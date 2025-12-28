/**
 * Telegram Bot
 * Handles all Telegram interactions
 */

import TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import type { AgentProvider, AgentContentBlock } from './providers/types.js';
import type { WhisperTranscriber } from './whisper.js';
import type { MemoryManager } from './memory.js';
import type { ResilienceManager } from './resilience.js';
import { GuardrailsManager, type WatchdogAnalysis, type AnalystAgentCallback } from './guardrails.js';
import type { TelegramConfig } from './types.js';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Type for markdown-it Token
type MdToken = {
  type: string;
  tag: string;
  content: string;
  info: string;
  children?: MdToken[] | null;
  attrGet?: (name: string) => string | null;
};

export class ProtoagentBot {
  private bot: TelegramBot;
  private config: TelegramConfig;
  private agent: AgentProvider;
  private whisper: WhisperTranscriber;
  private memory: MemoryManager;
  private resilience: ResilienceManager;
  private guardrails: GuardrailsManager;
  private processingLock: Map<number, boolean> = new Map();
  private currentTurnChatId: number | null = null;
  private typingInterval: NodeJS.Timeout | null = null;
  private md: MarkdownIt;

  constructor(
    config: TelegramConfig,
    agent: AgentProvider,
    whisper: WhisperTranscriber,
    memory: MemoryManager,
    resilience: ResilienceManager
  ) {
    this.config = config;
    this.agent = agent;
    this.whisper = whisper;
    this.memory = memory;
    this.resilience = resilience;
    this.guardrails = new GuardrailsManager();

    this.bot = new TelegramBot(config.botToken, { polling: true });
    // Handle polling errors (e.g., 409 Conflict when another instance is running)
    this.bot.on('polling_error', (err: Error) => {
      const msg = (err as Error & { response?: { body?: string } })?.response?.body || err?.toString() || 'Unknown polling error';
      try {
        // write to logs/error.log
        const LOGS_DIR = join(process.cwd(), 'logs');
        if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
        appendFileSync(join(process.cwd(), 'logs', 'error.log'), `[${new Date().toISOString()}] polling_error: ${msg}\n`);
      } catch (_e) {
        console.error('Failed to write polling error to log', _e);
      }

      console.error('Telegram polling error:', msg);

      // If conflict (409), attempt graceful backoff and restart polling
      if (typeof msg === 'string' && msg.includes('409')) {
        const attemptRestart = async (delayMs: number) => {
          console.log(`Polling conflict detected. Will attempt restart in ${delayMs}ms`);
          try {
            this.bot.stopPolling();
          } catch (_e) {}
          setTimeout(() => {
            try {
              // restart polling
              // @ts-ignore
              this.bot.startPolling({ restart: true });
              console.log('Attempted to restart Telegram polling');
            } catch (_e) {
              console.error('Failed to restart polling:', _e);
            }
          }, delayMs);
        };

        // exponential backoff: 5s, 15s, 60s
        attemptRestart(5000);
        attemptRestart(15000);
        attemptRestart(60000);
      }
    });
    // Markdown parser for converting provider Markdown -> Telegram-safe HTML
    this.md = new MarkdownIt({ html: false, linkify: true, typographer: true });
    this.setupHandlers();
    
    // Set up the analyst agent for the watchdog
    // Per project goals: "another agent should be spawned to analyze"
    this.setupAnalystAgent();
  }
  
  /**
   * Set up the analyst agent used by the watchdog
   * Uses the same provider but with a dedicated analysis prompt
   */
  private setupAnalystAgent(): void {
    const analystCallback: AnalystAgentCallback = async (turnSummary: string) => {
      const analysisPrompt = `Você é um agente analista de diagnóstico. Analise o seguinte turno de um agente AI e determine se ele está travado.

${turnSummary}

Responda APENAS em JSON no formato:
{
  "isStuck": true/false,
  "reason": "motivo se travado",
  "recommendation": "recomendação"
}

Considere travado se:
- Repetindo a mesma ação mais de 3 vezes
- Loop entre duas ações
- Sem progresso aparente após timeout
- Erros repetidos

Seja conservador: só considere travado se houver evidência clara.`;

      try {
        // Use the provider for analysis (ideally another lighter agent/model would be used)
        let response = '';
        for await (const msg of this.agent.query(analysisPrompt)) {
          for (const block of msg.content) {
            if (block.type === 'text') {
              response += block.text;
            }
          }
        }
        
        // Tentar parsear JSON da resposta
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            isStuck: Boolean(analysis.isStuck),
            reason: analysis.reason || 'Análise do agente',
            recommendation: analysis.recommendation || 'Verificar turno',
            analysisSource: 'agent' as const
          };
        }
      } catch (error) {
        console.error('[AnalystAgent] Erro na análise:', error);
      }
      
      // Fallback to heuristic if analysis fails
      return {
        isStuck: true,
        reason: 'Timeout excedido (análise do agente falhou)',
        recommendation: 'Abortar turno',
        analysisSource: 'heuristic' as const
      };
    };
    
    this.guardrails.watchdog.setAnalystAgent(analystCallback);
  }

  /**
   * Get guardrails manager (for external access to params)
   */
  getGuardrails(): GuardrailsManager {
    return this.guardrails;
  }

  /**
   * Setup message handlers
   */
  private setupHandlers(): void {
    // Handle text messages
    this.bot.on('message', async (msg) => {
      console.log(`📨 Telegram message received: ${msg.text?.substring(0, 50) || 'non-text'} from user ${msg.from?.id}`);
      if (msg.text && !msg.text.startsWith('/')) {
        await this.handleTextMessage(msg);
      }
    });

    // Handle voice messages
    this.bot.on('voice', async (msg) => {
      await this.handleVoiceMessage(msg);
    });

    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      await this.handleStartCommand(msg);
    });

    // Handle /reboot command
    this.bot.onText(/\/reboot/, async (msg) => {
      await this.handleRebootCommand(msg);
    });

    // Handle /status command
    this.bot.onText(/\/status/, async (msg) => {
      await this.handleStatusCommand(msg);
    });

    // Handle /clear command
    this.bot.onText(/\/clear/, async (msg) => {
      await this.handleClearCommand(msg);
    });

    // Handle /context command
    this.bot.onText(/\/context(?:\s+(.+))?/, async (msg, match) => {
      await this.handleContextCommand(msg, match?.[1]?.trim());
    });

    // Handle /params command
    this.bot.onText(/\/params(?:\s+(.+))?/, async (msg, match) => {
      await this.handleParamsCommand(msg, match?.[1]);
    });

    // Handle /model command
    this.bot.onText(/\/model(?:\s+(.+))?/, async (msg, match) => {
      await this.handleModelCommand(msg, match?.[1]?.trim());
    });

    // Handle /saveparams command
    this.bot.onText(/\/saveparams/, async (msg) => {
      await this.handleSaveParamsCommand(msg);
    });

    // Handle /todo command
    this.bot.onText(/\/todo(?:\s+(.+))?/, async (msg, match) => {
      await this.handleTodoCommand(msg, match?.[1]?.trim());
    });

    // Handle /logs command
    this.bot.onText(/\/logs(?:\s+(\d+))?/, async (msg, match) => {
      await this.handleLogsCommand(msg, match?.[1]);
    });

    // Handle errors
    this.bot.on('polling_error', (error) => {
      console.error('Polling error:', error);
      this.resilience.logError(error);
    });
  }

  /**
   * Ensure user has a session ID in the provider
   */
  private ensureUserSession(userId: number): void {
    // Check if provider supports session management
    if (!this.agent.setSessionId || !this.agent.getSessionId || !this.agent.setContextMode) {
      return; // Provider doesn't support sessions (skip)
    }
    
    // For Copilot: use 'continue' mode (resume most recent session automatically)
    // This avoids the "Session file is corrupted or incompatible" error
    // because we don't need to provide a sessionId - Copilot manages it
    if (this.agent.name === 'copilot') {
      this.agent.setContextMode('continue');
      return;
    }
    
    // For Claude: use custom sessionId per user
    const currentSession = this.agent.getSessionId();
    if (currentSession) {
      return; // Already has a session
    }
    
    const sessionId = `telegram-user-${userId}`;
    this.agent.setSessionId(sessionId);
    this.agent.setContextMode('resume');
  }

  /**
   * Check if user is allowed
   */
  private isAllowedUser(userId: number): boolean {
    return this.config.allowedUserIds.includes(userId);
  }

  /**
   * Check if user is already processing a message
   */
  private isProcessing(userId: number): boolean {
    return this.processingLock.get(userId) || false;
  }

  /**
   * Set processing lock
   */
  private setProcessing(userId: number, processing: boolean): void {
    this.processingLock.set(userId, processing);
  }

  /**
   * Send typing indicator
   */
  private async sendTyping(chatId: number): Promise<void> {
    await this.bot.sendChatAction(chatId, 'typing');
  }

  /**
   * Start continuous typing indicator
   * Telegram typing indicator lasts only 5 seconds, so we need to keep sending it
   */
  private startContinuousTyping(chatId: number): void {
    this.stopContinuousTyping();
    
    // Send immediately
    this.sendTyping(chatId).catch(err => 
      console.error('Error sending typing indicator:', err)
    );
    
    // Then send every 4 seconds (before the 5-second expiry)
    this.typingInterval = setInterval(() => {
      this.sendTyping(chatId).catch(err => 
        console.error('Error sending typing indicator:', err)
      );
    }, 4000);
  }

  /**
   * Stop continuous typing indicator
   */
  private stopContinuousTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  /**
   * Send message with HTML formatting
   */
  private async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (_error) {
      // Fallback to plain text if HTML fails
      await this.bot.sendMessage(chatId, text);
    }
  }

  /**
   * Convert Markdown (from provider) to Telegram-compatible HTML.
   * - transforms headings to <b>
   * - converts lists to plain lines prefixed with '-' or '1.'
   * - preserves fenced code as <pre><code>
   * - converts tables into monospaced <pre><code> blocks
   * - removes <p> tags and collapses excessive blank lines
   */
  private mdToTelegramHtml(markdown: string): string {
    if (!markdown) return '';

    const tokens = this.md.parse(markdown, {}) as unknown as MdToken[];
    const result = this.processTokens(tokens, 0, tokens.length, []);
    
    // Sanitize and collapse excessive newlines
    const clean = sanitizeHtml(result, {
      allowedTags: ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote'],
      allowedAttributes: { a: ['href'] },
    });

    return clean.replace(/\n{3,}/g, '\n\n').trim();
  }

  private processTokens(
    tokens: MdToken[],
    start: number,
    end: number,
    listStack: Array<{ ordered: boolean; index: number }>
  ): string {
    let out = '';
    let i = start;

    while (i < end) {
      const tok = tokens[i];
      if (!tok) {
        i++;
        continue;
      }

      switch (tok.type) {
        case 'heading_open': {
          const inline = tokens[i + 1];
          const txt = this.renderInlineTokens(inline?.children || []);
          out += `<b>${txt}</b>\n\n`;
          i += 3;
          break;
        }

        case 'paragraph_open': {
          const inline = tokens[i + 1];
          const txt = this.renderInlineTokens(inline?.children || []);
          // Inside lists, don't add extra spacing
          if (listStack.length > 0) {
            out += txt;
          } else {
            out += `${txt}\n\n`;
          }
          i += 3;
          break;
        }

        case 'blockquote_open': {
          // Find matching blockquote_close
          let depth = 1;
          let j = i + 1;
          while (j < end && depth > 0) {
            const token = tokens[j];
            if (!token) break;
            if (token.type === 'blockquote_open') depth++;
            if (token.type === 'blockquote_close') depth--;
            j++;
          }
          const content = this.processTokens(tokens, i + 1, j - 1, listStack);
          out += `<blockquote>${content}</blockquote>\n\n`;
          i = j;
          break;
        }

        case 'bullet_list_open': {
          // Find matching close
          let depth = 1;
          let j = i + 1;
          while (j < end && depth > 0) {
            const token = tokens[j];
            if (!token) break;
            if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') depth++;
            if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') depth--;
            j++;
          }
          listStack.push({ ordered: false, index: 0 });
          const listContent = this.processTokens(tokens, i + 1, j - 1, listStack);
          listStack.pop();
          out += listContent + '\n';
          i = j;
          break;
        }

        case 'ordered_list_open': {
          // Find matching close
          let depth = 1;
          let j = i + 1;
          while (j < end && depth > 0) {
            const token = tokens[j];
            if (!token) break;
            if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') depth++;
            if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') depth--;
            j++;
          }
          listStack.push({ ordered: true, index: 0 });
          const listContent = this.processTokens(tokens, i + 1, j - 1, listStack);
          listStack.pop();
          out += listContent + '\n';
          i = j;
          break;
        }

        case 'list_item_open': {
          // Find matching list_item_close
          let depth = 1;
          let j = i + 1;
          while (j < end && depth > 0) {
            const token = tokens[j];
            if (!token) break;
            if (token.type === 'list_item_open') depth++;
            if (token.type === 'list_item_close') depth--;
            j++;
          }
          const lvl = listStack.length;
          const ctx = listStack[listStack.length - 1];
          if (!ctx) break;
          const prefix = ctx.ordered ? `${++ctx.index}. ` : '• ';
          const indent = '  '.repeat(lvl - 1);
          const itemContent = this.processTokens(tokens, i + 1, j - 1, listStack);
          out += `${indent}${prefix}${itemContent.trim()}\n`;
          i = j;
          break;
        }

        case 'fence': {
          const lang = tok.info ? String(tok.info).trim().split(/\s+/)[0] : '';
          if (lang) {
            out += `<b>${this.escapeHtml(lang)}</b>\n`;
          }
          out += `<pre><code>${this.escapeHtml(tok.content)}</code></pre>\n\n`;
          i++;
          break;
        }

        case 'code_block': {
          out += `<pre><code>${this.escapeHtml(tok.content)}</code></pre>\n\n`;
          i++;
          break;
        }

        case 'table_open': {
          // Find table_close
          let j = i + 1;
          while (j < end) {
            const token = tokens[j];
            if (!token || token.type === 'table_close') break;
            j++;
          }
          
          const rows: string[][] = [];
          let k = i + 1;
          while (k < j) {
            const rowToken = tokens[k];
            if (!rowToken) break;
            if (rowToken.type === 'tr_open') {
              const cells: string[] = [];
              k++;
              while (k < j) {
                const cellToken = tokens[k];
                if (!cellToken || cellToken.type === 'tr_close') break;
                if (cellToken.type === 'th_open' || cellToken.type === 'td_open') {
                  const inline = tokens[k + 1];
                  const cell = this.renderInlineTokens(inline?.children || []);
                  cells.push(cell.replace(/\n/g, ' ').trim());
                  k += 3;
                } else {
                  k++;
                }
              }
              if (cells.length > 0) rows.push(cells);
              k++;
            } else {
              k++;
            }
          }

          if (rows.length > 0) {
            const cols = Math.max(...rows.map((r) => r.length));
            const widths: number[] = [];
            for (let c = 0; c < cols; c++) {
              widths[c] = Math.max(...rows.map((r) => (r[c] || '').length));
            }
            const lines = rows.map((r) =>
              r.map((c, ci) => c.padEnd(widths[ci] || 0, ' ')).join(' | ')
            );
            const tableText = lines.join('\n');
            out += `<pre><code>${this.escapeHtml(tableText)}</code></pre>\n\n`;
          }
          i = j + 1;
          break;
        }

        case 'hr':
          out += '─────────────\n\n';
          i++;
          break;

        default:
          i++;
          break;
      }
    }

    return out;
  }

  private renderInlineTokens(tokens: MdToken[]): string {
    let result = '';
    for (const tok of tokens) {
      switch (tok.type) {
        case 'text':
          result += this.escapeHtml(tok.content);
          break;
        case 'code_inline':
          result += `<code>${this.escapeHtml(tok.content)}</code>`;
          break;
        case 'strong_open':
          result += '<b>';
          break;
        case 'strong_close':
          result += '</b>';
          break;
        case 'em_open':
          result += '<i>';
          break;
        case 'em_close':
          result += '</i>';
          break;
        case 's_open':
          result += '<s>';
          break;
        case 's_close':
          result += '</s>';
          break;
        case 'link_open': {
          const href = tok.attrGet ? tok.attrGet('href') : null;
          result += `<a href="${this.escapeHtml(href || '')}">`;
          break;
        }
        case 'link_close':
          result += '</a>';
          break;
        case 'softbreak':
        case 'hardbreak':
          result += '\n';
          break;
        default:
          break;
      }
    }
    return result;
  }

  private escapeHtml(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Handle /start command
   */
  private async handleStartCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      await this.sendMessage(chatId, '⛔ Acesso negado. Você não está autorizado a usar este bot.');
      return;
    }

    const currentModel = this.agent.getParams().model || 'default';

    const welcomeMsg = `
🤖 <b>Protoagente</b>

Bem-vindo! Sou um assistente AI inteligente com capacidades avançadas.

<b>Provider:</b> ${this.agent.displayName}
<b>Modelo:</b> <code>${currentModel}</code>

<b>Comandos disponíveis:</b>
/start - Mostrar esta mensagem
/status - Ver status atual e tarefas
/clear - Limpar histórico de conversa
/reboot - Reiniciar o bot
/model - Ver/trocar modelo de AI
/params - Ver/alterar parâmetros
/saveparams - Salvar parâmetros como padrão
/logs [n] - Ver últimos n turnos logados

<b>Capacidades:</b>
✅ Tool calling (bash, edit, web, etc)
✅ Memória de conversas anteriores
✅ Suporte a mensagens de voz (Whisper)
✅ Recuperação automática de crashes
✅ Watchdog anti-loop/travamento
✅ Parametrização dinâmica

Pode me enviar mensagens de texto ou áudio!
    `.trim();

    await this.sendMessage(chatId, welcomeMsg);
  }

  /**
   * Handle /status command
   */
  private async handleStatusCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    const state = this.memory.state.getState();
    const todos = this.memory.state.getTodos();
    const recentSessions = this.memory.short.getRecentSessions(3);

    let statusMsg = '📊 <b>Status do Protoagente</b>\n\n';

    // Current tasks
    if (todos.length > 0) {
      statusMsg += '<b>Tarefas Atuais:</b>\n';
      todos.forEach((todo, i) => {
        const status = todo.status === 'completed' ? '✅' :
                      todo.status === 'in_progress' ? '🔄' : '⏳';
        statusMsg += `${status} ${i + 1}. ${todo.task}\n`;
      });
      statusMsg += '\n';
    } else {
      statusMsg += '<b>Tarefas:</b> Nenhuma tarefa ativa\n\n';
    }

    // Recent sessions
    if (recentSessions.length > 0) {
      statusMsg += `<b>Últimas Interações:</b> ${recentSessions.length}\n`;
      statusMsg += `<b>Última atualização:</b> ${new Date(state.lastUpdate).toLocaleString()}\n`;
    } else {
      statusMsg += '<b>Histórico:</b> Nenhuma interação recente\n';
    }

    await this.sendMessage(chatId, statusMsg);
  }

  /**
   * Handle /clear command
   */
  private async handleClearCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    // Clear short memory
    this.memory.short.clear();
    
    // Clear provider session context (if supported)
    if (this.agent.clearContext) {
      this.agent.clearContext();
    }
    
    // For Copilot: clearContext() already resets to new session (using --continue)
    // For Claude: we can generate a new sessionId
    if (this.agent.name === 'claude' && this.agent.setSessionId) {
      const newSessionId = `telegram-user-${userId}-${Date.now()}`;
      this.agent.setSessionId(newSessionId);
    }

    const sessionInfo = this.agent.getSessionId?.() 
      ? ` (sessão: ${this.agent.getSessionId()?.slice(0, 8)}...)` 
      : '';
    
    await this.sendMessage(chatId, `🗑️ Histórico de conversa limpo!${sessionInfo}\n\n💡 Nova conversa iniciada.`);
  }

  /**
   * Handle /context command - gerencia modo de contexto
   */
  private async handleContextCommand(msg: Message, args?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    // Check if the provider supports context
    if (!this.agent.setContextMode) {
      await this.sendMessage(chatId, `⚠️ O provider <b>${this.agent.displayName}</b> não suporta gerenciamento de contexto.`);
      return;
    }

    if (!args) {
      // Mostrar status atual
      const sessionId = this.agent.getSessionId?.();
      const sessionInfo = sessionId ? `\n📋 <b>Session ID:</b> <code>${sessionId}</code>` : '';
      
      let statusMsg = `🧠 <b>Contexto de Sessão</b>\n\n`;
      statusMsg += `<b>Provider:</b> ${this.agent.displayName}\n`;
      statusMsg += `<b>Status:</b> ${sessionId ? '✅ Ativo' : '⏸️ Nova sessão'}${sessionInfo}\n\n`;
      statusMsg += `<b>Comandos:</b>\n`;
      statusMsg += `• <code>/context continue</code> - Continua última sessão\n`;
      statusMsg += `• <code>/context none</code> - Sem memória (cada msg independente)\n`;
      statusMsg += `• <code>/clear</code> - Limpa e inicia nova sessão`;
      
      await this.sendMessage(chatId, statusMsg);
      return;
    }

    const mode = args.toLowerCase();
    
    if (mode === 'continue' || mode === 'none' || mode === 'resume') {
      this.agent.setContextMode(mode as 'none' | 'continue' | 'resume');
      
      const modeEmoji = mode === 'continue' ? '🔄' : mode === 'none' ? '🔕' : '📂';
      const modeDesc = mode === 'continue' 
        ? 'Continuando sessões automaticamente' 
        : mode === 'none' 
        ? 'Cada mensagem é independente (sem memória)'
        : 'Modo resume ativo';
      
      await this.sendMessage(chatId, `${modeEmoji} <b>Modo de contexto:</b> ${mode}\n\n${modeDesc}`);
    } else {
      await this.sendMessage(chatId, `❌ Modo inválido: <code>${mode}</code>\n\nUse: <code>continue</code>, <code>none</code>, ou <code>resume</code>`);
    }
  }

  /**
   * Handle /params command
   */
  private async handleParamsCommand(msg: Message, args?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    if (!args) {
      // Show current params (both guardrails and provider)
      const guardrailParams = this.guardrails.params.getParams();
      const providerParams = this.agent.getParams();
      
      let paramsMsg = `⚙️ <b>Parâmetros Atuais</b>\n`;
      paramsMsg += `\n<b>Provider:</b> ${this.agent.displayName}\n\n`;
      
      // Provider parameters
      paramsMsg += `<b>— Provider —</b>\n`;
      Object.entries(providerParams).forEach(([key, value]) => {
        paramsMsg += `<b>${key}:</b> <code>${JSON.stringify(value)}</code>\n`;
      });
      
      // Guardrails parameters
      paramsMsg += `\n<b>— Guardrails —</b>\n`;
      Object.entries(guardrailParams).forEach(([key, value]) => {
        if (!providerParams[key]) { // Evitar duplicatas
          paramsMsg += `<b>${key}:</b> <code>${JSON.stringify(value)}</code>\n`;
        }
      });

      paramsMsg += '\n<i>Use /params chave=valor para alterar</i>';
      paramsMsg += '\n<i>Use /model para trocar modelo</i>';
      paramsMsg += '\n<i>Use /saveparams para salvar como padrão</i>';

      await this.sendMessage(chatId, paramsMsg);
      return;
    }

    // Parse key=value
    const match = args.match(/^(\w+)\s*=\s*(.+)$/);
    if (!match || !match[1] || !match[2]) {
      await this.sendMessage(chatId, '❌ Formato inválido. Use: /params chave=valor');
      return;
    }

    const key = match[1];
    const rawValue = match[2];
    let value: string | number | boolean | object = rawValue;

    // Try to parse value as JSON (for numbers, booleans, etc)
    try {
      value = JSON.parse(rawValue);
    } catch {
      // Keep as string
    }

    // Update both guardrails and provider
    this.guardrails.params.setParam(key, value);
    this.agent.setParam(key, value);
    
    await this.sendMessage(chatId, `✅ Parâmetro <b>${key}</b> alterado para <code>${JSON.stringify(value)}</code>`);
  }

  /**
   * Handle /saveparams command
   */
  private async handleSaveParamsCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    this.guardrails.params.saveAsDefaults();
    await this.sendMessage(chatId, '💾 Parâmetros salvos como padrão!');
  }

  /**
   * Handle /model command
   */
  private async handleModelCommand(msg: Message, modelName?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    // If no model specified, list available models
    if (!modelName) {
      const models = await this.agent.getAvailableModels();
      const currentModel = this.agent.getParams().model;
      
      let msg = `🤖 <b>Modelos Disponíveis</b>\n\n`;
      models.forEach((model, _i) => {
        const isCurrent = model === currentModel;
        msg += `${isCurrent ? '✅' : '○'} <code>${model}</code>${isCurrent ? ' (atual)' : ''}\n`;
      });
      
      msg += `\n<i>Use /model nome_do_modelo para trocar</i>`;
      
      await this.sendMessage(chatId, msg);
      return;
    }

    // Validar modelo
    const models = await this.agent.getAvailableModels();
    if (!models.includes(modelName)) {
      await this.sendMessage(chatId, `❌ Modelo não encontrado: <code>${modelName}</code>\n\nUse /model para ver os disponíveis.`);
      return;
    }

    // Trocar modelo
    this.agent.setParam('model', modelName);
    this.guardrails.params.setParam('model', modelName);
    
    await this.sendMessage(chatId, `✅ Modelo alterado para <code>${modelName}</code>`);
  }
  /**
   * Handle /todo command - manage TODO list
   */
  private async handleTodoCommand(msg: Message, args?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    if (!args) {
      // Show current TODOs
      const todos = this.memory.state.getTodos();

      if (todos.length === 0) {
        await this.sendMessage(chatId, '📋 <b>Tarefas</b>\n\nNenhuma tarefa no momento. Use /todo add <tarefa> para criar uma!');
        return;
      }

      let todoMsg = '📋 <b>Tarefas Atuais</b>\n\n';
      todos.forEach((todo, i) => {
        const statusEmoji = todo.status === 'completed' ? '✅' :
                           todo.status === 'in_progress' ? '🔄' : '⏳';
        todoMsg += `${statusEmoji} ${i + 1}. ${todo.task}\n`;
      });

      todoMsg += '\n<i>Use /todo mark <n> <status> para alterar (ex: /todo mark 1 completed)</i>';
      todoMsg += '\n<i>Use /todo delete <n> para remover</i>';

      await this.sendMessage(chatId, todoMsg);
      return;
    }

    // Parse command
    const parts = args.split(' ');
    const subcommand = parts[0]?.toLowerCase();
    if (!subcommand) {
      await this.sendMessage(chatId, '❌ Comando incompleto');
      return;
    }

    if (subcommand === 'add') {
      const task = parts.slice(1).join(' ');
      if (!task) {
        await this.sendMessage(chatId, '❌ Use: /todo add <descrição da tarefa>');
        return;
      }

      this.memory.state.addTodo(task);
      await this.sendMessage(chatId, `✅ Tarefa adicionada: "${task}"`);
    } else if (subcommand === 'mark' || subcommand === 'status') {
      if (!parts[1] || !parts[2]) {
        await this.sendMessage(chatId, '❌ Use: /todo mark <número> <pending|in_progress|completed>');
        return;
      }
      const index = parseInt(parts[1]) - 1;
      const status = parts[2] as 'pending' | 'in_progress' | 'completed';

      if (Number.isNaN(index) || !['pending', 'in_progress', 'completed'].includes(status)) {
        await this.sendMessage(chatId, '❌ Use: /todo mark <número> <pending|in_progress|completed>');
        return;
      }

      this.memory.state.updateTodoStatus(index, status);
      await this.sendMessage(chatId, `✅ Status atualizado para: ${status}`);
    } else if (subcommand === 'delete' || subcommand === 'remove') {
      if (!parts[1]) {
        await this.sendMessage(chatId, '❌ Use: /todo delete <número>');
        return;
      }
      const index = parseInt(parts[1]) - 1;

      if (Number.isNaN(index)) {
        await this.sendMessage(chatId, '❌ Use: /todo delete <número>');
        return;
      }

      const todos = this.memory.state.getTodos();
      if (index < 0 || index >= todos.length) {
        await this.sendMessage(chatId, '❌ Tarefa não encontrada');
        return;
      }

      const todo = todos[index];
      if (!todo) {
        await this.sendMessage(chatId, '❌ Tarefa não encontrada');
        return;
      }
      const task = todo.task;
      todos.splice(index, 1);
      this.memory.state.updateTodos(todos);

      await this.sendMessage(chatId, `✅ Tarefa removida: "${task}"`);
    } else {
      await this.sendMessage(chatId, '❌ Comando desconhecido. Use /todo para ver opções.');
    }
  }

  /**
   * Handle /logs command
   */
  private async handleLogsCommand(msg: Message, countStr?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    const count = countStr ? parseInt(countStr) : 5;
    const turns = this.guardrails.turnLogger.getLoggedTurns().slice(-count);

    if (turns.length === 0) {
      await this.sendMessage(chatId, '📋 Nenhum turno logado ainda.');
      return;
    }

    let logsMsg = `📋 <b>Últimos ${turns.length} Turnos</b>\n\n`;

    turns.forEach((turn, i) => {
      const date = new Date(turn.timestamp).toLocaleString();
      const status = turn.completed ? '✅' : '❌';
      const duration = (turn.duration / 1000).toFixed(1);
      
      logsMsg += `<b>${i + 1}. ${status} ${date}</b>\n`;
      logsMsg += `Prompt: <code>${turn.userPrompt.substring(0, 50)}${turn.userPrompt.length > 50 ? '...' : ''}</code>\n`;
      logsMsg += `Duração: ${duration}s | Ações: ${turn.actions.length}\n`;
      if (turn.abortReason) {
        logsMsg += `Motivo: ${turn.abortReason}\n`;
      }
      logsMsg += '\n';
    });

    await this.sendMessage(chatId, logsMsg);
  }

  /**
   * Handle /reboot command
   */
  private async handleRebootCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      return;
    }

    await this.sendMessage(chatId, '🔄 Reiniciando o bot...');

    // Use the restart script for planned reboot
    const { exec } = require('child_process');
    exec('bash scripts/restart.sh', (error: Error | null) => {
      if (error) {
        console.error('Error executing restart script:', error);
      }
    });
  }

  /**
   * Handle text message
   */
  private async handleTextMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text;

    if (!userId || !this.isAllowedUser(userId) || !text) {
      return;
    }

    if (this.isProcessing(userId)) {
      await this.sendMessage(chatId, '⏳ Aguarde a resposta anterior terminar...');
      return;
    }

    this.setProcessing(userId, true);

    try {
      await this.processUserMessage(chatId, text);
    } finally {
      this.setProcessing(userId, false);
    }
  }

  /**
   * Handle voice message
   */
  private async handleVoiceMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const voice = msg.voice;

    if (!userId || !this.isAllowedUser(userId) || !voice) {
      return;
    }

    if (this.isProcessing(userId)) {
      await this.sendMessage(chatId, '⏳ Aguarde a resposta anterior terminar...');
      return;
    }

    this.setProcessing(userId, true);

    try {
      await this.sendTyping(chatId);
      await this.sendMessage(chatId, '🎤 Transcrevendo áudio...');

      // Download voice file
      const fileLink = await this.bot.getFileLink(voice.file_id);
      const response = await fetch(fileLink);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      // Transcribe
      const transcription = await this.whisper.transcribe(audioBuffer, 'voice.ogg');

      // Validate transcription result
      if (!transcription || transcription.trim().length === 0) {
        await this.sendMessage(chatId, '❌ Não foi possível transcrever o áudio. Tente novamente ou envie uma mensagem de texto.');
        return;
      }

      await this.sendMessage(chatId, `📝 <i>Transcrição:</i> "${transcription}"\n`);

      // Process transcription as text
      await this.processUserMessage(chatId, transcription);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.sendMessage(chatId, `❌ Erro ao transcrever áudio: ${errorMsg}`);
      this.resilience.logError(error instanceof Error ? error : new Error(errorMsg));
      // Don't call processUserMessage on error - just fail and return
    } finally {
      this.setProcessing(userId, false);
    }
  }

  /**
   * Process user message (common logic for text and voice)
   */
  private async processUserMessage(chatId: number, message: string): Promise<void> {
    // Initialize session ID for this user if not set
    const userId = chatId; // Using chatId as userId for simplicity
    this.ensureUserSession(userId);
    
    // Save pending turn for crash recovery
    this.resilience.savePendingTurn(message);
    this.currentTurnChatId = chatId;

    // Register current prompt and update state
    this.memory.state.setCurrentPrompt(message);

    // Auto-create TODO for this turn (if it looks like a task)
    const shouldCreateTodo = this.looksLikeTask(message);
    if (shouldCreateTodo) {
      this.memory.state.addTodo(message);
    }

    // Get current params from both guardrails and provider (merge them)
    const guardrailParams = this.guardrails.params.getParams();
    const providerParams = this.agent.getParams();
    const mergedParams = { ...guardrailParams, ...providerParams };
    
    // Start turn logging with merged params
    this.guardrails.turnLogger.startTurn(message, mergedParams);

    // Synchronize guardrails parameters with provider
    this.agent.setParams(mergedParams);

    // Setup watchdog for timeout detection
    this.guardrails.watchdog.startWatching(async (analysis: WatchdogAnalysis) => {
      await this.handleStuckAgent(chatId, analysis);
    });

    try {
      // Build prompt with memory context
      const contextPrompt = this.buildPromptWithContext(message);

      // Start continuous typing indicator
      this.startContinuousTyping(chatId);

      // Process agent response via streaming
      let fullResponse = '';
      
      for await (const agentMsg of this.agent.query(contextPrompt)) {
        // Process each content block
        for (const block of agentMsg.content) {
          await this.processContentBlock(chatId, block);
          
          // Accumulate text for memory
          if (block.type === 'text') {
            fullResponse += block.text;
          }
        }
      }

      // Stop continuous typing and watchdog
      this.stopContinuousTyping();
      this.guardrails.watchdog.stopWatching();
      this.guardrails.turnLogger.endTurn(true);

      // Save to memory
      if (fullResponse) {
        this.memory.short.addSession(message, fullResponse);
      }

      // Clear pending turn after successful processing
      this.resilience.clearPendingTurn();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Stop continuous typing
      this.stopContinuousTyping();
      
      // Log error
      this.guardrails.turnLogger.logError(errorMsg);
      this.guardrails.watchdog.stopWatching();
      this.guardrails.turnLogger.endTurn(false, errorMsg);
      
      await this.sendTyping(chatId);
      await this.sendMessage(chatId, `❌ <b>Erro ao processar mensagem:</b> ${errorMsg}`);
      this.resilience.logError(error instanceof Error ? error : new Error(errorMsg));

      // Clear pending turn even on error
      this.resilience.clearPendingTurn();
    } finally {
      this.currentTurnChatId = null;
    }
  }

  /**
   * Build prompt with memory context
   * 
   * If the provider holds a session (e.g. Claude), the SDK manages context.
   * Otherwise (or if `clearContext` was called), inject local memory context.
   */
  private buildPromptWithContext(message: string): string {
    // Check if provider has an active session (method exists AND returns truthy value)
    const hasActiveSession = typeof this.agent.getSessionId === 'function' && !!this.agent.getSessionId();
    
    if (hasActiveSession) {
      // Provider maintains context - just send the message
      return message;
    }
    
    // No active session - inject local memory context
    const basePrompt = this.getBaseSystemPrompt();
    const memoryContext = this.memory.getSystemPromptWithContext(basePrompt);
    
    // Prefix message with memory context
    return `[Contexto de memórias anteriores]\n${memoryContext}\n\n[Mensagem do usuário]\n${message}`;
  }

  /**
   * Process a single content block from agent response
   */
  private async processContentBlock(chatId: number, block: AgentContentBlock): Promise<void> {
    switch (block.type) {
      case 'text':
        this.guardrails.turnLogger.logTextResponse(block.text);
        // Convert provider Markdown to Telegram-safe HTML
        try {
          const html = this.mdToTelegramHtml(block.text);
          await this.sendMessage(chatId, html || block.text);
        } catch (_err) {
          // On any error, fallback to plain text
          await this.sendMessage(chatId, block.text);
        }
        break;
        
      case 'tool_use': {
        this.guardrails.turnLogger.logToolCall(block.toolName, block.toolInput as Record<string, unknown>);
        const toolMsg = this.formatToolUseMessage(block.toolName, block.toolInput);
        await this.sendMessage(chatId, toolMsg);
        break;
      }
        
      case 'tool_result':
        this.guardrails.turnLogger.logToolResult(block.toolName, block.toolResult);
        // Tool results are generally not sent to the user
        // Mas podemos logar para debug
        break;
        
      case 'error':
        this.guardrails.turnLogger.logError(block.error);
        await this.sendMessage(chatId, `❌ <b>Erro:</b> ${block.error}`);
        break;
    }
  }

  /**
   * Format tool use message for Telegram
   */
  private formatToolUseMessage(toolName: string, toolInput: Record<string, unknown>): string {
    const icons: Record<string, string> = {
      'Read': '📖',
      'Write': '📝',
      'Edit': '✏️',
      'Bash': '💻',
      'Grep': '🔍',
      'Glob': '📁',
      'Task': '🤖',
      'WebFetch': '🌐',
      'WebSearch': '🔎',
      'LSP': '🧠',
      'TodoWrite': '📋',
    };

    const icon = icons[toolName] || '⚙️';
    
    // Simplify display of the input
    let inputStr = '';
    if (toolInput.command) {
      inputStr = String(toolInput.command).substring(0, 100);
    } else if (toolInput.file_path) {
      inputStr = String(toolInput.file_path);
    } else if (toolInput.query) {
      inputStr = String(toolInput.query).substring(0, 100);
    }
    
    if (inputStr) {
      return `${icon} <b>${toolName}</b>: <code>${inputStr}</code>`;
    }
    return `${icon} <b>${toolName}</b>`;
  }

  /**
   * Handle stuck agent detected by watchdog
   */
  private async handleStuckAgent(chatId: number, analysis: WatchdogAnalysis): Promise<void> {
    // Abort the active query immediately
    this.agent.abort();
    
    // Stop the watchdog
    this.guardrails.watchdog.stopWatching();
    
    // Log the abort
    this.guardrails.turnLogger.endTurn(false, analysis.reason);
    
    // Clear context if provider supports it
    if (this.agent.clearContext) {
      this.agent.clearContext();
    }
    
    // Send user-friendly message
    const message = `⚠️ <b>Turno Abortado</b>\n\n` +
      `O agente foi interrompido por estar aparentemente travado.\n\n` +
      `<b>Motivo:</b> ${analysis.reason || 'Timeout excedido'}\n\n` +
      `<i>Por favor, tente reformular sua solicitação ou reinicie com /reboot</i>`;
    
    await this.sendTyping(chatId);
    await this.sendMessage(chatId, message);
    
    // Clear pending turn
    this.resilience.clearPendingTurn();
    
    // Get the user from the current turn
    const userId = this.currentTurnChatId === chatId ? chatId : null;
    if (userId) {
      // Release processing lock
      this.setProcessing(userId, false);
    }
  }

  /**
   * Check if message looks like a task (heuristic)
   */
  private looksLikeTask(message: string): boolean {
    // Skip very short messages (greetings, acknowledgments, etc.)
    if (message.length < 10) {
      return false;
    }
    
    const taskKeywords = [
      'fazer', 'criar', 'gerar', 'escrever', 'editar', 'remover', 'deletar',
      'modificar', 'alterar', 'trocar', 'atualizar', 'corrigir', 'ficar',
      'ajudar', 'analisar', 'revisar', 'verificar', 'testar', 'implementar',
      'refatorar', 'otimizar', 'melhorar', 'debug', 'fix', 'build', 'deploy',
      'find', 'search', 'buscar', 'procurar', 'pesquisar', 'investigate'
    ];
    
    const lowerMessage = message.toLowerCase();
    
    // Check for imperative verbs or task-like patterns
    const hasTaskKeyword = taskKeywords.some(keyword => lowerMessage.includes(keyword));
    const hasImperative = /^(fazer|criar|gerar|escrever|por favor|pls|please)/i.test(message);
    
    // Only create TODO if explicitly contains task keywords or imperative verbs
    return hasTaskKeyword || hasImperative;
  }

  /**
   * Get base system prompt
   */
  private getBaseSystemPrompt(): string {
    // Check if custom system prompt is set in params
    const customPrompt = this.guardrails.params.getParams().systemPrompt;
    if (customPrompt) {
      return customPrompt;
    }

    return `Você é o Protoagente, um assistente AI inteligente e prestativo.

Você tem capacidade de manter memória de conversas anteriores e gerenciar tarefas.

Sempre seja:
- Claro e objetivo
- Prestativo e amigável
- Honesto sobre suas limitações
- Proativo em sugerir soluções

Quando receber uma tarefa complexa, quebre-a em subtarefas e as organize.

Você pode solicitar ao usuário que altere seus parâmetros usando /params chave=valor, incluindo:
- model: o modelo de AI a ser usado
- temperature: nível de criatividade (0-1)
- maxTokens: limite de tokens na resposta
- turnTimeout: tempo limite do turno em ms (padrão: 600000 = 10 minutos)
- systemPrompt: prompt de sistema customizado`;
  }

  /**
   * Send boot notification
   */
  async sendBootNotification(message: string): Promise<void> {
    for (const userId of this.config.allowedUserIds) {
      try {
        await this.sendMessage(userId, message);
      } catch (error) {
        console.error(`Error sending boot notification to user ${userId}:`, error);
      }
    }
  }

  /**
   * Stop the bot
   */
  stop(): void {
    this.bot.stopPolling();
  }
}
