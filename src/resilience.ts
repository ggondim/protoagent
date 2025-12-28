/**
 * Protoagent Resilience System
 * Manages crashes, recovery and the circuit breaker
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { CrashLog, CrashRecord } from './types';

const DATA_DIR = join(process.cwd(), 'data');
const LOGS_DIR = join(process.cwd(), 'logs');
const PENDING_TURN_FILE = join(DATA_DIR, 'PENDING_TURN.txt');
const CRASHES_FILE = join(DATA_DIR, 'CRASHES.json');
const ERROR_LOG_FILE = join(LOGS_DIR, 'error.log');

export class ResilienceManager {
  private maxCrashes: number;

  constructor(maxCrashes: number = 3) {
    this.maxCrashes = maxCrashes;
  }

  // ==================== Pending Turn Management ====================

  /**
   * Save pending user prompt before processing
   */
  savePendingTurn(prompt: string): void {
    try {
      writeFileSync(PENDING_TURN_FILE, prompt, 'utf-8');
    } catch (error) {
      console.error('Error saving pending turn:', error);
    }
  }

  /**
   * Get pending turn if exists
   */
  getPendingTurn(): string | null {
    if (existsSync(PENDING_TURN_FILE)) {
      try {
        return readFileSync(PENDING_TURN_FILE, 'utf-8');
      } catch (error) {
        console.error('Error reading pending turn:', error);
        return null;
      }
    }
    return null;
  }

  /**
   * Clear pending turn after successful processing
   */
  clearPendingTurn(): void {
    if (existsSync(PENDING_TURN_FILE)) {
      try {
        unlinkSync(PENDING_TURN_FILE);
      } catch (error) {
        console.error('Error clearing pending turn:', error);
      }
    }
  }

  // ==================== Error Log Management ====================

  /**
   * Append error to error log
   */
  logError(error: Error | string): void {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.stack || error.message : error;
    const logEntry = `[${timestamp}] ${errorMessage}\n`;

    try {
      const currentLog = existsSync(ERROR_LOG_FILE) ? readFileSync(ERROR_LOG_FILE, 'utf-8') : '';
      writeFileSync(ERROR_LOG_FILE, currentLog + logEntry, 'utf-8');
    } catch (err) {
      console.error('Error writing to error log:', err);
    }
  }

  /**
   * Get error log content
   */
  getErrorLog(): string {
    if (existsSync(ERROR_LOG_FILE)) {
      try {
        return readFileSync(ERROR_LOG_FILE, 'utf-8');
      } catch (error) {
        console.error('Error reading error log:', error);
        return '';
      }
    }
    return '';
  }

  /**
   * Clear error log
   */
  clearErrorLog(): void {
    if (existsSync(ERROR_LOG_FILE)) {
      try {
        unlinkSync(ERROR_LOG_FILE);
      } catch (error) {
        console.error('Error clearing error log:', error);
      }
    }
  }

  // ==================== Crash Management ====================

  /**
   * Load crash log
   */
  private loadCrashLog(): CrashLog {
    if (existsSync(CRASHES_FILE)) {
      try {
        return JSON.parse(readFileSync(CRASHES_FILE, 'utf-8'));
      } catch (error) {
        console.error('Error loading crash log:', error);
      }
    }
    return { crashes: [] };
  }

  /**
   * Save crash log
   */
  private saveCrashLog(crashLog: CrashLog): void {
    try {
      writeFileSync(CRASHES_FILE, JSON.stringify(crashLog, null, 2));
    } catch (error) {
      console.error('Error saving crash log:', error);
    }
  }

  /**
   * Record a crash
   */
  recordCrash(pendingPrompt: string, errorLog: string): void {
    const crashLog = this.loadCrashLog();

    const crash: CrashRecord = {
      timestamp: new Date().toISOString(),
      pendingPrompt,
      errorLog
    };

    crashLog.crashes.push(crash);
    this.saveCrashLog(crashLog);
  }

  /**
   * Get all crashes
   */
  getCrashes(): CrashRecord[] {
    return this.loadCrashLog().crashes;
  }

  /**
   * Clear crash log
   */
  clearCrashLog(): void {
    if (existsSync(CRASHES_FILE)) {
      try {
        unlinkSync(CRASHES_FILE);
      } catch (error) {
        console.error('Error clearing crash log:', error);
      }
    }
  }

  // ==================== Boot Management ====================

  /**
   * Check if this is a dirty boot (after crash)
   */
  isDirtyBoot(): boolean {
    return this.getPendingTurn() !== null;
  }

  /**
   * Check circuit breaker - returns true if should halt
   */
  shouldHalt(): boolean {
    const crashes = this.getCrashes();
    return crashes.length >= this.maxCrashes;
  }

  /**
   * Handle dirty boot - record crash and return info
   */
  handleDirtyBoot(): { pendingPrompt: string; errorLog: string; crashCount: number } | null {
    const pendingPrompt = this.getPendingTurn();

    if (!pendingPrompt) {
      return null;
    }

    const errorLog = this.getErrorLog();

    // Record the crash
    this.recordCrash(pendingPrompt, errorLog);

    // Clear logs and pending turn
    this.clearErrorLog();
    this.clearPendingTurn();

    const crashCount = this.getCrashes().length;

    return {
      pendingPrompt,
      errorLog,
      crashCount
    };
  }

  /**
   * Handle clean boot - clear crash log
   */
  handleCleanBoot(): void {
    this.clearCrashLog();
    this.clearErrorLog();
    this.clearPendingTurn();
  }

  /**
   * Format crash info for display
   */
  formatCrashInfo(crashInfo: { pendingPrompt: string; errorLog: string; crashCount: number }): string {
    const { pendingPrompt, errorLog, crashCount } = crashInfo;

    let message = '⚠️ <b>REINÍCIO APÓS CRASH</b>\n\n';
    message += `<b>Data/Hora:</b> ${new Date().toLocaleString()}\n`;
    message += `<b>Crash #${crashCount}</b> de ${this.maxCrashes} máximo\n\n`;
    message += `<b>Prompt Pendente:</b>\n<code>${this.escapeHtml(pendingPrompt.substring(0, 200))}${pendingPrompt.length > 200 ? '...' : ''}</code>\n\n`;

    if (errorLog) {
      const errorLines = errorLog.split('\n').slice(-10); // Last 10 lines
      message += `<b>Últimos Erros:</b>\n<pre>${this.escapeHtml(errorLines.join('\n').substring(0, 500))}</pre>\n`;
    }

    return message;
  }

  /**
   * Format circuit breaker message
   */
  formatCircuitBreakerMessage(): string {
    const crashes = this.getCrashes();

    let message = '🛑 <b>CIRCUIT BREAKER ATIVADO</b>\n\n';
    message += `O sistema detectou <b>${crashes.length}</b> crashes consecutivos e foi desabilitado por segurança.\n\n`;
    message += `<b>Últimos crashes:</b>\n`;

    crashes.slice(-3).forEach((crash, i) => {
      message += `\n<b>${i + 1}. ${new Date(crash.timestamp).toLocaleString()}</b>\n`;
      message += `Prompt: <code>${this.escapeHtml(crash.pendingPrompt.substring(0, 100))}...</code>\n`;
    });

    message += '\n<i>Por favor, verifique os logs e reinicie manualmente após corrigir o problema.</i>';

    return message;
  }

  /**
   * Send boot notification directly without requiring full bot initialization
   * Used when circuit breaker is activated during boot
   */
  async sendBootNotificationDirect(botToken: string, userIds: number[]): Promise<void> {
    const message = this.formatCircuitBreakerMessage();
    
    for (const userId of userIds) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: userId,
            text: message,
            parse_mode: 'HTML'
          })
        });
      } catch (error) {
        console.error(`Failed to send notification to user ${userId}:`, error);
      }
    }
  }

  /**
   * Escape HTML for Telegram
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
