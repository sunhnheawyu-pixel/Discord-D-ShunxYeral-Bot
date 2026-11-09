module.exports = {
  apps: [
    {
      name: "lz-discord-bot",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: "production",
        DATA_DIR: "./data",
      },
    },
  ],
};
