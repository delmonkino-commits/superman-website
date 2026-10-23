/**
 * SUPERMAN Browser v2.4 — independent app/server, using packaged Scramjet as a dependency.
 * This process listens on loopback only, behind the authenticated SuperMan gateway.
 * It is not an open forward/reverse proxy on the user's LAN.
 */
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import express from 'express';
import {scramjetPath} from '@mercuryworkshop/scramjet/path';
import {server as wisp} from '@mercuryworkshop/wisp-js/server';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageDirectory = id => path.dirname(require.resolve(id));
const app = express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  next();
});
// Runtime identifiers below are internal API/asset paths and are not branding.
// Do not rename them: their filenames are part of the engine's public API.
app.use('/scram/', express.static(scramjetPath,{fallthrough:false}));
app.use('/controller/',express.static(packageDirectory('@mercuryworkshop/scramjet-controller'),{fallthrough:false}));
app.use('/utils/',express.static(packageDirectory('@mercuryworkshop/scramjet-utils'),{fallthrough:false}));
app.use('/libcurl/',express.static(packageDirectory('@mercuryworkshop/libcurl-transport'),{fallthrough:false}));
app.get('/api/health',(_req,res)=>res.json({ok:true,application:'SUPERMAN Browser',engine:'ready'}));
app.use(express.static(path.join(here,'public'),{index:'index.html'}));
app.use((_req,res)=>res.status(404).send('Not found'));
const server = http.createServer(app);
server.on('upgrade',(req,socket,head)=>{
  let pathname;
  try{pathname=new URL(req.url||'/','http://localhost').pathname;}catch{socket.destroy();return;}
  if(pathname!=='/wisp/'){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
  req.url=pathname;
  wisp.routeRequest(req,socket,head);
});
const port=Number(process.env.PROXY_PORT||8080);
server.listen(port,'127.0.0.1',()=>console.log(`[SUPERMAN] Original browser engine ready at http://127.0.0.1:${port}`));
