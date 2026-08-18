import { spawn } from 'node:child_process';

const npmExecPath = process.env.npm_execpath;
const npmCommand = npmExecPath ? process.execPath : (process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm');
const npmPrefix = npmExecPath ? [npmExecPath] : (process.platform === 'win32' ? ['/d', '/s', '/c', 'npm'] : []);
const commands = [
  ['run', 'dev', '-w', '@knewstudio/api'],
  ['run', 'dev', '-w', '@knewstudio/web'],
];
const children = commands.map((args) => spawn(npmCommand, [...npmPrefix, ...args], { stdio: 'inherit' }));
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stop();
    }
  });
}
