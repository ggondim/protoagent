/**
 * PM2 Ecosystem Configuration for Protoagente
 */

module.exports = {
  apps: [{
    name: 'protoagente',
    script: 'bun',
    args: 'run src/index.ts',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 5000
  }]
};
