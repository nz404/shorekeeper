module.exports = {
  apps: [{
    name: 'shorekeeper',
    script: 'npm',
    args: 'run dev',
    cwd: '/opt/shorekeeper',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    error_file: 'logs/error.log',
    out_file: 'logs/output.log',
  }]
};