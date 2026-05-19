/*
 * PM2 ecosystem — LP-9.
 * Usage:
 *   pm2 start ecosystem.config.js          # start
 *   pm2 restart axis-server                # restart
 *   pm2 logs axis-server                   # tail logs
 *   pm2 monit                              # live dashboard
 */

module.exports = {
  apps: [
    {
      name:      'axis-server',
      script:    './index.js',
      instances: 1,          // single instance; SQLite is not safe for multi-process writes
      exec_mode: 'fork',
      autorestart:          true,
      watch:                false,
      max_memory_restart:   '512M',

      env: {
        NODE_ENV: 'production',
        PORT:     3002,
      },

      // Log files — the ./logs/ directory is created on boot if absent.
      error_file:       './logs/error.log',
      out_file:         './logs/out.log',
      log_date_format:  'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:       true,

      // Graceful shutdown: wait up to 10 s for in-flight requests.
      kill_timeout:    10000,
      listen_timeout:  5000,
    },
  ],
};
