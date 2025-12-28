/**
 * Types for Protoagent
 */

// Re-export provider types
export type { 
  AgentProvider, 
  AgentProviderOptions, 
  AgentMessage, 
  AgentContentBlock,
  AgentRuntimeParams 
} from './providers/types.js';

// ==================== AI Agent Types (Legacy - para compatibilidade) ====================

export type AIProvider = 'claude' | 'copilot' | 'api' | 'sdk' | 'cli';

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AIToolResult {
  id: string;
  result: any;
  error?: string;
}

export interface AIResponse {
  content?: string;
  toolCalls?: AIToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  error?: string;
}

export interface AIAgentConfig {
  /** Provider to use: 'claude', 'copilot', etc */
  provider: AIProvider;
  /** Working directory for the agent */
  cwd?: string;
}

// ==================== Memory Types ====================

export interface TodoItem {
  task: string;
  status: 'pending' | 'in_progress' | 'completed';
  timestamp: string;
}

export interface SessionMemory {
  sessionId: string;
  timestamp: string;
  userPrompt: string;
  agentResponse: string;
  summary?: string;
}

export interface UserPreference {
  key: string;
  value: any;
  timestamp: string;
}

export interface AgentState {
  currentPrompt: string;
  todos: TodoItem[];
  lastUpdate: string;
}

export interface ShortMemory {
  recentSessions: SessionMemory[];
  maxSessions: number;
}

export interface LongMemory {
  preferences: UserPreference[];
  importantSummaries: string[];
}

// ==================== Crash & Recovery Types ====================

export interface CrashRecord {
  timestamp: string;
  pendingPrompt: string;
  errorLog: string;
}

export interface CrashLog {
  crashes: CrashRecord[];
}

// ==================== Turn Logging Types ====================

export interface TurnAction {
  type: 'text_response' | 'tool_call' | 'tool_result' | 'error';
  timestamp: string;
  content: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: any;
}

export interface TurnLog {
  turnId: string;
  timestamp: string;
  userPrompt: string;
  actions: TurnAction[];
  params: AgentParams;
  duration: number; // in ms
  completed: boolean;
  abortReason?: string;
}

// ==================== Agent Parameters Types ====================

export interface AgentParams {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  turnTimeout?: number; // timeout in ms (default 2 min = 120000)
  [key: string]: any;
}

// ==================== Telegram Types ====================

export interface TelegramConfig {
  botToken: string;
  allowedUserIds: number[];
}

// ==================== Application Config ====================

export interface AppConfig {
  telegram: TelegramConfig;
  ai: AIAgentConfig;
  whisper: {
    model: string;
    language?: string;
  };
  maxCrashes: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
