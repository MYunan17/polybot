module.exports = {
  apps: [
    {
      name: "polymarket-mirofish-bot",
      script: "dist/src/index.js",
      args: "--once",
      interpreter: "node",
      cron_restart: "0 */6 * * *",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
