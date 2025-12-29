/**
 * GitHub Copilot CLI Provider
 *
 * Uses the `copilot` command in PROMPT MODE (-p):
 * - Authenticates via GitHub CLI (`gh auth`)
 * - Does NOT keep context between messages (stateless)
 * - Each query spawns a new process
 * - More reliable than interactive mode without TTY
 */

import { spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { 
  AgentProvider, 
  AgentProviderOptions, 
  AgentMessage, 
  AgentRuntimeParams 
} from '../types.js';

/**
 * Cache for available models (to avoid repeated CLI calls)
 */
let cachedModels: string[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Provider for GitHub Copilot CLI
 *
 * Uses prompt mode (stateless) - each query is independent
 */
export class CopilotAgentProvider implements AgentProvider {
  readonly name = 'copilot';
  readonly displayName = 'GitHub Copilot CLI';
  
  private options: AgentProviderOptions;
  private params: AgentRuntimeParams;
  
  // Session context (similar to Claude provider)
  private sessionId: string | null = null;
  private contextMode: 'none' | 'continue' | 'resume' = 'continue'; // default: continue (resume most recent)
  private lastActivityTime: number = Date.now();
  private static SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

  private static LOGS_DIR = join(process.cwd(), 'logs');
  private static COPILOT_LOG = join(process.cwd(), 'logs', 'copilot.log');
  private static MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
  private static MAX_OLD_LOGS = 3; // Keep last 3 old logs

  constructor(options: AgentProviderOptions) {
    this.options = options;
    this.params = {
      model: 'claude-sonnet-4-5',
      turnTimeout: 600000, // 10 minutes
    };
  }

  private logToCopilot(message: string): void {
    try {
      if (!existsSync(CopilotAgentProvider.LOGS_DIR)) {
        mkdirSync(CopilotAgentProvider.LOGS_DIR, { recursive: true });
      }
      
      // Check if log file needs rotation (> 10MB)
      if (existsSync(CopilotAgentProvider.COPILOT_LOG)) {
        const stats = statSync(CopilotAgentProvider.COPILOT_LOG);
        if (stats.size > CopilotAgentProvider.MAX_LOG_SIZE) {
          this.rotateLog();
        }
      }
      
      appendFileSync(CopilotAgentProvider.COPILOT_LOG, `[${new Date().toISOString()}] ${message}\n`);
    } catch (err) {
      console.error('[Copilot] Failed to write copilot log:', err);
    }
  }
  
  /**
   * Rotate log file: copilot.log -> copilot.log.1 -> copilot.log.2 -> ... -> delete oldest
   */
  private rotateLog(): void {
    try {
      // Delete oldest log if it exists
      const oldestLog = join(CopilotAgentProvider.LOGS_DIR, `copilot.log.${CopilotAgentProvider.MAX_OLD_LOGS}`);
      if (existsSync(oldestLog)) {
        unlinkSync(oldestLog);
      }
      
      // Rotate existing logs: .2 -> .3, .1 -> .2, etc.
      for (let i = CopilotAgentProvider.MAX_OLD_LOGS - 1; i >= 1; i--) {
        const oldFile = join(CopilotAgentProvider.LOGS_DIR, `copilot.log.${i}`);
        const newFile = join(CopilotAgentProvider.LOGS_DIR, `copilot.log.${i + 1}`);
        if (existsSync(oldFile)) {
          renameSync(oldFile, newFile);
        }
      }
      
      // Rotate current log: copilot.log -> copilot.log.1
      renameSync(CopilotAgentProvider.COPILOT_LOG, join(CopilotAgentProvider.LOGS_DIR, 'copilot.log.1'));
    } catch (err) {
      console.error('[Copilot] Failed to rotate log:', err);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      return new Promise((resolve) => {
        const proc = spawn('which', ['copilot']);
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
      });
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // Check cache first
    const now = Date.now();
    if (cachedModels && (now - cacheTimestamp) < CACHE_TTL) {
      return cachedModels;
    }

    // Query Copilot CLI for available models
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn('copilot', ['--help']);
        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });

        proc.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`copilot --help failed: ${stderr}`));
          }
        });

        proc.on('error', reject);
      });

      // Parse models from help output
      // Format: "--model <model>                     Set the AI model to use (choices:"
      // Models are listed as quoted strings: "claude-sonnet-4.5", "gpt-5-mini", etc.
      const models: string[] = [];

      // Extract from "choices:" section - models are quoted strings
      // Example: (choices: "claude-sonnet-4.5", "claude-haiku-4.5", "gpt-5-mini", ...)
      const choicesMatch = result.match(/--model[^(]*\(choices:\s*([^)]+)\)/s);
      if (choicesMatch?.[1]) {
        // Extract all quoted strings
        const quotedModels = choicesMatch[1].match(/"([^"]+)"/g);
        if (quotedModels) {
          for (const quoted of quotedModels) {
            const model = quoted.replace(/"/g, '');
            if (!models.includes(model)) {
              models.push(model);
            }
          }
        }
      }

      // Also extract from example commands like "$ copilot --model gpt-5"
      const exampleMatches = result.matchAll(/\$\s+copilot\s+--model\s+([a-z0-9.-]+)/gi);
      for (const match of exampleMatches) {
        if (match[1] && !models.includes(match[1])) {
          models.push(match[1]);
        }
      }

      // If we found models, cache them
      if (models.length > 0) {
        this.logToCopilot(`Detected ${models.length} models: ${models.join(', ')}`);
        cachedModels = models;
        cacheTimestamp = now;
        return models;
      }

      this.logToCopilot('No models detected from parsing, using fallback');

      // Fallback to common known models if parsing failed
      const fallbackModels = [
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-5',
        'claude-sonnet-4-5',
        'claude-opus-4',
        'o1',
        'o3-mini',
      ];

      cachedModels = fallbackModels;
      cacheTimestamp = now;
      return fallbackModels;
    } catch (error) {
      console.warn('[Copilot] Failed to detect models dynamically:', error);

      // Return fallback models on error
      const fallbackModels = [
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-5',
        'claude-sonnet-4-5',
        'claude-opus-4',
        'o1',
        'o3-mini',
      ];

      return fallbackModels;
    }
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
  
  /**
   * Set the context mode
   * - 'none': each query is independent (no memory)
   * - 'continue': automatically continue the most recent session
   * - 'resume': resume a specific session by ID (use setSessionId)
   */
  setContextMode(mode: 'none' | 'continue' | 'resume'): void {
    this.contextMode = mode;
    this.logToCopilot(`Context mode set to: ${mode}`);
  }
  
  /**
   * Set the session ID to resume (used with contextMode='resume')
   */
  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
    this.lastActivityTime = Date.now();
    this.logToCopilot(`Session ID set to: ${sessionId}`);
  }
  
  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }
  
  /**
   * Clear session context (start a new conversation)
   */
  clearContext(): void {
    const oldSessionId = this.sessionId;
    this.sessionId = null;
    this.lastActivityTime = Date.now();
    this.logToCopilot(`Context cleared - old session: ${oldSessionId}`);
  }
  
  /**
   * Check if session has expired (24h inactivity)
   */
  private isSessionExpired(): boolean {
    if (!this.sessionId) return false;
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    return timeSinceLastActivity > CopilotAgentProvider.SESSION_TIMEOUT;
  }

  async *query(prompt: string): AsyncGenerator<AgentMessage, void, unknown> {
    try {
      // Check if session expired (24h inactivity)
      if (this.isSessionExpired()) {
        this.logToCopilot('Session expired (24h inactivity), clearing context');
        this.clearContext();
      }
      
      // Update last activity
      this.lastActivityTime = Date.now();
      
      this.logToCopilot(`query start - mode: ${this.contextMode}, sessionId: ${this.sessionId}, model: ${this.params.model}, prompt: ${prompt.substring(0, 100)}...`);

      // Build args: copilot -p "prompt" --model <model> [--resume sessionId | --continue]
      const args = ['-p', prompt];

      // Add model if specified
      if (this.params.model) {
        args.push('--model', String(this.params.model));
        this.logToCopilot(`Using model: ${this.params.model}`);
      }

      // Add session resumption based on context mode
      if (this.contextMode === 'continue') {
        args.push('--continue');
        this.logToCopilot('Using --continue (resume most recent session)');
      } else if (this.contextMode === 'resume' && this.sessionId) {
        args.push('--resume', this.sessionId);
        this.logToCopilot(`Using --resume ${this.sessionId}`);
      } else if (this.contextMode === 'none') {
        this.logToCopilot('No session context (stateless mode)');
      }
      
      const env = {
        ...process.env,
        COPILOT_CLI_HEADLESS: '1',
      };

      const proc = spawn('copilot', args, {
        cwd: this.options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      });

      this.logToCopilot(`spawned process PID=${proc.pid}`);

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        this.logToCopilot(`stdout: ${text.substring(0, 200)}`);
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        this.logToCopilot(`stderr: ${text.substring(0, 200)}`);
      });

      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error('Copilot CLI timeout após 60 segundos'));
        }, 60000);

        proc.on('close', (code) => {
          clearTimeout(timeout);
          this.logToCopilot(`process closed with code ${code}`);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Copilot CLI exited with code ${code}. stderr: ${stderr}`));
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this.logToCopilot(`query complete - stdout length: ${stdout.length}`);

      // Parse and yield the response
      if (stdout.trim()) {
        const messages = this.parseOutput(stdout);
        for (const msg of messages) {
          this.options.onMessage?.(msg);
          yield msg;
        }
      } else {
        yield {
          role: 'assistant',
          content: [{ type: 'text', text: 'Copilot não retornou resposta.' }]
        };
      }
      
    } catch (error) {
      console.error('[Copilot] Query error:', error);
      this.logToCopilot(`query error: ${String(error)}`);
      const errorMessage: AgentMessage = {
        role: 'assistant',
        content: [{
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        }],
        raw: error
      };
      yield errorMessage;
    }
  }

  /**
   * Parses CLI output into AgentMessages
   */
  private parseOutput(output: string): AgentMessage[] {
    const messages: AgentMessage[] = [];
    
    // Remove prompts from the output
    const cleanOutput = output
      .replace(/^> /gm, '')
      .replace(/^❯ /gm, '')
      .replace(/^copilot> /gm, '')
      .trim();
    
    if (!cleanOutput) return messages;
    
    // Detect tool use patterns
    const lines = cleanOutput.split('\n');
    let currentText = '';
    
    for (const line of lines) {
      // Detect tool use patterns (common emojis used by Copilot)
      const toolMatch = line.match(/^(⚙️|🔧|💻|📖|📝|🔍|📂|✏️)\s*(\w+)(?::\s*(.*))?$/);
      
      if (toolMatch && toolMatch[2]) {
        // Emit accumulated text before the tool
        if (currentText.trim()) {
          messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: currentText.trim() }]
          });
          currentText = '';
        }
        
        messages.push({
          role: 'assistant',
          content: [{
            type: 'tool_use',
            toolName: toolMatch[2],
            toolInput: { description: toolMatch[3] || '' }
          }]
        });
      } else {
        currentText += line + '\n';
      }
    }
    
    // Emit remaining text
    if (currentText.trim()) {
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: currentText.trim() }]
      });
    }
    
    return messages;
  }

  abort(): void {
    // In prompt mode, there's no persistent session to abort
  }
}
