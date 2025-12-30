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
import { AgentService } from './core/agent-service.js';
import { TelegramChannel, type TelegramChannelConfig } from './channels/telegram.js';
import { APIChannel, type APIChannelConfig } from './channels/api.js';
import type { Channel } from './channels/types.js';
import type { AppConfig } from './types.js';

// Load environment variables
loadEnv();

// Ensure required directories exist
const DATA_DIR = join(process.cwd(), 'data');
const LOGS_DIR = join(process.cwd(), 'logs');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });

/**
 * Load configuration from environment
 */
function loadConfig(): AppConfig & {
  api: APIChannelConfig;
} {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUserIds = process.env.ALLOWED_USER_IDS;

  if (!telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN not set in environment');
  }

  if (!allowedUserIds) {
    throw new Error('ALLOWED_USER_IDS not set in environment');
  }

  const userIds = allowedUserIds.split(',').map((id) => parseInt(id.trim()));

  const config = {
    telegram: {
      botToken: telegramToken,
      allowedUserIds: userIds,
      enabled: process.env.TELEGRAM_ENABLED !== 'false',
    },
    ai: {
      provider: ((process.env.AI_PROVIDER as string) || 'claude') as 'claude' | 'copilot',
      cwd: process.cwd(),
    },
    whisper: {
      model: process.env.WHISPER_MODEL || 'base',
      language: process.env.WHISPER_LANGUAGE || 'auto',
    },
    api: {
      enabled: process.env.API_ENABLED === 'true',
      port: parseInt(process.env.API_PORT || '3000'),
      apiKey: process.env.API_KEY || '',
    },
    maxCrashes: parseInt(process.env.MAX_CRASHES || '3'),
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  };

  // Validate API config
  if (config.api.enabled && !config.api.apiKey) {
    console.warn('⚠️  API_KEY not set - API channel will require authentication');
  }

  return config;
}

/**
 * Main application
 */
async function main() {
  console.log('🚀 Starting Protoagente...\n');

  // Load configuration
  let config: ReturnType<typeof loadConfig>;
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

    try {
      const lang = process.env.DEFAULT_LANGUAGE || 'pt-BR';
      await resilience.sendBootNotificationDirect(
        config.telegram.botToken,
        config.telegram.allowedUserIds,
        lang
      );
    } catch (error) {
      console.error('Failed to send circuit breaker notification:', error);
    }

    // Docker will handle restart via restart policy
    console.error('Circuit breaker activated - halting application');
    process.exit(1);
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

    const isAvailable = await agent.isAvailable();
    if (!isAvailable) {
      throw new Error(`Provider ${config.ai.provider} not available`);
    }

    console.log(`  ✅ AI agent (${agent.displayName})`);
  } catch (error) {
    console.warn(`  ⚠️ Provider ${config.ai.provider} unavailable, searching alternative...`);

    const available = await getFirstAvailableProvider({
      cwd: config.ai.cwd || process.cwd(),
    });

    if (!available) {
      console.error('  ❌ No AI provider available!');
      process.exit(1);
    }

    agent = available;
    console.log(`  ✅ AI agent (${agent.displayName}) [fallback]`);
  }

  // Create AgentService
  const agentService = new AgentService(
    {
      cwd: config.ai.cwd || process.cwd(),
      defaultProvider: config.ai.provider,
    },
    agent,
    {
      whisper,
      memory,
      resilience,
    }
  );
  console.log('  ✅ Agent service');

  // Initialize channels
  const channels: Channel[] = [];

  // Telegram Channel
  const telegramChannel = new TelegramChannel(
    {
      ...config.telegram,
      enabled: config.telegram.enabled ?? true,
    } as TelegramChannelConfig,
    { agentService }
  );
  channels.push(telegramChannel);

  // API Channel
  const apiChannel = new APIChannel(config.api, { agentService });
  channels.push(apiChannel);

  // Start all channels
  console.log('\n📡 Starting channels...');
  for (const channel of channels) {
    await channel.start();
  }

  // Send boot notification via Telegram
  if (telegramChannel && config.telegram.enabled !== false) {
    const lang = process.env.DEFAULT_LANGUAGE || 'pt-BR';
    if (crashInfo) {
      const message = await resilience.formatCrashInfo(crashInfo, lang);
      await telegramChannel.sendNotification(message);
      console.log('\n✅ Crash notification sent');
    } else {
      const bootMsg =
        `✅ <b>Protoagente iniciado</b>\n\n` +
        `<i>Boot limpo em ${new Date().toLocaleString()}</i>\n\n` +
        `Pronto para receber comandos!`;
      await telegramChannel.sendNotification(bootMsg);
    }
  }

  console.log('\n✅ Protoagente is running!\n');
  console.log(`Provider: ${config.ai.provider}`);
  console.log(`Telegram: ${config.telegram.enabled !== false ? 'enabled' : 'disabled'}`);
  console.log(`API: ${config.api.enabled ? `enabled on port ${config.api.port}` : 'disabled'}`);
  console.log(`Allowed users: ${config.telegram.allowedUserIds.join(', ')}`);
  console.log(`Max crashes: ${config.maxCrashes}\n`);
  console.log('Press Ctrl+C to stop\n');

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down gracefully...');

    for (const channel of channels) {
      await channel.stop();
    }

    resilience.clearPendingTurn();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run the application
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
