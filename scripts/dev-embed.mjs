/**
 * Runs the embed development loop: the Nuxt dev server for the editor plus the
 * host stand on a second origin.
 *
 * The two are deliberately reached through different hostnames (`localhost` vs
 * `127.0.0.1`), which the browser treats as separate origins. That is what makes
 * the stand exercise the real third-party path — origin checks, the postMessage
 * boundary and the absence of cross-origin isolation — without any DNS setup.
 */
import { spawn } from 'node:child_process';

const editorPort = Number(process.env.PORT ?? 3008);
const standPort = Number(process.env.EMBED_HOST_PORT ?? 3011);
const editorUrl = `http://localhost:${editorPort}/embed`;
const standUrl = `http://127.0.0.1:${standPort}/`;

const children = [];

function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n${command} exited (${signal ?? code}); shutting down the embed dev loop.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('pnpm', ['--filter', '@fastcat/web', 'exec', 'nuxt', 'dev', '--port', String(editorPort)]);
run('node', ['scripts/embed-host-server.mjs', '--port', String(standPort), '--editor', editorUrl]);

console.log(`\nEmbed host stand:  ${standUrl}`);
console.log(`Editor (embedded): ${editorUrl}\n`);
