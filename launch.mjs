/** Launch the original SUPERMAN proxy and the community server, with Windows-safe paths. */
import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const engine=path.join(root,'superman-browser');
const deps=path.join(engine,'node_modules');
const processes=[];
let stopping=false;
function run(script,cwd,label){
  const p=spawn(process.execPath,[script],{cwd,stdio:'inherit',shell:false,env:process.env});
  processes.push(p);
  p.on('error',err=>{console.error(`[SUPERMAN ${label}] ${err.message}`);if(label==='chat')stop()});
  p.on('exit',code=>{if(!stopping && code!==0)console.error(`[SUPERMAN ${label}] exited with code ${code}`);if(!stopping && label==='chat')stop()});
}
function stop(){if(stopping)return;stopping=true;for(const p of processes)if(!p.killed)p.kill('SIGTERM')}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
if(existsSync(deps)){
  console.log('[SUPERMAN] Starting original SUPERMAN Browser engine (Scramjet is a dependency only).');
  run('server.mjs',engine,'browser');
}else{
  console.warn('[SUPERMAN] Browser packages are not installed. Run npm run setup once. Chat still works.');
}
run('server.mjs',root,'chat');
