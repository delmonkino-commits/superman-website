/** Standalone SUPERMAN Browser web service for Render. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProxyGateway} from './proxy-gateway.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const browserDir=path.join(root,'superman-browser');
const startScript=path.join(browserDir,'server.mjs');
const secret=process.env.PROXY_GATEWAY_SECRET||'';
if(secret.length<32){console.error('[SUPERMAN] Missing PROXY_GATEWAY_SECRET (at least 32 random characters).');process.exit(1);}
if(!existsSync(startScript)||!existsSync(path.join(browserDir,'node_modules'))){
  console.error('[SUPERMAN] Browser engine dependencies missing. Use Build Command: npm ci --prefix superman-browser');
  process.exit(1);
}
const port=Number(process.env.PORT||10000);
const upstreamPort=Number(process.env.PROXY_PORT||8080);
const browser=spawn(process.execPath,[startScript],{
  cwd:browserDir,stdio:'inherit',env:{...process.env,PROXY_PORT:String(upstreamPort)},shell:false
});
const gateway=createProxyGateway({port,host:'0.0.0.0',upstreamPort,sharedSecret:secret,staticDir:path.join(root,'public')});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;browser.kill('SIGTERM');await gateway.stop().catch(()=>{});}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop().then(()=>process.exit(0));});
browser.once('error',err=>{console.error('[SUPERMAN] Browser server startup error:',err.message);stop().then(()=>process.exit(1));});
browser.once('exit',code=>{if(!stopping){console.error('[SUPERMAN] Browser engine stopped:',code);stop().then(()=>process.exit(1));}});
await gateway.start();
console.log('[SUPERMAN] Secure public browser gateway ready.');
