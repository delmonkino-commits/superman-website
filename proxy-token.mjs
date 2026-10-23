/** Server-only, short-lived cross-service SUPERMAN browser access tickets. */
import crypto from 'node:crypto';
const TTL=45_000;
function hmac(secret,body){return crypto.createHmac('sha256',secret).update(body).digest('base64url');}
function requireSecret(secret){if(typeof secret!=='string'||secret.length<32)throw new Error('PROXY_GATEWAY_SECRET must contain at least 32 random characters.');}
export function mintRemoteTicket(secret, now=Date.now()){
  requireSecret(secret);
  const payload=Buffer.from(JSON.stringify({expires:now+TTL,nonce:crypto.randomBytes(18).toString('base64url')})).toString('base64url');
  return `v1.${payload}.${hmac(secret,`v1.${payload}`)}`;
}
/** Returns expiry timestamp on success; false on failure. */
export function verifyRemoteTicket(token,secret,now=Date.now()){
  if(typeof secret!=='string'||secret.length<32||typeof token!=='string'||token.length>1024)return false;
  const parts=token.split('.');if(parts.length!==3||parts[0]!=='v1'||!/^[A-Za-z0-9_-]+$/.test(parts[1])||!/^[A-Za-z0-9_-]+$/.test(parts[2]))return false;
  const sig=hmac(secret,`v1.${parts[1]}`);
  if(sig.length!==parts[2].length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(parts[2])))return false;
  try{
    const object=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    if(!Number.isSafeInteger(object.expires)||object.expires<now||object.expires>now+TTL)return false;
    if(typeof object.nonce!=='string'||object.nonce.length<20)return false;
    return object.expires;
  }catch{return false;}
}
