/**
 * Channel Types
 * Interfaces for communication channels (Telegram, API, etc.)
 */

import type { AgentService } from '../core/agent-service.js';

/**
 * Message received from a channel
 */
export interface ChannelMessage {
  /** User identifier (can be Telegram ID, API user ID, etc.) */
  userId: string;
  /** Text content (if any) */
  text?: string;
  /** Audio buffer (if voice message) */
  audio?: Buffer;
  /** Original filename for audio */
  audioFilename?: string;
  /** Additional metadata from the channel */
  metadata?: Record<string, unknown>;
}

/**
 * Options for processing a message
 */
export interface ProcessMessageOptions {
  /** Override provider for this request */
  provider?: string;
  /** Override model for this request */
  model?: string;
  /** Specific session ID to use */
  sessionId?: string;
  /** Enable streaming response */
  stream?: boolean;
}

/**
 * Response chunk for streaming
 */
export interface ResponseChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'complete';
  content: string;
  /** Tool name (for tool_use/tool_result) */
  toolName?: string;
  /** Tool input (for tool_use) */
  toolInput?: Record<string, unknown>;
}

/**
 * Complete response (non-streaming)
 */
export interface ChannelResponse {
  /** Full response text */
  text: string;
  /** Session ID used */
  sessionId: string | null;
  /** Provider used */
  provider: string;
  /** Model used */
  model: string | null;
}

/**
 * Channel configuration
 */
export interface ChannelConfig {
  /** Whether the channel is enabled */
  enabled: boolean;
}

/**
 * Base interface for all channels
 */
export interface Channel {
  /** Channel name identifier */
  readonly name: string;

  /** Display name for logging */
  readonly displayName: string;

  /**
   * Start the channel (begin listening)
   */
  start(): Promise<void>;

  /**
   * Stop the channel gracefully
   */
  stop(): Promise<void>;

  /**
   * Send a notification message to all allowed users
   */
  sendNotification?(message: string): Promise<void>;
}

/**
 * Channel constructor options
 */
export interface ChannelOptions {
  /** Agent service instance */
  agentService: AgentService;
}
