/**
 * Protoagent Guardrails System
 * Manages turn logging, timeouts and the watchdog
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { TurnLog, TurnAction, AgentParams } from './types';

// Use process.cwd() to get the project root
const DATA_DIR = join(process.cwd(), 'data');
const LOGGED_TURNS_FILE = join(DATA_DIR, 'LOGGED_TURNS.json');
const DEFAULT_PARAMS_FILE = join(DATA_DIR, 'DEFAULT_PARAMS.json');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== Turn Logger ====================

export class TurnLogger {
  private currentTurn: TurnLog | null = null;
  private turnStartTime: number = 0;

  /**
   * Start logging a new turn
   */
  startTurn(userPrompt: string, params: AgentParams): string {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.turnStartTime = Date.now();
    
    // Ensure we have complete params including defaults
    const completeParams = {
      turnTimeout: params.turnTimeout || 600000,
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens || 4096,
      ...params
    };
    
    this.currentTurn = {
      turnId,
      timestamp: new Date().toISOString(),
      userPrompt,
      actions: [],
      params: completeParams,
      duration: 0,
      completed: false
    };

    return turnId;
  }

  /**
   * Log an action within the current turn
   */
  logAction(action: TurnAction): void {
    if (!this.currentTurn) {
      console.warn('No active turn to log action');
      return;
    }

    this.currentTurn.actions.push({
      ...action,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log a text response
   */
  logTextResponse(content: string): void {
    this.logAction({
      type: 'text_response',
      timestamp: new Date().toISOString(),
      content
    });
  }

  /**
   * Log a tool call
   */
  logToolCall(toolName: string, toolArgs: Record<string, any>): void {
    this.logAction({
      type: 'tool_call',
      timestamp: new Date().toISOString(),
      content: `Calling tool: ${toolName}`,
      toolName,
      toolArgs
    });
  }

  /**
   * Log a tool result
   */
  logToolResult(toolName: string, result: any): void {
    this.logAction({
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      content: `Tool result: ${toolName}`,
      toolName,
      toolResult: result
    });
  }

  /**
   * Log an error
   */
  logError(error: string): void {
    this.logAction({
      type: 'error',
      timestamp: new Date().toISOString(),
      content: error
    });
  }

  /**
   * End the current turn and save to file
   */
  endTurn(completed: boolean = true, abortReason?: string): TurnLog | null {
    if (!this.currentTurn) {
      return null;
    }

    this.currentTurn.duration = Date.now() - this.turnStartTime;
    this.currentTurn.completed = completed;
    if (abortReason) {
      this.currentTurn.abortReason = abortReason;
    }

    // Append to logged turns file
    this.saveTurnLog(this.currentTurn);

    const completedTurn = this.currentTurn;
    this.currentTurn = null;
    this.turnStartTime = 0;

    return completedTurn;
  }

  /**
   * Get current turn info (for watchdog analysis)
   */
  getCurrentTurn(): TurnLog | null {
    if (!this.currentTurn) return null;
    
    return {
      ...this.currentTurn,
      duration: Date.now() - this.turnStartTime
    };
  }

  /**
   * Get all logged turns
   */
  getLoggedTurns(): TurnLog[] {
    if (!existsSync(LOGGED_TURNS_FILE)) {
      return [];
    }

    try {
      const data = readFileSync(LOGGED_TURNS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading logged turns:', error);
      return [];
    }
  }

  /**
   * Save turn log to file
   */
  private saveTurnLog(turn: TurnLog): void {
    try {
      const turns = this.getLoggedTurns();
      turns.push(turn);
      
      // Keep last 100 turns
      const trimmedTurns = turns.slice(-100);
      
      writeFileSync(LOGGED_TURNS_FILE, JSON.stringify(trimmedTurns, null, 2));
    } catch (error) {
      console.error('Error saving turn log:', error);
    }
  }
}

// ==================== Parameters Manager ====================

export class ParamsManager {
  private currentParams: AgentParams;
  private defaultParams: AgentParams;

  constructor() {
    this.defaultParams = this.loadDefaultParams();
    this.currentParams = { ...this.defaultParams };
  }

  /**
   * Load default params from file
   */
  private loadDefaultParams(): AgentParams {
    const defaults: AgentParams = {
      turnTimeout: 600000, // 10 minutes default (increased from 2min)
      temperature: 0.7,
      maxTokens: 4096
    };

    if (existsSync(DEFAULT_PARAMS_FILE)) {
      try {
        const savedParams = JSON.parse(readFileSync(DEFAULT_PARAMS_FILE, 'utf-8'));
        return { ...defaults, ...savedParams };
      } catch (error) {
        console.error('Error loading default params:', error);
      }
    }

    return defaults;
  }

  /**
   * Save current params as defaults
   */
  saveAsDefaults(): void {
    try {
      writeFileSync(DEFAULT_PARAMS_FILE, JSON.stringify(this.currentParams, null, 2));
      this.defaultParams = { ...this.currentParams };
    } catch (error) {
      console.error('Error saving default params:', error);
    }
  }

  /**
   * Get current params
   */
  getParams(): AgentParams {
    return { ...this.currentParams };
  }

  /**
   * Set a parameter
   */
  setParam(key: string, value: any): void {
    this.currentParams[key] = value;
  }

  /**
   * Set multiple parameters
   */
  setParams(params: Partial<AgentParams>): void {
    this.currentParams = { ...this.currentParams, ...params };
  }

  /**
   * Reset to defaults
   */
  resetToDefaults(): void {
    this.currentParams = { ...this.defaultParams };
  }

  /**
   * Get turn timeout
   */
  getTurnTimeout(): number {
    return this.currentParams.turnTimeout || 600000;
  }
}

// ==================== Watchdog ====================

export interface WatchdogAnalysis {
  isStuck: boolean;
  reason?: string;
  recommendation: string;
  analysisSource: 'heuristic' | 'agent';
}

/**
 * Callback to invoke an analyst agent
 * Allows dependency injection to avoid coupling with the provider
 */
export type AnalystAgentCallback = (turnSummary: string) => Promise<WatchdogAnalysis>;

export class TurnWatchdog {
  private turnLogger: TurnLogger;
  private paramsManager: ParamsManager;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private onStuck: ((analysis: WatchdogAnalysis) => void) | null = null;
  private analystAgent: AnalystAgentCallback | null = null;

  constructor(turnLogger: TurnLogger, paramsManager: ParamsManager) {
    this.turnLogger = turnLogger;
    this.paramsManager = paramsManager;
  }

  /**
   * Sets the analyst agent for advanced analysis
   * Per project goals: "another agent should be spawned to analyze"
   */
  setAnalystAgent(agent: AnalystAgentCallback): void {
    this.analystAgent = agent;
  }

  /**
   * Start watching the current turn
   */
  startWatching(onStuck: (analysis: WatchdogAnalysis) => void): void {
    this.onStuck = onStuck;
    this.scheduleCheck();
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.onStuck = null;
  }

  /**
   * Schedule timeout check
   */
  private scheduleCheck(): void {
    const timeout = this.paramsManager.getTurnTimeout();
    
    this.timeoutId = setTimeout(() => {
      this.checkIfStuck();
    }, timeout);
  }

  /**
   * Check if the agent is stuck
   */
  private async checkIfStuck(): Promise<void> {
    const currentTurn = this.turnLogger.getCurrentTurn();
    
    if (!currentTurn) {
      return;
    }

    let analysis: WatchdogAnalysis;
    
    // First: quick heuristic analysis
    const heuristicAnalysis = this.analyzeWithHeuristics(currentTurn);
    
    // If heuristic detected a clear problem, use it
    if (heuristicAnalysis.isStuck && !this.analystAgent) {
      analysis = heuristicAnalysis;
    } else if (this.analystAgent) {
      // GOALS: "another agent should be spawned to analyze"
      // Use analyst agent for more sophisticated analysis
      try {
        const turnSummary = this.formatTurnForAnalysis(currentTurn);
        analysis = await this.analystAgent(turnSummary);
        analysis.analysisSource = 'agent';
      } catch (error) {
        console.error('[Watchdog] Erro no agente analista, usando heurística:', error);
        analysis = heuristicAnalysis;
      }
    } else {
      analysis = heuristicAnalysis;
    }
    
    if (analysis.isStuck && this.onStuck) {
      this.onStuck(analysis);
    } else if (!analysis.isStuck && this.onStuck && this.turnLogger.getCurrentTurn()) {
        // Reschedule check if not stuck and the turn is still active
      this.scheduleCheck();
    }
  }

  /**
   * Format the turn for sending to the analyst agent
   */
  private formatTurnForAnalysis(turn: TurnLog): string {
    const actions = turn.actions.slice(-20); // Last 20 actions
    
    let summary = `## Análise de Turno\n\n`;
    summary += `**Duração:** ${Math.round(turn.duration / 1000)}s\n`;
    summary += `**Timeout:** ${this.paramsManager.getTurnTimeout() / 1000}s\n`;
    summary += `**Prompt do usuário:** ${turn.userPrompt.substring(0, 200)}...\n\n`;
    summary += `**Últimas ações (${actions.length}):**\n`;
    
    actions.forEach((action, i) => {
      summary += `${i + 1}. [${action.type}] `;
      if (action.toolName) summary += `${action.toolName} `;
      if (action.content) summary += `- ${action.content.substring(0, 100)}`;
      summary += '\n';
    });
    
    return summary;
  }

  /**
   * Analyze turn with heuristics (fast, local)
   */
  analyzeWithHeuristics(turn: TurnLog): WatchdogAnalysis {
    const timeout = this.paramsManager.getTurnTimeout();
    const actions = turn.actions;

    // Check if turn exceeded timeout
    if (turn.duration > timeout) {
      // Check for repetitive actions (potential loop)
      if (this.hasRepetitivePattern(actions)) {
        return {
          isStuck: true,
          reason: 'Detected repetitive action pattern (possible infinite loop)',
          recommendation: 'Abort turn and notify user',
          analysisSource: 'heuristic'
        };
      }

      // Check for lack of progress
      if (this.hasNoProgress(actions)) {
        return {
          isStuck: true,
          reason: 'No meaningful progress detected within timeout',
          recommendation: 'Abort turn and notify user',
          analysisSource: 'heuristic'
        };
      }

      // Generic timeout
      return {
        isStuck: true,
        reason: `Turn exceeded timeout of ${timeout / 1000} seconds`,
        recommendation: 'Abort turn and notify user',
        analysisSource: 'heuristic'
      };
    }

    return {
      isStuck: false,
      recommendation: 'Continue monitoring',
      analysisSource: 'heuristic'
    };
  }

  /**
   * Alias to maintain compatibility
   */
  analyzeTurn(turn: TurnLog): WatchdogAnalysis {
    return this.analyzeWithHeuristics(turn);
  }

  /**
   * Check for repetitive patterns in actions
   */
  private hasRepetitivePattern(actions: TurnAction[]): boolean {
    if (actions.length < 6) return false;

    // Check last 6 actions for repetition
    const recentActions = actions.slice(-6);
    const toolCalls = recentActions.filter(a => a.type === 'tool_call');
    
    if (toolCalls.length >= 4) {
      // Check if same tool called repeatedly
      const toolNames = toolCalls.map(a => a.toolName);
      const uniqueTools = new Set(toolNames);
      
      if (uniqueTools.size === 1) {
        // Same tool called 4+ times in last 6 actions
        return true;
      }

      // Check for A-B-A-B pattern
      if (toolNames.length >= 4) {
        const pattern1 = toolNames[0] === toolNames[2] && toolNames[1] === toolNames[3];
        if (pattern1) return true;
      }
    }

    return false;
  }

  /**
   * Check for lack of progress
   */
  private hasNoProgress(actions: TurnAction[]): boolean {
    // If no actions at all after timeout, it's stuck
    if (actions.length === 0) return true;

    // Check if only errors in recent actions
    const recentActions = actions.slice(-5);
    const errorCount = recentActions.filter(a => a.type === 'error').length;
    
    return errorCount >= 3;
  }
}

// ==================== Guardrails Manager ====================

export class GuardrailsManager {
  public turnLogger: TurnLogger;
  public params: ParamsManager;
  public watchdog: TurnWatchdog;

  constructor() {
    this.turnLogger = new TurnLogger();
    this.params = new ParamsManager();
    this.watchdog = new TurnWatchdog(this.turnLogger, this.params);
  }
}
