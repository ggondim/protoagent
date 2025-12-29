/**
 * Session Manager
 * Centralized session management for all channels
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type ContextMode = 'none' | 'continue' | 'resume';

export interface UserSession {
  userId: string;
  sessionId: string | null;
  contextMode: ContextMode;
  provider: string;
  model: string | null;
  createdAt: number;
  lastActivity: number;
}

interface SessionsStore {
  sessions: Record<string, UserSession>;
  lastUpdate: number;
}

const DATA_DIR = join(process.cwd(), 'data');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

export class SessionManager {
  private sessions: Map<string, UserSession> = new Map();

  constructor() {
    this.loadSessions();
  }

  /**
   * Load sessions from disk
   */
  private loadSessions(): void {
    try {
      if (existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) as SessionsStore;
        for (const [userId, session] of Object.entries(data.sessions)) {
          this.sessions.set(userId, session);
        }
      }
    } catch (error) {
      console.warn('[SessionManager] Failed to load sessions:', error);
    }
  }

  /**
   * Save sessions to disk
   */
  private saveSessions(): void {
    try {
      const store: SessionsStore = {
        sessions: Object.fromEntries(this.sessions),
        lastUpdate: Date.now(),
      };
      writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2));
    } catch (error) {
      console.warn('[SessionManager] Failed to save sessions:', error);
    }
  }

  /**
   * Get or create session for a user
   */
  getSession(userId: string, provider: string): UserSession {
    let session = this.sessions.get(userId);

    if (!session) {
      session = {
        userId,
        sessionId: null,
        contextMode: 'continue', // Default mode
        provider,
        model: null,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessions.set(userId, session);
      this.saveSessions();
    }

    return session;
  }

  /**
   * Update session
   */
  updateSession(userId: string, updates: Partial<UserSession>): UserSession {
    const session = this.sessions.get(userId);
    if (!session) {
      throw new Error(`Session not found for user ${userId}`);
    }

    Object.assign(session, updates, { lastActivity: Date.now() });
    this.saveSessions();

    return session;
  }

  /**
   * Set session ID for a user
   */
  setSessionId(userId: string, sessionId: string | null): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.sessionId = sessionId;
      session.lastActivity = Date.now();
      this.saveSessions();
    }
  }

  /**
   * Set context mode for a user
   */
  setContextMode(userId: string, mode: ContextMode): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.contextMode = mode;
      session.lastActivity = Date.now();
      this.saveSessions();
    }
  }

  /**
   * Clear session for a user (start fresh)
   */
  clearSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.sessionId = null;
      session.lastActivity = Date.now();
      this.saveSessions();
    }
  }

  /**
   * Delete session completely
   */
  deleteSession(userId: string): void {
    this.sessions.delete(userId);
    this.saveSessions();
  }

  /**
   * Get all sessions
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }
}
