#!/usr/bin/env bun

/**
 * Docker Health Check Script
 * Verifies the application is running and responsive
 */

import { existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const LOGS_DIR = join(process.cwd(), 'logs');

async function healthCheck(): Promise<boolean> {
  try {
    // Check critical directories exist
    if (!existsSync(DATA_DIR)) {
      console.error('Health check failed: data directory missing');
      return false;
    }

    if (!existsSync(LOGS_DIR)) {
      console.error('Health check failed: logs directory missing');
      return false;
    }

    // Check if API is enabled and responding (optional)
    if (process.env.API_ENABLED === 'true') {
      const port = parseInt(process.env.API_PORT || '3000');
      try {
        const response = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          console.error('Health check failed: API not responding');
          return false;
        }
      } catch (error) {
        console.error('Health check failed: API unreachable:', error);
        return false;
      }
    }

    // All checks passed
    return true;
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

// Run health check
healthCheck()
  .then((healthy) => {
    if (healthy) {
      console.log('Health check: OK');
      process.exit(0);
    } else {
      console.error('Health check: FAILED');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Health check error:', error);
    process.exit(1);
  });
