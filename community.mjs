import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Friend access is shared via MEMBER_PASSWORD; individual profiles are anchored
// to separate HttpOnly device cookies. Friend codes are discovery IDs, NOT secrets.
export async function createCommunity({ dataDir, legacyMessages = {}, initialState = null, saveState = null }) {
  const filename = path.join(dataDir, 'community.json');
  const clone = () => ({version:2,users:{},requests:[],groups:{},rooms:{main:[]},mutes:{}});
  function read() {
    try {
      const data = initialState === null ? JSON.parse(fs.readFileSync(filename,'utf8')) : initialState;
      if(data?.version!==2 || typeof data.users!=='object' || typeof data.rooms!=='object') return clone();
      return data;
    } catch { return clone(); }
  }
  const db = read();
  // Keep v2 data; adding moderation storage must not destroy existing profiles.
  db.mutes ||= {};
  let dirty = false;
  // Migration: older profiles are already set up; only profiles created after this
  // release must complete the welcome/name form. Never change their joinMain choice.
  for (const account of Object.values(db.users)) {
    account.preferences ||= {};
    if (typeof account.onboarded !== 'boolean') {
      account.onboarded = account.name !== 'New member';
      dirty = true;
    }
    if (typeof account.preferences.privateProfile !== 'boolean') {
      account.preferences.privateProfile = false;
      dirty = true;
    }
  }
  function newTimeoutCode() {
    let code;
    do { code = 'TO-' + crypto.randomBytes(8).toString('hex').toUpperCase(); }
    while (Object.values(db.users).some(u => u.timeoutCode === code));
    return code;
  }
  for (const account of Object.values(db.users)) {
    if (!/^TO-[0-9A-F]{16}$/.test(account.timeoutCode || '')) {
      account.timeoutCode = newTimeoutCode();
      dirty = true;
    }
  }
  if (initialState === null && !fs.existsSync(filename)) {
    const prior=Object.values(legacyMessages).filter(Array.isArray).flat()
      .filter(m=>m && typeof m.content==='string')
      .map(m=>({id:String(m.id || crypto.randomUUID()),author:String(m.author||'Member').slice(0,32),authorId:null,content:String(m.content).slice(0,1200),createdAt:String(m.createdAt||new Date().toISOString()),room:'main'}))
      .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-200);
    db.rooms.main=prior;
    dirty=true;
  }
  async function save() {
    if (saveState) return saveState(db);
    const temp=filename+'.tmp';fs.writeFileSync(temp,JSON.stringify(db,null,2),{mode:0o600});fs.renameSync(temp,filename);
  }
  if(dirty) await save();
  function response(res,status,value,headers={}) {
    res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});
    res.end(JSON.stringify(value));
  }
  function cookie(req,name){const x=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return x?x.slice(name.length+1):null;}
  const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
  const rand=n=>crypto.randomBytes(n).toString('base64url');
  const fixed = str => String(str||'').replace(/[\x00-\x1f\x7f]/g,'').trim();
  function me(req){const id=hash(cookie(req,'superman_profile')||'');return Object.values(db.users).find(u=>u.tokenHash===id)||null;}
  // Public DTOs are deliberate: a private profile must not leak its friend code.
  // Moderation codes are never included in a member-facing DTO.
  function publicUser(u) {
    return {id:u.id,name:u.name,...(u.preferences?.privateProfile?{}:{code:u.code})};
  }
  function mine(u) {
    return {id:u.id,name:u.name,code:u.code,onboarded:u.onboarded===true,preferences:u.preferences||{},createdAt:u.createdAt};
  }
  function canDiscover(viewer,target) {
    return viewer.id === target.id || !!friend(viewer,target.id) ||
      (joinedMain(viewer) && joinedMain(target)) ||
      Object.values(db.groups).some(g=>g.members.includes(viewer.id) && g.members.includes(target.id));
  }
  function uniqueCode(){let code;do{code='SM-'+crypto.randomBytes(4).toString('hex').toUpperCase();}while(Object.values(db.users).some(u=>u.code===code));return code;}
  async function newProfile(){const token=rand(32);const u={id:crypto.randomUUID(),tokenHash:hash(token),name:'New member',code:uniqueCode(),timeoutCode:newTimeoutCode(),onboarded:false,createdAt:new Date().toISOString(),friendIds:[],preferences:{privateProfile:false,accent:'#9878ff',cloak:'SuperMan',hotkey:'Alt+Shift+P',joinMain:false,background:'nebula',customTabTitle:'SuperMan',customFavicon:'',customBackground:''}};db.users[u.id]=u;await save();return {u,token};}
  const friend=(u,id)=>u.friendIds?.includes(id) && db.users[id];
  function joinedMain(u){ return u.preferences?.joinMain !== false; } // Existing v2 profiles stay opted in.
  function roomsFor(u){return [...(joinedMain(u)?[{id:'main',name:'Main Chat',kind:'main',members:null}]:[]),...Object.values(db.groups).filter(g=>g.members.includes(u.id)).map(g=>({id:g.id,name:g.name,kind:'group',members:g.members.length,ownerId:g.ownerId}))];}
  function canRead(u,room){return (room==='main' && joinedMain(u)) || !!db.groups[room]?.members.includes(u.id);}
  function asJSON(obj,code=200,headers={}){return {code,body:obj,headers};}
  function imageData(input,maxLength){
    // No SVG/HTML: only bounded raster data URLs created by the canvas encoder.
    return typeof input === 'string' && input.length <= maxLength &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input) ? input : '';
  }
  function prefs(input,existing={}){
    const validCloaks=['SuperMan','Homework','School Portal','Notes','Calendar','Dashboard','Custom'];
    const cloak=validCloaks.includes(input.cloak)?input.cloak:(existing.cloak||'SuperMan');
    const accent=/^#[0-9a-fA-F]{6}$/.test(input.accent)?input.accent:(existing.accent||'#9878ff');
    const validHotkeys=['Alt+Shift+P','Alt+Shift+Q','Alt+Shift+X','Ctrl+Shift+Y','Ctrl+Shift+U','Ctrl+Alt+P'];
    const backgrounds=['none','nebula','aurora','circuit','sunset','custom'];
    const background=backgrounds.includes(input.background)?input.background:(existing.background||'nebula');
    const rawTitle=typeof input.customTabTitle==='string'?fixed(input.customTabTitle):existing.customTabTitle;
    return {
      accent,cloak,hotkey:validHotkeys.includes(input.hotkey)?input.hotkey:(existing.hotkey||'Alt+Shift+P'),
      // A checkbox is required for new profiles; existing profiles remain opted in.
      joinMain:typeof input.joinMain==='boolean'?input.joinMain:existing.joinMain!==false,
      privateProfile:typeof input.privateProfile==='boolean'?input.privateProfile:existing.privateProfile===true,
      background,customTabTitle:String(rawTitle||'SuperMan').slice(0,45),
      customFavicon: imageData(input.customFavicon===undefined?existing.customFavicon:input.customFavicon,60000),
      customBackground:imageData(input.customBackground===undefined?existing.customBackground:input.customBackground,480000)
    };
  }
  const startTime=Date.now();
  async function handle(req,res,{pathname,url,session,checkOrigin,bodyJSON,isHttps,rateLimit}) {
    // Uses the proven v2 shared-password login before any profile or group API.
    if (!session) return response(res,401,{error:'Please log in again'});
    const method=req.method;
    if(method!=='GET' && (!checkOrigin(req) || !rateLimit(req,25))) return response(res,403,{error:'Request blocked by security check or rate limit'});
    let u=me(req);
    if(pathname==='/hub/api/v2/bootstrap' && method==='GET') {
      const headers={};
      if(!u){const p=await newProfile();u=p.u;headers['set-cookie']=`superman_profile=${p.token}; HttpOnly; SameSite=Lax; Path=/hub; Max-Age=31536000${isHttps(req)?'; Secure':''}`;}
      return response(res,200,{me:mine(u),role:session.role,rooms:roomsFor(u),friends:u.friendIds.filter(id=>db.users[id]).map(id=>publicUser(db.users[id])),requests:db.requests.filter(r=>r.to===u.id).map(r=>({id:r.id,from:publicUser(db.users[r.from]||{id:'',name:'Unknown',code:''})})),outgoing:db.requests.filter(r=>r.from===u.id).map(r=>({id:r.id,to:publicUser(db.users[r.to]||{id:'',name:'Unknown',code:''})})),startTime},headers);
    }
    if(!u)return response(res,409,{error:'Open SuperMan again to finish setting up your profile'});
    // Only return a profile visible to this visitor; names are public, but private
    // profiles never expose codes, even to the admin. Admins get a timeout ID only.
    const profileMatch = pathname.match(/^\/hub\/api\/v2\/users\/([0-9a-f-]{36})\/public$/i);
    if(profileMatch && method==='GET') {
      const target=db.users[profileMatch[1]];
      if(!target || !canDiscover(u,target))return response(res,404,{error:'Profile not found'});
      const privateMode=target.preferences?.privateProfile===true;
      const profile={id:target.id,name:target.name,private:privateMode};
      if(!privateMode)profile.friendCode=target.code;
      if(session.role==='admin')profile.timeoutCode=target.timeoutCode;
      return response(res,200,{profile});
    }
    if(!u.onboarded && pathname!=='/hub/api/v2/profile' && pathname!=='/hub/api/v2/recover')
      return response(res,409,{error:'Choose your name and Main Chat preference first'});
    if(pathname==='/hub/api/v2/profile' && method==='PUT') {
      try{
        const input=await bodyJSON(req,650000);
        if(typeof input.name!=='string'||fixed(input.name).length<2||fixed(input.name).length>28)return response(res,400,{error:'Name must be 2–28 characters'});
        u.name=fixed(input.name);u.preferences=prefs(input.preferences||{},u.preferences);u.onboarded=true;
        await save();return response(res,200,{me:mine(u)});
      }catch{return response(res,400,{error:'Invalid profile'});}
    }
    if(pathname==='/hub/api/v2/recovery' && method==='POST') {
      const recovery=rand(32);u.recoveryHash=hash(recovery);await save();return response(res,200,{recoveryCode:recovery});
    }
    if(pathname==='/hub/api/v2/recover' && method==='POST') {
      try{
        const input=await bodyJSON(req,1024);const code=String(input.recoveryCode||'');
        if(!/^[A-Za-z0-9_-]{40,60}$/.test(code))return response(res,400,{error:'Invalid recovery code'});
        const target=Object.values(db.users).find(x=>x.recoveryHash && x.recoveryHash===hash(code));
        if(!target)return response(res,403,{error:'Recovery code not recognized'});
        // One-time recovery; regenerate a new code on the recovered device.
        delete target.recoveryHash;await save();
        const token=rand(32);target.tokenHash=hash(token);await save();
        return response(res,200,{me:mine(target)}, {'set-cookie':`superman_profile=${token}; HttpOnly; SameSite=Lax; Path=/hub; Max-Age=31536000${isHttps(req)?'; Secure':''}`});
      }catch{return response(res,400,{error:'Invalid recovery request'});}
    }
    if(pathname==='/hub/api/v2/friends/request' && method==='POST') {
      try{
        const input=await bodyJSON(req,1024);const code=fixed(input.code).toUpperCase();const other=Object.values(db.users).find(x=>x.code===code);
        if(!other)return response(res,404,{error:'Friend code not found'});
        if(other.id===u.id)return response(res,400,{error:'You cannot add yourself'});
        if(friend(u,other.id))return response(res,409,{error:'Already friends'});
        if(db.requests.some(r=>(r.from===u.id&&r.to===other.id)||(r.from===other.id&&r.to===u.id)))return response(res,409,{error:'A friend request already exists'});
        if(db.requests.filter(r=>r.from===u.id).length>=20)return response(res,429,{error:'Too many pending requests'});
        db.requests.push({id:crypto.randomUUID(),from:u.id,to:other.id,createdAt:new Date().toISOString()});await save();return response(res,201,{ok:true});
      }catch{return response(res,400,{error:'Invalid code'});}
    }
    if(pathname==='/hub/api/v2/friends/respond' && method==='POST') {
      try{
        const input=await bodyJSON(req,1024);const idx=db.requests.findIndex(r=>r.id===input.requestId && r.to===u.id);
        if(idx<0)return response(res,404,{error:'Friend request not found'});
        const [request]=db.requests.splice(idx,1);const other=db.users[request.from];
        if(input.accept===true && other){u.friendIds||=[];other.friendIds||=[];if(!u.friendIds.includes(other.id))u.friendIds.push(other.id);if(!other.friendIds.includes(u.id))other.friendIds.push(u.id);}
        await save();return response(res,200,{ok:true});
      }catch{return response(res,400,{error:'Invalid response'});}
    }
    if(pathname==='/hub/api/v2/groups' && method==='POST') {
      try{
        const input=await bodyJSON(req,4096);const name=fixed(input.name);
        if(name.length<2||name.length>40)return response(res,400,{error:'Group name must be 2–40 characters'});
        if(!Array.isArray(input.memberIds))return response(res,400,{error:'Select friends to invite'});
        const ids=[...new Set(input.memberIds.filter(id=>typeof id==='string'))];
        if(ids.length<1 || ids.length>15 || ids.some(id=>!friend(u,id)))return response(res,403,{error:'Groups require 1–15 accepted friends'});
        if(Object.values(db.groups).filter(g=>g.members.includes(u.id)).length>=30)return response(res,429,{error:'Group limit reached'});
        const id='group_'+rand(12);db.groups[id]={id,name,ownerId:u.id,members:[u.id,...ids],createdAt:new Date().toISOString()};db.rooms[id]=[];await save();return response(res,201,{group:{id,name}});
      }catch{return response(res,400,{error:'Invalid group'});}
    }
    if(pathname==='/hub/api/v2/groups/add' && method==='POST'){
      try{const input=await bodyJSON(req,1024);const g=db.groups[input.groupId];if(!g)return response(res,404,{error:'Group not found'});if(g.ownerId!==u.id)return response(res,403,{error:'Only the group creator can add people'});if(!friend(u,input.memberId))return response(res,403,{error:'Add this person as a friend first'});if(g.members.length>=16)return response(res,400,{error:'Group is full'});if(!g.members.includes(input.memberId))g.members.push(input.memberId);await save();return response(res,200,{ok:true});}catch{return response(res,400,{error:'Invalid group update'});}
    }
    if(pathname==='/hub/api/v2/groups/leave' && method==='POST'){
      try{const input=await bodyJSON(req,1024);const g=db.groups[input.groupId];if(!g||!g.members.includes(u.id))return response(res,404,{error:'Group not found'});g.members=g.members.filter(id=>id!==u.id);if(g.ownerId===u.id)g.ownerId=g.members[0]||null;if(!g.members.length){delete db.groups[g.id];delete db.rooms[g.id];}await save();return response(res,200,{ok:true});}catch{return response(res,400,{error:'Invalid request'});}
    }
    // Moderation: only a server admin session can perform these actions.
    if(pathname==='/hub/api/v2/admin/stats' && method==='GET') {
      if(session.role!=='admin')return response(res,403,{error:'Admin only'});
      const active=Object.entries(db.mutes).filter(([,x])=>x.until>Date.now()).map(([id,x])=>({user:db.users[id]?publicUser(db.users[id]):null,until:x.until})).filter(x=>x.user);
      return response(res,200,{profiles:Object.keys(db.users).length,groups:Object.keys(db.groups).length,mainMessages:db.rooms.main?.length||0,activeMutes:active});
    }
    if(pathname==='/hub/api/v2/admin/mute' && method==='POST'){
      if(session.role!=='admin')return response(res,403,{error:'Admin only'});
      try{
        const input=await bodyJSON(req,1024);const code=fixed(input.timeoutCode).toUpperCase();const target=Object.values(db.users).find(x=>x.timeoutCode===code);
        if(!target)return response(res,404,{error:'Timeout code not found'});
        if(target.id===u.id)return response(res,400,{error:'You cannot mute yourself'});
        const minutes=Number(input.minutes);
        if(![0,10,60,1440].includes(minutes))return response(res,400,{error:'Choose 0, 10, 60, or 1440 minutes'});
        if(minutes===0)delete db.mutes[target.id];else db.mutes[target.id]={until:Date.now()+minutes*60000};
        await save();return response(res,200,{ok:true,name:target.name,minutes});
      }catch{return response(res,400,{error:'Invalid moderation request'});}
    }
    if(pathname==='/hub/api/v2/admin/clear-main' && method==='POST'){
      if(session.role!=='admin')return response(res,403,{error:'Admin only'});
      db.rooms.main=[];await save();return response(res,200,{ok:true});
    }
    if(pathname==='/hub/api/v2/messages/delete' && method==='POST'){
      if(session.role!=='admin')return response(res,403,{error:'Admin only'});
      try{
        const input=await bodyJSON(req,1024);const room=String(input.room||'');const id=String(input.id||'');
        // An admin who isn't a group member cannot moderate that private group.
        if(!canRead(u,room))return response(res,403,{error:'Not a member of this conversation'});
        const entries=db.rooms[room]||[];const idx=entries.findIndex(x=>x.id===id);
        if(idx<0)return response(res,404,{error:'Message not found'});
        entries.splice(idx,1);await save();return response(res,200,{ok:true});
      }catch{return response(res,400,{error:'Invalid deletion'});}
    }
    if(pathname==='/hub/api/v2/history' && method==='GET') {
      const room=url.searchParams.get('room')||'main';if(!canRead(u,room))return response(res,403,{error:'Not a member of this group'});
      const entries=db.rooms[room]||[];return response(res,200,{messages:entries.slice(-200)});
    }
    if(pathname==='/hub/api/v2/send' && method==='POST') {
      try{
        const input=await bodyJSON(req,4096);const room=String(input.room||'main');
        if(!canRead(u,room))return response(res,403,{error:'Not a member of this group'});
        if(typeof input.content!=='string')return response(res,400,{error:'Only text messages are allowed'});
        const content=input.content.trim();
        if(room==='main' && db.mutes[u.id]?.until>Date.now())return response(res,403,{error:'An admin has temporarily muted your Main Chat messages'});
        if(!content||content.length>1200)return response(res,400,{error:'Messages must be 1–1200 characters'});
        if(/data:image\b|!\[[^\]]*\]\([^)]*\)|\bhttps?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:[?#]|$)/i.test(content))return response(res,400,{error:'Picture sharing is disabled in SuperMan'});
        const item={id:crypto.randomUUID(),room,author:u.name,authorId:u.id,content,createdAt:new Date().toISOString()};
        (db.rooms[room] ||= []).push(item);db.rooms[room]=db.rooms[room].slice(-250);await save();return response(res,201,{message:item});
      }catch{return response(res,400,{error:'Invalid text message'});}
    }
    if(pathname==='/hub/api/v2/updates' && method==='GET') {
      const since=url.searchParams.get('since')||'';const cutoff=Date.parse(since);
      if(!Number.isFinite(cutoff) || cutoff<Date.now()-3600_000)return response(res,200,{messages:[],serverTime:new Date().toISOString()});
      const permitted=[...(joinedMain(u)?['main']:[]),...Object.values(db.groups).filter(g=>g.members.includes(u.id)).map(g=>g.id)];
      const all=permitted.flatMap(room=>(db.rooms[room]||[]).filter(m=>Date.parse(m.createdAt)>cutoff)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-50);
      return response(res,200,{messages:all,serverTime:new Date().toISOString()});
    }
    return response(res,404,{error:'Unknown community endpoint'});
  }
  return {handle};
}
