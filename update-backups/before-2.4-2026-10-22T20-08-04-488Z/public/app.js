(()=>{
  'use strict';
  const $=q=>document.querySelector(q), $$=q=>[...document.querySelectorAll(q)];
  const state={me:null,role:'member',rooms:[],friends:[],requests:[],outgoing:[],room:null,messages:[],lastEventCursor:new Date().toISOString(),settings:null};
  let toastTimeout, syncTimer, activityTimer, syncing=false, notificationsEnabled=localStorage.getItem('sm2.notify')==='yes';
  let pendingFavicon='',pendingBackground='';
  const fmtDate=v=>{try{return new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch{return '';}};
  function toast(str){const e=$('#toast');e.textContent=String(str);e.hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>e.hidden=true,3600);}
  async function api(route,options={}){
    const r=await fetch('/hub/api/v2/'+route,{credentials:'same-origin',headers:{'content-type':'application/json'},...options});
    if(r.redirected&&new URL(r.url).pathname==='/hub/login'){location.assign('/hub/login');throw Error('Please log in again');}
    const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to complete request');return data;
  }
  async function send(route,data){return api(route,{method:'POST',body:JSON.stringify(data)});}
  const initial=p=>p?.name?.slice(0,1).toUpperCase()||'?';
  function setView(view){
    $('#welcome-view').hidden=view!=='home';$('#chat-view').hidden=view!=='chat';
    $('#go-home').classList.toggle('active',view==='home');$('#go-main').classList.toggle('active',view==='chat'&&state.room==='main');
    $('#sidebar').classList.remove('open');
  }
  function setTitle(){
    const info=state.rooms.find(r=>r.id===state.room);
    const main=state.room==='main';
    $('#top-icon').textContent=main?'#':'♧';$('#room-name').textContent=info?.name||'Chat';
    $('#room-subtitle').textContent=main?'One room for everyone':`${info?.members||1} group members`;
    $('#intro-mark').textContent=main?'#':'♧';$('#intro-title').textContent=info?.name||'Group';
    $('#intro-summary').textContent=main?'This is the one main chat for everyone. Text messages only.':'Only people in this group can read the conversation.';
    $('#message-input').placeholder=`Message ${info?.name||'chat'}`;
    $('#manage-group').hidden=main;
  }
  function renderRooms(){
    const list=$('#group-list');list.replaceChildren();const groups=state.rooms.filter(r=>r.kind==='group');
    if(!groups.length){const p=document.createElement('div');p.className='side-muted';p.textContent='No private groups yet';list.append(p);}
    for(const room of groups){const b=document.createElement('button');b.className='side-item'+(state.room===room.id&&!$('#chat-view').hidden?' active':'');const bubble=document.createElement('span');bubble.className='item-bubble';bubble.textContent='♧';const name=document.createElement('span');name.textContent=room.name;b.append(bubble,name);b.addEventListener('click',()=>openRoom(room.id));list.append(b);}
    $('#go-main').classList.toggle('active',state.room==='main'&&!$('#chat-view').hidden);
  }
  function renderFriends(){
    const list=$('#friend-list');list.replaceChildren();
    if(!state.friends.length){const p=document.createElement('div');p.className='side-muted';p.textContent='Add someone using their code';list.append(p);}
    for(const person of state.friends){const r=document.createElement('button');r.type='button';r.className='side-item friend-profile-link';const bubble=document.createElement('span');bubble.className='item-bubble';bubble.textContent=initial(person);const name=document.createElement('span');name.textContent=person.name;r.append(bubble,name);r.title='View '+person.name+' profile';r.addEventListener('click',()=>openPublicProfile(person.id));list.append(r);}
    $('#request-count').textContent=state.requests.length;
  }
  function drawMessages(scroll=true){
    const container=$('#messages');container.replaceChildren();
    if(!state.messages.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No messages yet. Be the first to say hello!';container.append(empty);}
    for(const msg of state.messages){
      const row=document.createElement('article');row.className='message';const av=document.createElement('span');av.className='mini-avatar';av.textContent=initial({name:msg.author});
      const box=document.createElement('div');box.className='message-main';const title=document.createElement('div');title.className='message-byline';
      const who=document.createElement(msg.authorId?'button':'strong');who.textContent=msg.author;
      if(msg.authorId){who.type='button';who.className='author-profile';who.title='View '+msg.author+' profile';who.setAttribute('aria-label','Open '+msg.author+' profile');who.addEventListener('click',()=>openPublicProfile(msg.authorId));}
      const time=document.createElement('time');time.dateTime=msg.createdAt;time.textContent=fmtDate(msg.createdAt);
      title.append(who,time);
      if(state.role==='admin'){
        const del=document.createElement('button');del.className='message-delete';del.type='button';del.textContent='Delete';del.title='Delete this message for everyone';
        del.addEventListener('click',async()=>{if(!confirm('Delete this message for everyone?'))return;
          try{await send('messages/delete',{room:msg.room||state.room,id:msg.id});state.messages=state.messages.filter(m=>m.id!==msg.id);drawMessages(false);toast('Message deleted');}
          catch(e){toast(e.message);}});title.append(del);
      }
      const content=document.createElement('div');content.className='message-content';content.textContent=msg.content;box.append(title,content);row.append(av,box);container.append(row);
    }
    if(scroll)$('#chat-scroll').scrollTop=$('#chat-scroll').scrollHeight;
  }
  async function openRoom(room){
    if(room==='main'&&!state.me?.preferences?.joinMain && state.me?.preferences?.joinMain===false){
      populateProfile();modal('profile-dialog');showSetting('account');return toast('Check Join Main Chat in your Account settings, then save');
    }
    if(!state.rooms.some(r=>r.id===room))return toast('That group is not available');
    state.room=room;setView('chat');setTitle();renderRooms();
    try{const v=await api('history?room='+encodeURIComponent(room));if(state.room===room){state.messages=v.messages;drawMessages();}}catch(e){toast(e.message);}
  }
  const CLOAK_ICONS={'SuperMan':'✦','Homework':'📘','School Portal':'🎓','Notes':'📝','Calendar':'📅','Dashboard':'📊','Custom':'✦'};
  const BACKGROUNDS={none:'',nebula:'/hub/assets/backgrounds/nebula.svg',aurora:'/hub/assets/backgrounds/aurora.svg',circuit:'/hub/assets/backgrounds/circuit.svg',sunset:'/hub/assets/backgrounds/sunset.svg'};
  function tabTitle(p){return p.cloak==='Custom'?(p.customTabTitle||'My Workspace'):(p.cloak||'SuperMan');}
  function setTabIcon(p){
    const favicon=$('#tab-icon');
    if(p.cloak==='Custom'&&p.customFavicon){favicon.href=p.customFavicon;favicon.type='image/png';return;}
    if((p.cloak||'SuperMan')==='SuperMan'){favicon.href='/hub/assets/superman-emblem.svg';favicon.type='image/svg+xml';return;}
    const glyph=CLOAK_ICONS[p.cloak]||'✦';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#252942"/><text x="32" y="44" font-size="38" text-anchor="middle">${glyph}</text></svg>`;
    favicon.href='data:image/svg+xml,'+encodeURIComponent(svg);favicon.type='image/svg+xml';
  }
  function applyAppearance(){
    const p=state.me?.preferences||{};
    document.documentElement.style.setProperty('--accent',p.accent||'#9878ff');
    document.title=tabTitle(p);setTabIcon(p);
    const image=p.background==='custom'?p.customBackground:BACKGROUNDS[p.background||'nebula'];
    const wall=image ? `url("${image}")` : 'none';
    document.documentElement.style.setProperty('--chat-wallpaper',wall);
  }
  function updateMainJoinUI(){
    const optedIn=state.me?.preferences?.joinMain!==false;
    $('#go-main').classList.toggle('not-joined',!optedIn);
    $('#go-main').querySelector('.tiny-pill').textContent=optedIn?'ONE ROOM':'NOT JOINED';
    $('#join-main').innerHTML=optedIn?'Open Main Chat <span>↗</span>':'Join Main Chat in settings <span>↗</span>';
  }
  function updateOwnProfile(){
    $('#my-name').textContent=state.me.name;$('#my-avatar').textContent=initial(state.me);$('#my-role').textContent=state.role==='admin'?'Admin · Online':'Member · Online';
    $('#admin-settings').hidden=state.role!=='admin';$('#admin-moderation-settings').hidden=state.role!=='admin';$('#admin-tools').hidden=state.role!=='admin';applyAppearance();updateMainJoinUI();
  }
  async function refreshBootstrap(){
    const data=await api('bootstrap');state.me=data.me;state.role=data.role;state.rooms=data.rooms;state.friends=data.friends;state.requests=data.requests;state.outgoing=data.outgoing;
    updateOwnProfile();renderRooms();renderFriends();if(state.room==='main'&&!state.rooms.some(r=>r.id==='main')){state.room=null;setView('home');}return data;
  }
  function requestRow(user,buttons=[]){
    const row=document.createElement('div');row.className='request-row';const who=document.createElement('button');who.type='button';who.className='author-profile';who.textContent=user.name;who.addEventListener('click',()=>openPublicProfile(user.id));row.append(who);
    if(buttons.length){const acts=document.createElement('span');acts.className='request-actions';for(const [text,onClick]of buttons){const b=document.createElement('button');b.textContent=text;b.addEventListener('click',onClick);acts.append(b);}row.append(acts);}return row;
  }
  function drawRequests(){
    const inbound=$('#incoming-requests'),outbound=$('#outgoing-requests');inbound.replaceChildren();outbound.replaceChildren();
    if(!state.requests.length){const t=document.createElement('div');t.className='empty';t.textContent='No incoming requests';inbound.append(t);}
    for(const r of state.requests){inbound.append(requestRow(r.from,[['Accept',async()=>{try{await send('friends/respond',{requestId:r.id,accept:true});await refreshBootstrap();drawRequests();toast('Friend added!');}catch(e){toast(e.message);}}],['Decline',async()=>{try{await send('friends/respond',{requestId:r.id,accept:false});await refreshBootstrap();drawRequests();}catch(e){toast(e.message);}}]]));}
    if(!state.outgoing.length){const t=document.createElement('div');t.className='empty';t.textContent='No pending requests';outbound.append(t);}
    for(const r of state.outgoing)outbound.append(requestRow(r.to));
  }
  function modal(id){document.getElementById(id).showModal();}
  let viewedProfile=null;
  async function openPublicProfile(userId){
    if(!userId)return toast('This older message has no linked profile');
    try{
      const result=await api('users/'+encodeURIComponent(userId)+'/public');
      const p=result.profile;
      viewedProfile=p;
      $('#public-profile-name').textContent=p.name;
      $('#public-profile-status').textContent=p.private?'Private profile · only the name is shared':'Public profile';
      $('#public-friend-wrap').hidden=p.private;
      $('#public-friend-code').value=p.private?'':(p.friendCode||'');
      // Never depend on hiding these elements for security; the server does not
      // send timeoutCode to member sessions, even if someone edits the HTML.
      const isAdmin=state.role==='admin' && !!p.timeoutCode;
      $('#public-admin-wrap').hidden=!isAdmin;
      $('#public-timeout-code').value=isAdmin?p.timeoutCode:'';
      $('#public-timeout-duration').value='10';
      modal('public-profile-dialog');
    }catch(e){toast(e.message);}
  }
  $('#public-timeout-apply').addEventListener('click',async()=>{
    if(state.role!=='admin'||!viewedProfile?.timeoutCode)return toast('Admin only');
    const minutes=Number($('#public-timeout-duration').value);
    if(!confirm(`${minutes?'Time out':'Remove timeout for'} ${viewedProfile.name}${minutes?' for '+minutes+' minutes':''}?`))return;
    try{
      const r=await send('admin/mute',{timeoutCode:viewedProfile.timeoutCode,minutes});
      $('#public-profile-dialog').close();toast(`${r.name}: ${minutes?'timeout applied':'timeout removed'}`);
    }catch(e){toast(e.message);}
  });
  function populateProfile(){
    const p=state.me.preferences||{};
    pendingFavicon=p.customFavicon||'';pendingBackground=p.customBackground||'';
    $('#profile-name').value=state.me.name;$('#my-code').value=state.me.code;
    $('#profile-join-main').checked=p.joinMain!==false;$('#profile-privacy').checked=p.privateProfile===true;
    $('#profile-accent').value=p.accent||'#9878ff';$('#cloak-select').value=p.cloak||'SuperMan';
    $('#custom-tab-name').value=p.customTabTitle||'My Workspace';$('#panic-hotkey').value=p.hotkey||'Alt+Shift+P';
    $('#favicon-upload').value='';$('#background-upload').value='';
    const background=p.background||'nebula';
    const radio=document.querySelector(`input[name="background-choice"][value="${background}"]`);
    if(radio)radio.checked=true;
    showSetting('account');updatePreview();
  }
  function showSetting(name){for(const b of $$('[data-settings]'))b.classList.toggle('active',b.dataset.settings===name);for(const section of $$('[data-section]'))section.hidden=section.dataset.section!==name;}
  function updatePreview(){
    const value=$('#cloak-select').value;
    $('#custom-cloak-fields').hidden=value!=='Custom';
    const title=value==='Custom'?($('#custom-tab-name').value.trim()||'My Workspace'):value;
    $('#cloak-preview-title').textContent=title;
    $('#cloak-preview-image').hidden=!(value==='Custom'&&pendingFavicon);
    $('#cloak-preview-icon').hidden=value==='Custom'&&!!pendingFavicon;
    if(value==='Custom'&&pendingFavicon)$('#cloak-preview-image').src=pendingFavicon;
    else $('#cloak-preview-icon').textContent=CLOAK_ICONS[value]||'✦';
    $('#custom-background-preview').style.backgroundImage=pendingBackground?`url("${pendingBackground}")`:'';
    $('#custom-background-preview').textContent=pendingBackground?'':'＋';
  }
  async function resizeImage(file,width,height,quality,maxLength,asPng=false){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPG or WebP image');
    if(file.size>10_000_000)throw Error('Please choose an image under 10 MB');
    const bmp=await createImageBitmap(file);
    try{
      const scale=Math.min(1,width/bmp.width,height/bmp.height);
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image editing is unsupported by your browser');
      ctx.drawImage(bmp,0,0,canvas.width,canvas.height);
      // Canvas output is raster data; uploaded SVG, HTML and unsafe URL schemes are forbidden.
      const format=asPng?'image/png':'image/jpeg';
      let output=canvas.toDataURL(format,quality);
      for(let i=0;i<4&&output.length>maxLength&&!asPng;i++){quality=Math.max(.35,quality-.16);output=canvas.toDataURL(format,quality);}
      if(output.length>maxLength)throw Error('Picture is too large. Choose a smaller image.');
      return output;
    }finally{bmp.close();}
  }
  function renderGroupChoices(){const list=$('#group-friends');list.replaceChildren();if(!state.friends.length){const p=document.createElement('p');p.className='help';p.textContent='Add a friend first using their code, then come back to create a group.';list.append(p);}for(const user of state.friends){const lab=document.createElement('label');lab.className='friend-check';const cb=document.createElement('input');cb.type='checkbox';cb.name='member';cb.value=user.id;lab.append(cb,document.createTextNode(user.name));list.append(lab);}}
  function openGroups(){renderGroupChoices();$('#group-name').value='';modal('group-dialog');}
  function openFriends(){drawRequests();modal('friends-dialog');}
  function notify(message){
    if(!notificationsEnabled||!document.hidden||!('Notification' in window)||Notification.permission!=='granted')return;
    try{const n=new Notification(message.room==='main'?'SuperMan · Main Chat':'SuperMan · Private group',{body:`${message.author}: ${message.content.slice(0,130)}`,icon:'/hub/assets/superman-emblem.svg',tag:message.room});n.onclick=()=>{window.focus();openRoom(message.room);n.close();};}catch{}
  }
  async function syncMessages(){
    if(syncing)return;syncing=true;
    try{
      const r=await api('updates?since='+encodeURIComponent(state.lastEventCursor));state.lastEventCursor=r.serverTime;
      const events=r.messages.filter(x=>x.authorId!==state.me.id);
      for(const message of events)notify(message);
      if(state.room && !$('#chat-view').hidden){
        const h=await api('history?room='+encodeURIComponent(state.room));const last=a=>a.length?a[a.length-1].id:null;
        if(h.messages.length!==state.messages.length||last(h.messages)!==last(state.messages)){state.messages=h.messages;drawMessages(!document.hidden);}
      }
    }catch{}finally{syncing=false;}
  }
  function panic(){try{window.close();}catch{}setTimeout(()=>location.replace('about:blank'),80);}
  function handleHotkey(e){
    const combo=state.me?.preferences?.hotkey||'Alt+Shift+P';
    const [a,b,key]=combo.split('+');
    const expectedAlt=a==='Alt'||b==='Alt',expectedCtrl=a==='Ctrl'||b==='Ctrl',expectedShift=a==='Shift'||b==='Shift';
    if(e.altKey===expectedAlt&&e.ctrlKey===expectedCtrl&&e.shiftKey===expectedShift&&e.key.toUpperCase()===key.toUpperCase()){e.preventDefault();panic();}
  }
  async function init(){
    try{await refreshBootstrap();}catch(e){toast('Could not load SuperMan: '+e.message);return;}
    state.lastEventCursor=new Date().toISOString();setView('home');$('#top-icon').textContent='⌂';
    if(state.me.onboarded!==true){$('#first-join-main').checked=false;modal('welcome-name-dialog');}
    syncTimer=setInterval(async()=>{try{await refreshBootstrap();}catch{}},11000);
    activityTimer=setInterval(syncMessages,4000);
  }
  $('#go-home').addEventListener('click',()=>{state.room=null;$('#room-name').textContent='Home';$('#room-subtitle').textContent='A simpler place to talk';$('#top-icon').textContent='⌂';$('#manage-group').hidden=true;setView('home');renderRooms();});
  for(const b of ['#go-main','#join-main'])$(b).addEventListener('click',()=>openRoom('main'));
  $('#welcome-group').addEventListener('click',openGroups);$('#new-group').addEventListener('click',openGroups);
  $('#mobile-nav').addEventListener('click',()=>$('#sidebar').classList.add('open'));$('#close-nav').addEventListener('click',()=>$('#sidebar').classList.remove('open'));
  $('#profile-button').addEventListener('click',()=>{populateProfile();modal('profile-dialog');});
  $('#add-friend').addEventListener('click',openFriends);$('#friend-requests').addEventListener('click',openFriends);
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
  $('#compose-form').addEventListener('submit',async e=>{e.preventDefault();const input=$('#message-input'),content=input.value.trim();if(!content)return;const room=state.room;input.value='';try{const r=await send('send',{room,content});if(room===state.room){state.messages.push(r.message);drawMessages();}}catch(err){input.value=content;toast(err.message);}});
  $('#friend-form').addEventListener('submit',async e=>{e.preventDefault();try{await send('friends/request',{code:$('#friend-code').value.trim()});$('#friend-code').value='';await refreshBootstrap();drawRequests();toast('Friend request sent');}catch(err){toast(err.message);}});
  $('#group-form').addEventListener('submit',async e=>{e.preventDefault();const ids=$$('#group-friends input:checked').map(x=>x.value);if(!ids.length)return toast('Select at least one friend');try{const r=await send('groups',{name:$('#group-name').value.trim(),memberIds:ids});$('#group-dialog').close();await refreshBootstrap();await openRoom(r.group.id);toast('Your group is ready');}catch(err){toast(err.message);}});
  $('#profile-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const background=document.querySelector('input[name="background-choice"]:checked')?.value||'nebula';
    if(background==='custom'&&!pendingBackground)return toast('Upload a background first, or choose a preset');
    const preferences={accent:$('#profile-accent').value,cloak:$('#cloak-select').value,hotkey:$('#panic-hotkey').value,
      joinMain:$('#profile-join-main').checked,privateProfile:$('#profile-privacy').checked,background,customBackground:pendingBackground,
      customTabTitle:$('#custom-tab-name').value.trim(),customFavicon:pendingFavicon};
    try{
      const data=await api('profile',{method:'PUT',body:JSON.stringify({name:$('#profile-name').value.trim(),preferences})});
      state.me=data.me;updateOwnProfile();$('#profile-dialog').close();await refreshBootstrap();
      toast('Your profile was saved');
    }catch(err){toast(err.message);}
  });
  $('#welcome-name-form').addEventListener('submit',async e=>{
    e.preventDefault();
    try{
      const result=await api('profile',{method:'PUT',body:JSON.stringify({name:$('#first-name').value.trim(),preferences:{...state.me.preferences,joinMain:$('#first-join-main').checked}})});
      state.me=result.me;$('#welcome-name-dialog').close();await refreshBootstrap();
      if(state.me.preferences.joinMain)await openRoom('main');
    }catch(err){toast(err.message);}
  });
  $$('[data-settings]').forEach(b=>b.addEventListener('click',()=>showSetting(b.dataset.settings)));
  $('#cloak-select').addEventListener('change',updatePreview);
  $('#custom-tab-name').addEventListener('input',updatePreview);
  $('#favicon-upload').addEventListener('change',async e=>{
    try{if(e.target.files[0]){pendingFavicon=await resizeImage(e.target.files[0],64,64,.85,60000,true);$('#cloak-select').value='Custom';updatePreview();toast('Favicon ready — save your settings');}}catch(err){toast(err.message);}
  });
  $('#remove-favicon').addEventListener('click',()=>{pendingFavicon='';$('#favicon-upload').value='';updatePreview();});
  $('#background-upload').addEventListener('change',async e=>{
    try{if(e.target.files[0]){pendingBackground=await resizeImage(e.target.files[0],1300,900,.76,480000,false);document.querySelector('input[name="background-choice"][value="custom"]').checked=true;updatePreview();toast('Background ready — save your settings');}}catch(err){toast(err.message);}
  });
  $('#remove-background').addEventListener('click',()=>{pendingBackground='';$('#background-upload').value='';document.querySelector('input[name="background-choice"][value="none"]').checked=true;updatePreview();});
  $('#panic-now').addEventListener('click',panic);$('#test-panic').addEventListener('click',panic);document.addEventListener('keydown',handleHotkey);
  $('#copy-code').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(state.me.code);toast('Friend code copied');}catch{toast('Select your code and copy it manually');}});
  $('#enable-notifications').addEventListener('click',async()=>{
    if(!('Notification' in window)){return toast('This browser does not support notifications');}
    if(!isSecureContext)return toast('Use the HTTPS Cloudflare link or localhost to enable notifications');
    try{const permission=await Notification.requestPermission();notificationsEnabled=permission==='granted';localStorage.setItem('sm2.notify',notificationsEnabled?'yes':'no');$('#notification-state').textContent=notificationsEnabled?'Notifications enabled while SuperMan is open.':'Permission was not granted.';toast(notificationsEnabled?'Notifications enabled':'Browser notifications not enabled');}catch(e){toast('Could not enable notifications');}
  });
  $('#create-recovery').addEventListener('click',async()=>{if(!confirm('Generating a recovery key will replace your previous recovery key. Keep it secret. Continue?'))return;try{const r=await send('recovery',{});$('#recovery-box').hidden=false;$('#recovery-value').value=r.recoveryCode;toast('Copy this secret key somewhere safe');}catch(e){toast(e.message);}});
  $('#copy-recovery').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#recovery-value').value);toast('Recovery key copied');}catch{toast('Select and copy the key manually');}});
  $('#restore-profile').addEventListener('click',async()=>{const key=prompt('Enter your PRIVATE profile recovery key from your other device:');if(!key)return;try{const r=await send('recover',{recoveryCode:key.trim()});state.me=r.me;$('#profile-dialog').close();await refreshBootstrap();toast('Your profile has been restored. The recovery key is now invalid.');}catch(e){toast(e.message);}});
  $('#sign-out').addEventListener('click',async()=>{try{await fetch('/hub/logout',{method:'POST',credentials:'same-origin'});}finally{location.assign('/hub/login');}});
  async function openModeration(){
    if(state.role!=='admin')return toast('Admin only');
    modal('moderation-dialog');await refreshModeration();
  }
  async function refreshModeration(){
    try{
      const stats=await api('admin/stats');
      $('#admin-stats').textContent=`${stats.profiles} profiles · ${stats.groups} groups · ${stats.mainMessages} Main Chat messages · ${stats.activeMutes.length} active timeouts`;
      const list=$('#moderation-messages');list.replaceChildren();
      if(!state.me?.preferences?.joinMain){list.textContent='Opt into Main Chat in your profile settings to review its messages.';return;}
      const results=await api('history?room=main');
      for(const msg of results.messages.slice(-45).reverse()){
        const row=document.createElement('div');row.className='request-row';const main=document.createElement('div');
        const username=document.createElement('div');username.className='moderation-message-user';username.textContent=msg.author;
        const content=document.createElement('div');content.className='moderation-message-text';content.textContent=msg.content;
        main.append(username,content);const del=document.createElement('button');del.type='button';del.textContent='Delete';
        del.addEventListener('click',async()=>{if(!confirm('Delete this message for everyone?'))return;try{await send('messages/delete',{room:'main',id:msg.id});await refreshModeration();toast('Message deleted');}catch(e){toast(e.message);}});
        row.append(main,del);list.append(row);
      }
      if(!results.messages.length)list.textContent='Main Chat has no messages yet.';
    }catch(e){toast(e.message);}
  }
  $('#admin-tools').addEventListener('click',openModeration);
  $('#admin-moderation-settings').addEventListener('click',()=>{$('#profile-dialog').close();openModeration();});
  $('#mute-form').addEventListener('submit',async e=>{e.preventDefault();try{const r=await send('admin/mute',{timeoutCode:$('#mute-code').value.trim(),minutes:Number($('#mute-duration').value)});await refreshModeration();toast(`${r.name}: ${r.minutes===0?'unmuted':'timeout applied'}`);}catch(err){toast(err.message);}});
  $('#clear-main').addEventListener('click',async()=>{if(!confirm('PERMANENTLY delete ALL stored Main Chat messages? This cannot be undone.'))return;try{await send('admin/clear-main',{});await refreshModeration();if(state.room==='main'){state.messages=[];drawMessages();}toast('Main Chat cleared');}catch(e){toast(e.message);}});
  $('#admin-settings').addEventListener('click',async()=>{try{const r=await fetch('/hub/api/settings');const settings=await r.json();state.settings=settings;$('#admin-name').value=settings.name;$('#admin-tagline').value=settings.tagline;$('#admin-accent').value=settings.accent;$('#profile-dialog').close();modal('admin-dialog');}catch(e){toast('Could not load server settings');}});
  $('#admin-form').addEventListener('submit',async e=>{e.preventDefault();if(state.role!=='admin')return;const body={...state.settings,name:$('#admin-name').value,tagline:$('#admin-tagline').value,accent:$('#admin-accent').value};try{const res=await fetch('/hub/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||'Not allowed');state.settings=data;$('#admin-dialog').close();toast('Server appearance updated');}catch(e){toast(e.message);}});
  $('#manage-group').addEventListener('click',()=>{
    const room=state.rooms.find(r=>r.id===state.room);if(!room||room.kind!=='group')return;
    const list=$('#member-invites');list.replaceChildren();
    if(room.ownerId===state.me.id){
      for(const person of state.friends){const row=document.createElement('div');row.className='request-row';const name=document.createElement('span');name.textContent=person.name;const b=document.createElement('button');b.textContent='Invite';b.addEventListener('click',async()=>{try{await send('groups/add',{groupId:room.id,memberId:person.id});b.textContent='Added';b.disabled=true;await refreshBootstrap();toast('Friend added to group');}catch(e){toast(e.message);}});row.append(name,b);list.append(row);}
    }else{const p=document.createElement('p');p.className='help';p.textContent='Only the group creator can invite additional friends.';list.append(p);}
    modal('members-dialog');
  });
  $('#leave-group').addEventListener('click',()=>{$('#members-dialog').close();modal('leave-dialog');});
  $('#confirm-leave').addEventListener('click',async()=>{try{await send('groups/leave',{groupId:state.room});$('#leave-dialog').close();await refreshBootstrap();await openRoom('main');toast('You left the group');}catch(e){toast(e.message);}});
  // Separate-origin browser launcher. The PIN never appears in frontend source.
  $('#open-proxy').addEventListener('click',()=>{
    $('#proxy-access-code').value='';
    $('#proxy-status').textContent='';
    $('#proxy-open-link').style.display='none';
    modal('proxy-dialog');
  });
  $('#proxy-unlock-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const code=$('#proxy-access-code').value;
    // Must be opened synchronously from the user's submit gesture to avoid popup blocking.
    const tab=window.open('about:blank','_blank');
    $('#proxy-status').textContent='Checking code…';
    try{
      const r=await fetch('/hub/api/proxy/unlock',{
        method:'POST',headers:{'content-type':'application/json'},
        credentials:'same-origin',cache:'no-store',body:JSON.stringify({code})
      });
      const data=await r.json();
      if(!r.ok)throw Error(data.error||'Could not unlock browser');
      $('#proxy-access-code').value='';
      if(tab){tab.opener=null;tab.location.replace(data.url);$('#proxy-dialog').close();}
      else {
        const link=$('#proxy-open-link');link.href=data.url;link.style.display='block';
        $('#proxy-status').textContent='Your browser blocked the new tab. Click the Open SUPERMAN Browser link below.';
      }
    }catch(err){if(tab)tab.close();$('#proxy-status').textContent=err.message;}
  });
  init();
})();
