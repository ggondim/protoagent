/**
 * Agent Service
 * Core service that handles agent interactions
 * Extracted from telegram-bot.ts for multi-channel support
 */

import { EventEmitter } from 'events';
import type { AgentProvider, AgentContentBlock, AgentRuntimeParams } from '../providers/types.js';
import { createProvider, providerRegistry, getFirstAvailableProvider } from '../providers/index.js';
import type { WhisperTranscriber } from '../whisper.js';
import type { MemoryManager } from '../memory.js';
import type { ResilienceManager } from '../resilience.js';
import { GuardrailsManager, type WatchdogAnalysis, type AnalystAgentCallback } from '../guardrails.js';
import { SessionManager, type ContextMode, type UserSession } from './session-manager.js';
import type { ProcessMessageOptions, ResponseChunk, ChannelResponse } from '../channels/types.js';

export interface AgentServiceConfig {
  /** Working directory for the agent */
  cwd: string;
  /** Default provider name */
  defaultProvider: string;
}

export interface AgentServiceDependencies {
  whisper: WhisperTranscriber;
  memory: MemoryManager;
  resilience: ResilienceManager;
}

/**
 * Events emitted by AgentService
 */
export interface AgentServiceEvents {
  chunk: (userId: string, chunk: ResponseChunk) => void;
  complete: (userId: string, response: ChannelResponse) => void;
  error: (userId: string, error: Error) => void;
  processing: (userId: string, isProcessing: boolean) => void;
}

export class AgentService extends EventEmitter {
  private config: AgentServiceConfig;
  private agent: AgentProvider;
  private whisper: WhisperTranscriber;
  private memory: MemoryManager;
  private resilience: ResilienceManager;
  private guardrails: GuardrailsManager;
  private sessionManager: SessionManager;
  private processingLock: Map<string, boolean> = new Map();

  constructor(
    config: AgentServiceConfig,
    agent: AgentProvider,
    deps: AgentServiceDependencies
  ) {
    super();
    this.config = config;
    this.agent = agent;
    this.whisper = deps.whisper;
    this.memory = deps.memory;
    this.resilience = deps.resilience;
    this.guardrails = new GuardrailsManager();
    this.sessionManager = new SessionManager();

    // Set up analyst agent for watchdog
    this.setupAnalystAgent();
  }

  /**
   * Set up the analyst agent for watchdog analysis
   */
  private setupAnalystAgent(): void {
    const analystCallback: AnalystAgentCallback = async (turnSummary: string) => {
      const analysisPrompt = `Voce e um agente analista de diagnostico. Analise o seguinte turno de um agente AI e determine se ele esta travado.

${turnSummary}

Responda APENAS em JSON no formato:
{
  "isStuck": true/false,
  "reason": "motivo se travado",
  "recommendation": "recomendacao"
}

Considere travado se:
- Repetindo a mesma acao mais de 3 vezes
- Loop entre duas acoes
- Sem progresso aparente apos timeout
- Erros repetidos

Seja conservador: so considere travado se houver evidencia clara.`;

      try {
        let response = '';
        for await (const msg of this.agent.query(analysisPrompt)) {
          for (const block of msg.content) {
            if (block.type === 'text') {
              response += block.text;
            }
          }
        }

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          return {
            isStuck: Boolean(analysis.isStuck),
            reason: analysis.reason || 'Analise do agente',
            recommendation: analysis.recommendation || 'Verificar turno',
            analysisSource: 'agent' as const,
          };
        }
      } catch (error) {
        console.error('[AnalystAgent] Erro na analise:', error);
      }

      return {
        isStuck: true,
        reason: 'Timeout excedido (analise do agente falhou)',
        recommendation: 'Abortar turno',
        analysisSource: 'heuristic' as const,
      };
    };

    this.guardrails.watchdog.setAnalystAgent(analystCallback);
  }

  // ==================== Provider Management ====================

  /**
   * Get current provider
   */
  getProvider(): AgentProvider {
    return this.agent;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.agent.name;
  }

  /**
   * Get provider display name
   */
  getProviderDisplayName(): string {
    return this.agent.displayName;
  }

  /**
   * Set provider by name
   */
  async setProvider(providerName: string): Promise<void> {
    const providers = providerRegistry.list();
    if (!providers.includes(providerName)) {
      throw new Error(`Provider not found: ${providerName}`);
    }

    const newProvider = createProvider(providerName, { cwd: this.config.cwd });
    const isAvailable = await newProvider.isAvailable();
    if (!isAvailable) {
      throw new Error(`Provider ${providerName} is not available`);
    }

    this.agent = newProvider;
    this.setupAnalystAgent();

    if (this.agent.clearContext) {
      this.agent.clearContext();
    }
  }

  /**
   * List available providers
   */
  listProviders(): string[] {
    return providerRegistry.list();
  }

  // ==================== Model Management ====================

  /**
   * Get current model
   */
  getModel(): string | undefined {
    return this.agent.getParams().model;
  }

  /**
   * Set model
   */
  async setModel(modelName: string): Promise<void> {
    const models = await this.agent.getAvailableModels();
    if (!models.includes(modelName)) {
      throw new Error(`Model not found: ${modelName}`);
    }

    this.agent.setParam('model', modelName);
    this.guardrails.params.setParam('model', modelName);
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    return this.agent.getAvailableModels();
  }

  // ==================== Parameters Management ====================

  /**
   * Get current parameters
   */
  getParams(): AgentRuntimeParams {
    return {
      ...this.guardrails.params.getParams(),
      ...this.agent.getParams(),
    };
  }

  /**
   * Set a parameter
   */
  setParam(key: string, value: unknown): void {
    this.guardrails.params.setParam(key, value);
    this.agent.setParam(key, value);
  }

  /**
   * Set multiple parameters
   */
  setParams(params: Partial<AgentRuntimeParams>): void {
    this.guardrails.params.setParams(params);
    this.agent.setParams(params);
  }

  /**
   * Save current params as defaults
   */
  saveParamsAsDefaults(): void {
    this.guardrails.params.saveAsDefaults();
  }

  // ==================== Session Management ====================

  /**
   * Get session for a user
   */
  getSession(userId: string): UserSession {
    return this.sessionManager.getSession(userId, this.agent.name);
  }

  /**
   * Clear session for a user
   */
  clearSession(userId: string): void {
    this.sessionManager.clearSession(userId);
    this.memory.short.clear();

    if (this.agent.clearContext) {
      this.agent.clearContext();
    }

    if (this.agent.name === 'claude' && this.agent.setSessionId) {
      const newSessionId = `user-${userId}-${Date.now()}`;
      this.agent.setSessionId(newSessionId);
      this.sessionManager.setSessionId(userId, newSessionId);
    }
  }

  /**
   * Set context mode for a user
   */
  setContextMode(userId: string, mode: ContextMode): void {
    this.sessionManager.setContextMode(userId, mode);
    if (this.agent.setContextMode) {
      this.agent.setContextMode(mode);
    }
  }

  // ==================== Message Processing ====================

  /**
   * Check if user is currently processing
   */
  isProcessing(userId: string): boolean {
    return this.processingLock.get(userId) || false;
  }

  /**
   * Process a text message
   */
  async processMessage(
    userId: string,
    message: string,
    options?: ProcessMessageOptions
  ): Promise<ChannelResponse> {
    if (this.isProcessing(userId)) {
      throw new Error('Already processing a message');
    }

    this.processingLock.set(userId, true);
    this.emit('processing', userId, true);

    try {
      // Apply options if provided
      if (options?.provider) {
        await this.setProvider(options.provider);
      }
      if (options?.model) {
        await this.setModel(options.model);
      }
      if (options?.sessionId && this.agent.setSessionId) {
        this.agent.setSessionId(options.sessionId);
        this.sessionManager.setSessionId(userId, options.sessionId);
      }

      // Ensure session
      this.ensureUserSession(userId);

      // Save pending turn for crash recovery
      this.resilience.savePendingTurn(message);

      // Register prompt in memory
      this.memory.state.setCurrentPrompt(message);

      // Auto-create TODO if looks like a task
      if (this.looksLikeTask(message)) {
        this.memory.state.addTodo(message);
      }

      // Get merged params
      const guardrailParams = this.guardrails.params.getParams();
      const providerParams = this.agent.getParams();
      const mergedParams = { ...guardrailParams, ...providerParams };

      // Start turn logging
      this.guardrails.turnLogger.startTurn(message, mergedParams);
      this.agent.setParams(mergedParams);

      // Build prompt with context
      const contextPrompt = this.buildPromptWithContext(message);

      // Process with streaming or not
      let fullResponse = '';

      if (options?.stream) {
        // Streaming mode - emit chunks
        fullResponse = await this.processWithStreaming(userId, contextPrompt);
      } else {
        // Non-streaming mode - collect full response
        fullResponse = await this.processWithoutStreaming(userId, contextPrompt);
      }

      // End turn successfully
      this.guardrails.watchdog.stopWatching();
      this.guardrails.turnLogger.endTurn(true);

      // Save to memory
      if (fullResponse) {
        this.memory.short.addSession(message, fullResponse);
      }

      // Clear pending turn
      this.resilience.clearPendingTurn();

      const response: ChannelResponse = {
        text: fullResponse,
        sessionId: this.agent.getSessionId?.() || null,
        provider: this.agent.name,
        model: this.agent.getParams().model || null,
      };

      this.emit('complete', userId, response);
      return response;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log error
      this.guardrails.turnLogger.logError(errorMsg);
      this.guardrails.watchdog.stopWatching();
      this.guardrails.turnLogger.endTurn(false, errorMsg);
      this.resilience.logError(error instanceof Error ? error : new Error(errorMsg));
      this.resilience.clearPendingTurn();

      const err = error instanceof Error ? error : new Error(errorMsg);
      this.emit('error', userId, err);
      throw err;
    } finally {
      this.processingLock.set(userId, false);
      this.emit('processing', userId, false);
    }
  }

  /**
   * Process a voice message (transcribe + process)
   */
  async processVoice(
    userId: string,
    audioBuffer: Buffer,
    filename: string = 'voice.ogg',
    options?: ProcessMessageOptions
  ): Promise<{ transcription: string; response: ChannelResponse }> {
    // Transcribe audio
    const transcription = await this.whisper.transcribe(audioBuffer, filename);

    if (!transcription || transcription.trim().length === 0) {
      throw new Error('Failed to transcribe audio');
    }

    // Process transcription
    const response = await this.processMessage(userId, transcription, options);

    return { transcription, response };
  }

  /**
   * Process with streaming (emit chunks)
   */
  private async processWithStreaming(userId: string, prompt: string): Promise<string> {
    let fullResponse = '';

    // Setup watchdog
    this.guardrails.watchdog.startWatching(async (analysis: WatchdogAnalysis) => {
      await this.handleStuckAgent(userId, analysis);
    });

    for await (const agentMsg of this.agent.query(prompt)) {
      for (const block of agentMsg.content) {
        const chunk = this.contentBlockToChunk(block);
        this.emit('chunk', userId, chunk);

        if (block.type === 'text') {
          fullResponse += block.text;
          this.guardrails.turnLogger.logTextResponse(block.text);
        } else if (block.type === 'tool_use') {
          this.guardrails.turnLogger.logToolCall(block.toolName, block.toolInput as Record<string, unknown>);
        } else if (block.type === 'tool_result') {
          this.guardrails.turnLogger.logToolResult(block.toolName, block.toolResult);
        } else if (block.type === 'error') {
          this.guardrails.turnLogger.logError(block.error);
        }
      }
    }

    return fullResponse;
  }

  /**
   * Process without streaming (collect full response)
   */
  private async processWithoutStreaming(userId: string, prompt: string): Promise<string> {
    let fullResponse = '';

    // Setup watchdog
    this.guardrails.watchdog.startWatching(async (analysis: WatchdogAnalysis) => {
      await this.handleStuckAgent(userId, analysis);
    });

    for await (const agentMsg of this.agent.query(prompt)) {
      for (const block of agentMsg.content) {
        if (block.type === 'text') {
          fullResponse += block.text;
          this.guardrails.turnLogger.logTextResponse(block.text);
        } else if (block.type === 'tool_use') {
          this.guardrails.turnLogger.logToolCall(block.toolName, block.toolInput as Record<string, unknown>);
        } else if (block.type === 'tool_result') {
          this.guardrails.turnLogger.logToolResult(block.toolName, block.toolResult);
        } else if (block.type === 'error') {
          this.guardrails.turnLogger.logError(block.error);
        }
      }
    }

    return fullResponse;
  }

  /**
   * Convert content block to response chunk
   */
  private contentBlockToChunk(block: AgentContentBlock): ResponseChunk {
    switch (block.type) {
      case 'text':
        return { type: 'text', content: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          content: `Calling ${block.toolName}`,
          toolName: block.toolName,
          toolInput: block.toolInput,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          content: String(block.toolResult),
          toolName: block.toolName,
        };
      case 'error':
        return { type: 'error', content: block.error };
      default:
        return { type: 'text', content: '' };
    }
  }

  /**
   * Ensure user has a session
   */
  private ensureUserSession(userId: string): void {
    const session = this.sessionManager.getSession(userId, this.agent.name);

    if (this.agent.setContextMode) {
      this.agent.setContextMode(session.contextMode);
    }

    if (session.sessionId && this.agent.setSessionId) {
      this.agent.setSessionId(session.sessionId);
    }
  }

  /**
   * Build prompt with memory context
   */
  private buildPromptWithContext(message: string): string {
    const hasActiveSession =
      typeof this.agent.getSessionId === 'function' && !!this.agent.getSessionId();

    if (hasActiveSession) {
      return message;
    }

    const basePrompt = this.getBaseSystemPrompt();
    const memoryContext = this.memory.getSystemPromptWithContext(basePrompt);

    return `[Contexto de memorias anteriores]\n${memoryContext}\n\n[Mensagem do usuario]\n${message}`;
  }

  /**
   * Get base system prompt
   */
  private getBaseSystemPrompt(): string {
    const customPrompt = this.guardrails.params.getParams().systemPrompt;
    if (customPrompt) {
      return customPrompt;
    }

    return `Voce e o Protoagente, um assistente AI inteligente e prestativo.

Voce tem capacidade de manter memoria de conversas anteriores e gerenciar tarefas.

Sempre seja:
- Claro e objetivo
- Prestativo e amigavel
- Honesto sobre suas limitacoes
- Proativo em sugerir solucoes

Quando receber uma tarefa complexa, quebre-a em subtarefas e as organize.`;
  }

  /**
   * Check if message looks like a task
   */
  private looksLikeTask(message: string): boolean {
    if (message.length < 10) return false;

    const taskKeywords = [
      'fazer', 'criar', 'gerar', 'escrever', 'editar', 'remover', 'deletar',
      'modificar', 'alterar', 'trocar', 'atualizar', 'corrigir', 'ficar',
      'ajudar', 'analisar', 'revisar', 'verificar', 'testar', 'implementar',
      'refatorar', 'otimizar', 'melhorar', 'debug', 'fix', 'build', 'deploy',
      'find', 'search', 'buscar', 'procurar', 'pesquisar', 'investigate',
    ];

    const lowerMessage = message.toLowerCase();
    const hasTaskKeyword = taskKeywords.some((keyword) => lowerMessage.includes(keyword));
    const hasImperative = /^(fazer|criar|gerar|escrever|por favor|pls|please)/i.test(message);

    return hasTaskKeyword || hasImperative;
  }

  /**
   * Handle stuck agent
   */
  private async handleStuckAgent(userId: string, analysis: WatchdogAnalysis): Promise<void> {
    this.agent.abort();
    this.guardrails.watchdog.stopWatching();
    this.guardrails.turnLogger.endTurn(false, analysis.reason);

    if (this.agent.clearContext) {
      this.agent.clearContext();
    }

    this.resilience.clearPendingTurn();
    this.processingLock.set(userId, false);
    this.emit('processing', userId, false);

    const error = new Error(`Agent stuck: ${analysis.reason || 'Timeout exceeded'}`);
    this.emit('error', userId, error);
  }

  /**
   * Abort current processing
   */
  abort(): void {
    this.agent.abort();
    this.guardrails.watchdog.stopWatching();
  }

  // ==================== Memory & State ====================

  /**
   * Get memory manager
   */
  getMemory(): MemoryManager {
    return this.memory;
  }

  /**
   * Get guardrails manager
   */
  getGuardrails(): GuardrailsManager {
    return this.guardrails;
  }

  /**
   * Get turn logger
   */
  getTurnLogger() {
    return this.guardrails.turnLogger;
  }
}
