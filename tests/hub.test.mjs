import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=30000+Math.floor(Math.random()*20000);
const base='http://127.0.0.1:'+port;
const env={...process.env,ACCESS_PASSWORD:'testing123-superman',MEMBER_PASSWORD:'friend-test-password',ENABLE_PROXY:'true',PORT:String(port),PROXY_PORT:'60991'};
const server=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let logs='';server.stderr.on('data',b=>logs+=b);
async function waitUp(){for(let tries=0;tries<60;tries++){try{const r=await fetch(base+'/hub/api/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,90));}throw new Error('server startup failed: '+logs);}
try {
 await waitUp();
 await test('free hub responds to health',async()=>{
  const r=await fetch(base+'/hub/api/health');assert.equal(r.status,200);assert.equal((await r.json()).service,'SuperMan');
 });
 await test('unauthenticated users cannot access chat or proxy',async()=>{
  const r=await fetch(base+'/hub/',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/hub/login');
  const upstream=await fetch(base+'/',{redirect:'manual'});assert.equal(upstream.status,302);
 });
 const wrong=await fetch(base+'/hub/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':base.replace('127.0.0.1','localhost').replace('http://localhost','http://127.0.0.1')},body:'password=wrong',redirect:'manual'});
 assert.equal(wrong.status,401);
 const login=await fetch(base+'/hub/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':base},body:'password=testing123-superman',redirect:'manual'});
 assert.equal(login.status,302);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 await test('friends cannot edit owner settings or use the proxy',async()=>{
  const friend = await fetch(base+'/hub/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':base},body:'password=friend-test-password',redirect:'manual'});
  assert.equal(friend.status,302);
  const friendCookie=friend.headers.get('set-cookie').split(';')[0];
  const identity=await fetch(base+'/hub/api/me',{headers:{cookie:friendCookie}});
  assert.deepEqual((await identity.json()),{role:'member',canProxy:false});
  const update=await fetch(base+'/hub/api/settings',{method:'PUT',headers:{cookie:friendCookie,'origin':base,'content-type':'application/json'},body:'{}'});
  assert.equal(update.status,403);
  const p=await fetch(base+'/',{headers:{cookie:friendCookie}});
  assert.equal(p.status,403);
 });
 await test('logged-in user can view app and site settings',async()=>{
  const r=await fetch(base+'/hub/',{headers:{cookie}});assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes('SuperMan Browser'));
  const conf=await fetch(base+'/hub/api/settings',{headers:{cookie}});assert.equal(conf.status,200);assert.equal((await conf.json()).name,'SuperMan');
 });
 await test('a message is stored and appears in history',async()=>{
  const msg=await fetch(base+'/hub/api/send',{method:'POST',headers:{cookie,'content-type':'application/json','origin':base},body:JSON.stringify({channel:'general',author:'Alice',content:'Hello SuperMan!'})});
  assert.equal(msg.status,201,await msg.text());
  const history=await fetch(base+'/hub/api/history?channel=general',{headers:{cookie}});
  assert.equal(history.status,200);assert.ok((await history.json()).messages.some(x=>x.content==='Hello SuperMan!'));
 });
 await test('settings API updates colors/channels',async()=>{
  const newSettings={name:'SuperMan',tagline:'YOUR UNIVERSE. UNLOCKED.',description:'My editable hub',accent:'#6633ff',welcomeChannel:'general',channels:[{id:'general',name:'general',description:'Hello',category:'COMMUNITY'}]};
  const r=await fetch(base+'/hub/api/settings',{method:'PUT',headers:{cookie,'content-type':'application/json','origin':base},body:JSON.stringify(newSettings)});
  assert.equal(r.status,200);assert.equal((await r.json()).accent,'#6633ff');
 });
 await test('without upstream installed proxy error is informative',async()=>{
  const r=await fetch(base+'/',{headers:{cookie}});assert.equal(r.status,503);assert.match(await r.text(),/not running/i);
 });
 await test('gateway forwards native proxy HTML and injects visible rebrand',async()=>{
  const mock=http.createServer((_req,res)=>{
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end('<html><head><title>InvisiProxy</title></head><body><h1>InvisiProxy</h1></body></html>');
  });
  await new Promise(resolve=>mock.listen(60991,'127.0.0.1',resolve));
  try {
    const r=await fetch(base+'/',{headers:{cookie}});
    assert.equal(r.status,200);
    const html=await r.text();
    assert.match(html,/superman-brand\/proxy-brand.js/);
    assert.match(html,/<h1>InvisiProxy<\/h1>/); // DOM branding is applied by the client, not server
  } finally {await new Promise(resolve=>mock.close(resolve));}
 });
} finally {
 server.kill();
 for(const filename of ['messages.json','site-config.json']){
   const full=path.join(root,'data',filename);
   if(fs.existsSync(full))fs.rmSync(full);
 }
}
