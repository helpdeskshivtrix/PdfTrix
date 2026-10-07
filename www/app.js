(()=>{'use strict';
/* ========== helpers ========== */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=n=>String(n||'document').replace(/\.[^.]+$/,'');
const fmt=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB';
const hexRgb=h=>{const m=/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h||'');return m?[1,2,3].map(i=>parseInt(m[i],16)/255):[0,0,0]};
const hexA=(h,a)=>{const[r,g,b]=hexRgb(h);return`rgba(${r*255|0},${g*255|0},${b*255|0},${a})`};
const PL=window.PDFLib||{};
const{PDFDocument,StandardFonts,rgb,degrees,PDFName,PDFDict,PDFArray,LineCapStyle}=PL;
function toast(m,t=''){const e=document.createElement('div');e.className='toast '+t;e.textContent=m;$('#toasts').append(e);setTimeout(()=>e.remove(),4800)}
let bn=0;
async function busy(label,fn){bn++;$('#busyL').textContent=label;$('#busy').hidden=false;try{await new Promise(r=>setTimeout(r));return await fn()}finally{if(--bn<=0){bn=0;$('#busy').hidden=true}}}
const safe=fn=>async(...a)=>{try{return await fn(...a)}catch(e){if(e&&e.cancelled)return;console.error(e);toast(e&&e.message?e.message:String(e),'bad')}};
async function nativeSave(name,b){
  const C=window.Capacitor,P=C&&C.Plugins;if(!(C&&C.isNativePlatform&&C.isNativePlatform()&&P&&P.Filesystem))return false;
  const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(b)});
  const w=await P.Filesystem.writeFile({path:name,data,directory:'CACHE',recursive:true});
  try{if(P.Share)await P.Share.share({title:name,url:w.uri,dialogTitle:'Save or share '+name});else toast('Saved '+name,'ok')}catch(e){if(!/cancel/i.test(String(e&&e.message||e)))throw e}
  return true;
}
function save(name,data,mime='application/octet-stream'){const b=data instanceof Blob?data:new Blob([data],{type:mime});
  nativeSave(name,b).then(done=>{if(done)return;const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('Saved '+name,'ok')}).catch(e=>toast('Save failed: '+(e&&e.message||e),'bad'))}
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const pickFiles=(accept,multiple)=>new Promise(res=>{const i=document.createElement('input');i.type='file';i.accept=accept;i.multiple=!!multiple;i.onchange=()=>res([...i.files]);i.click()});
const parseRange=(str,n)=>{const out=new Set();String(str||'').split(/[,;\s]+/).filter(Boolean).forEach(p=>{const m=/^(\d*)-(\d*)$/.exec(p);if(m){const a=m[1]?+m[1]:1,b=m[2]?+m[2]:n;for(let i=Math.max(1,a);i<=Math.min(n,b);i++)out.add(i)}else if(/^\d+$/.test(p)&&+p>=1&&+p<=n)out.add(+p)});return[...out].sort((a,b)=>a-b)};
const WORKER=new URL('./libs/pdfjs/pdf.worker.min.js',document.baseURI).href;
if(window.pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER;

/* ========== state ========== */
const WS=['dash','edit','secure','forms'];
const S={bytes:null,pdf:null,n:0,page:1,name:'',zv:1,z:1,fit:'width',ann:{},sel:null,tool:'select',hist:[],img:null,audit:[],locked:false,thSel:new Set(),tab:'dash',dims:{w:600,h:800},dpr:1,q:[],res:[],sigW:150};
const cur=()=>S.ann[S.page]||(S.ann[S.page]=[]);
const pend=()=>Object.values(S.ann).reduce((a,l)=>a+l.length,0);
const targets=()=>S.thSel.size?[...S.thSel].sort((a,b)=>a-b):[S.page];
const need=()=>{if(!S.pdf)throw new Error('Open a PDF first')};
function sync(){
  const h=!!S.pdf;
  $('#empty').hidden=h;$('#pageWrap').hidden=!h;
  $('#pgNum').value=S.page;$('#pgTot').textContent='/ '+(S.n||1);
  $('#dName').textContent=h?S.name:'None';$('#dPages').textContent=h?S.n:'—';$('#dSize').textContent=h?fmt(S.bytes.length):'—';$('#dPend').textContent=pend();
  $('#pendTxt').textContent=pend()?`${pend()} pending. Apply to write into the PDF.`:'No pending marks';
  $('#undoBtn').disabled=!h||(!S.hist.length&&!cur().length);
  $('#zoomTxt').textContent=h&&S.zv?Math.round(S.zv*100)+'%':'';
  $$('.th').forEach(t=>{t.classList.toggle('cur',+t.dataset.p===S.page);t.classList.toggle('sel',S.thSel.has(+t.dataset.p))});
}

/* ========== tabs ========== */
function tab(t){
  S.tab=t;
  $$('[data-tab]').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===t));
  $$('.panel').forEach(p=>p.classList.toggle('on',p.id==='tab-'+t&&t!=='dash'));
  const w=WS.includes(t),min=t==='dash';$('#ws').classList.toggle('on',w);$('#ws').classList.toggle('min',min);
  document.body.classList.toggle('mini',min);
  $$('.tp').forEach(p=>p.hidden=!p.dataset.for.split(' ').includes(t));
  if(w){setTool(t==='secure'?'redact':(min||coarse)?'hand':'select');requestAnimationFrame(()=>render())}
  sync();
}
$$('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$$('[data-go]').forEach(b=>b.onclick=()=>tab(b.dataset.go));
const coarse=matchMedia('(pointer:coarse)').matches;

/* ========== document load ========== */
async function openPdfjs(bytes){
  try{return await pdfjsLib.getDocument({data:bytes.slice()}).promise}
  catch(e){if(e&&e.name==='PasswordException'){const pw=prompt('This PDF is password protected. Enter the password (read-only):');if(!pw)throw Object.assign(new Error('Cancelled'),{cancelled:true});S.locked=true;return pdfjsLib.getDocument({data:bytes.slice(),password:pw}).promise}throw e}
}
async function setDoc(bytes,{page,fresh}={}){
  if(!window.pdfjsLib||!PDFDocument)throw new Error('PDF engines did not load. Check your connection and reload.');
  if(fresh)S.locked=false;
  const pdf=await openPdfjs(bytes);
  try{S.pdf&&S.pdf.destroy()}catch{}
  S.bytes=bytes;S.pdf=pdf;S.n=pdf.numPages;S.page=clamp(page||S.page||1,1,S.n);S.ann={};S.sel=null;S.thSel=new Set();
  if(fresh)S.hist=[];
  thumbs();sync();await render();
}
async function imgBytes(file,max=3000){const bm=await createImageBitmap(file);const s=Math.min(1,max/Math.max(bm.width,bm.height));const c=document.createElement('canvas');c.width=Math.round(bm.width*s);c.height=Math.round(bm.height*s);const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(bm,0,0,c.width,c.height);const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));return{bytes:new Uint8Array(await b.arrayBuffer()),w:c.width,h:c.height}}
async function canvasInfo(c){const b=await new Promise(r=>c.toBlob(r,'image/png'));const bytes=new Uint8Array(await b.arrayBuffer());const el=new Image();await new Promise(r=>{el.onload=r;el.src=c.toDataURL('image/png')});return{el,bytes,w:c.width,h:c.height}}
async function pngInfo(file,max=1800){const bm=await createImageBitmap(file);const s=Math.min(1,max/Math.max(bm.width,bm.height));const c=document.createElement('canvas');c.width=Math.round(bm.width*s);c.height=Math.round(bm.height*s);c.getContext('2d').drawImage(bm,0,0,c.width,c.height);return canvasInfo(c)}
async function imgsToPdf(files){const d=await PDFDocument.create();for(const f of files){const i=await imgBytes(f);const im=await d.embedJpg(i.bytes);const s=Math.min(1,595/i.w,842/i.h);const w=i.w*s,h=i.h*s;d.addPage([w,h]).drawImage(im,{x:0,y:0,width:w,height:h})}d.setProducer('PdfTrix');return d.save()}
async function textPdf(text,title='Document',size=12){
  const d=await PDFDocument.create();d.setTitle(title);d.setProducer('PdfTrix');const f=await d.embedFont(StandardFonts.Helvetica);
  text=String(text).replace(/\r/g,'').replace(/\t/g,'    ').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g,'?');
  const W=595.28,H=841.89,m=56,lh=size*1.45,maxW=W-2*m;let pg=d.addPage([W,H]),y=H-m-size;
  const nl=()=>{y-=lh;if(y<m){pg=d.addPage([W,H]);y=H-m-size}};
  for(const para of text.split('\n')){
    if(!para.trim()){nl();continue}
    let line='';
    for(const w of para.split(/(\s+)/)){const t=line+w;if(f.widthOfTextAtSize(t,size)>maxW&&line.trim()){pg.drawText(line.trimEnd(),{x:m,y,size,font:f});nl();line=w.trimStart()}else line=t}
    if(line.trim())pg.drawText(line.trimEnd(),{x:m,y,size,font:f});nl();
  }
  return d.save();
}
async function toPdf(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase(),t=file.type||'';
  if(t==='application/pdf'||ext==='pdf')return new Uint8Array(await file.arrayBuffer());
  if(t.startsWith('image/')||['png','jpg','jpeg','webp','gif','bmp'].includes(ext))return imgsToPdf([file]);
  if(['txt','md','csv','log','json','html','htm'].includes(ext)||t.startsWith('text/')){let tx=await file.text();if(/^html?$/.test(ext)){const d=new DOMParser().parseFromString(tx,'text/html');d.querySelectorAll('script,style').forEach(n=>n.remove());tx=(d.body.textContent||'').trim()}return textPdf(tx,base(file.name))}
  if(ext==='docx'||t==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){
    if(!window.mammoth)throw new Error('Word reader did not load.');
    const r=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
    if(!r.value.trim())throw new Error('No text found in '+file.name);
    return textPdf(r.value,base(file.name));
  }
  if(ext==='doc'||t==='application/msword')throw new Error('Old .doc files are not supported. Open it in Word and Save As .docx, then share again.');
  if(t.startsWith('audio/')||t.startsWith('video/')||['mp3','m4a','aac','wav','ogg','oga','opus','amr','flac','weba','webm','mp4','3gp'].includes(ext))return textPdf(await transcribe(file),base(file.name)+' (voice transcript)');
  throw new Error('Unsupported file type: '+file.name);
}
/* voice -> text (Whisper runs on-device in the browser; model downloads once, then is cached) */
let asr=null;
async function transcribe(file){
  const L=m=>{$('#busyL').textContent=m};
  L('Decoding audio…');
  let audio;
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
    const buf=await ctx.decodeAudioData(await file.arrayBuffer());ctx.close&&ctx.close();
    audio=buf.getChannelData(0);
    if(buf.numberOfChannels>1){const b=buf.getChannelData(1),m=new Float32Array(audio.length);for(let i=0;i<m.length;i++)m[i]=(audio[i]+b[i])/2;audio=m}
  }catch(e){throw new Error('This device could not decode '+file.name+'. Try sharing it as MP3/WAV.')}
  if(!asr){
    L('Loading speech model (first time only, needs internet)…');
    let tf;try{tf=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6')}catch(e){throw new Error('Speech engine could not be loaded. Connect to the internet once, then try again.')}
    asr=await tf.pipeline('automatic-speech-recognition','Xenova/whisper-tiny',{progress_callback:p=>{if(p&&p.status==='progress')L('Downloading speech model '+Math.round(p.progress||0)+'%')}});
  }
  L('Transcribing…');
  const r=await asr(audio,{chunk_length_s:30,stride_length_s:5,task:'transcribe'});
  const tx=(r&&r.text||'').trim();
  if(!tx)throw new Error('No speech was detected in '+file.name);
  return tx;
}
async function openFile(f){
  await busy('Opening '+f.name+'…',async()=>{const b=await toPdf(f);S.name=/\.pdf$/i.test(f.name)?f.name:base(f.name)+'.pdf';await setDoc(b,{fresh:true,page:1})});
  if(!WS.includes(S.tab))tab('edit');
}
const pickOpen=safe(async()=>{const f=await pickFiles('.pdf,application/pdf,image/*,audio/*,.docx,.txt,.md,.html,.htm,.csv,.mp3,.m4a,.wav,.ogg,.opus,.aac');if(f[0])await openFile(f[0])});
['openBtn','dashOpen','emptyOpen'].forEach(id=>$('#'+id).onclick=pickOpen);
$('#dashNew').onclick=safe(async()=>{const d=await PDFDocument.create();d.addPage([595.28,841.89]);S.name='Untitled.pdf';await setDoc(await d.save(),{fresh:true,page:1});tab('edit')});

/* ========== rendering ========== */
let rtask=null,rtok=0;
async function render(){
  if(!S.pdf||!WS.includes(S.tab))return;
  const my=++rtok,pg=await S.pdf.getPage(S.page),b=pg.getViewport({scale:1});S.dims={w:b.width,h:b.height};
  const host=$('#view'),aw=Math.max(200,host.clientWidth-24),ah=Math.max(200,host.clientHeight-24);
  let z=S.fit==='width'?aw/b.width:S.fit==='page'?Math.min(aw/b.width,ah/b.height):S.z;z=clamp(z,.15,6);S.zv=z;
  const dpr=Math.min(devicePixelRatio||1,2.5);S.dpr=dpr;
  const vp=pg.getViewport({scale:z*dpr}),c=$('#pg'),g=c.getContext('2d');
  c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
  const cw=vp.width/dpr+'px',ch=vp.height/dpr+'px';c.style.width=cw;c.style.height=ch;
  const ov=$('#ov');ov.width=c.width;ov.height=c.height;ov.style.width=cw;ov.style.height=ch;
  try{rtask&&rtask.cancel()}catch{}
  rtask=pg.render({canvasContext:g,viewport:vp});
  try{await rtask.promise}catch{return}
  if(my!==rtok)return;
  drawOv();sync();
}
let rzT;addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(()=>{if(S.fit!=='n')render()},150)});
async function go(p,keep){if(!S.pdf)return;p=clamp(Math.round(p)||1,1,S.n);S.page=p;S.sel=null;if(!keep)S.thSel=new Set();await render();$('#view').scrollTop=0}
$('#prev').onclick=()=>go(S.page-1);$('#next').onclick=()=>go(S.page+1);
$('#pgNum').onchange=e=>go(+e.target.value);
/* zoom: fixed steps only (25% to 400%), no free pinch or wheel zoom */
const ZSTEPS=Array.from({length:16},(_,i)=>(i+1)*25);
$('#zoomSel').innerHTML='<option value="width">Fit width</option><option value="page">Fit page</option>'+ZSTEPS.map(s=>`<option value="${s/100}">${s}%</option>`).join('');
const setZoom=(m,v)=>{S.fit=m;if(v)S.z=v;$('#zoomSel').value=m==='n'?String(Math.round(S.z*100)/100):m;render()};
function stepZoom(d){const c=Math.round(S.zv*100),t=d>0?ZSTEPS.find(s=>s>c):[...ZSTEPS].reverse().find(s=>s<c);if(t)setZoom('n',t/100)}
$('#zoomIn').onclick=()=>stepZoom(1);$('#zoomOut').onclick=()=>stepZoom(-1);
$('#zoomSel').onchange=e=>{const v=e.target.value;v==='width'||v==='page'?setZoom(v):setZoom('n',+v)};
let wheelT=0;
document.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const n=Date.now();if(n-wheelT<180||!S.pdf||!e.target.closest||!e.target.closest('#view'))return;wheelT=n;stepZoom(e.deltaY<0?1:-1)},{passive:false});
document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey))return;const k=e.key;
  if(k==='+'||k==='='){e.preventDefault();if(S.pdf)stepZoom(1)}else if(k==='-'||k==='_'){e.preventDefault();if(S.pdf)stepZoom(-1)}else if(k==='0'){e.preventDefault();if(S.pdf)setZoom('width')}});

/* ========== full screen (viewer + editor) ========== */
let fsFallback=false,wasFs=false;
const isFull=()=>!!(document.fullscreenElement||document.webkitFullscreenElement)||fsFallback;
function applyFs(){
  const on=isFull();document.body.classList.toggle('fs',on);
  if(on&&!wasFs)$('#ws').classList.add('notools');
  if(!on&&wasFs)$('#ws').classList.remove('notools');
  wasFs=on;const b=$('#fsBtn');b.textContent=on?'🗗':'⛶';b.title=on?'Exit full screen (Esc)':'Full screen';
  requestAnimationFrame(()=>render());
}
async function toggleFull(){
  if(isFull()){fsFallback=false;try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.webkitFullscreenElement)document.webkitExitFullscreen()}catch{}applyFs();return}
  const el=document.documentElement,req=el.requestFullscreen||el.webkitRequestFullscreen,native=!!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform());
  if(req&&!native){try{await req.call(el);applyFs();return}catch{}}
  fsFallback=true;applyFs(); /* Android app / unsupported browsers: hide all bars inside the page */
}
$('#fsBtn').onclick=toggleFull;
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)fsFallback=false;applyFs()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&fsFallback){fsFallback=false;applyFs()}});
$('#fsTools').onclick=()=>{$('#ws').classList.toggle('notools');requestAnimationFrame(()=>render())};

/* ========== minimal dashboard buttons ========== */
$('#barOpen').onclick=pickOpen;
$('#toolsGo').onclick=()=>tab('edit');
function sheetFor(id){const ws=$('#ws'),box=$('#'+id),open=ws.classList.contains('sheet')&&box.open;
  if(open){ws.classList.remove('sheet')}else{ws.classList.add('sheet');$$('#ocrBox,#ttsBox').forEach(d=>d.open=d===box)}
  requestAnimationFrame(()=>render())}
$('#ocrT').onclick=()=>sheetFor('ocrBox');$('#ttsT').onclick=()=>sheetFor('ttsBox');

/* ========== read aloud (TTS) ========== */
const TTS=(()=>{
  const syn=window.speechSynthesis;let tok=0;
  const ui=on=>{$('#ttsPlay').disabled=on;$('#ttsStop').disabled=!on;$('#ttsPause').disabled=!on;$('#ttsPause').textContent='⏸ Pause'};
  function voices(){if(!syn)return;$('#ttsVoice').innerHTML='<option value="">Default voice</option>'+syn.getVoices().map(v=>`<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
  if(syn){voices();syn.onvoiceschanged=voices}
  const chunks=t=>{const out=[];String(t).replace(/\s+/g,' ').trim().split(/(?<=[.!?\u0964\u0965\u061F])\s+/).forEach(s=>{while(s.length>220){let i=s.lastIndexOf(' ',220);if(i<60)i=220;out.push(s.slice(0,i));s=s.slice(i).trim()}if(s)out.push(s)});return out};
  async function text(){
    const m=$('#ttsSrc').value;
    if(m==='ocr'){const t=$('#ocrOut').value.trim();if(!t)throw new Error('OCR text is empty. Run OCR first.');return t}
    need();let t='';
    for(const p of m==='all'?Array.from({length:S.n},(_,i)=>i+1):[S.page])t+=(await pageText(S.pdf,p))+'\n';
    if(!t.trim())throw new Error('No readable text here (scanned page?). Run OCR, then choose "OCR text".');
    return t;
  }
  function stop(){tok++;if(syn)syn.cancel();ui(false)}
  async function play(){
    if(!syn)throw new Error('Read aloud is not supported on this device.');
    stop();const my=tok,list=chunks(await text());if(my!==tok||!list.length)return;
    const vo=syn.getVoices().find(v=>v.voiceURI===$('#ttsVoice').value),rate=+$('#ttsRate').value||1;let i=0;ui(true);
    const next=()=>{if(my!==tok)return;if(i>=list.length){ui(false);return}
      const u=new SpeechSynthesisUtterance(list[i++]);if(vo){u.voice=vo;u.lang=vo.lang}u.rate=rate;u.onend=next;
      u.onerror=e=>{if(my!==tok||(e&&/canceled|interrupted/.test(e.error||'')))return;ui(false);toast('Read aloud failed: '+(e&&e.error||'unknown'),'bad')};
      syn.speak(u)};
    next();
  }
  function pause(){if(!syn)return;if(syn.paused){syn.resume();$('#ttsPause').textContent='⏸ Pause'}else if(syn.speaking){syn.pause();$('#ttsPause').textContent='▶ Resume'}}
  $('#ttsPlay').onclick=safe(play);$('#ttsPause').onclick=pause;$('#ttsStop').onclick=stop;
  addEventListener('pagehide',()=>syn&&syn.cancel());ui(false);
  return{stop};
})();

/* ========== thumbnails + page management ========== */
let tho;
function thumbs(){
  const box=$('#thumbs');box.innerHTML='';tho&&tho.disconnect();
  tho=new IntersectionObserver(es=>es.forEach(async e=>{if(!e.isIntersecting)return;tho.unobserve(e.target);const p=+e.target.dataset.p,cv=$('canvas',e.target);try{const pg=await S.pdf.getPage(p),v0=pg.getViewport({scale:1}),vp=pg.getViewport({scale:180/v0.width});cv.width=vp.width;cv.height=vp.height;await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise}catch{}}),{root:box,rootMargin:'200px'});
  let dp=null;
  for(let p=1;p<=S.n;p++){
    const d=document.createElement('div');d.className='th';d.dataset.p=p;d.draggable=true;d.innerHTML=`<canvas width="120" height="160" aria-label="Page ${p}"></canvas><span>${p}</span>`;
    d.onclick=e=>{if(e.ctrlKey||e.metaKey){S.thSel.has(p)?S.thSel.delete(p):S.thSel.add(p)}else if(e.shiftKey&&S.thSel.size){const a=Math.min(...S.thSel,p),b=Math.max(...S.thSel,p);S.thSel=new Set();for(let i=a;i<=b;i++)S.thSel.add(i)}else S.thSel=new Set([p]);go(p,true)};
    d.ondragstart=e=>{dp=p;if(!S.thSel.has(p)){S.thSel=new Set([p]);sync()}e.dataTransfer.setData('text/plain',String(p))};
    d.ondragover=e=>{if(dp!=null)e.preventDefault()};
    d.ondrop=safe(async e=>{e.preventDefault();if(dp==null)return;dp=null;await reorderTo(p)});
    d.ondragend=()=>dp=null;
    box.append(d);tho.observe(d);
  }
  sync();
}
async function edit(label,fn,{page,skipFlush}={}){
  need();if(S.locked)throw new Error('Encrypted PDFs are read-only here.');
  if(!skipFlush)await flush();
  return busy(label+'…',async()=>{
    const doc=await PDFDocument.load(S.bytes,{ignoreEncryption:true,updateMetadata:false});
    const r=await fn(doc);const out=r&&r.save?r:doc;const bytes=await out.save({useObjectStreams:true});
    S.hist.push({bytes:S.bytes,page:S.page});if(S.hist.length>8)S.hist.shift();
    await setDoc(bytes,{page:page??S.page});
  });
}
async function rebuild(doc,order){const out=await PDFDocument.create();const cp=await out.copyPages(doc,order.map(i=>i-1));cp.forEach(p=>out.addPage(p));try{const t=doc.getTitle();t&&out.setTitle(t);const a=doc.getAuthor();a&&out.setAuthor(a)}catch{}return out}
async function reorderTo(target){
  const mv=[...S.thSel].sort((a,b)=>a-b);if(!mv.length||mv.includes(target))return;
  const rest=[];for(let i=1;i<=S.n;i++)if(!mv.includes(i))rest.push(i);
  let at=rest.indexOf(target);if(mv[0]<target)at+=1;
  const order=[...rest.slice(0,at),...mv,...rest.slice(at)];
  await edit('Reordering',d=>rebuild(d,order),{page:order.indexOf(mv[0])+1});
}
const moveSel=safe(async dir=>{
  need();await flush();const mv=targets(),order=[];for(let i=1;i<=S.n;i++)order.push(i);
  if(dir<0){if(mv[0]===1)return;for(const p of mv){const i=order.indexOf(p);[order[i-1],order[i]]=[order[i],order[i-1]]}}
  else{if(mv[mv.length-1]===S.n)return;for(const p of[...mv].reverse()){const i=order.indexOf(p);[order[i+1],order[i]]=[order[i],order[i+1]]}}
  await edit('Moving',d=>rebuild(d,order),{page:order.indexOf(mv[0])+1,skipFlush:true});
  S.thSel=new Set(mv.map(p=>p+dir));sync();
});
$('#pUp').onclick=()=>moveSel(-1);$('#pDown').onclick=()=>moveSel(1);
const rotate=safe(async d=>{need();await flush();const t=targets();await edit('Rotating',doc=>{t.forEach(p=>{const g=doc.getPage(p-1);g.setRotation(degrees((g.getRotation().angle+d+360)%360))})},{skipFlush:true})});
$('#rotL').onclick=()=>rotate(-90);$('#rotR').onclick=()=>rotate(90);
$('#pDel').onclick=safe(async()=>{need();await flush();const t=targets();if(t.length>=S.n){toast('A document needs at least one page','warn');return}const o=[];for(let i=1;i<=S.n;i++)if(!t.includes(i))o.push(i);await edit('Deleting',d=>rebuild(d,o),{page:Math.min(t[0],o.length),skipFlush:true})});
$('#pBlank').onclick=safe(async()=>{need();await edit('Adding page',d=>{const{width,height}=d.getPage(S.page-1).getSize();d.insertPage(S.page,[width,height])},{page:S.page+1})});
$('#pMerge').onclick=safe(async()=>{need();const fs=await pickFiles('.pdf,application/pdf,image/*,.txt,.md,.html',true);if(!fs.length)return;await flush();await edit('Merging',async doc=>{for(const f of fs){const src=await PDFDocument.load(await toPdf(f),{ignoreEncryption:true});const cp=await doc.copyPages(src,src.getPageIndices());cp.forEach(p=>doc.addPage(p))}},{skipFlush:true})});
$('#pSplit').onclick=safe(async()=>{
  need();await flush();const n=Math.max(1,+$('#splitN').value||1);
  await busy('Splitting…',async()=>{const doc=await PDFDocument.load(S.bytes,{ignoreEncryption:true}),zip=new JSZip();let k=1;for(let i=1;i<=S.n;i+=n){const o=[];for(let j=i;j<Math.min(S.n+1,i+n);j++)o.push(j);zip.file(`${base(S.name)}-part${String(k++).padStart(2,'0')}.pdf`,await(await rebuild(doc,o)).save())}save(base(S.name)+'-split.zip',await zip.generateAsync({type:'blob'}))});
});
$('#pExtract').onclick=safe(async()=>{need();await flush();const pages=parseRange($('#exRange').value||targets().join(','),S.n);if(!pages.length)throw new Error('No valid pages in that range');const doc=await PDFDocument.load(S.bytes,{ignoreEncryption:true});save(base(S.name)+'-pages.pdf',await(await rebuild(doc,pages)).save(),'application/pdf')});
$('#saveBtn').onclick=safe(async()=>{need();await flush();save(base(S.name)+'.pdf',S.bytes,'application/pdf')});
$('#undoBtn').onclick=safe(undo);
async function undo(){const l=cur();if(l.length){l.pop();S.sel=null;drawOv();sync();return}const h=S.hist.pop();if(!h)return;await setDoc(h.bytes,{page:h.page});toast('Undone')}

/* ========== markup overlay ========== */
const FONT='Helvetica,Arial,"Noto Sans",sans-serif';
function setTool(t){
  S.tool=t;$$('[data-t]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===t));
  const ov=$('#ov');ov.classList.toggle('hand',t==='hand');ov.style.cursor=t==='select'?'default':'crosshair';
  if(t==='image'&&!S.img)pickImg();
}
$$('[data-t]').forEach(b=>b.onclick=()=>setTool(b.dataset.t));
function pickImg(){pickFiles('image/*').then(safe(async f=>{if(f[0]){S.img=await pngInfo(f[0]);toast('Image ready. Click the page to place it.','ok');setTool('image')}}))}
function ptr(e){const r=$('#ov').getBoundingClientRect();return{x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)}}
function bbox(it){
  if(it.t==='pen'){let a=1,b=1,c=0,d=0;it.pts.forEach(([x,y])=>{a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y)});return{x:a-.006,y:b-.006,w:c-a+.012,h:d-b+.012}}
  if(it.t==='text')return{x:it.x,y:it.y,w:it._w||.1,h:it._h||.04};
  return{x:it.x,y:it.y,w:it.w,h:it.h};
}
function drawItem(g,it,W,H){
  const z=S.zv;
  switch(it.t){
    case'text':{g.font=`${it.size*z}px ${FONT}`;g.textBaseline='top';g.fillStyle=it.color;const ls=String(it.text).split('\n'),lh=it.size*z*1.2;let mw=0;ls.forEach((l,i)=>{g.fillText(l,it.x*W,it.y*H+i*lh);mw=Math.max(mw,g.measureText(l).width)});it._w=mw/W;it._h=ls.length*lh/H;break}
    case'image':if(it.el)g.drawImage(it.el,it.x*W,it.y*H,it.w*W,it.h*H);break;
    case'hl':g.fillStyle=hexA(it.color,.4);g.fillRect(it.x*W,it.y*H,it.w*W,it.h*H);break;
    case'rect':g.strokeStyle=it.color;g.lineWidth=Math.max(1,it.width*z);g.strokeRect(it.x*W,it.y*H,it.w*W,it.h*H);break;
    case'redact':g.fillStyle='rgba(0,0,0,.9)';g.fillRect(it.x*W,it.y*H,it.w*W,it.h*H);g.strokeStyle='#ff7a8a';g.lineWidth=1.5;g.setLineDash([5,4]);g.strokeRect(it.x*W,it.y*H,it.w*W,it.h*H);g.setLineDash([]);break;
    case'pen':g.strokeStyle=it.color;g.lineWidth=Math.max(1,it.width*z);g.lineCap='round';g.lineJoin='round';g.beginPath();it.pts.forEach(([x,y],i)=>i?g.lineTo(x*W,y*H):g.moveTo(x*W,y*H));if(it.pts.length===1)g.lineTo(it.pts[0][0]*W+.1,it.pts[0][1]*H);g.stroke();break;
    case'ftext':case'fcheck':case'fdate':g.fillStyle='rgba(245,165,36,.18)';g.fillRect(it.x*W,it.y*H,it.w*W,it.h*H);g.strokeStyle='#f5a524';g.lineWidth=1.5;g.setLineDash([4,3]);g.strokeRect(it.x*W,it.y*H,it.w*W,it.h*H);g.setLineDash([]);g.fillStyle='#c9b8ff';g.font='11px '+FONT;g.textBaseline='top';g.fillText(it.t==='ftext'?'Text field':it.t==='fdate'?'Date field':'✓',it.x*W+4,it.y*H+3);break;
  }
}
let drag=null;
function drawOv(){
  const c=$('#ov');if(!S.pdf||!c.width)return;const d=S.dpr||1,g=c.getContext('2d');g.setTransform(d,0,0,d,0,0);
  const W=c.width/d,H=c.height/d;g.clearRect(0,0,W,H);
  cur().forEach(it=>drawItem(g,it,W,H));
  if(drag&&drag.mode==='draw'){const a=drag.start,b=drag.cur;drawItem(g,{t:drag.tool,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y),color:$('#anColor').value,width:2},W,H)}
  if(drag&&drag.mode==='pen')drawItem(g,{t:'pen',pts:drag.pts,color:$('#anColor').value,width:Math.max(1,+$('#anSize').value/6)},W,H);
  const s=S.sel;if(s){const b=bbox(s);g.strokeStyle='#2fd6ff';g.lineWidth=1.5;g.setLineDash([6,4]);g.strokeRect(b.x*W-3,b.y*H-3,b.w*W+6,b.h*H+6);g.setLineDash([]);if(s.w!=null&&s.t!=='pen'){g.fillStyle='#2fd6ff';g.fillRect((b.x+b.w)*W-6,(b.y+b.h)*H-6,12,12)}}
}
function hit(p){const l=cur();for(let i=l.length-1;i>=0;i--){const b=bbox(l[i]);if(p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h)return l[i]}return null}
function syncSel(){const s=S.sel;if(!s)return;if(s.t==='text'){$('#anText').value=s.text;$('#anSize').value=s.size}if(s.color)$('#anColor').value=s.color}
function add(it){cur().push(it);S.sel=it;drawOv();sync()}
(()=>{
  const ov=$('#ov');
  ov.addEventListener('pointerdown',e=>{
    if(!S.pdf||S.tool==='hand')return;const p=ptr(e),t=S.tool;
    if(t==='select'){
      const s=S.sel;if(s&&s.w!=null&&s.t!=='pen'){const b=bbox(s),W=ov.clientWidth,H=ov.clientHeight;if(Math.abs((p.x-b.x-b.w)*W)<14&&Math.abs((p.y-b.y-b.h)*H)<14){drag={mode:'resize',it:s,start:p,o:{w:s.w,h:s.h}};ov.setPointerCapture(e.pointerId);return}}
      const it=hit(p);S.sel=it;if(it){drag={mode:'move',it,start:p,o:{x:it.x,y:it.y,pts:it.pts&&it.pts.map(q=>q.slice())}};syncSel()}
      drawOv();ov.setPointerCapture(e.pointerId);return;
    }
    if(t==='text'){add({t:'text',x:p.x,y:p.y,text:$('#anText').value||'Text',size:+$('#anSize').value||18,color:$('#anColor').value});setTool('select');return}
    if(t==='image'){
      if(!S.img){pickImg();return}
      const sg=S.img.sig,w=sg?S.sigW/S.dims.w:.25;
      add({t:'image',x:p.x,y:p.y,w,h:w*S.dims.w*(S.img.h/S.img.w)/S.dims.h,el:S.img.el,bytes:S.img.bytes,sig:sg||null});
      if(sg){const a=S.audit.find(x=>x.id===sg.id);if(a)a.page=S.page;S.img=null}
      setTool('select');return;
    }
    if(['hl','rect','redact','ftext','fcheck','fdate'].includes(t)){drag={mode:'draw',tool:t,start:p,cur:p};ov.setPointerCapture(e.pointerId);return}
    if(t==='pen'){drag={mode:'pen',pts:[[p.x,p.y]]};ov.setPointerCapture(e.pointerId)}
  });
  ov.addEventListener('pointermove',e=>{
    if(!drag)return;const p=ptr(e);
    if(drag.mode==='move'){const it=drag.it,dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(it.t==='pen')it.pts=drag.o.pts.map(([x,y])=>[x+dx,y+dy]);else{it.x=clamp(drag.o.x+dx,0,1);it.y=clamp(drag.o.y+dy,0,1)}}
    else if(drag.mode==='resize'){drag.it.w=Math.max(.01,drag.o.w+p.x-drag.start.x);drag.it.h=Math.max(.01,drag.o.h+p.y-drag.start.y)}
    else if(drag.mode==='draw')drag.cur=p;
    else if(drag.mode==='pen')drag.pts.push([p.x,p.y]);
    drawOv();
  });
  const up=()=>{
    if(!drag)return;const d=drag;drag=null;
    if(d.mode==='draw'){const a=d.start,b=d.cur,w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
      if(w>.004&&h>.004){const c=$('#anColor').value;add({t:d.tool,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w,h,color:d.tool==='hl'?(c==='#3b82ff'?'#ffd60a':c):c,width:2,name:$('#fdName').value,def:$('#fdDate').value})}}
    else if(d.mode==='pen')add({t:'pen',pts:d.pts,color:$('#anColor').value,width:Math.max(1,+$('#anSize').value/6)});
    drawOv();sync();
  };
  ov.addEventListener('pointerup',up);ov.addEventListener('pointercancel',up);
  $('#anText').addEventListener('input',()=>{const s=S.sel;if(s&&s.t==='text'){s.text=$('#anText').value;drawOv()}});
  $('#anSize').addEventListener('input',()=>{const s=S.sel;if(s){if(s.t==='text')s.size=+$('#anSize').value;else if(s.width)s.width=Math.max(1,+$('#anSize').value/6);drawOv()}});
  $('#anColor').addEventListener('input',()=>{const s=S.sel;if(s&&s.color){s.color=$('#anColor').value;drawOv()}});
  $('#view').addEventListener('wheel',e=>{if(e.ctrlKey&&S.pdf){e.preventDefault();setZoom('n',clamp(S.zv*(e.deltaY<0?1.1:.9),.2,5))}},{passive:false});
})();
$('#anDel').onclick=()=>deleteSel();
function deleteSel(){const s=S.sel;if(!s)return;const l=cur();l.splice(l.indexOf(s),1);S.sel=null;drawOv();sync()}
$('#anClear').onclick=()=>{S.ann[S.page]=[];S.sel=null;drawOv();sync()};
$('#discard').onclick=()=>{S.ann={};S.sel=null;drawOv();sync();toast('Pending changes discarded')};
$('#apply').onclick=safe(()=>{if(!pend()){toast('Nothing to apply','warn');return}return applyAnn()});
async function flush(){if(pend())await applyAnn()}

/* ---- apply markup to PDF ---- */
function geom(page){
  const a=((page.getRotation().angle%360)+360)%360,cb=page.getCropBox?page.getCropBox():page.getMediaBox(),w=cb.width,h=cb.height,dw=a%180?h:w,dh=a%180?w:h;
  const map=(nx,ny)=>{const dx=nx*dw,dy=ny*dh;let x,y;if(a===0){x=dx;y=h-dy}else if(a===90){x=dy;y=dx}else if(a===180){x=w-dx;y=dy}else{x=w-dy;y=h-dx}return{x:x+cb.x,y:y+cb.y}};
  return{a,w,h,dw,dh,cb,map};
}
async function putText(doc,page,font,text,{dx,dy,size,color='#000000'}){
  const G=geom(page);let ok=true;try{font.encodeText(String(text).replace(/\n/g,' '))}catch{ok=false}
  const ls=String(text).split('\n');
  if(ok){ls.forEach((l,i)=>{const m=G.map(dx/G.dw,(dy+i*size*1.2)/G.dh);page.drawText(l,{x:m.x,y:m.y,size,font,color:rgb(...hexRgb(color)),rotate:degrees(G.a)})})}
  else{
    const k=3,c=document.createElement('canvas'),g=c.getContext('2d'),f=`${size*k}px ${FONT}`;g.font=f;
    const lh=size*k*1.3,w=Math.ceil(Math.max(...ls.map(l=>g.measureText(l).width),4))+8;
    c.width=w;c.height=Math.ceil(lh*ls.length+size*k*.3);g.font=f;g.fillStyle=color;
    const rtl=/[\u0590-\u08FF]/.test(text);g.direction=rtl?'rtl':'ltr';g.textAlign=rtl?'right':'left';
    ls.forEach((l,i)=>g.fillText(l,rtl?w-4:4,size*k+i*lh));
    const im=await doc.embedPng((await canvasInfo(c)).bytes),wp=c.width/k,hp=c.height/k,m=G.map(dx/G.dw,(dy+hp-size)/G.dh);
    page.drawImage(im,{x:m.x,y:m.y,width:wp,height:hp,rotate:degrees(G.a)});
  }
}
async function applyAnn(){
  const pages=Object.keys(S.ann).map(Number).filter(p=>S.ann[p].length);if(!pages.length)return;
  const snap={};pages.forEach(p=>snap[p]=S.ann[p].slice());const had=S.page;
  const normal=pages.filter(p=>snap[p].some(i=>i.t!=='redact')),reds=pages.filter(p=>snap[p].some(i=>i.t==='redact'));
  const sigs=pages.flatMap(p=>snap[p].filter(i=>i.sig));
  if(normal.length)await edit('Applying markup',async doc=>{
    const font=await doc.embedFont(StandardFonts.Helvetica);let form=null;const used=new Set();
    for(const p of normal){
      const pg=doc.getPage(p-1),G=geom(pg);
      for(const it of snap[p]){
        if(it.t==='redact')continue;
        if(it.t==='text')await putText(doc,pg,font,it.text,{dx:it.x*G.dw,dy:it.y*G.dh+it.size*.86,size:it.size,color:it.color});
        else if(it.t==='image'){
          const im=await doc.embedPng(it.bytes),bl=G.map(it.x,it.y+it.h);
          pg.drawImage(im,{x:bl.x,y:bl.y,width:it.w*G.dw,height:it.h*G.dh,rotate:degrees(G.a)});
          if(it.sig){const s=it.sig;await putText(doc,pg,font,`Signed by ${s.name} - ${new Date(s.time).toLocaleString()}${s.reason?' - '+s.reason:''}`,{dx:it.x*G.dw,dy:(it.y+it.h)*G.dh+8,size:6.5,color:'#555555'})}
        }
        else if(it.t==='hl'){const bl=G.map(it.x,it.y+it.h);pg.drawRectangle({x:bl.x,y:bl.y,width:it.w*G.dw,height:it.h*G.dh,color:rgb(...hexRgb(it.color)),opacity:.38,rotate:degrees(G.a)})}
        else if(it.t==='rect'){const bl=G.map(it.x,it.y+it.h);pg.drawRectangle({x:bl.x,y:bl.y,width:it.w*G.dw,height:it.h*G.dh,borderColor:rgb(...hexRgb(it.color)),borderWidth:it.width||2,rotate:degrees(G.a)})}
        else if(it.t==='pen'){const pts=it.pts.map(([x,y])=>G.map(x,y)),col=rgb(...hexRgb(it.color));for(let i=1;i<pts.length;i++)pg.drawLine({start:pts[i-1],end:pts[i],thickness:it.width||2,color:col,lineCap:LineCapStyle.Round});if(pts.length===1)pg.drawCircle({x:pts[0].x,y:pts[0].y,size:(it.width||2)/2,color:col})}
        else if(it.t==='ftext'||it.t==='fcheck'||it.t==='fdate'){
          if(G.a){toast('Form fields are skipped on rotated pages. Rotate the page upright first.','warn');continue}
          form=form||doc.getForm();if(!used.size)form.getFields().forEach(f=>used.add(f.getName()));
          const nm=(it.name||'').trim().replace(/[^\w-]/g,'_')||(it.t==='fcheck'?'check':it.t==='fdate'?'date':'text');let k=nm,i=1;while(used.has(k))k=nm+'_'+(++i);used.add(k);
          const bl=G.map(it.x,it.y+it.h),o={x:bl.x,y:bl.y,width:it.w*G.dw,height:it.h*G.dh,borderWidth:1,borderColor:rgb(.3,.35,.95)};
          if(it.t==='fcheck')form.createCheckBox(k).addToPage(pg,o);
          else{const tf=form.createTextField(k);if(it.t==='fdate'){tf.setMaxLength(10);if(it.def)tf.setText(it.def)}tf.addToPage(pg,o)}
        }
      }
    }
  },{skipFlush:true,page:had});
  if(reds.length){
    const dpi=+$('#rdDpi').value||200,imgs={};
    await busy('Rendering redactions…',async()=>{
      for(const p of reds){
        const pg=await S.pdf.getPage(p),vp=pg.getViewport({scale:dpi/72}),c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
        const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:g,viewport:vp}).promise;
        g.fillStyle='#000';snap[p].filter(i=>i.t==='redact').forEach(r=>g.fillRect(r.x*c.width-1,r.y*c.height-1,r.w*c.width+2,r.h*c.height+2));
        const bl=await new Promise(r=>c.toBlob(r,'image/jpeg',.92));imgs[p]=new Uint8Array(await bl.arrayBuffer());
      }
    });
    await edit('Removing redacted content',async doc=>{
      const out=await PDFDocument.create();
      for(let i=1;i<=doc.getPageCount();i++){
        if(imgs[i]){const G=geom(doc.getPage(i-1)),im=await out.embedJpg(imgs[i]);out.addPage([G.dw,G.dh]).drawImage(im,{x:0,y:0,width:G.dw,height:G.dh})}
        else{const[cp]=await out.copyPages(doc,[i-1]);out.addPage(cp)}
      }
      return out;
    },{skipFlush:true,page:had});
    toast('Redaction applied. Marked pages are now flat images.','ok');
  }
  if(sigs.length){const h=await sha(S.bytes);sigs.forEach(i=>{const a=S.audit.find(x=>x.id===i.sig.id);if(a)a.sha256_after_signing=h});logAudit()}
  if(!reds.length)toast('Markup applied','ok');
}
async function findBoxes(term){
  const t=term.toLowerCase(),out={};let n=0;
  for(let p=1;p<=S.n;p++){
    const pg=await S.pdf.getPage(p),vp=pg.getViewport({scale:1}),tc=await pg.getTextContent();
    for(const it of tc.items){
      if(!it.str)continue;const lo=it.str.toLowerCase();let i=-1,from=0;
      while((i=lo.indexOf(t,from))>=0){
        from=i+t.length;const L=it.str.length,tr=it.transform,w=it.width||0,h=it.height||Math.abs(tr[3])||10;
        const x0=tr[4]+w*i/L,x1=tr[4]+w*(i+t.length)/L,r=vp.convertToViewportRectangle([x0-1,tr[5]-h*.22,x1+1,tr[5]+h*.9]);
        const xa=Math.min(r[0],r[2]),xb=Math.max(r[0],r[2]),ya=Math.min(r[1],r[3]),yb=Math.max(r[1],r[3]);
        (out[p]=out[p]||[]).push({t:'redact',x:xa/vp.width,y:ya/vp.height,w:(xb-xa)/vp.width,h:(yb-ya)/vp.height});n++;
      }
    }
  }
  return{out,n};
}
$('#rdFind').onclick=safe(async()=>{
  need();const term=$('#rdTerm').value.trim();if(!term)throw new Error('Type the text to find');
  const{out,n}=await busy('Finding text…',()=>findBoxes(term));
  Object.entries(out).forEach(([p,l])=>(S.ann[p]=S.ann[p]||[]).push(...l));drawOv();sync();
  toast(n?`${n} box${n>1?'es':''} added. Review them, then Apply.`:'No matches. Scanned pages have no searchable text.',n?'ok':'warn');
});

/* ========== OCR ========== */
function renderCanvas(pg,scale){const vp=pg.getViewport({scale}),c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);return pg.render({canvasContext:g,viewport:vp}).promise.then(()=>c)}
$('#ocrRun').onclick=safe(async()=>{
  need();if(!window.Tesseract)throw new Error('OCR engine did not load.');
  const lang=$('#ocrLang').value,pages=$('#ocrAll').checked?Array.from({length:S.n},(_,i)=>i+1):[S.page],out=$('#ocrOut');out.value='';let txt='';
  await busy('OCR…',async()=>{
    for(const p of pages){
      const c=await renderCanvas(await S.pdf.getPage(p),2.2);
      const r=await Tesseract.recognize(c,lang,{workerPath:new URL('./libs/tesseract/worker.min.js',document.baseURI).href,corePath:new URL('./libs/tesseract/',document.baseURI).href,...(lang==='eng'?{langPath:new URL('./libs/tesseract/lang',document.baseURI).href}:{}),logger:m=>{if(m.status)$('#busyL').textContent=`OCR page ${p}: ${m.status}${m.progress?' '+Math.round(m.progress*100)+'%':''}`}});
      txt+=(pages.length>1?`--- Page ${p} ---\n`:'')+r.data.text.trim()+'\n\n';out.value=txt;
    }
  });
  toast('OCR finished','ok');
});
$('#ocrCopy').onclick=safe(async()=>{await navigator.clipboard.writeText($('#ocrOut').value);toast('Copied','ok')});
$('#ocrDl').onclick=()=>{const t=$('#ocrOut').value;if(!t.trim()){toast('Run OCR first','warn');return}save((S.name?base(S.name):'ocr')+'-ocr.txt',t,'text/plain')};

/* ========== convert + export ========== */
async function pageText(pdf,p){
  const pg=await pdf.getPage(p),tc=await pg.getTextContent();let out='',last=null;
  for(const it of tc.items){
    if(!('str' in it))continue;const x=it.transform[4],y=it.transform[5],h=it.height||10;
    if(last){if(Math.abs(y-last.y)>h*.6)out+='\n';else if(x-last.e>h*.18&&!/\s$/.test(out)&&!/^\s/.test(it.str))out+=' '}
    out+=it.str;last={y,e:x+(it.width||0)};if(it.hasEOL){out+='\n';last=null}
  }
  return out;
}
async function allText(){const o=[];await busy('Reading text…',async()=>{for(let p=1;p<=S.n;p++)o.push((await pageText(S.pdf,p)).trim())});return o}
const exportText=safe(async f=>{
  need();await flush();const pages=await allText();if(!pages.some(Boolean))throw new Error('No selectable text found. Run OCR on scanned pages first.');
  const title=base(S.name);
  if(f==='html')save(title+'.html',`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 16px}</style></head><body><h1>${esc(title)}</h1>${pages.map((t,i)=>`<section><h2>Page ${i+1}</h2>${t.split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('')}</section>`).join('')}</body></html>`,'text/html');
  else save(title+'.txt',pages.map((t,i)=>`--- Page ${i+1} ---\n${t}`).join('\n\n'),'text/plain');
});
$('#xTxt').onclick=()=>exportText('txt');$('#xHtml').onclick=()=>exportText('html');
$('#xImg').onclick=safe(async()=>{
  need();await flush();const dpi=+$('#xDpi').value;
  await busy('Rendering pages…',async()=>{const zip=new JSZip();for(let p=1;p<=S.n;p++){const c=await renderCanvas(await S.pdf.getPage(p),dpi/72);const b=await new Promise(r=>c.toBlob(r,'image/png'));zip.file(`${base(S.name)}-p${String(p).padStart(3,'0')}.png`,await b.arrayBuffer())}save(base(S.name)+'-images.zip',await zip.generateAsync({type:'blob'}))});
});
$('#cvImgs').onclick=safe(async()=>{const f=await pickFiles('image/*',true);if(!f.length)return;await busy('Building PDF…',async()=>{S.name='Images.pdf';await setDoc(await imgsToPdf(f),{fresh:true,page:1})});tab('edit')});
$('#cvTextGo').onclick=safe(async()=>{const t=$('#cvText').value;if(!t.trim())throw new Error('Type or paste some text first');await busy('Building PDF…',async()=>{S.name='Text.pdf';await setDoc(await textPdf(t,'Text'),{fresh:true,page:1})});tab('edit')});
const xml=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
$('#mGo').onclick=safe(async()=>{
  need();const[part,conf]=$('#mConf').value.split('|');
  const v={t:$('#mT').value||base(S.name),a:$('#mA').value,s:$('#mS').value,k:$('#mK').value,c:$('#mC').value||'PdfTrix'};
  await edit('Writing metadata',doc=>{
    const now=new Date(),iso=now.toISOString();
    doc.setTitle(v.t);doc.setAuthor(v.a);doc.setSubject(v.s);doc.setKeywords(v.k.split(',').map(x=>x.trim()).filter(Boolean));doc.setCreator(v.c);doc.setProducer('PdfTrix');doc.setCreationDate(now);doc.setModificationDate(now);
    const x=`<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(v.t)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${xml(v.a)}</rdf:li></rdf:Seq></dc:creator><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(v.s)}</rdf:li></rdf:Alt></dc:description><pdf:Keywords>${xml(v.k)}</pdf:Keywords><pdf:Producer>PdfTrix</pdf:Producer><xmp:CreatorTool>${xml(v.c)}</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>${conf}</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
    doc.catalog.set(PDFName.of('Metadata'),doc.context.register(doc.context.stream(x,{Type:'Metadata',Subtype:'XML'})));
  });
  toast('Archival metadata written. Download to keep it.','ok');
});

/* ========== security: encryption ========== */
$('#enGo').onclick=safe(async()=>{
  need();if(!window.PDFLibEnc)throw new Error('The encryption module did not load. Check your connection.');
  const u=$('#enU').value,o=$('#enO').value;if(!u&&!o)throw new Error('Enter at least one password');
  await flush();
  await busy('Encrypting…',async()=>{
    const doc=await PDFLibEnc.PDFDocument.load(S.bytes,{ignoreEncryption:true});
    doc.encrypt({userPassword:u||'',ownerPassword:o||u+'-owner',permissions:{printing:$('#enPr').checked?'highResolution':false,modifying:$('#enMd').checked,copying:$('#enCp').checked,annotating:$('#enAn').checked,fillingForms:$('#enFm').checked,contentAccessibility:true,documentAssembly:false}});
    save(base(S.name)+'-protected.pdf',await doc.save(),'application/pdf');
  });
});

/* ========== security: compare ========== */
const dlg=$('#cmpDlg');
$('#cmpOpen').onclick=()=>{$('#cmpUse').checked=!!S.pdf;dlg.showModal()};
$('#cmpClose').onclick=()=>dlg.close();
const docFrom=async f=>pdfjsLib.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
async function paint(pdf,p,cv,w){const pg=await pdf.getPage(Math.min(p,pdf.numPages)),b=pg.getViewport({scale:1}),vp=pg.getViewport({scale:w/b.width});cv.width=w;cv.height=Math.round(vp.height);const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,cv.width,cv.height);await pg.render({canvasContext:g,viewport:vp}).promise}
function lineDiff(a,b){
  const n=a.length,m=b.length,L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=a[i]===b[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const out=[];let i=0,j=0;
  while(i<n&&j<m){if(a[i]===b[j]){out.push([' ',a[i]]);i++;j++}else if(L[i+1][j]>=L[i][j+1])out.push(['-',a[i++]]);else out.push(['+',b[j++]])}
  while(i<n)out.push(['-',a[i++]]);while(j<m)out.push(['+',b[j++]]);return out;
}
$('#cmpRun').onclick=safe(async()=>{
  const fa=$('#cmpA').files[0],fb=$('#cmpB').files[0];
  const A=$('#cmpUse').checked&&S.pdf?S.pdf:fa?await docFrom(fa):null,B=fb?await docFrom(fb):null;
  if(!A||!B)throw new Error('Choose document A (or use the open one) and document B');
  const p=Math.max(1,+$('#cmpPg').value||1),W=420,ca=$('#cA'),cb=$('#cB'),cd=$('#cD');
  await busy('Comparing…',async()=>{
    await paint(A,p,ca,W);await paint(B,p,cb,W);
    const h=Math.max(ca.height,cb.height);cd.width=W;cd.height=h;
    const da=ca.getContext('2d').getImageData(0,0,W,ca.height).data,db=cb.getContext('2d').getImageData(0,0,W,cb.height).data,gd=cd.getContext('2d'),im=gd.createImageData(W,h);
    const px=(d,hh,i)=>i<W*hh?[d[i*4],d[i*4+1],d[i*4+2]]:[255,255,255];let diff=0;
    for(let i=0;i<W*h;i++){const a=px(da,ca.height,i),b=px(db,cb.height,i),o=i*4,df=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);if(df>90){diff++;im.data.set([255,60,160,255],o)}else{const l=40+(a[0]+a[1]+a[2])/3*.25;im.data.set([l,l,l,255],o)}}
    gd.putImageData(im,0,0);
    const ta=(await pageText(A,Math.min(p,A.numPages))).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,600),tb=(await pageText(B,Math.min(p,B.numPages))).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,600);
    const d=lineDiff(ta,tb);let html='',chg=0;
    for(const[k,l]of d){if(k===' ')html+=`<div>${esc(l)}</div><div>${esc(l)}</div>`;else if(k==='-'){chg++;html+=`<div class="del">${esc(l)}</div><div></div>`}else{chg++;html+=`<div></div><div class="ins">${esc(l)}</div>`}}
    $('#cmpText').innerHTML=html||'<div>No selectable text on this page.</div><div></div>';
    $('#cmpInfo').textContent=`Pages: A ${A.numPages}, B ${B.numPages}. Visual difference on page ${p}: ${(diff/(W*h)*100).toFixed(2)}%. Changed text lines: ${chg}.`;
  });
});

/* ========== signatures ========== */
const pad=$('#sgPad');let strokes=[],sgDown=null,sgMode='draw';
function padDraw(){const g=pad.getContext('2d');g.clearRect(0,0,pad.width,pad.height);g.strokeStyle=$('#sgColor').value;g.lineWidth=+$('#sgWidth').value*2.2;g.lineCap='round';g.lineJoin='round';strokes.forEach(s=>{g.beginPath();s.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));if(s.length===1)g.lineTo(s[0][0]+.1,s[0][1]);g.stroke()})}
const padPt=e=>{const r=pad.getBoundingClientRect();return[(e.clientX-r.left)*pad.width/r.width,(e.clientY-r.top)*pad.height/r.height]};
pad.addEventListener('pointerdown',e=>{sgDown=[padPt(e)];strokes.push(sgDown);pad.setPointerCapture(e.pointerId);padDraw()});
pad.addEventListener('pointermove',e=>{if(sgDown){sgDown.push(padPt(e));padDraw()}});
pad.addEventListener('pointerup',()=>sgDown=null);pad.addEventListener('pointercancel',()=>sgDown=null);
$('#sgUndo').onclick=()=>{strokes.pop();padDraw()};$('#sgClear').onclick=()=>{strokes=[];padDraw()};
$('#sgColor').oninput=padDraw;$('#sgWidth').oninput=padDraw;
$$('#sgMode button').forEach(b=>b.onclick=()=>{sgMode=b.dataset.m;$$('#sgMode button').forEach(x=>x.setAttribute('aria-pressed',x===b));$('#sgDraw').hidden=sgMode!=='draw';$('#sgTypeBox').hidden=sgMode!=='type'});
function sigCanvas(){
  let src=pad;
  if(sgMode==='type'){const t=$('#sgType').value.trim();if(!t)return null;src=document.createElement('canvas');src.width=900;src.height=220;const g=src.getContext('2d');g.fillStyle=$('#sgColor').value;g.font='italic 110px "Segoe Script","Brush Script MT","Snell Roundhand","Apple Chancery",cursive';g.textBaseline='middle';g.fillText(t,30,110)}
  const g=src.getContext('2d'),d=g.getImageData(0,0,src.width,src.height).data;let x0=src.width,y0=src.height,x1=0,y1=0;
  for(let y=0;y<src.height;y+=2)for(let x=0;x<src.width;x+=2)if(d[(y*src.width+x)*4+3]>10){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
  if(x1<=x0)return null;const m=8,c=document.createElement('canvas');c.width=x1-x0+2*m;c.height=y1-y0+2*m;c.getContext('2d').drawImage(src,x0-m,y0-m,c.width,c.height,0,0,c.width,c.height);return c;
}
function logAudit(){const l=$('#sgLog');l.hidden=!S.audit.length;l.textContent=S.audit.map(a=>`${a.time}\n${a.signer}: ${a.reason}\nPage ${a.page??'-'}\nBefore ${a.sha256_before_signing.slice(0,24)}…${a.sha256_after_signing?`\nAfter  ${a.sha256_after_signing.slice(0,24)}…`:''}`).join('\n\n')}
$('#sgPlace').onclick=safe(async()=>{
  need();const name=$('#sgName').value.trim();if(!name){$('#sgName').focus();throw new Error('Enter the signer name')}
  const c=sigCanvas();if(!c)throw new Error('Draw or type a signature first');
  const info=await canvasInfo(c),id=crypto.randomUUID?crypto.randomUUID():String(Date.now()),time=new Date().toISOString();
  S.audit.push({id,signer:name,reason:$('#sgReason').value,page:null,time,document:S.name,sha256_before_signing:await sha(S.bytes),device:navigator.userAgent});
  S.img={...info,sig:{id,name,reason:$('#sgReason').value,time}};S.sigW=+$('#sgSize').value;setTool('image');logAudit();
  toast('Click the page where the signature goes, then Apply.','ok');
});
$('#sgAudit').onclick=()=>{if(!S.audit.length){toast('Nothing to export yet','warn');return}save((S.name?base(S.name):'document')+'-audit.json',JSON.stringify(S.audit,null,2),'application/json')};
$('#flatten').onclick=safe(async()=>{need();await edit('Flattening',d=>{d.getForm().flatten()})});

/* ========== automation: batch ========== */
function renderQ(){
  $('#bList').innerHTML=S.q.length?S.q.map((f,i)=>`<div class="q"><span>${esc(f.name)} <small class="note">${fmt(f.size)}</small></span><button class="btn sm bad" data-rm="${i}">✕</button></div>`).join(''):'<p class="note">Queue is empty. Add PDFs, images or text files, or drop them here.</p>';
}
function addQ(fs){S.q.push(...fs);renderQ();toast(`${fs.length} file${fs.length>1?'s':''} queued`,'ok')}
$('#bAdd').onclick=safe(async()=>{const f=await pickFiles('.pdf,application/pdf,image/*,.txt,.md,.html',true);if(f.length)addQ(f)});
$('#bClear').onclick=()=>{S.q=[];S.res=[];renderQ();$('#bRes').innerHTML='';$('#bZip').hidden=true};
$('#bList').onclick=e=>{const b=e.target.closest('[data-rm]');if(b){S.q.splice(+b.dataset.rm,1);renderQ()}};
async function rasterize(bytes,dpi,q){
  const src=await pdfjsLib.getDocument({data:bytes.slice()}).promise,out=await PDFDocument.create();
  for(let p=1;p<=src.numPages;p++){const pg=await src.getPage(p),b=pg.getViewport({scale:1}),c=await renderCanvas(pg,dpi/72),bl=await new Promise(r=>c.toBlob(r,'image/jpeg',q)),im=await out.embedJpg(new Uint8Array(await bl.arrayBuffer()));out.addPage([b.width,b.height]).drawImage(im,{x:0,y:0,width:b.width,height:b.height})}
  src.destroy();out.setProducer('PdfTrix');return out.save();
}
$('#bRun').onclick=safe(async()=>{
  if(!S.q.length)throw new Error('Add files to the queue first');
  const mode=$('#bMode').value,dpi=+$('#bDpi').value,qual=+$('#bQ').value/100,wm=$('#bWm').value.trim().replace(/[^\x20-\x7E]/g,'?'),op=+$('#bOp').value/100,col=$('#bCol').value;
  S.res=[];$('#bRes').innerHTML='';const pr=$('#bProg');pr.hidden=false;pr.max=S.q.length;pr.value=0;
  for(let i=0;i<S.q.length;i++){
    const f=S.q[i];
    try{
      await busy(`Processing ${f.name} (${i+1}/${S.q.length})…`,async()=>{
        const orig=await toPdf(f);let bytes=orig;
        if(wm){
          const doc=await PDFDocument.load(bytes,{ignoreEncryption:true}),font=await doc.embedFont(StandardFonts.HelveticaBold),th=Math.PI/4;
          for(const pg of doc.getPages()){const{width,height}=pg.getSize(),size=Math.min(width,height)*.12,w=font.widthOfTextAtSize(wm,size),hh=size*.7;pg.drawText(wm,{x:width/2-(w/2)*Math.cos(th)+(hh/2)*Math.sin(th),y:height/2-(w/2)*Math.sin(th)-(hh/2)*Math.cos(th),size,font,color:rgb(...hexRgb(col)),opacity:op,rotate:degrees(45)})}
          bytes=await doc.save();
        }
        if(mode==='light'){const doc=await PDFDocument.load(bytes,{ignoreEncryption:true});doc.setProducer('PdfTrix');bytes=await doc.save({useObjectStreams:true})}
        else if(mode==='strong')bytes=await rasterize(bytes,dpi,qual);
        if(mode!=='none'&&!wm&&bytes.length>=orig.length)bytes=orig;
        S.res.push({name:base(f.name)+(wm||mode!=='none'?'-processed':'')+'.pdf',bytes,before:f.size,after:bytes.length});
      });
    }catch(e){toast(`${f.name}: ${e.message||e}`,'bad')}
    pr.value=i+1;
  }
  pr.hidden=true;
  $('#bRes').innerHTML=S.res.map((r,i)=>`<div class="q"><span>${esc(r.name)}<br><small class="note">${fmt(r.before)} → ${fmt(r.after)} (${r.before?Math.round((1-r.after/r.before)*100):0}% saved)</small></span><button class="btn sm" data-dl="${i}">⬇</button></div>`).join('');
  $('#bZip').hidden=S.res.length<2;toast(`${S.res.length} file${S.res.length===1?'':'s'} processed`,'ok');
});
$('#bRes').onclick=e=>{const b=e.target.closest('[data-dl]');if(b){const r=S.res[+b.dataset.dl];save(r.name,r.bytes,'application/pdf')}};
$('#bZip').onclick=safe(async()=>{const zip=new JSZip();S.res.forEach(r=>zip.file(r.name,r.bytes));save('pdftrix-batch.zip',await zip.generateAsync({type:'blob'}))});

/* ========== automation: preflight ========== */
function pfScan(doc){
  const N=PDFName.of,fonts=new Map(),cs=new Set(),seen=new Set();
  doc.getPages().forEach(pg=>{
    const res=pg.node.Resources();if(!res)return;
    const fd=res.lookup(N('Font'));
    if(fd instanceof PDFDict)for(const[,ref]of fd.entries()){
      const f=doc.context.lookup(ref);if(!(f instanceof PDFDict))continue;
      const key=String(ref);if(seen.has(key))continue;seen.add(key);
      const bf=(f.get(N('BaseFont'))||'?').toString().replace(/^\//,'').replace(/^[A-Z]{6}\+/,''),sub=f.get(N('Subtype'))?.toString();let target=f;
      if(sub==='/Type0'){const df=f.lookup(N('DescendantFonts'));if(df instanceof PDFArray){const t=df.lookup(0);if(t instanceof PDFDict)target=t}}
      const desc=target.lookup(N('FontDescriptor'));
      fonts.set(key,{name:bf,type:(sub||'').slice(1),emb:desc instanceof PDFDict&&['FontFile','FontFile2','FontFile3'].some(k=>desc.has(N(k)))});
    }
    const c=res.lookup(N('ColorSpace'));
    if(c instanceof PDFDict)for(const[,v]of c.entries()){const o=doc.context.lookup(v);if(o instanceof PDFArray)cs.add(String(o.lookup(0)).replace(/^\//,''));else if(o)cs.add(String(o).replace(/^\//,''))}
  });
  const oi=doc.catalog.lookup(N('OutputIntents'));
  return{fonts:[...fonts.values()],cs:[...cs],oi:oi instanceof PDFArray?oi.size():0,xmp:doc.catalog.has(N('Metadata'))};
}
$('#pfRun').onclick=safe(async()=>{
  need();await flush();
  const doc=await PDFDocument.load(S.bytes,{ignoreEncryption:true}),r=pfScan(doc),b=(ok,y,n)=>`<span class="badge ${ok?'ok':'warn'}">${ok?y:n}</span>`;
  const rows=doc.getPages().map((p,i)=>{const{width,height}=p.getSize(),mm=v=>(v/72*25.4).toFixed(0);return`<tr><td>${i+1}</td><td>${mm(width)}×${mm(height)} mm</td><td>${width>height?'Landscape':'Portrait'}</td><td>${p.getRotation().angle}°</td></tr>`}).join('');
  const unemb=r.fonts.filter(f=>!f.emb).length;
  $('#pfOut').innerHTML=`<div class="row" style="margin:8px 0">${b(!S.locked,'Not encrypted','Encrypted')}${b(unemb===0&&r.fonts.length>0,'Fonts embedded',r.fonts.length?unemb+' font(s) not embedded':'No fonts found')}${b(r.oi>0,'Output intent present','No output intent')}${b(r.xmp,'XMP metadata','No XMP metadata')}</div>
  <p class="note">${S.n} pages · ${fmt(S.bytes.length)} · Title: ${esc(doc.getTitle()||'none')} · Producer: ${esc(doc.getProducer()||'none')}</p>
  <h3 style="margin:10px 0 4px;font-size:14px">Fonts (${r.fonts.length})</h3>
  <table class="tbl"><tr><th>Name</th><th>Type</th><th>Embedded</th></tr>${r.fonts.map(f=>`<tr><td>${esc(f.name)}</td><td>${esc(f.type)}</td><td>${f.emb?'Yes':'No'}</td></tr>`).join('')||'<tr><td colspan="3">None detected</td></tr>'}</table>
  <h3 style="margin:10px 0 4px;font-size:14px">Colour spaces</h3><p class="note">${r.cs.length?esc(r.cs.join(', ')):'None declared in page resources (device defaults).'}</p>
  <h3 style="margin:10px 0 4px;font-size:14px">Pages</h3><div style="max-height:220px;overflow:auto"><table class="tbl"><tr><th>#</th><th>Size</th><th>Orientation</th><th>Rotation</th></tr>${rows}</table></div>`;
});

/* ========== app shell ========== */
document.addEventListener('keydown',e=>{
  const typing=['input','textarea','select'].includes((e.target.tagName||'').toLowerCase());
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();pickOpen();return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!typing&&WS.includes(S.tab)){e.preventDefault();safe(undo)();return}
  if(typing||!WS.includes(S.tab)||!S.pdf||dlg.open)return;
  if(e.key==='Delete'||e.key==='Backspace'){if(S.sel){e.preventDefault();deleteSel()}}
  else if(e.key==='ArrowRight'||e.key==='PageDown')go(S.page+1);
  else if(e.key==='ArrowLeft'||e.key==='PageUp')go(S.page-1);
});
addEventListener('dragover',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){e.preventDefault();$('#dropOv').classList.add('on')}});
addEventListener('dragleave',e=>{if(!e.relatedTarget)$('#dropOv').classList.remove('on')});
addEventListener('drop',e=>{if(!(e.dataTransfer&&e.dataTransfer.files.length))return;e.preventDefault();$('#dropOv').classList.remove('on');const fs=[...e.dataTransfer.files];S.tab==='automate'?addQ(fs):safe(openFile)(fs[0])});
const syncNet=()=>{const on=navigator.onLine;$('#net').classList.toggle('off',!on);$('#net span').textContent=on?'Online':'Offline'};

/* ========== files from the OS: Android share / Open with, Windows Open with ========== */
async function receiveFiles(files){
  files=files.filter(Boolean);if(!files.length)return;
  const isImg=f=>(f.type||'').startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);
  await safe(async()=>{
    if(files.length>1&&files.every(isImg)){
      await busy('Building PDF…',async()=>{S.name='Images.pdf';await setDoc(await imgsToPdf(files),{fresh:true,page:1})});
      if(!WS.includes(S.tab))tab('edit');
    }else{
      await openFile(files[0]);
      if(files.length>1)toast(files.length+' files received. Opened the first one.','warn');
    }
  })();
}
(function(){
  const C=window.Capacitor,SR=C&&C.Plugins&&C.Plugins.ShareReceiver;
  if(SR&&C.isNativePlatform&&C.isNativePlatform()){
    const pull=async()=>{try{
      const r=await SR.consume(),out=[];
      for(const m of r.files||[]){const res=await fetch(C.convertFileSrc(m.uri));const b=await res.blob();out.push(new File([b],m.name,{type:m.mime||b.type}))}
      await receiveFiles(out);
    }catch(e){toast('Could not open shared file: '+(e&&e.message||e),'bad')}};
    SR.addListener('sharedFiles',pull);pull();
  }
  const D=window.__SHIVTRIX_DESKTOP__;
  if(D&&D.onOpenFile)D.onOpenFile(async f=>{await receiveFiles([new File([f.data],f.name,{type:f.type||''})])});
})();
addEventListener('online',syncNet);addEventListener('offline',syncNet);syncNet();
let dip=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();dip=e;$('#installBtn').hidden=false});
$('#installBtn').onclick=async()=>{if(!dip)return;dip.prompt();await dip.userChoice;dip=null;$('#installBtn').hidden=true};
addEventListener('appinstalled',()=>{$('#installBtn').hidden=true});
if('serviceWorker' in navigator&&/^https?:|^app:/.test(location.protocol)&&!window.__NO_SW__)addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
if(!window.pdfjsLib||!PDFDocument)toast('Some libraries did not load. Check your connection and reload.','bad');
renderQ();padDraw();
const qt=new URLSearchParams(location.search).get('tab');
tab(['dash','edit','convert','secure','forms','automate'].includes(qt)?qt:'dash');
})();
