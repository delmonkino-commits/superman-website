/* Only swaps displayed branding; the upstream engine packages keep their required IDs. */
(() => {
 const swaps = [
   [/Invisi\s*Proxy(?:\s*LTS)?/gi, 'SuperMan'],
   [/Invisi\s*LTS/gi, 'SuperMan'],
   [/Holy\s*Unblocker(?:\s*LTS)?/gi, 'SuperMan'],
   [/Scramjet/gi, 'Hyperdrive'],
   [/Ultraviolet/gi, 'Ghost Layer']
 ];
 const rename = str => swaps.reduce((s,[pattern,next])=>s.replace(pattern,next),str);
 function work(root) {
   document.title='SUPERMAN';
   const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
   let node,count=0;
   while((node=walker.nextNode()) && count++<6000) {
     if(!node.parentElement || /^(script|style|textarea|code|pre)$/i.test(node.parentElement.tagName)) continue;
     if(node.nodeValue && /(Invisi|Holy Unblocker|Scramjet|Ultraviolet)/i.test(node.nodeValue)) node.nodeValue=rename(node.nodeValue);
   }
   if(!root.querySelectorAll)return;
   for(const image of root.querySelectorAll('img')){
     const hint=((image.alt||'')+' '+(image.getAttribute('src')||'')).toLowerCase();
     if(/scramjet/.test(hint))image.src='/_superman/hyperdrive.svg';
     else if(/ultraviolet/.test(hint))image.src='/_superman/ghost.svg';
     else if(/invisi|holy.?unblock|site.?logo/.test(hint))image.src='/_superman/logo.svg';
     if(image.alt) image.alt=rename(image.alt);
   }
   for(const icon of document.querySelectorAll('link[rel~="icon"]'))icon.href='/_superman/logo.svg';
 }
 let pending=false;
 const run=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;work(document.body);});};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{work(document.body);new MutationObserver(run).observe(document.body,{childList:true,subtree:true});});
 else {work(document.body);new MutationObserver(run).observe(document.body,{childList:true,subtree:true});}
})();
