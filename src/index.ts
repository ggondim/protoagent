#!/usr/bin/env bun

/**
 * Protoagente - Main Entry Point
 * Orchestrates all components and handles boot sequence
 */

import { config as loadEnv } from 'dotenv';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createProvider, getFirstAvailableProvider } from './providers/index.js';
import type { AgentProvider } from './providers/types.js';
import { WhisperTranscriber } from './whisper.js';
import { MemoryManager } from './memory.js';
import { ResilienceManager } from './resilience.js';
import { ProtoagentBot } from './telegram-bot.js';
import type { AppConfig } from './types.js';

// Load environment variables
loadEnv();

// Ensure required directories exist
const DATA_DIR = join(process.cwd(), 'data');
const LOGS_DIR = join(process.cwd(), 'logs');
const BOT_RUNTIME_DIR = join(process.cwd(), '.bot-runtime');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
if (!existsSync(BOT_RUNTIME_DIR)) mkdirSync(BOT_RUNTIME_DIR, { recursive: true });

/**
 * Load configuration from environment
 */
function loadConfig(): AppConfig {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUserIds = process.env.ALLOWED_USER_IDS;

  if (!telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not set in environment');
  }

  if (!allowedUserIds) {
    throw new Error('ALLOWED_USER_IDS not set in environment');
  }

  const userIds = allowedUserIds.split(',').map(id => parseInt(id.trim()));

  // Allow multiple user IDs (no restriction)

  const config: AppConfig = {
    telegram: {
      botToken: telegramToken,
      allowedUserIds: userIds
    },
    ai: {
      provider: (process.env.AI_PROVIDER as any) || 'claude',
      // Use isolated runtime directory for the bot to avoid session conflicts
      cwd: join(process.cwd(), '.bot-runtime'),
    },
    whisper: {
      model: process.env.WHISPER_MODEL || 'base',
      language: process.env.WHISPER_LANGUAGE || 'auto'
    },
    maxCrashes: parseInt(process.env.MAX_CRASHES || '3'),
    logLevel: (process.env.LOG_LEVEL as any) || 'info'
  };

  return config;
}

/**
 * Main application
 */
async function main() {
  console.log('🚀 Starting Protoagente...\n');

  // Load configuration
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error('❌ Configuration error:', error);
    process.exit(1);
  }

  // Initialize resilience manager
  const resilience = new ResilienceManager(config.maxCrashes);

  // Check if dirty boot (after crash) and record it FIRST
  const isDirty = resilience.isDirtyBoot();
  let crashInfo: { pendingPrompt: string; errorLog: string; crashCount: number } | null = null;

  if (isDirty) {
    console.log('⚠️  Dirty boot detected (recovering from crash)\n');
    crashInfo = resilience.handleDirtyBoot();

    if (crashInfo) {
      console.log(`Crash #${crashInfo.crashCount}`);
      console.log(`Pending prompt: ${crashInfo.pendingPrompt.substring(0, 100)}...`);
      console.log(`Error log: ${crashInfo.errorLog.substring(0, 200)}...\n`);
    }
  } else {
    console.log('✅ Clean boot\n');
    resilience.handleCleanBoot();
  }

  // Check circuit breaker AFTER recording crash
  if (resilience.shouldHalt()) {
    console.error('🛑 Circuit breaker activated - too many crashes');

    // Notify users using simple method that doesn't require full bot
    try {
      await resilience.sendBootNotificationDirect(
        config.telegram.botToken,
        config.telegram.allowedUserIds
      );
    } catch (error) {
      console.error('Failed to send circuit breaker notification:', error);
    }

    // Disable PM2 service with proper exit
    const { exec } = require('child_process');
    exec('pm2 stop protoagente', (error: Error | null) => {
      if (error) {
        console.error('Error stopping PM2:', error);
      }
      process.exit(1);
    });

    return;
  }

  // Initialize components
  console.log('📦 Initializing components...');

  const memory = new MemoryManager();
  console.log('  ✅ Memory manager');

  const whisper = new WhisperTranscriber(config.whisper);
  console.log('  ✅ Whisper transcriber');

  // Create agent provider
  let agent: AgentProvider;
  try {
    agent = createProvider(config.ai.provider, {
      cwd: config.ai.cwd || process.cwd(),
    });
    
    // Check availability
    const isAvailable = await agent.isAvailable();
    if (!isAvailable) {
      throw new Error(`Provider ${config.ai.provider} não está disponível`);
    }
    
    console.log(`  ✅ AI agent (${agent.displayName})`);
  } catch (error) {
    console.warn(`  ⚠️ Provider ${config.ai.provider} indisponível, buscando alternativa...`);
    
    // Try to find an available provider
    const available = await getFirstAvailableProvider({
      cwd: config.ai.cwd || process.cwd(),
    });
    
    if (!available) {
      console.error('  ❌ Nenhum provider de AI disponível!');
      process.exit(1);
    }
    
    agent = available;
    console.log(`  ✅ AI agent (${agent.displayName}) [fallback]`);
  }

  const bot = new ProtoagentBot(
    config.telegram,
    agent,
    config.ai.cwd,
    whisper,
    memory,
    resilience
  );
  console.log('  ✅ Telegram bot\n');

  // Send boot notification
  if (crashInfo) {
    // Send crash notification for dirty boot
    const message = resilience.formatCrashInfo(crashInfo);
    await bot.sendBootNotification(message);
    console.log('✅ Crash notification sent to users\n');
  } else {
    // Send clean boot notification
    const bootMsg = `✅ <b>Protoagente iniciado</b>\n\n` +
                   `<i>Boot limpo em ${new Date().toLocaleString()}</i>\n\n` +
                   `Pronto para receber comandos!`;
    await bot.sendBootNotification(bootMsg);
  }

  console.log('✅ Protoagente is running!\n');
  console.log(`Provider: ${config.ai.provider}`);
  console.log(`Allowed users: ${config.telegram.allowedUserIds.join(', ')}`);
  console.log(`Max crashes: ${config.maxCrashes}\n`);
  console.log('Press Ctrl+C to stop\n');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    bot.stop();
    resilience.clearPendingTurn(); // Clear pending turn on graceful shutdown
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    bot.stop();
    resilience.clearPendingTurn(); // Clear pending turn on graceful shutdown
    process.exit(0);
  });
}

// Run the application
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
