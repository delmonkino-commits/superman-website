import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const upstream=path.join(root,'upstream');
const repo='https://github.com/InvisiProxy/InvisiProxyLTS.git';
const minimum=24;
if (Number(process.versions.node.split('.')[0]) < minimum){console.error(`SuperMan requires Node ${minimum}+ (upstream's official requirement); you have ${process.version}.`);process.exit(1);}
function run(binary,args,cwd=root){
 console.log(`\n→ ${binary} ${args.join(' ')}`);
 const p=spawnSync(binary,args,{cwd,stdio:'inherit',shell:false});
 if(p.error)throw p.error;
 if(p.status!==0)throw Error(`${binary} exited with ${p.status}`);
}
// Invoke npm's npx JavaScript entry point through Node itself rather than a
// Windows command shell, which can split paths under C:\Program Files.
function runNpx(args,cwd=upstream){
 const candidates=[
   process.env.npm_execpath && path.join(path.dirname(process.env.npm_execpath),'npx-cli.js'),
   path.join(path.dirname(process.execPath),'node_modules','npm','bin','npx-cli.js')
 ].filter(Boolean);
 const cli=candidates.find(fs.existsSync);
 if(cli) return run(process.execPath,[cli,...args],cwd);
 if(process.platform==='win32') return run(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`npx ${args.join(' ')}`],cwd);
 return run('npx',args,cwd);
}
try{
 if(!fs.existsSync(path.join(upstream,'.git'))){
   if(fs.existsSync(upstream))throw Error('The upstream folder exists but is not a Git checkout; move or remove it first.');
   run('git',['clone','--depth','1',repo,'upstream']);
 }else{
   console.log('[SuperMan] Updating the upstream checkout to the latest master.');
   console.log('[SuperMan] Warning: this resets direct edits inside upstream/; keep your own changes in the SuperMan files.');
   run('git',['fetch','--depth','1','origin','master'],upstream);
   run('git',['reset','--hard','FETCH_HEAD'],upstream);
 }
 run(process.execPath,[path.join(root,'scripts','brand.mjs')]);
 const pwd=path.join(root,'.env.local');
 if(!fs.existsSync(pwd)){
   const password=crypto.randomBytes(18).toString('base64url');
   fs.writeFileSync(pwd,`ACCESS_PASSWORD=${password}\n`,{mode:0o600});
   console.log('\n[SuperMan] IMPORTANT: A secure password was created in .env.local. Save it to sign in.');
 }
 runNpx(['--yes','pnpm@10','install','--frozen-lockfile'],upstream);
 runNpx(['--yes','pnpm@10','build'],upstream);
 const hash=spawnSync('git',['rev-parse','--short','HEAD'],{cwd:upstream,encoding:'utf8'});
 const version=JSON.parse(fs.readFileSync(path.join(upstream,'package.json'),'utf8')).version;
 fs.writeFileSync(path.join(root,'upstream-version.txt'),`Version: ${version}\nCommit: ${(hash.stdout||'unknown').trim()}\nSource: ${repo}\n`);
 console.log(`\n✓ SuperMan ready. Upstream version ${version}. Run: npm start`);
 console.log('Open: http://localhost:3000/hub/');
}catch(error){console.error('\nSetup failed:',error.message);process.exitCode=1;}
