// PM2 process file. Runs two instances so reloads have no downtime.
module.exports = {
  apps: [{
    name: 'scoothero-backoffice',
    script: 'server.js',
    cwd: '/var/www/scoothero-backoffice/current',
    instances: 2,
    exec_mode: 'cluster',
    env_file: '/var/www/scoothero-backoffice/shared/.env',
    max_memory_restart: '600M',
    time: true,
  }],
};
