module.exports = {
  apps: [{
    name: 'fps-server',
    script: 'server.js',
    watch: true,
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development'
    }
  }]
};
