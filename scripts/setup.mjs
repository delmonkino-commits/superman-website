/** Install only our standalone dependency-based browser — no other site is cloned. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageDir=path.join(root,'superman-browser');
if(!existsSync(path.join(packageDir,'package.json'))){console.error('SUPERMAN Browser folder missing. Re-extract the update ZIP.');process.exit(1)}
const possible=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')].filter(Boolean);
const npmScript=possible.find(existsSync);
if(!npmScript){console.error('Could not locate npm-cli.js. Install Node.js and run "npm install" inside superman-browser.');process.exit(1)}
console.log('[SUPERMAN] Installing Scramjet dependencies for original SUPERMAN Browser. No proxy website is cloned.');
const child=spawn(process.execPath,[npmScript,'install','--prefix',packageDir,'--no-audit','--no-fund'],{cwd:root,stdio:'inherit',shell:false});
child.on('error',err=>{console.error(err.message);process.exitCode=1});
child.on('exit',code=>{if(code===0)console.log('\n[SUPERMAN] Installation complete. Run: npm start');process.exitCode=code||0});
