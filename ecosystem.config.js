// PM2 process definition for the droplet. One fork-mode instance on purpose:
// Socket.io keeps its rooms in memory, so cluster mode would need a Redis adapter.
module.exports = {
  apps: [
    {
      name: "bayshoreportal_backend",
      cwd: "/var/www/bayshoreportal_backend/current",
      script: "dist/server.js",
      exec_mode: "fork",
      instances: 1,
      // Wins over whatever NODE_ENV the .env file carries.
      env: { NODE_ENV: "production" },
      // server.ts gives in-flight requests 5s to finish on shutdown.
      kill_timeout: 8000,
      time: true,
    },
  ],
};
