/** SUPERMAN Browser UI. Independently implemented — engine supplied by third party. */
const el = id => document.getElementById(id);
const tabs = [];
let activeId = null;
let nextId = 0;
let controller = null;
let engineReady = false;
let status = 'Starting engine';
const storage = {get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}},remove(k){try{localStorage.removeItem(k)}catch{}}};

function updateStatus(message){status=message; el('connection').textContent=message;el('status').textContent=message;}
function loadScript(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error('Could not load '+src));document.head.append(script);});}
function normalizeUrl(input){
  const text=String(input||'').trim();if(!text)return null;
  try {
    const isUrl=/^https?:\/\//i.test(text)||/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(text)||/^[^\s]+\.[^\s]+$/.test(text);
    const url=new URL(isUrl ? (/^https?:\/\//i.test(text)?text:'https://'+text) : 'https://www.google.com/search?q='+encodeURIComponent(text));
    if(!['https:','http:'].includes(url.protocol))return null;
    return url.href;
  }catch{return null;}
}
function getActive(){return tabs.find(x=>x.id===activeId)}
function showTabs(){
  const wrapper=el('tabs');wrapper.replaceChildren();
  for(const t of tabs){
    const button=document.createElement('button');button.type='button';button.className='browser-tab'+(t.id===activeId?' active':'');button.setAttribute('role','tab');button.setAttribute('aria-selected',String(t.id===activeId));
    const label=document.createElement('span');label.className='tab-title';label.textContent=t.title || 'New tab';
    const close=document.createElement('span');close.className='close-tab';close.textContent='×';close.title='Close tab';close.setAttribute('aria-label','Close tab');close.addEventListener('click',ev=>{ev.stopPropagation();removeTab(t.id)});
    button.append(label,close);button.addEventListener('click',()=>selectTab(t.id));wrapper.append(button);
  }
}
function createTab(){
  if(tabs.length>=8){updateStatus('Maximum of eight tabs. Close a tab first.');return}
  const frame=document.createElement('iframe');frame.className='web-frame';frame.title='SUPERMAN browsing window';frame.referrerPolicy='no-referrer';
  el('frames').append(frame);
  const t={id:++nextId,title:'New tab',url:null,element:frame,frame:null};
  if(controller){
    const plugins=[];
    const utils=window.$scramjetUtils;
    if(utils?.UrlWatcherPlugin)plugins.push(new utils.UrlWatcherPlugin(url=>{
      t.url=String(url);
      if(t.id===activeId)el('address').value=t.url;
    }));
    t.frame=controller.createFrame(frame,{plugins});
  }
  tabs.push(t);selectTab(t.id);return t;
}
function selectTab(id){activeId=id;for(const t of tabs)t.element.classList.toggle('active',t.id===id && Boolean(t.url));const active=getActive();el('start').hidden=Boolean(active?.url);el('address').value=active?.url||'';showTabs();}
function removeTab(id){const index=tabs.findIndex(t=>t.id===id);if(index<0)return;const [tab]=tabs.splice(index,1);tab.element.remove();if(!tabs.length)createTab();else if(activeId===id)selectTab(tabs[Math.min(index,tabs.length-1)].id);else showTabs();}
function navigate(input){const url=normalizeUrl(input);if(!url){updateStatus('Enter an address or search query.');return;}if(!engineReady){updateStatus('Browser engine still loading. Try again shortly.');return;}const tab=getActive();if(!tab)return;tab.url=url;tab.title=(()=>{try{return new URL(url).hostname}catch{return 'Web page'}})();tab.element.classList.add('active');el('start').hidden=true;el('address').value=url;showTabs();try{tab.frame.go(url);updateStatus('Connected securely')}catch(e){updateStatus('Could not open page: '+e.message)}}
function home(){const tab=getActive();if(!tab)return;tab.url=null;tab.title='New tab';tab.element.classList.remove('active');selectTab(tab.id)}
function panic(){location.replace('about:blank')}
async function initEngine(){
  if(!('serviceWorker' in navigator))throw new Error('Your browser does not support service workers. Use an up-to-date Chrome or Chromium browser.');
  if(!window.isSecureContext)throw new Error('Open the browser through HTTPS, or use localhost on this computer.');
  const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller){await new Promise((resolve,reject)=>{const id=setTimeout(()=>reject(new Error('Service worker did not take control. Refresh the page.')),12000);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(id);resolve()}, {once:true})})}
  const worker=navigator.serviceWorker.controller || registration.active;
  if(!worker)throw new Error('Missing service worker');
  for(const asset of ['/scram/scramjet.js','/controller/controller.api.js','/utils/scramjet-utils.js'])await loadScript(asset);
  const engine=window.$scramjetController;
  if(!engine?.Controller)throw new Error('Browser controller did not load');
  const {default:LibcurlClient}=await import('/libcurl/index.mjs');
  const wispAddress=(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/wisp/';
  controller=new engine.Controller({serviceworker:worker,transport:new LibcurlClient({wisp:wispAddress}),config:{scramjetPath:'/scram/scramjet.js',wasmPath:'/scram/scramjet.wasm',injectPath:'/controller/controller.inject.js'}});
  await controller.wait();
  // Existing tabs created while the engine was loading are now attached.
  for(const t of tabs){if(!t.frame){const plugins=[];const utils=window.$scramjetUtils;if(utils?.UrlWatcherPlugin)plugins.push(new utils.UrlWatcherPlugin(url=>{t.url=String(url);if(t.id===activeId)el('address').value=t.url;}));t.frame=controller.createFrame(t.element,{plugins});}}
  setInterval(()=>navigator.serviceWorker.controller?.postMessage('keepalive'),15000);
  engineReady=true;updateStatus('Browser engine ready');
}
function applyCloak(){document.title=storage.get('superman_tabtitle')||'SUPERMAN — Browser';const icon=storage.get('superman_tabicon')||'/favicon.svg';document.querySelector('link[rel=icon]').href=icon;el('tab-title').value=storage.get('superman_tabtitle')||'';}
function initUI(){
  createTab();
  el('add-tab').addEventListener('click',createTab);
  el('address-form').addEventListener('submit',event=>{event.preventDefault();navigate(el('address').value)});
  el('search-form').addEventListener('submit',event=>{event.preventDefault();navigate(el('search').value)});
  el('back').addEventListener('click',()=>getActive()?.frame?.back());
  el('forward').addEventListener('click',()=>getActive()?.frame?.forward());
  el('reload').addEventListener('click',()=>getActive()?.frame?.reload());
  el('home').addEventListener('click',home);
  el('panic').addEventListener('click',panic);
  el('settings-btn').addEventListener('click',()=>el('settings').showModal());
  for(const button of document.querySelectorAll('[data-site]'))button.addEventListener('click',()=>navigate(button.dataset.site));
  el('tab-title').addEventListener('change',event=>{storage.set('superman_tabtitle',event.target.value.slice(0,80));applyCloak()});
  el('tab-icon').addEventListener('change',event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>256*1024){updateStatus('Favicon must be PNG or JPG and smaller than 256 KB.');return}
    const reader=new FileReader();reader.onload=()=>{storage.set('superman_tabicon',String(reader.result));applyCloak()};reader.readAsDataURL(file);
  });
  el('reset-cloak').addEventListener('click',()=>{storage.remove('superman_tabtitle');storage.remove('superman_tabicon');applyCloak()});
  document.addEventListener('keydown',event=>{
    if(event.altKey&&event.shiftKey&&event.code==='KeyX'){event.preventDefault();panic()}
    else if(event.ctrlKey&&event.code==='KeyL'){event.preventDefault();el('address').focus();el('address').select()}
    else if(event.ctrlKey&&event.code==='KeyT'){event.preventDefault();createTab()}
  });
  applyCloak();
}
initUI();initEngine().catch(error=>{console.error('[SUPERMAN] Engine startup failed:',error);updateStatus('Browser engine error: '+error.message)});
