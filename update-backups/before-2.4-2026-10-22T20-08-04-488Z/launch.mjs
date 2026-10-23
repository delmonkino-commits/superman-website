import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.join(root, 'upstream');
const envFile = path.join(root, '.env.local');
const envSettings = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
      .map(line => /^([A-Z_]+)=(.*)$/.exec(line))
      .filter(Boolean)
      .map(match => [match[1], match[2]]))
  : {};
// The browser engine runs on a separate port; it is never exposed through the chat origin.
// ENABLE_PROXY is no longer needed for the separate secure browser gateway.
const running = [];
let stopping = false;

// Run executables directly, without a shell. On Windows, paths such as
// C:\Program Files\nodejs\node.exe otherwise get incorrectly split at spaces.
function startProcess(command, args, cwd, label) {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env, shell: false });
  running.push(child);
  child.on('error', (error) => {
    console.error(`[${label}] couldn't start: ${error.message}`);
    if (label === 'hub') terminate();
  });
  child.on('exit', (code) => {
    if (!stopping && code !== 0 && code !== null) console.error(`[${label}] exited with ${code}`);
    if (!stopping && label === 'hub') terminate();
  });
  return child;
}

// Node installations on Windows ship npx as a JavaScript CLI. Running it via
// node.exe avoids both .cmd quoting problems and DEP0190 shell warnings.
function npxCommand(args) {
  const candidates = [
    process.env.npm_execpath && path.join(path.dirname(process.env.npm_execpath), 'npx-cli.js'),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].filter(Boolean);
  const cli = candidates.find(existsSync);
  if (cli) return { command: process.execPath, args: [cli, ...args] };
  if (process.platform === 'win32') {
    // The arguments below are fixed constants controlled by this project.
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `npx ${args.join(' ')}`] };
  }
  return { command: 'npx', args };
}

function terminate() {
  if (stopping) return;
  stopping = true;
  for (const p of running) if (!p.killed) p.kill('SIGTERM');
}
process.on('SIGINT', terminate);
process.on('SIGTERM', terminate);

if (existsSync(path.join(upstream, 'package.json'))) {
  console.log('[SuperMan] Starting upstream proxy. First build may take some time.');
  const proxy = npxCommand(['--yes', 'pnpm@10', 'start']);
  startProcess(proxy.command, proxy.args, upstream, 'proxy');
} else {
  console.warn('[SuperMan] Browser engine not installed. Run npm run setup (Internet required). Chat still works.');
}
startProcess(process.execPath, ['server.mjs'], root, 'hub');
