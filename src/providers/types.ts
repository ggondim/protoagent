/**
 * Abstract types for Agent Providers
 *
 * Minimal interface each provider should implement,
 * delegating as much as possible to native SDKs/CLIs.
 */

// ==================== Content Blocks ====================

/**
 * Generic content block - each provider maps its native structure
 */
export type AgentContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolName: string; toolInput: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; toolResult: unknown; isError?: boolean }
  | { type: 'error'; error: string };

/**
 * Agent message used during streaming
 */
export interface AgentMessage {
  /** Role: user or assistant */
  role: 'user' | 'assistant';
  /** Message content blocks */
  content: AgentContentBlock[];
  /** Original provider message (for debug/logging) */
  raw?: unknown;
}

// ==================== Agent Options ====================

/**
 * Agent runtime parameters (can be changed by the user)
 */
export interface AgentRuntimeParams {
  /** Model to use (eg: 'claude-sonnet-4-5-20250929', 'gpt-4', etc) */
  model?: string;
  /** Temperature (0-1) */
  temperature?: number;
  /** Maximum tokens in the response */
  maxTokens?: number;
  /** Additional system prompt */
  systemPrompt?: string;
  /** Turn timeout in milliseconds */
  turnTimeout?: number;
  /** Extra provider-specific parameters */
  [key: string]: unknown;
}

/**
 * Fixed options for the provider (defined at initialization)
 */
export interface AgentProviderOptions {
  /** Agent working directory */
  cwd: string;
  /** Callback to emit messages during streaming */
  onMessage?: (message: AgentMessage) => void;
}

// ==================== Provider Interface ====================

/**
 * Abstract interface that each provider must implement
 */
export interface AgentProvider {
  /** Provider name (ex: 'claude', 'copilot', 'openai') */
  readonly name: string;
  
  /** Friendly display name */
  readonly displayName: string;

  /**
   * Checks if the provider is available and configured
   * Ex: Claude verifies SDK authentication
   * Ex: Copilot verifies CLI installation
   */
  isAvailable(): Promise<boolean>;

  /**
   * Retrieves available models for this provider
   */
  getAvailableModels(): Promise<string[]>;

  /**
   * Retrieves current runtime parameters
   */
  getParams(): AgentRuntimeParams;

  /**
   * Sets a single parameter
   */
  setParam(key: string, value: unknown): void;

  /**
   * Sets multiple parameters
   */
  setParams(params: Partial<AgentRuntimeParams>): void;

  /**
   * Executes a query and returns an AsyncGenerator of messages
   * Each provider converts its native format to `AgentMessage`
   */
  query(prompt: string): AsyncGenerator<AgentMessage, void, unknown>;

  /**
   * Aborts the current query (if possible)
   */
  abort(): void;
  
  // ==================== Context/Session Management ====================
  
  /**
   * Set the context mode (optional - not all providers support this)
   * - 'none': each query is independent
   * - 'continue': continue the last session
   * - 'resume': resume a specific session
   */
  setContextMode?(mode: 'none' | 'continue' | 'resume'): void;
  
  /**
   * Sets the session ID for resume
   */
  setSessionId?(sessionId: string | null): void;
  
  /**
   * Retrieves the current session ID
   */
  getSessionId?(): string | null;
  
  /**
   * Clears the context (starts a new conversation)
   */
  clearContext?(): void;
}

// ==================== Provider Factory ====================

/**
 * Factory function to create a provider
 */
export type AgentProviderFactory = (options: AgentProviderOptions) => AgentProvider;

/**
 * Registry of available providers
 */
export interface ProviderRegistry {
  /** Registers a new provider */
  register(name: string, factory: AgentProviderFactory): void;
  /** Retrieves a provider by name */
  get(name: string, options: AgentProviderOptions): AgentProvider | null;
  /** Lists registered providers */
  list(): string[];
  /** Checks which providers are available */
  getAvailable(options: AgentProviderOptions): Promise<Map<string, AgentProvider>>;
}
