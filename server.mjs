import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCommunity } from './community.mjs';
import { createProxyGateway } from './proxy-gateway.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const PORT = Number(process.env.PORT || 3000);
const PROXY_PORT = Number(process.env.PROXY_PORT || 8080);
const upstreamHost = '127.0.0.1';
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
let password = process.env.ACCESS_PASSWORD;
if (!password) {
  password = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(envFile, `ACCESS_PASSWORD=${password}\n`, { mode: 0o600 });
  console.log('[SuperMan] Generated private ADMIN password in .env.local.');
}
let memberPassword = process.env.MEMBER_PASSWORD;
if (!memberPassword) {
  memberPassword = crypto.randomBytes(24).toString('base64url');
  const newline = fs.existsSync(envFile) && !fs.readFileSync(envFile, 'utf8').endsWith('\n') ? '\n' : '';
  fs.appendFileSync(envFile, `${newline}MEMBER_PASSWORD=${memberPassword}\n`, { mode: 0o600 });
  console.log('[SuperMan] Generated a separate FRIEND password in .env.local.');
}
if (memberPassword === password) {
  console.error('[SuperMan] ACCESS_PASSWORD and MEMBER_PASSWORD must be different.');
  process.exit(1);
}
// The proxy and chat originally ran on the same web origin. Until they can be
// deployed on distinct origins, disable the web proxy for public friend use.
const PROXY_ENABLED = false; // Always keep proxy off the chat origin; use port 3001 only.
const sessions = new Map();
const streams = new Set();
const actions = new Map();
const failedLogins = new Map();
const loginFormTokens = new Map(); // Single-use per-visitor login tokens; no cookie dependency
const presence = new Map(); // Time-limited session heartbeats for Quick Tunnel visitors
const baseSettings = JSON.parse(fs.readFileSync(path.join(ROOT, 'site-config.json'), 'utf8'));
const SETTINGS_FILE = path.join(DATA, 'site-config.json');
const MESSAGES_FILE = path.join(DATA, 'messages.json');
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
let settings = validateSettings(readJSON(SETTINGS_FILE, baseSettings));
let messages = readJSON(MESSAGES_FILE, {});
for (const [k, v] of Object.entries(messages)) if (!Array.isArray(v)) delete messages[k];
const community = createCommunity({dataDir:DATA, legacyMessages:messages});
const GATEWAY_PORT = Number(process.env.SUPERMAN_BROWSER_PORT || 3001);
const BROWSER_CODE = String(process.env.PROXY_ACCESS_CODE || '123456789');
const BROWSER_PUBLIC = String(process.env.PROXY_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const browserGateway = createProxyGateway({port:GATEWAY_PORT, upstreamPort:PROXY_PORT,staticDir:PUBLIC});
const browserAttempts = new Map();
function browserOrigin(req) {
  if(BROWSER_PUBLIC){
    try {const url = new URL(BROWSER_PUBLIC); if(url.protocol==='https:' && !url.username && !url.password && !url.pathname.replaceAll('/','') && !url.search && !url.hash)return url.origin;}
    catch{}
    return null;
  }
  // 127.0.0.1:3001 can only be used from the same computer running SuperMan.
  // Do not send a local address to friends visiting on a remote device.
  const requestHost=String(req.headers.host||'').split(':')[0].toLowerCase();
  if(!['localhost','127.0.0.1','[::1]'].includes(requestHost))return null;
  // Different hostnames isolate cookies as well as origin-based browser storage.
  const separateHostname=requestHost==='localhost'?'127.0.0.1':'localhost';
  return `http://${separateHostname}:${GATEWAY_PORT}`;
}

function saveJSON(file, content) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(content, null, 2));
  fs.renameSync(temp, file);
}
function validateSettings(value) {
  const clean = typeof value === 'object' && value ? value : {};
  let channels = Array.isArray(clean.channels) ? clean.channels : baseSettings.channels;
  channels = channels.slice(0, 30).map(c => ({
    id: String(c?.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32),
    name: String(c?.name || '').slice(0, 36),
    description: String(c?.description || '').slice(0, 140),
    category: String(c?.category || 'COMMUNITY').toUpperCase().slice(0, 24)
  })).filter(c => c.id && c.name);
  if (!channels.length) channels = baseSettings.channels;
  const accent = /^#[0-9a-fA-F]{6}$/.test(clean.accent) ? clean.accent : baseSettings.accent;
  return {
    name: String(clean.name || 'SuperMan').slice(0, 32),
    tagline: String(clean.tagline || baseSettings.tagline).slice(0, 100),
    description: String(clean.description || '').slice(0, 180),
    accent,
    welcomeChannel: channels.some(c => c.id === clean.welcomeChannel) ? clean.welcomeChannel : channels[0].id,
    channels
  };
}
function json(res, code, payload, headers = {}) { res.writeHead(code, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers }); res.end(JSON.stringify(payload)); }
function cookieValue(req, key) {
  const found = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(key + '='));
  return found ? found.slice(key.length + 1) : null;
}
function sessionFor(req) {
  const token = cookieValue(req, 'superman_sid');
  const session = token && sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.lastSeen > 7 * 864e5) { sessions.delete(token); return null; }
  session.lastSeen = Date.now();
  return session;
}
function isAuthorized(req) { return Boolean(sessionFor(req)); }
function isAdmin(req) { return sessionFor(req)?.role === 'admin'; }
function mayUseProxy(req) { return PROXY_ENABLED && isAdmin(req); }

function isHttps(req) { return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https'; }
function bodyJSON(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > limit) { reject(new Error('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function checkOrigin(req) {
  // Compare the browser's Origin to the public hostname. Cloudflare Tunnel
  // may supply the public name through a forwarded header.
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const from = new URL(origin);
    if (from.protocol !== 'http:' && from.protocol !== 'https:') return false;
    const directHost = String(req.headers.host || '').toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
    if (from.host.toLowerCase() === directHost) return true;
    // Trust forwarded-host only from a local tunnel/reverse proxy.
    const peer = String(req.socket.remoteAddress || '');
    const localPeer = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    if (localPeer && forwardedHost && from.host.toLowerCase() === forwardedHost) return true;
    // Treat localhost and 127.0.0.1 as equivalent only for local requests
    // targeting the same port; do not weaken checks for public origins.
    const loopback = new Set(['localhost','127.0.0.1','[::1]']);
    const target = new URL('http://' + directHost);
    if (localPeer && loopback.has(from.hostname.toLowerCase()) && loopback.has(target.hostname.toLowerCase()) && from.port === target.port) return true;
    return false;
  } catch { return false; }
}
function broadcast(type, payload) {
  const serialized = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const s of streams) { try { s.res.write(serialized); } catch { streams.delete(s); } }
}
function serverTime() { return new Date().toISOString(); }
function rateLimit(req, max = 12) {
  const key = cookieValue(req, 'superman_sid');
  const now = Date.now();
  const list = (actions.get(key) || []).filter(t => now - t < 60000);
  if (list.length >= max) return false;
  list.push(now); actions.set(key, list); return true;
}
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json; charset=utf-8' };
function serveFile(res, requested) {
  const rel = path.posix.normalize('/' + requested).slice(1);
  const filename = path.resolve(PUBLIC, rel);
  if (!filename.startsWith(PUBLIC + path.sep)) return json(res, 403, {error:'Forbidden'});
  try {
    const bytes = fs.readFileSync(filename);
    res.writeHead(200, { 'content-type': TYPES[path.extname(filename)] || 'application/octet-stream', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
    res.end(bytes);
  } catch { json(res, 404, {error:'Not found'}); }
}
function loginPage(req, res, failure = false) {
  // A one-time token is generated with each page and bound to the requesting
  // browser's user agent and network peer. This avoids reliance on a Strict
  // cookie, which browsers can omit when reporting an opaque Origin: null.
  // We still reject explicit cross-origin POSTs in login() below.
  const now = Date.now();
  for (const [key, issued] of loginFormTokens) if (now - issued.time > 10 * 60 * 1000) loginFormTokens.delete(key);
  const csrf = crypto.randomBytes(32).toString('hex');
  loginFormTokens.set(csrf, {
    time: now,
    peer: String(req.socket.remoteAddress || ''),
    agent: String(req.headers['user-agent'] || '')
  });
  res.writeHead(failure ? 401 : 200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'x-frame-options':'DENY' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SuperMan • Enter</title><style>body{background:#090a13;display:grid;place-items:center;min-height:100vh;color:#f8f8ff;font:16px system-ui;margin:0;background-image:radial-gradient(ellipse at 50% 14%,#44316d70,transparent 55%)}.card{width:min(90vw,390px);background:#151520;border:1px solid #ffffff18;border-radius:24px;padding:40px;box-shadow:0 32px 80px #0006}img{width:78px;filter:drop-shadow(0 0 24px #b193ff80)}h1{margin:20px 0 8px;font-size:31px}p{color:#9998b0;margin-bottom:27px}input{box-sizing:border-box;width:100%;padding:14px 16px;border:1px solid #4c4b65;border-radius:12px;background:#0f101b;color:white;font:inherit}button{width:100%;background:#a584ff;color:#100c1f;border:0;border-radius:12px;padding:14px;margin-top:14px;font-size:15px;font-weight:800;cursor:pointer}.error{color:#ff8b9d}</style></head><body><div class="card"><img src="/hub/assets/superman-emblem.svg" alt="SuperMan"><h1>Enter SuperMan</h1><p>One universe. Infinite possibilities.</p>${failure ? '<p class="error">Incorrect password. Try again.</p>' : ''}<form action="/hub/login" method="POST"><input type="hidden" name="csrf" value="${csrf}"><label for="password">Community password</label><input id="password" name="password" type="password" autofocus autocomplete="current-password" placeholder="Enter your password" required><button>Enter the universe ↗</button></form></div></body></html>`);
}
async function login(req, res) {
  const providedOrigin = req.headers.origin;
  if (providedOrigin && providedOrigin !== 'null' && !checkOrigin(req)) return json(res, 403, { error: 'Origin mismatch' });
  const ip = String(req.socket.remoteAddress || 'unknown');
  const recent = (failedLogins.get(ip)||[]).filter(t=>Date.now()-t<60000);
  if (recent.length>=10) return json(res,429,{error:'Too many login attempts. Try again in a minute.'});
  let raw='';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return json(res, 413, {error:'Too long'}); }
  const params = new URLSearchParams(raw);
  const submittedCsrf = params.get('csrf') || '';
  const issued = loginFormTokens.get(submittedCsrf);
  // Tokens can only be used once, including failed password attempts.
  loginFormTokens.delete(submittedCsrf);
  const validCsrf = /^[a-f0-9]{64}$/.test(submittedCsrf) &&
    Boolean(issued) && Date.now() - issued.time <= 600000 &&
    issued.peer === String(req.socket.remoteAddress || '') &&
    issued.agent === String(req.headers['user-agent'] || '');
  if (!validCsrf) return json(res, 403, { error: 'Login form expired. Open /hub/login again and try once.' });
  const value = params.get('password') || '';
  function matches(secret) {
    const a = Buffer.from(value), b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const adminMatch = matches(password);
  const friendMatch = matches(memberPassword);
  if (!adminMatch && !friendMatch) { recent.push(Date.now()); failedLogins.set(ip,recent); return loginPage(req, res, true); }
  failedLogins.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { lastSeen: Date.now(), role: adminMatch ? 'admin' : 'member' });
  res.writeHead(302, { 'location':'/hub/', 'set-cookie':`superman_sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${isHttps(req) ? '; Secure' : ''}`, 'cache-control':'no-store' });
  res.end();
}
function brandHtml(body) {
  return body.replace(/<\/head>/i, '<link rel="stylesheet" href="/superman-brand/proxy-brand.css"><script defer src="/superman-brand/proxy-brand.js"></script></head>');
}
function forwardProxy(req, res) {
  const headers = {...req.headers, 'accept-encoding':'identity'};
  const target = http.request({host:upstreamHost, port:PROXY_PORT, method:req.method, path:req.url, headers}, pRes => {
    const h = {...pRes.headers};
    const inject = req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/' && String(h['content-type']||'').includes('text/html') && !h['content-encoding'];
    if (!inject) { res.writeHead(pRes.statusCode || 502, h); pRes.pipe(res); return; }
    const chunks = []; let size = 0;
    pRes.on('data', b => { size += b.length; if (size < 3e6) chunks.push(b); });
    pRes.on('end', () => {
      if (size >= 3e6) { json(res, 502, {error:'Upstream HTML too large'}); return; }
      const output = Buffer.from(brandHtml(Buffer.concat(chunks).toString('utf8')));
      delete h['content-length']; delete h.etag;
      res.writeHead(pRes.statusCode || 200, h); res.end(output);
    });
  });
  target.on('error', () => { if (!res.headersSent) { res.writeHead(503, {'content-type':'text/html; charset=utf-8'}); res.end('<html><body style="background:#11121c;color:white;font:16px system-ui;padding:40px"><h2>SuperMan browser is not running</h2><p>Run <code>npm run setup</code>, then <code>npm start</code> to enable the browser engine.</p><a style="color:#bdabff" href="/hub/">Back to chat</a></body></html>'); } });
  req.pipe(target);
}
function forwardWebSocket(req, socket, head) {
  if (!isAuthorized(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
  if (!checkOrigin(req) || !mayUseProxy(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
  const upstream = net.connect(PROXY_PORT, upstreamHost, () => {
    const rawHeaders = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) rawHeaders.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i+1]}`);
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${rawHeaders.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket); socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
}
const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  if (req.url?.startsWith('/hub/')) {
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('content-security-policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src 'self'; form-action 'self'");
  }
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname === '/hub/api/health' && req.method === 'GET') return json(res,200,{service:'SuperMan',ok:true,browserInstalled:fs.existsSync(path.join(ROOT,'superman-browser','node_modules'))});
  if (pathname === '/hub/login' && req.method === 'GET') return loginPage(req, res);
  if (pathname === '/hub/login' && req.method === 'POST') return login(req,res);
  if (pathname.startsWith('/hub/assets/')) return serveFile(res, 'assets/' + pathname.slice('/hub/assets/'.length));
  if (!isAuthorized(req)) { res.writeHead(302, { location:'/hub/login' }); res.end(); return; }
  if (pathname === '/hub/logout' && req.method === 'POST') {
    if (!checkOrigin(req)) return json(res, 403, {error:'Origin mismatch'});
    sessions.delete(cookieValue(req, 'superman_sid'));
    presence.delete(cookieValue(req, 'superman_sid'));
    res.writeHead(302, {location:'/hub/login', 'set-cookie':'superman_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'}); res.end(); return;
  }
  if (pathname === '/hub/' || pathname === '/hub') return serveFile(res, 'index.html');
  if (pathname === '/hub/app.js') return serveFile(res,'app.js');
  if (pathname === '/hub/style.css') return serveFile(res,'style.css');
  if (pathname === '/superman-brand/proxy-brand.js') return serveFile(res,'proxy-brand.js');
  if (pathname === '/superman-brand/proxy-brand.css') return serveFile(res,'proxy-brand.css');
  if (pathname.startsWith('/hub/api/v2/')) return community.handle(req,res,{pathname,url,session:sessionFor(req),checkOrigin,bodyJSON,isHttps,rateLimit});
  if (pathname === '/hub/api/proxy/unlock' && req.method === 'POST') {
    if(!checkOrigin(req))return json(res,403,{error:'Request origin not allowed'});
    const key=cookieValue(req,'superman_sid');
    const attempts=(browserAttempts.get(key)||[]).filter(t=>Date.now()-t<15*60*1000);
    if(attempts.length>=5)return json(res,429,{error:'Too many incorrect codes. Try again later.'});
    let payload;
    try {payload=await bodyJSON(req,512);} catch {return json(res,400,{error:'Invalid request'});}
    const submitted=Buffer.from(String(payload.code||''),'utf8');
    const expected=Buffer.from(BROWSER_CODE,'utf8');
    if(submitted.length!==expected.length || !crypto.timingSafeEqual(submitted,expected)){
      attempts.push(Date.now());browserAttempts.set(key,attempts);
      return json(res,403,{error:'Incorrect proxy access code'});
    }
    browserAttempts.delete(key);
    const base=browserOrigin(req);
    if(!base)return json(res,409,{error:'For remote access, start a second Cloudflare Tunnel to port 3001 and set PROXY_PUBLIC_URL in .env.local. See SUPERMAN-PROXY-SETUP.md.'});
    const ticket=browserGateway.mintTicket();
    return json(res,200,{url:`${base}/_superman/start?ticket=${encodeURIComponent(ticket)}`});
  }
  if (pathname === '/hub/api/me' && req.method === 'GET') return json(res, 200, {
    role: sessionFor(req).role,
    canProxy: mayUseProxy(req)
  });
  if (pathname === '/hub/api/presence' && req.method === 'GET') {
    const key = cookieValue(req, 'superman_sid');
    const name = String(url.searchParams.get('user') || 'Guest').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 28);
    presence.set(key, { user: name, lastSeen: Date.now() });
    const active = [];
    for (const [token, item] of presence) {
      if (Date.now() - item.lastSeen > 30000 || !sessions.has(token)) { presence.delete(token); continue; }
      active.push(item.user);
    }
    return json(res, 200, {online:active.length,users:[...new Set(active)].slice(0,60)});
  }
  if (pathname === '/hub/api/settings' && req.method === 'GET') return json(res, 200, settings);
  if (pathname === '/hub/api/settings' && req.method === 'PUT') {
    if (!isAdmin(req)) return json(res, 403, {error:'Only the owner can edit SuperMan settings'});
    if (!checkOrigin(req)) return json(res, 403, {error:'Origin mismatch'});
    if (!rateLimit(req, 30)) return json(res, 429, {error:'Too many requests'});
    try { settings = validateSettings(await bodyJSON(req, 16384)); saveJSON(SETTINGS_FILE, settings); broadcast('settings', settings); return json(res,200,settings); }
    catch { return json(res,400,{error:'Invalid settings'}); }
  }
  if (pathname === '/hub/api/history' && req.method === 'GET') {
    const channel = url.searchParams.get('channel') || settings.welcomeChannel;
    return json(res, 200, {messages:messages[channel] || []});
  }
  if (pathname === '/hub/api/send' && req.method === 'POST') return json(res,410,{error:'This chat endpoint has been upgraded. Refresh SuperMan.'});
  if (false && pathname === '/hub/api/send' && req.method === 'POST') {
    if (!checkOrigin(req)) return json(res,403,{error:'Origin mismatch'});
    if (!rateLimit(req)) return json(res,429,{error:'Slow down for a moment'});
    try {
      const input = await bodyJSON(req, 16384);
      const channel = String(input.channel || '');
      const author = String(input.author || '').trim().slice(0,28);
      const content = String(input.content || '').trim().slice(0,2000);
      if (!settings.channels.some(c=>c.id===channel) || !author || !content) return json(res,400,{error:'Enter a name, message and valid channel'});
      const item = {id:crypto.randomUUID(), channel, author, content, createdAt:serverTime()};
      (messages[channel] ||= []).push(item);
      messages[channel] = messages[channel].slice(-200);
      saveJSON(MESSAGES_FILE, messages);
      broadcast('message', item);
      return json(res,201,{message:item});
    } catch { return json(res,400,{error:'Invalid message'}); }
  }
  if (pathname === '/hub/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'content-type':'text/event-stream; charset=utf-8', 'cache-control':'no-cache, no-transform', 'connection':'keep-alive', 'x-accel-buffering':'no' });
    const user = (url.searchParams.get('user') || 'Guest').slice(0,28);
    const entry = {res, user}; streams.add(entry);
    res.write(': connected\n\n');
    broadcast('presence', {online:streams.size, users:[...new Set([...streams].map(x=>x.user))].slice(0,60)});
    req.on('close', () => { streams.delete(entry); broadcast('presence', {online:streams.size, users:[...new Set([...streams].map(x=>x.user))].slice(0,60)}); });
    return;
  }
  if (!mayUseProxy(req)) return json(res, 403, {error: 'Browser proxy disabled in friend-safe mode. This does not affect chat.'});
  forwardProxy(req,res);
});
server.on('upgrade', forwardWebSocket);
const heartbeat = setInterval(() => { for (const s of streams) { try { s.res.write(': ping\n\n'); } catch { streams.delete(s); } } },25000);
heartbeat.unref();
const HUB_HOST = process.env.HUB_HOST || '127.0.0.1';
browserGateway.start().catch(error=>{console.error('[SuperMan] Browser gateway failed to start:',error.message);});
server.listen(PORT, HUB_HOST, ()=>{
  console.log(`[SuperMan] Open http://localhost:${PORT}/hub/`);
  console.log(`[SuperMan] Owner-only settings; public proxy ${PROXY_ENABLED ? 'ENABLED (do not share this origin with friends)' : 'DISABLED'}; listening on ${HUB_HOST}.`);
  console.log('[SuperMan] Login security fix v2 active (one-time visitor tokens).');
  console.log('[SuperMan] Community v2: one main chat, friend codes and groups enabled.');
  console.log('[SuperMan] SUPERMAN Browser unlock uses a separate access code and isolated origin.');
  if(BROWSER_CODE==='123456789')console.warn('[SuperMan] WARNING: default proxy PIN 123456789 is weak. Change PROXY_ACCESS_CODE before sharing publicly.');
});
export {server, validateSettings};
