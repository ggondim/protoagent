/**
 * Telegram Channel
 * Handles Telegram bot interactions using AgentService
 */

import TelegramBot from 'node-telegram-bot-api';
import type { Message } from 'node-telegram-bot-api';
import type { AgentService } from '../core/agent-service.js';
import type { Channel, ChannelOptions, ResponseChunk } from './types.js';
import type { TelegramConfig } from '../types.js';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import i18n, { t } from '../i18n/index.js';

type MdToken = {
  type: string;
  tag: string;
  content: string;
  info: string;
  children?: MdToken[] | null;
  attrGet?: (name: string) => string | null;
};

export interface TelegramChannelConfig extends TelegramConfig {
  enabled: boolean;
}

export class TelegramChannel implements Channel {
  readonly name = 'telegram';
  readonly displayName = 'Telegram';

  private bot: TelegramBot;
  private config: TelegramChannelConfig;
  private agentService: AgentService;
  private typingIntervals: Map<number, NodeJS.Timeout> = new Map();
  private md: MarkdownIt;

  constructor(config: TelegramChannelConfig, options: ChannelOptions) {
    this.config = config;
    this.agentService = options.agentService;

    this.bot = new TelegramBot(config.botToken, { polling: false });
    this.md = new MarkdownIt({ html: false, linkify: true, typographer: true });

    this.setupPollingErrorHandler();
  }

  private setupPollingErrorHandler(): void {
    this.bot.on('polling_error', (err: Error) => {
      const msg =
        (err as Error & { response?: { body?: string } })?.response?.body ||
        err?.toString() ||
        'Unknown polling error';

      try {
        const LOGS_DIR = join(process.cwd(), 'logs');
        if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
        appendFileSync(
          join(process.cwd(), 'logs', 'error.log'),
          `[${new Date().toISOString()}] polling_error: ${msg}\n`
        );
      } catch (_e) {
        console.error('Failed to write polling error to log', _e);
      }

      console.error('Telegram polling error:', msg);

      if (typeof msg === 'string' && msg.includes('409')) {
        this.handlePollingConflict();
      }
    });
  }

  private handlePollingConflict(): void {
    const attemptRestart = (delayMs: number) => {
      console.log(`Polling conflict detected. Will attempt restart in ${delayMs}ms`);
      try {
        this.bot.stopPolling();
      } catch (_e) {}
      setTimeout(() => {
        try {
          // @ts-ignore
          this.bot.startPolling({ restart: true });
          console.log('Attempted to restart Telegram polling');
        } catch (_e) {
          console.error('Failed to restart polling:', _e);
        }
      }, delayMs);
    };

    attemptRestart(5000);
    attemptRestart(15000);
    attemptRestart(60000);
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('  ⏭️  Telegram channel disabled');
      return;
    }

    this.setupHandlers();
    this.bot.startPolling();
    console.log('  ✅ Telegram channel started');
  }

  async stop(): Promise<void> {
    this.bot.stopPolling();
    this.typingIntervals.forEach((interval) => clearInterval(interval));
    this.typingIntervals.clear();
  }

  async sendNotification(message: string): Promise<void> {
    for (const userId of this.config.allowedUserIds) {
      try {
        await this.sendMessage(userId, message);
      } catch (error) {
        console.error(`Error sending notification to user ${userId}:`, error);
      }
    }
  }

  private setupHandlers(): void {
    this.bot.on('message', async (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        await this.handleTextMessage(msg);
      }
    });

    this.bot.on('voice', async (msg) => {
      await this.handleVoiceMessage(msg);
    });

    this.bot.onText(/\/start/, async (msg) => await this.handleStartCommand(msg));
    this.bot.onText(/\/reboot/, async (msg) => await this.handleRebootCommand(msg));
    this.bot.onText(/\/status/, async (msg) => await this.handleStatusCommand(msg));
    this.bot.onText(/\/clear/, async (msg) => await this.handleClearCommand(msg));
    this.bot.onText(/\/context(?:\s+(.+))?/, async (msg, match) =>
      await this.handleContextCommand(msg, match?.[1]?.trim())
    );
    this.bot.onText(/\/params(?:\s+(.+))?/, async (msg, match) =>
      await this.handleParamsCommand(msg, match?.[1])
    );
    this.bot.onText(/\/model(?:\s+(.+))?/, async (msg, match) =>
      await this.handleModelCommand(msg, match?.[1]?.trim())
    );
    this.bot.onText(/\/provider(?:\s+(.+))?/, async (msg, match) =>
      await this.handleProviderCommand(msg, match?.[1]?.trim())
    );
    this.bot.onText(/\/saveparams/, async (msg) => await this.handleSaveParamsCommand(msg));
    this.bot.onText(/\/todo(?:\s+(.+))?/, async (msg, match) =>
      await this.handleTodoCommand(msg, match?.[1]?.trim())
    );
    this.bot.onText(/\/logs(?:\s+(\d+))?/, async (msg, match) =>
      await this.handleLogsCommand(msg, match?.[1])
    );
    this.bot.onText(/\/language(?:\s+(.+))?/, async (msg, match) =>
      await this.handleLanguageCommand(msg, match?.[1]?.trim())
    );
  }

  private isAllowedUser(userId: number): boolean {
    return this.config.allowedUserIds.includes(userId);
  }

  private async sendTyping(chatId: number): Promise<void> {
    await this.bot.sendChatAction(chatId, 'typing');
  }

  private startContinuousTyping(chatId: number): void {
    this.stopContinuousTyping(chatId);
    this.sendTyping(chatId).catch((err) => console.error('Error sending typing:', err));

    const interval = setInterval(() => {
      this.sendTyping(chatId).catch((err) => console.error('Error sending typing:', err));
    }, 4000);

    this.typingIntervals.set(chatId, interval);
  }

  private stopContinuousTyping(chatId: number): void {
    const interval = this.typingIntervals.get(chatId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (_error) {
      await this.bot.sendMessage(chatId, text);
    }
  }

  // ==================== Language Detection ====================

  private getUserLanguage(userId: number, msg?: Message): string {
    // 1. Check stored preference
    const stored = this.agentService.getMemory().state.getUserLanguage(String(userId));
    if (stored) return stored;

    // 2. Check Telegram language_code
    if (msg?.from?.language_code) {
      const code = msg.from.language_code;
      const normalized = code.startsWith('pt') ? 'pt-BR' :
                        code.startsWith('en') ? 'en' : 'pt-BR';
      // Auto-save detected language
      this.agentService.getMemory().state.setUserLanguage(String(userId), normalized);
      return normalized;
    }

    // 3. Environment default
    return process.env.DEFAULT_LANGUAGE || 'pt-BR';
  }

  private async setLanguage(userId: number, msg?: Message): Promise<void> {
    const lang = this.getUserLanguage(userId, msg);
    await i18n.changeLanguage(lang);
  }

  // ==================== Command Handlers ====================

  private async handleStartCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) {
      // Use default language for unauthorized users
      await i18n.changeLanguage(process.env.DEFAULT_LANGUAGE || 'pt-BR');
      await this.sendMessage(chatId, t('telegram:errors.access_denied'));
      return;
    }

    await this.setLanguage(userId, msg);

    const currentModel = this.agentService.getModel() || 'default';
    const welcomeMsg = `
${t('telegram:commands.start.title')}

${t('telegram:commands.start.welcome')}

${t('telegram:commands.start.provider', { provider: this.agentService.getProviderDisplayName() })}
${t('telegram:commands.start.model', { model: currentModel })}

${t('telegram:commands.start.commands_header')}
${t('telegram:commands.start.cmd_start')}
${t('telegram:commands.start.cmd_status')}
${t('telegram:commands.start.cmd_clear')}
${t('telegram:commands.start.cmd_model')}
${t('telegram:commands.start.cmd_provider')}
${t('telegram:commands.start.cmd_params')}
${t('telegram:commands.start.cmd_saveparams')}
${t('telegram:commands.start.cmd_logs')}
${t('telegram:commands.start.cmd_reboot')}
${t('telegram:commands.start.cmd_language')}

${t('telegram:commands.start.footer')}
    `.trim();

    await this.sendMessage(chatId, welcomeMsg);
  }

  private async handleStatusCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    const memory = this.agentService.getMemory();
    const state = memory.state.getState();
    const todos = memory.state.getTodos();
    const recentSessions = memory.short.getRecentSessions(3);

    let statusMsg = t('telegram:commands.status.title') + '\n\n';

    if (todos.length > 0) {
      statusMsg += t('telegram:commands.status.tasks_current') + '\n';
      todos.forEach((todo, i) => {
        const status =
          todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
        statusMsg += `${status} ${i + 1}. ${todo.task}\n`;
      });
      statusMsg += '\n';
    } else {
      statusMsg += t('telegram:commands.status.tasks_none') + '\n\n';
    }

    if (recentSessions.length > 0) {
      statusMsg += t('telegram:commands.status.recent_sessions', { count: recentSessions.length }) + '\n';
      statusMsg += t('telegram:commands.status.last_update', { date: new Date(state.lastUpdate).toLocaleString() }) + '\n';
    }

    await this.sendMessage(chatId, statusMsg);
  }

  private async handleClearCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    this.agentService.clearSession(String(userId));
    const session = this.agentService.getSession(String(userId));
    const sessionInfo = session.sessionId ? t('telegram:commands.clear.session_info', { sessionId: session.sessionId.slice(0, 8) }) : '';

    await this.sendMessage(chatId, t('telegram:commands.clear.success', { sessionInfo }));
  }

  private async handleContextCommand(msg: Message, args?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    if (!args) {
      const session = this.agentService.getSession(String(userId));
      const sessionInfo = session.sessionId
        ? t('telegram:commands.context.session_id', { sessionId: session.sessionId })
        : '';

      let statusMsg = t('telegram:commands.context.title') + '\n\n';
      statusMsg += t('telegram:commands.context.provider', { provider: this.agentService.getProviderDisplayName() }) + '\n';
      statusMsg += t('telegram:commands.context.mode', { mode: session.contextMode, sessionInfo }) + '\n\n';
      statusMsg += t('telegram:commands.context.commands_header') + '\n';
      statusMsg += t('telegram:commands.context.cmd_continue') + '\n';
      statusMsg += t('telegram:commands.context.cmd_none') + '\n';
      statusMsg += t('telegram:commands.context.cmd_clear');

      await this.sendMessage(chatId, statusMsg);
      return;
    }

    const mode = args.toLowerCase();
    if (mode === 'continue' || mode === 'none' || mode === 'resume') {
      this.agentService.setContextMode(String(userId), mode as 'none' | 'continue' | 'resume');
      const emoji = mode === 'continue' ? '🔄' : mode === 'none' ? '🔕' : '📂';
      await this.sendMessage(chatId, t('telegram:commands.context.mode_changed', { emoji, mode }));
    } else {
      await this.sendMessage(chatId, t('telegram:errors.invalid_mode', { modes: 'continue, none, ou resume' }));
    }
  }

  private async handleParamsCommand(msg: Message, args?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    if (!args) {
      const params = this.agentService.getParams();
      let paramsMsg = t('telegram:commands.params.title') + '\n\n';

      Object.entries(params).forEach(([key, value]) => {
        paramsMsg += t('telegram:commands.params.param_line', { key, value: JSON.stringify(value) }) + '\n';
      });

      paramsMsg += '\n' + t('telegram:commands.params.hint');
      await this.sendMessage(chatId, paramsMsg);
      return;
    }

    const match = args.match(/^(\w+)\s*=\s*(.+)$/);
    if (!match || !match[1] || !match[2]) {
      await this.sendMessage(chatId, t('telegram:errors.invalid_format', { format: '/params chave=valor' }));
      return;
    }

    const key = match[1];
    const rawValue = match[2];
    let value: unknown = rawValue;

    try {
      value = JSON.parse(rawValue);
    } catch {
      // Keep as string
    }

    this.agentService.setParam(key, value);
    await this.sendMessage(chatId, t('telegram:commands.params.updated', { key, value: JSON.stringify(value) }));
  }

  private async handleModelCommand(msg: Message, modelName?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    if (!modelName) {
      const models = await this.agentService.listModels();
      const currentModel = this.agentService.getModel();

      let modelMsg = t('telegram:commands.model.title') + '\n\n';
      models.forEach((model) => {
        const isCurrent = model === currentModel;
        const currentIndicator = isCurrent ? t('telegram:commands.model.current_indicator') : '';
        modelMsg += `${isCurrent ? '✅' : '○'} <code>${model}</code>${currentIndicator}\n`;
      });
      modelMsg += '\n' + t('telegram:commands.model.hint');

      await this.sendMessage(chatId, modelMsg);
      return;
    }

    try {
      await this.agentService.setModel(modelName);
      await this.sendMessage(chatId, t('telegram:commands.model.changed', { model: modelName }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.sendMessage(chatId, t('telegram:errors.generic_simple', { message: errorMsg }));
    }
  }

  private async handleProviderCommand(msg: Message, providerName?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    if (!providerName) {
      const providers = this.agentService.listProviders();
      const currentProvider = this.agentService.getProviderName();

      let providerMsg = t('telegram:commands.provider.title') + '\n\n';
      providers.forEach((provider) => {
        const isCurrent = provider === currentProvider;
        const currentIndicator = isCurrent ? t('telegram:commands.provider.current_indicator') : '';
        providerMsg += `${isCurrent ? '✅' : '○'} <code>${provider}</code>${currentIndicator}\n`;
      });
      providerMsg += '\n' + t('telegram:commands.provider.hint');

      await this.sendMessage(chatId, providerMsg);
      return;
    }

    try {
      const oldProvider = this.agentService.getProviderDisplayName();
      await this.agentService.setProvider(providerName);
      await this.sendMessage(
        chatId,
        t('telegram:commands.provider.changed', {
          oldProvider,
          newProvider: this.agentService.getProviderDisplayName()
        })
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.sendMessage(chatId, t('telegram:errors.generic_simple', { message: errorMsg }));
    }
  }

  private async handleSaveParamsCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    this.agentService.saveParamsAsDefaults();
    await this.sendMessage(chatId, t('telegram:commands.saveparams.success'));
  }

  private async handleTodoCommand(msg: Message, args?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    const memory = this.agentService.getMemory();

    if (!args) {
      const todos = memory.state.getTodos();
      if (todos.length === 0) {
        await this.sendMessage(chatId, t('telegram:commands.todo.empty'));
        return;
      }

      let todoMsg = t('telegram:commands.todo.title') + '\n\n';
      todos.forEach((todo, i) => {
        const status =
          todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳';
        todoMsg += `${status} ${i + 1}. ${todo.task}\n`;
      });
      todoMsg += '\n' + t('telegram:commands.todo.hint');

      await this.sendMessage(chatId, todoMsg);
      return;
    }

    const parts = args.split(' ');
    const subcommand = parts[0]?.toLowerCase();

    if (subcommand === 'add') {
      const task = parts.slice(1).join(' ');
      if (!task) {
        await this.sendMessage(chatId, t('telegram:errors.invalid_todo_add'));
        return;
      }
      memory.state.addTodo(task);
      await this.sendMessage(chatId, t('telegram:commands.todo.added', { task }));
    } else if (subcommand === 'mark') {
      if (!parts[1] || !parts[2]) {
        await this.sendMessage(chatId, t('telegram:errors.invalid_todo_mark'));
        return;
      }
      const index = parseInt(parts[1]) - 1;
      const status = parts[2] as 'pending' | 'in_progress' | 'completed';
      memory.state.updateTodoStatus(index, status);
      await this.sendMessage(chatId, t('telegram:commands.todo.status_updated', { status }));
    } else if (subcommand === 'delete') {
      if (!parts[1]) {
        await this.sendMessage(chatId, t('telegram:errors.invalid_todo_delete'));
        return;
      }
      const index = parseInt(parts[1]) - 1;
      const todos = memory.state.getTodos();
      if (index >= 0 && index < todos.length) {
        const task = todos[index]?.task;
        todos.splice(index, 1);
        memory.state.updateTodos(todos);
        await this.sendMessage(chatId, t('telegram:commands.todo.deleted', { task }));
      }
    }
  }

  private async handleLogsCommand(msg: Message, countStr?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    const count = countStr ? parseInt(countStr) : 5;
    const turns = this.agentService.getTurnLogger().getLoggedTurns().slice(-count);

    if (turns.length === 0) {
      await this.sendMessage(chatId, t('telegram:commands.logs.empty'));
      return;
    }

    let logsMsg = t('telegram:commands.logs.title', { count: turns.length }) + '\n\n';
    turns.forEach((turn, i) => {
      const date = new Date(turn.timestamp).toLocaleString();
      const status = turn.completed ? '✅' : '❌';
      const duration = (turn.duration / 1000).toFixed(1);
      logsMsg += t('telegram:commands.logs.entry_header', { index: i + 1, status, date }) + '\n';
      logsMsg += t('telegram:commands.logs.entry_prompt', { prompt: turn.userPrompt.substring(0, 50) }) + '\n';
      logsMsg += t('telegram:commands.logs.entry_stats', { duration, actions: turn.actions.length }) + '\n\n';
    });

    await this.sendMessage(chatId, logsMsg);
  }

  private async handleRebootCommand(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    await this.sendMessage(chatId, t('telegram:commands.reboot.message'));

    const { exec } = require('child_process');
    exec('docker-compose restart protoagente', (error: Error | null) => {
      if (error) console.error('Error executing restart:', error);
    });
  }

  private async handleLanguageCommand(msg: Message, lang?: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !this.isAllowedUser(userId)) return;

    await this.setLanguage(userId, msg);

    if (!lang) {
      const current = this.getUserLanguage(userId, msg);
      await this.sendMessage(chatId, t('telegram:commands.language.current', { current }));
      return;
    }

    if (['pt-BR', 'en'].includes(lang)) {
      this.agentService.getMemory().state.setUserLanguage(String(userId), lang);
      await i18n.changeLanguage(lang);
      await this.sendMessage(chatId, t('telegram:commands.language.changed', { lang }));
    } else {
      await this.sendMessage(chatId, t('telegram:commands.language.invalid'));
    }
  }

  // ==================== Message Handlers ====================

  private async handleTextMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text;

    if (!userId || !this.isAllowedUser(userId) || !text) return;

    await this.setLanguage(userId, msg);

    if (this.agentService.isProcessing(String(userId))) {
      await this.sendMessage(chatId, t('telegram:errors.wait_previous'));
      return;
    }

    this.startContinuousTyping(chatId);

    try {
      const response = await this.agentService.processMessage(String(userId), text, {
        stream: false,
      });

      this.stopContinuousTyping(chatId);

      const html = this.mdToTelegramHtml(response.text);
      await this.sendMessage(chatId, html || response.text);
    } catch (error) {
      this.stopContinuousTyping(chatId);
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.sendMessage(chatId, t('telegram:errors.generic', { message: errorMsg }));
    }
  }

  private async handleVoiceMessage(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const voice = msg.voice;

    if (!userId || !this.isAllowedUser(userId) || !voice) return;

    await this.setLanguage(userId, msg);

    if (this.agentService.isProcessing(String(userId))) {
      await this.sendMessage(chatId, t('telegram:errors.wait_previous'));
      return;
    }

    try {
      await this.sendMessage(chatId, t('telegram:processing.transcribing'));

      const fileLink = await this.bot.getFileLink(voice.file_id);
      const response = await fetch(fileLink);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const result = await this.agentService.processVoice(String(userId), audioBuffer, 'voice.ogg', {
        stream: false,
      });

      await this.sendMessage(chatId, t('telegram:processing.transcription_result', { transcription: result.transcription }));

      this.startContinuousTyping(chatId);

      this.stopContinuousTyping(chatId);

      const html = this.mdToTelegramHtml(result.response.text);
      await this.sendMessage(chatId, html || result.response.text);
    } catch (error) {
      this.stopContinuousTyping(chatId);
      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.sendMessage(chatId, t('telegram:errors.generic_simple', { message: errorMsg }));
    }
  }

  // ==================== Markdown Conversion ====================

  private mdToTelegramHtml(markdown: string): string {
    if (!markdown) return '';

    const tokens = this.md.parse(markdown, {}) as unknown as MdToken[];
    const result = this.processTokens(tokens, 0, tokens.length, []);

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
          if (listStack.length > 0) {
            out += txt;
          } else {
            out += `${txt}\n\n`;
          }
          i += 3;
          break;
        }

        case 'fence': {
          const lang = tok.info ? String(tok.info).trim().split(/\s+/)[0] : '';
          if (lang) out += `<b>${this.escapeHtml(lang)}</b>\n`;
          out += `<pre><code>${this.escapeHtml(tok.content)}</code></pre>\n\n`;
          i++;
          break;
        }

        case 'code_block': {
          out += `<pre><code>${this.escapeHtml(tok.content)}</code></pre>\n\n`;
          i++;
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
}
