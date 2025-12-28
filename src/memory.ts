/**
 * Protoagent Memory System
 * Manages state, short-term memory and long-term memory
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  AgentState,
  TodoItem,
  ShortMemory,
  SessionMemory,
  LongMemory,
  UserPreference
} from './types';

const DATA_DIR = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_DIR, 'agent-state.json');
const SHORT_MEMORY_FILE = join(DATA_DIR, 'short-memory.json');
const LONG_MEMORY_FILE = join(DATA_DIR, 'long-memory.json');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== Agent State Management ====================

export class StateManager {
  private state: AgentState;

  constructor() {
    this.state = this.loadState();
  }

  private loadState(): AgentState {
    if (existsSync(STATE_FILE)) {
      try {
        return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
      } catch (error) {
        console.error('Error loading state:', error);
      }
    }
    return {
      currentPrompt: '',
      todos: [],
      lastUpdate: new Date().toISOString()
    };
  }

  private saveState(): void {
    try {
      writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Error saving state:', error);
    }
  }

  setCurrentPrompt(prompt: string): void {
    this.state.currentPrompt = prompt;
    this.state.lastUpdate = new Date().toISOString();
    this.saveState();
  }

  getCurrentPrompt(): string {
    return this.state.currentPrompt;
  }

  clearCurrentPrompt(): void {
    this.state.currentPrompt = '';
    this.state.lastUpdate = new Date().toISOString();
    this.saveState();
  }

  updateTodos(todos: TodoItem[]): void {
    this.state.todos = todos;
    this.state.lastUpdate = new Date().toISOString();
    this.saveState();
  }

  getTodos(): TodoItem[] {
    return this.state.todos;
  }

  addTodo(task: string): void {
    this.state.todos.push({
      task,
      status: 'pending',
      timestamp: new Date().toISOString()
    });
    this.state.lastUpdate = new Date().toISOString();
    this.saveState();
  }

  updateTodoStatus(taskIndex: number, status: TodoItem['status']): void {
    if (this.state.todos[taskIndex]) {
      this.state.todos[taskIndex].status = status;
      this.state.lastUpdate = new Date().toISOString();
      this.saveState();
    }
  }

  getState(): AgentState {
    return { ...this.state };
  }
}

// ==================== Short Memory Management ====================

export class ShortMemoryManager {
  private memory: ShortMemory;
  private maxSessions: number = 10;

  constructor(maxSessions: number = 10) {
    this.maxSessions = maxSessions;
    this.memory = this.loadMemory();
  }

  private loadMemory(): ShortMemory {
    if (existsSync(SHORT_MEMORY_FILE)) {
      try {
        return JSON.parse(readFileSync(SHORT_MEMORY_FILE, 'utf-8'));
      } catch (error) {
        console.error('Error loading short memory:', error);
      }
    }
    return {
      recentSessions: [],
      maxSessions: this.maxSessions
    };
  }

  private saveMemory(): void {
    try {
      writeFileSync(SHORT_MEMORY_FILE, JSON.stringify(this.memory, null, 2));
    } catch (error) {
      console.error('Error saving short memory:', error);
    }
  }

  addSession(userPrompt: string, agentResponse: string, summary?: string): void {
    const session: SessionMemory = {
      sessionId: Date.now().toString(),
      timestamp: new Date().toISOString(),
      userPrompt,
      agentResponse,
      summary
    };

    this.memory.recentSessions.unshift(session);

    // Keep only the most recent sessions
    if (this.memory.recentSessions.length > this.maxSessions) {
      this.memory.recentSessions = this.memory.recentSessions.slice(0, this.maxSessions);
    }

    this.saveMemory();
  }

  getRecentSessions(count: number = 5): SessionMemory[] {
    return this.memory.recentSessions.slice(0, count);
  }

  getAllSessions(): SessionMemory[] {
    return [...this.memory.recentSessions];
  }

  clear(): void {
    this.memory.recentSessions = [];
    this.saveMemory();
  }
}

// ==================== Long Memory Management ====================

export class LongMemoryManager {
  private memory: LongMemory;

  constructor() {
    this.memory = this.loadMemory();
  }

  private loadMemory(): LongMemory {
    if (existsSync(LONG_MEMORY_FILE)) {
      try {
        return JSON.parse(readFileSync(LONG_MEMORY_FILE, 'utf-8'));
      } catch (error) {
        console.error('Error loading long memory:', error);
      }
    }
    return {
      preferences: [],
      importantSummaries: []
    };
  }

  private saveMemory(): void {
    try {
      writeFileSync(LONG_MEMORY_FILE, JSON.stringify(this.memory, null, 2));
    } catch (error) {
      console.error('Error saving long memory:', error);
    }
  }

  setPreference(key: string, value: any): void {
    const existingIndex = this.memory.preferences.findIndex(p => p.key === key);

    const preference: UserPreference = {
      key,
      value,
      timestamp: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      this.memory.preferences[existingIndex] = preference;
    } else {
      this.memory.preferences.push(preference);
    }

    this.saveMemory();
  }

  getPreference(key: string): any | undefined {
    const pref = this.memory.preferences.find(p => p.key === key);
    return pref?.value;
  }

  getAllPreferences(): UserPreference[] {
    return [...this.memory.preferences];
  }

  addSummary(summary: string): void {
    this.memory.importantSummaries.unshift(summary);
    // Keep max 50 summaries
    if (this.memory.importantSummaries.length > 50) {
      this.memory.importantSummaries = this.memory.importantSummaries.slice(0, 50);
    }
    this.saveMemory();
  }

  getSummaries(count: number = 10): string[] {
    return this.memory.importantSummaries.slice(0, count);
  }

  clear(): void {
    this.memory = {
      preferences: [],
      importantSummaries: []
    };
    this.saveMemory();
  }
}

// ==================== Unified Memory Manager ====================

export class MemoryManager {
  public state: StateManager;
  public short: ShortMemoryManager;
  public long: LongMemoryManager;

  constructor(maxShortSessions: number = 10) {
    this.state = new StateManager();
    this.short = new ShortMemoryManager(maxShortSessions);
    this.long = new LongMemoryManager();
  }

  /**
   * Get system prompt with memory context
   */
  getSystemPromptWithContext(basePrompt: string): string {
    const recentSessions = this.short.getRecentSessions(3);
    const preferences = this.long.getAllPreferences();
    const summaries = this.long.getSummaries(5);
    const todos = this.state.getTodos();

    let prompt = basePrompt + '\n\n';

    // Add current todos
    if (todos.length > 0) {
      prompt += '## Current Tasks\n';
      todos.forEach((todo, i) => {
        const status = todo.status === 'completed' ? '✅' :
                      todo.status === 'in_progress' ? '🔄' : '⏳';
        prompt += `${status} ${i + 1}. ${todo.task}\n`;
      });
      prompt += '\n';
    }

    // Add recent sessions
    if (recentSessions.length > 0) {
      prompt += '## Recent Interactions\n';
      recentSessions.forEach((session, i) => {
        prompt += `### Session ${i + 1} (${new Date(session.timestamp).toLocaleString()})\n`;
        prompt += `User: ${session.userPrompt.substring(0, 100)}${session.userPrompt.length > 100 ? '...' : ''}\n`;
        if (session.summary) {
          prompt += `Summary: ${session.summary}\n`;
        }
        prompt += '\n';
      });
    }

    // Add user preferences
    if (preferences.length > 0) {
      prompt += '## User Preferences\n';
      preferences.forEach(pref => {
        prompt += `- ${pref.key}: ${JSON.stringify(pref.value)}\n`;
      });
      prompt += '\n';
    }

    // Add important summaries
    if (summaries.length > 0) {
      prompt += '## Important Context from Past Conversations\n';
      summaries.forEach((summary, i) => {
        prompt += `${i + 1}. ${summary}\n`;
      });
      prompt += '\n';
    }

    return prompt;
  }
}
