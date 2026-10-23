// Starts a free, temporary Cloudflare subdomain for a local SuperMan session.
// Requires cloudflared to be installed separately. This is for testing, not guaranteed hosting.
import {spawn} from 'node:child_process';
import {spawnSync} from 'node:child_process';
const command=process.platform==='win32'?'cloudflared.exe':'cloudflared';
const check=spawnSync(command,['--version'],{encoding:'utf8',shell:process.platform==='win32'});
if(check.error || check.status!==0){
  console.error('cloudflared was not found. Download it for free: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  process.exit(1);
}
const port=process.env.PORT || '3000';
console.log('[SuperMan] Starting free temporary subdomain for http://localhost:'+port);
console.log('[SuperMan] Keep this terminal and npm start running. The subdomain changes after a restart.');
const child=spawn(command,['tunnel','--url',`http://localhost:${port}`],{stdio:'inherit',shell:process.platform==='win32'});
process.on('SIGINT',()=>child.kill('SIGTERM'));
child.on('exit', code=>process.exitCode=code||0);
