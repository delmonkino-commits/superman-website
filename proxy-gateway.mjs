/**
 * SUPERMAN Browser Gateway. Separate origin from /hub/ chat.
 * Keeps full browser engine and its service workers on a distinct port.
 * The original SUPERMAN browser server runs separately on 127.0.0.1:8080.
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyRemoteTicket } from './proxy-token.mjs';

const COOKIE = 'superman_browser_key';
const SESSION_MS = 60 * 60 * 1000;
const TICKET_MS = 45 * 1000;
const BADGE_CSS = `body{--superman-brand:#997aff}`;
const SECURE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
};

function valueOfCookie(req, key) {
  const value = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='));
  return value?.slice(key.length+1) || '';
}
function loopback(hostname) {return ['localhost', '127.0.0.1', '[::1]'].includes(hostname?.toLowerCase());}
function bad(res, status, title, message) {
  res.writeHead(status, {'content-type':'text/html; charset=utf-8', ...SECURE_HEADERS,'x-frame-options':'DENY'});
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SUPERMAN</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d1b;color:#edf0ff;font:16px system-ui}.panel{max-width:450px;padding:40px;border-radius:22px;background:#181b2c;border:1px solid #3a3b56;line-height:1.7}a{color:#bba5ff}</style><section class="panel"><h1>${title}</h1><p>${message}</p><p>Return to SuperMan, choose Proxy and enter your access code.</p></section></html>`);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return false;
  try {return new URL(origin).host.toLowerCase() === String(req.headers.host||'').toLowerCase();}
  catch {return false;}
}
function safeHeaders(req, upstreamPort) {
  const headers = {...req.headers};
  headers.host = `127.0.0.1:${upstreamPort}`;
  // Never forward SuperMan login and browser authorization cookies to the engine.
  const cleanCookies = (headers.cookie || '').split(';').map(x=>x.trim()).filter(x=>x && !/^(superman_sid|superman_browser_key)=/.test(x));
  if(cleanCookies.length)headers.cookie = cleanCookies.join('; '); else delete headers.cookie;
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  delete headers['x-forwarded-for'];
  delete headers['proxy-authorization'];
  return headers;
}

export function createProxyGateway({port=3001, upstreamPort=8080, host='127.0.0.1', staticDir, logger=console, sharedSecret=null} = {}) {
  const tickets = new Map();
  const spentRemoteTickets = new Map();
  const sessions = new Map();
  function mintTicket() {
    const key = crypto.randomBytes(32).toString('base64url');
    tickets.set(key,Date.now() + TICKET_MS);
    return key;
  }
  function validSession(req) {
    const key = valueOfCookie(req,COOKIE);
    const expires = sessions.get(key);
    if (!key || !expires || Date.now()>expires) {if (key) sessions.delete(key);return false;}
    sessions.set(key, Date.now()+SESSION_MS);
    return true;
  }
  function checkTicket(ticket) {
    if(sharedSecret){
      const expires=verifyRemoteTicket(ticket,sharedSecret);
      if(!expires)return false;
      const digest=crypto.createHash('sha256').update(ticket).digest('hex');
      if(spentRemoteTickets.has(digest))return false;
      spentRemoteTickets.set(digest,expires);
      return true;
    }
    const expires = tickets.get(ticket);
    tickets.delete(ticket); // single-use even if expired
    return Boolean(expires && Date.now() <= expires);
  }
  function staticFile(res, file, mime) {
    try {res.writeHead(200, {'content-type':mime, ...SECURE_HEADERS}); res.end(fs.readFileSync(path.join(staticDir,file)));}
    catch {bad(res,404,'Not found','This SuperMan asset is missing.');}
  }
  function proxyHttp(req,res) {
    // Forward requests to this project's independently authored browser server,
    // not to any cloned third-party proxy website.
    const outgoing=http.request({
      hostname:'127.0.0.1', port:upstreamPort, path:req.url,method:req.method,
      headers:safeHeaders(req,upstreamPort)
    },upstream=>{
      const headers={...upstream.headers};
      // Do not leak our loopback port in redirects to remote Chromebook users.
      if(typeof headers.location==='string'){
        try {const to=new URL(headers.location);if(loopback(to.hostname)&&Number(to.port)===upstreamPort)headers.location=to.pathname+to.search+to.hash;}catch{}
      }
      res.writeHead(upstream.statusCode||502,{...headers,'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
      upstream.pipe(res);
    });
    outgoing.setTimeout(60000,()=>outgoing.destroy(new Error('Browser timeout')));
    outgoing.on('error',()=>{
      if(!res.headersSent)bad(res,503,'SUPERMAN Browser is offline','Install engine packages with npm run setup, then start npm start.');
      else res.destroy();
    });
    req.pipe(outgoing);
  }
  const server=http.createServer((req,res)=>{
    if (!req.url) return bad(res,400,'Invalid request','The request is missing a URL.');
    let parsed;try{parsed=new URL(req.url,'http://localhost');}catch{return bad(res,400,'Invalid request','The URL could not be read.');}
    if(parsed.pathname==='/_superman/health' && req.method==='GET'){
      res.writeHead(200,{'content-type':'application/json; charset=utf-8',...SECURE_HEADERS});
      return res.end(JSON.stringify({ok:true,service:'SUPERMAN Browser gateway'}));
    }
    if(parsed.pathname==='/_superman/start' && req.method==='GET') {
      const ticket=parsed.searchParams.get('ticket')||'';
      if(!checkTicket(ticket))return bad(res,403,'Access required','This link is expired or already used. Unlock the proxy again from SuperMan.');
      const key=crypto.randomBytes(32).toString('base64url');
      sessions.set(key,Date.now()+SESSION_MS);
      const secure=req.socket.encrypted || String(req.headers['x-forwarded-proto']||'').split(',')[0]==='https';
      res.writeHead(303,{location:'/', 'set-cookie':`${COOKIE}=${key}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600${secure?'; Secure':''}`, ...SECURE_HEADERS});
      return res.end();
    }
    if(!validSession(req))return bad(res,401,'SUPERMAN · Locked','Unlock this browser from the Proxy button in your SuperMan chat.');
    if(parsed.pathname==='/_superman/logout' && req.method==='POST') {
      if(!sameOrigin(req))return bad(res,403,'Access denied','Origin mismatch.');
      sessions.delete(valueOfCookie(req,COOKIE));
      res.writeHead(303,{location:'/', 'set-cookie':`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`, ...SECURE_HEADERS});return res.end();
    }
    proxyHttp(req,res);
  });
  server.on('upgrade',(req,socket,head)=>{
    if(!validSession(req))return socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    // Browser websocket requests must come from the browser gateway origin.
    if(!sameOrigin(req))return socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    const upstream=net.connect(upstreamPort,'127.0.0.1',()=>{
      const headers=safeHeaders(req,upstreamPort);
      const entries=Object.entries(headers).map(([key,value])=>`${key}: ${value}`).join('\r\n');
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${entries}\r\n\r\n`);
      if(head.length)upstream.write(head);
      upstream.pipe(socket);socket.pipe(upstream);
    });
    upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
  });
  // Remove expired tickets/sessions; no persistence across server restarts.
  const cleanup=setInterval(()=>{
    const now=Date.now();for(const [k,v] of tickets)if(v<=now)tickets.delete(k);
    for(const [k,v] of spentRemoteTickets)if(v<=now)spentRemoteTickets.delete(k);
    for(const [k,v] of sessions)if(v<=now)sessions.delete(k);
  },60000);cleanup.unref();
  function start(){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);logger.log(`[SuperMan] SUPERMAN Browser gateway listening at http://${host}:${port}/ (separate origin).`);resolve(server);});});}
  function stop(){clearInterval(cleanup);return new Promise(resolve=>server.close(resolve));}
  return {start,stop,mintTicket,server};
}
