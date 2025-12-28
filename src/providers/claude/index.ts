/**
 * Claude Agent Provider
 *
 * Uses the @anthropic-ai/claude-agent-sdk which:
 * - Authenticates via Claude Desktop (no API key required)
 * - Includes built-in tools (Read, Edit, Bash, Grep, etc)
 * - Supports native streaming
 * - Provides permission bypass mode
 * - Maintains session context between messages
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, Options as ClaudeAgentOptions, Query, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { 
  AgentProvider, 
  AgentProviderOptions, 
  AgentMessage, 
  AgentContentBlock,
  AgentRuntimeParams 
} from '../types.js';

/**
 * Available models in Claude
 */
const CLAUDE_MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-20250514',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
];

/**
 * Provider for the Claude Agent SDK
 *
 * Supports multiple context modes:
 * - 'none': each query is independent
 * - 'continue': continue the last session (continue: true)
 * - 'resume': resume a specific session (resume: sessionId)
 */
export class ClaudeAgentProvider implements AgentProvider {
  readonly name = 'claude';
  readonly displayName = 'Claude (Anthropic)';
  
  private options: AgentProviderOptions;
  private params: AgentRuntimeParams;
  private abortController: AbortController | null = null;
  private currentQuery: Query | null = null;
  
  // Session context
  private lastSessionId: string | null = null;
  private contextMode: 'none' | 'continue' | 'resume' = 'continue'; // default: continue session

  constructor(options: AgentProviderOptions) {
    this.options = options;
    this.params = {
      model: 'claude-sonnet-4-5-20250929',
      turnTimeout: 120000,
    };
  }
  
  /**
   * Set the context mode
   * - 'none': each query is independent (no memory)
   * - 'continue': automatically continue the last session
   * - 'resume': resume a specific session by ID (use setSessionId)
   */
  setContextMode(mode: 'none' | 'continue' | 'resume'): void {
    this.contextMode = mode;
  }
  
  /**
   * Set the session ID to resume (used with contextMode='resume')
   */
  setSessionId(sessionId: string | null): void {
    this.lastSessionId = sessionId;
  }
  
  /**
   * Get the last session ID
   */
  getSessionId(): string | null {
    return this.lastSessionId;
  }
  
  /**
   * Clear session context (start a new conversation)
   */
  clearContext(): void {
    this.lastSessionId = null;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try to import the SDK (it will fail if Claude Desktop is not running)
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      
      // Try a simple test query to verify Claude Desktop is actually running
      const testQuery = query({
        prompt: 'ping',
        options: {
          cwd: this.options.cwd,
          model: 'claude-sonnet-4-5-20250929',
        }
      });

      // Check if we can start iterating - if this works, Claude is available
      const iterator = testQuery[Symbol.asyncIterator]();
      const probe = await Promise.race([
        iterator.next(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        )
      ]);

      // If we got here, Claude is available
      return true;
    } catch (error) {
      console.debug('[Claude] Availability probe failed:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    return CLAUDE_MODELS;
  }

  getParams(): AgentRuntimeParams {
    return { ...this.params };
  }

  setParam(key: string, value: unknown): void {
    this.params[key] = value;
  }

  setParams(params: Partial<AgentRuntimeParams>): void {
    this.params = { ...this.params, ...params };
  }

  async *query(prompt: string): AsyncGenerator<AgentMessage, void, unknown> {
    this.abortController = new AbortController();
    
    const sdkOptions: ClaudeAgentOptions = {
      cwd: this.options.cwd,
      
      // BYPASS MODE: allow everything without explicit authorization
      // Per project GOALS: "all capabilities operate in bypass mode"
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      
      // Dynamic model (can be changed by the user)
      model: this.params.model as string,
      
      // Load CLAUDE.md and .claude/ automatically
      settingSources: ['project'],
      
      // AbortController for cancellation
      abortController: this.abortController,
      
      // GOALS: "all possible tools should be enabled"
      // Use the 'claude_code' preset which includes all tools
      tools: { type: 'preset', preset: 'claude_code' },
      
      // Do not block any tool
      disallowedTools: [],
      
      // SESSION CONTEXT
      // Allows keeping history between messages from the same user
      ...(this.contextMode === 'continue' && { continue: true }),
      ...(this.contextMode === 'resume' && this.lastSessionId && { resume: this.lastSessionId }),
      
      // Persist session to allow later resume
      persistSession: true,
    };

    try {
      this.currentQuery = query({ 
        prompt, 
        options: sdkOptions,
      });

      for await (const sdkMessage of this.currentQuery) {
          // Capture session_id from messages to allow resume
        if ('session_id' in sdkMessage && sdkMessage.session_id) {
          this.lastSessionId = sdkMessage.session_id;
        }
        
        const agentMessage = this.mapSDKMessage(sdkMessage);
        if (agentMessage) {
          // Optional callback for streaming
          this.options.onMessage?.(agentMessage);
          yield agentMessage;
        }
      }
    } catch (error) {
      // Emit an error message (unless it was aborted)
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      
      const errorMessage: AgentMessage = {
        role: 'assistant',
        content: [{
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        }],
        raw: error
      };
      yield errorMessage;
    } finally {
      this.abortController = null;
      this.currentQuery = null;
    }
  }

  abort(): void {
    this.abortController?.abort();
    this.currentQuery?.interrupt().catch(() => {});
  }

  /**
   * Swap the model at runtime (if a query is active)
   */
  async setModelRuntime(model: string): Promise<void> {
    this.params.model = model;
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
    }
  }

  /**
   * Map a Claude SDKMessage to a generic AgentMessage
   */
  private mapSDKMessage(msg: SDKMessage): AgentMessage | null {
    // Assistant message
    if (msg.type === 'assistant') {
      const content: AgentContentBlock[] = [];
      
      if (msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            content.push({
              type: 'text',
              text: block.text
            });
          } else if (block.type === 'tool_use') {
            content.push({
              type: 'tool_use',
              toolName: block.name,
              toolInput: block.input as Record<string, unknown>
            });
          } else if (block.type === 'tool_result') {
            content.push({
              type: 'tool_result',
              toolName: (block as any).tool_use_id || 'unknown',
              toolResult: (block as any).content,
              isError: (block as any).is_error
            });
          }
        }
      }

      if (content.length === 0) {
        return null;
      }

      return {
        role: 'assistant',
        content,
        raw: msg
      };
    }

    // Result message (end of turn)
    if (msg.type === 'result') {
      // We can use this for logging, but we don't emit it as an AgentMessage
      // because we already receive individual messages during streaming
      return null;
    }

    // System message (init)
    if (msg.type === 'system' && msg.subtype === 'init') {
      // Initialization info - may be useful for logging
      console.log(`[Claude] Sessão iniciada - modelo: ${msg.model}, tools: ${msg.tools.length}`);
      return null;
    }

    // Other system messages or partial streaming
    // No need to emit to Telegram
    return null;
  }
}
