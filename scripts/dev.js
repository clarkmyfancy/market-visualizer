const { spawn } = require('child_process');
const path = require('path');

const cwd = path.resolve(__dirname, '..');

const apiServer = spawn('node', ['server.js'], {
  cwd,
  stdio: 'inherit',
  shell: true,
});

const webServer = spawn(
  'npx',
  [
    'ng',
    'serve',
    'market-visualizer',
    '--configuration',
    'development',
    '--port',
    '4200',
    '--proxy-config',
    'proxy.conf.json',
  ],
  {
    cwd,
    stdio: 'inherit',
    shell: true,
  }
);

const shutdown = () => {
  if (!apiServer.killed) apiServer.kill('SIGTERM');
  if (!webServer.killed) webServer.kill('SIGTERM');
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

apiServer.on('exit', (code) => {
  if (code !== 0) {
    shutdown();
    process.exit(code ?? 1);
  }
});

webServer.on('exit', (code) => {
  shutdown();
  process.exit(code ?? 0);
});
