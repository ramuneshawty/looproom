const $ = id => document.getElementById(id);
const themeToggle=$('theme-toggle');
// Automatic theme follows local time; manual changes last until the next transition or reload.
let manualThemeUntil=0;
function nightTime(now=new Date()){return now.getHours()<7||now.getHours()>=19;}
function nextThemeTransition(now=new Date()){
 const next=new Date(now);
 if(now.getHours()<7)next.setHours(7,0,0,0);
 else if(now.getHours()<19)next.setHours(19,0,0,0);
 else{next.setDate(next.getDate()+1);next.setHours(7,0,0,0);}
 return next.getTime();
}
function setTheme(dark){
 document.documentElement.dataset.theme=dark?'dark':'light';
 themeToggle.setAttribute('aria-checked',String(dark));
 themeToggle.title=(dark?'Switch to light mode':'Switch to dark mode')+'. Automatic: dark 7 PM–7 AM, light 7 AM–7 PM. Manual changes last until the next scheduled switch or refresh.';
}
function syncTimedTheme(){if(Date.now()>=manualThemeUntil){manualThemeUntil=0;setTheme(nightTime());}}
syncTimedTheme();
themeToggle.onclick=()=>{manualThemeUntil=nextThemeTransition();setTheme(document.documentElement.dataset.theme!=='dark');};
setInterval(syncTimedTheme,30000);
window.addEventListener('focus',syncTimedTheme);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncTimedTheme();});
const token = document.querySelector('meta[name="looproom-token"]').content;
// BEGIN SYNCHRONIZED PREVIEW
class SynchronizedPreview {
 constructor(audio,notify,clock=window){
  this.audio=audio;this.notify=notify;this.clock=clock;this.video=null;this.frame=null;this.waiting=false;this.videoListeners=[];this.playAttempt=null;
  audio.addEventListener('play',()=>{this.waiting=audio.readyState<3;this.align(true);this.follow();});
  audio.addEventListener('playing',()=>{this.waiting=false;this.align(true);this.follow();});
  audio.addEventListener('pause',()=>{this.stopVideo();this.align(true);});
  audio.addEventListener('ended',()=>{this.stopVideo();this.align(true);});
  audio.addEventListener('waiting',()=>{this.waiting=true;this.stopVideo();});
  audio.addEventListener('seeking',()=>{this.stopVideo();this.align(true);});
  audio.addEventListener('seeked',()=>{this.align(true);this.follow();});
  audio.addEventListener('ratechange',()=>{if(this.video)this.video.playbackRate=audio.playbackRate;});
  audio.addEventListener('timeupdate',()=>this.align(false));
  audio.addEventListener('error',()=>{this.stopVideo();this.notify('This audio cannot play in your browser. You can still try exporting it.');});
 }
 setVideo(video,preserveAudio=false){
  if(!preserveAudio)this.audio.pause();this.stopVideo();
  for(const [type,handler] of this.videoListeners)this.video?.removeEventListener(type,handler);
  this.videoListeners=[];this.playAttempt=null;this.video=video;this.waiting=false;
  if(!video)return;
  video.controls=false;video.muted=true;video.defaultMuted=true;video.volume=0;video.loop=true;video.playsInline=true;
  video.playbackRate=this.audio.playbackRate;
  const listen=(type,handler)=>{video.addEventListener(type,handler);this.videoListeners.push([type,handler]);};
  listen('loadedmetadata',()=>this.align(true));
  listen('canplay',()=>{this.align(false);this.follow();});
  listen('seeked',()=>this.follow());
  listen('error',()=>{this.audio.pause();this.stopVideo();this.notify('Artwork preview is unavailable for this video format. Try an H.264 MP4, or export the video without previewing.');});
  this.align(true);
 }
 align(force){
  const video=this.video,duration=video?.duration;
  if(!video||!Number.isFinite(duration)||duration<=0||(!force&&video.seeking))return;
  const target=Math.max(0,this.audio.currentTime)%duration;
  const difference=Math.abs(video.currentTime-target);
  const drift=Math.min(difference,Math.abs(duration-difference));
  if((force&&difference>.025)||drift>.15){try{video.currentTime=target;}catch(error){/* Wait for the next metadata or seek event. */}}
 }
 stopVideo(){
  if(this.frame!==null)this.clock.cancelAnimationFrame(this.frame);
  this.frame=null;this.video?.pause();
 }
 follow(){
  const audio=this.audio,video=this.video;
  if(!video||audio.paused||audio.ended||audio.seeking||this.waiting){this.stopVideo();return;}
  if(video.readyState>=2&&!video.seeking&&video.paused&&!this.playAttempt){
   const attempt={video};this.playAttempt=attempt;
   Promise.resolve().then(()=>{
    if(this.video!==video||audio.paused||audio.ended||audio.seeking||this.waiting)return;
    return video.play();
   }).catch(error=>{
    if(this.video===video&&!audio.paused&&error.name!=='AbortError'){
     audio.pause();this.notify('The artwork could not start. Press Play to try again.');
    }
   }).finally(()=>{if(this.playAttempt===attempt)this.playAttempt=null;if(this.video!==video||audio.paused||audio.ended||this.waiting)video.pause();});
  }
  if(this.frame===null)this.frame=this.clock.requestAnimationFrame(()=>{this.frame=null;this.align(false);this.follow();});
 }
}
// END SYNCHRONIZED PREVIEW
// BEGIN LIVE SEQUENCE PREVIEW
class LiveSequencePreview extends SynchronizedPreview {
 setSequence(clips,container){
  this.clips=[];super.setVideo(null,true);
  container.replaceChildren();
  this.clips=clips.map(clip=>{
   const video=document.createElement('video');video.muted=true;video.defaultMuted=true;video.playsInline=true;video.preload='auto';video.hidden=true;
   video.src='/media/'+clip.id;container.append(video);
   return {video,duration:clip.duration};
  });
  this.align(true);this.follow();
 }
 setVideo(video,preserveAudio=false){this.clips=[];super.setVideo(video,preserveAudio);}
 align(force){
  if(!this.clips?.length)return super.align(force);
  const total=this.clips.reduce((n,clip)=>n+clip.duration,0);if(!(total>0))return;
  let offset=Math.max(0,this.audio.currentTime)%total,index=0;
  while(index<this.clips.length-1&&offset>=this.clips[index].duration){offset-=this.clips[index].duration;index++;}
  const video=this.clips[index].video;
  if(this.video!==video){
   for(const clip of this.clips)clip.video.hidden=clip.video!==video;
   super.setVideo(video,true);video.loop=false;
  }
  if(!Number.isFinite(video.duration)||video.duration<=0||(!force&&video.seeking))return;
  const target=Math.min(offset,Math.max(0,video.duration-.01));
  if(Math.abs(video.currentTime-target)>(force?.025:.15))try{video.currentTime=target;}catch(error){}
 }
}
// END LIVE SEQUENCE PREVIEW
const previewPlayer=new LiveSequencePreview($('audio-preview'),message=>toast(message));
$('audio-preview').setAttribute('aria-label','Music and artwork preview');
let previewAudioId=null,previewArtId=null;
let tracks = [], selected = -1, sharedArt = null, tags = [], library = [], defaults = {}, jobs = [], output = '', draftTimer, toastTimer, suggestionIndex = -1, suggestions = [], saving = Promise.resolve();
const api = async (path, body) => {
  const response = await fetch('/api/' + path, {method:body === undefined?'GET':'POST', headers:{'Content-Type':'application/json','X-Looproom-Token':token}, ...(body === undefined?{}:{body:JSON.stringify(body)})});
  const result = await response.json(); if(!response.ok) throw new Error(result.error || 'Something went wrong.'); return result;
};
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500);}
function el(tag, text, cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function button(text, action, cls='text-button'){const node=el('button',text,cls);node.onclick=()=>Promise.resolve().then(action).catch(e=>toast(e.message));return node;}
function fields(){return {title:$('title').value,description:$('description').value,tags:[...tags],fit:$('fit').value,format:$('format').value,resolution:$('resolution').value,crossfade:$('crossfade').checked};}
function remember(){if(selected>=0 && tracks[selected])Object.assign(tracks[selected],fields());}
function scheduleSave(){remember();$('save-status').textContent='Saving…';clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,350);}
function saveDraft(){remember();const draft={tracks,selected,sharedArt,fields:fields()};saving=saving.catch(()=>{}).then(()=>api('draft',draft)).then(()=>$('save-status').textContent='Saved on this computer').catch(e=>{$('save-status').textContent='Could not save';toast(e.message);});return saving;}
function loadFields(data){$('title').value=data.title||'';$('description').value=data.description||'';const seen=new Set();tags=(data.tags||[]).filter(tag=>{const key=tag.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});$('format').value=data.format||'landscape';$('fit').value=data.fit||'fit';$('resolution').value=data.resolution||'1080';$('crossfade').checked=!!data.crossfade;renderTags();updateLabels();}
function updateLabels(){const ratio=$('format').value==='portrait'?'9/16':$('format').value==='square'?'1/1':'16/9';$('preview').style.aspectRatio=ratio;$('preview-ratio').textContent=ratio.replace('/',':');$('title-count').textContent=$('title').value.length+' / 100';$('preview-title').textContent=$('title').value||'Untitled release';for(const visual of $('preview').querySelectorAll('img,video'))visual.style.objectFit=$('fit').value==='crop'?'cover':'contain';}
function selectTrack(index){remember();selected=index;loadFields(tracks[index]);renderTracks();renderPreview();scheduleSave();}
function renderTracks(){
 const area=$('tracks');area.replaceChildren();
 tracks.forEach((track,i)=>{
  const wrap=el('div',undefined,'batch-track');const check=el('input');check.type='checkbox';check.checked=track.checked!==false;check.setAttribute('aria-label','Include '+track.audio.name);check.onchange=()=>{track.checked=check.checked;batchCount();scheduleSave();};
  const edit=button((i+1)+'. '+(track.title||track.audio.name),()=>selectTrack(i),'track'+(i===selected?' active':''));edit.title='Edit details and artwork for '+track.audio.name;
  const details=el('div',undefined,'batch-track-details');details.append(edit,el('small',track.audio.name+' · '+(track.art?.name||'Artwork needed')));
  const move=delta=>{remember();const active=tracks[selected];[tracks[i],tracks[i+delta]]=[tracks[i+delta],tracks[i]];selected=tracks.indexOf(active);renderTracks();scheduleSave();};
  const up=button('↑',()=>move(-1));up.disabled=i===0;up.setAttribute('aria-label','Move '+track.audio.name+' up');
  const down=button('↓',()=>move(1));down.disabled=i===tracks.length-1;down.setAttribute('aria-label','Move '+track.audio.name+' down');
  const remove=button('×',()=>{remember();const active=tracks[selected];tracks.splice(i,1);selected=active===track?(tracks.length?Math.min(i,tracks.length-1):-1):tracks.indexOf(active);if(selected>=0)loadFields(tracks[selected]);renderTracks();renderPreview();scheduleSave();});remove.setAttribute('aria-label','Remove '+track.audio.name);
  wrap.append(check,details,up,down,remove);area.append(wrap);
 });
 $('render-all').hidden=tracks.length<2;$('apply-all').hidden=tracks.length<2;$('batch-note').hidden=tracks.length<2;batchCount();
}
function batchCount(){const n=tracks.filter(t=>t.checked!==false).length;$('batch-count').textContent=n+' of '+tracks.length+' checked';$('render-selected').textContent='Export checked tracks ('+n+')';$('render-selected').disabled=!n;}
function currentArt(){return selected>=0?tracks[selected]?.art:sharedArt;}
function renderPreview(){
 drawSequenceEditor();
 const art=currentArt(),audio=selected>=0?tracks[selected]?.audio:null;
 $('music-name').textContent=audio?.name||'Add your music';$('music-info').textContent=audio?Math.floor(audio.duration/60)+':'+String(Math.floor(audio.duration%60)).padStart(2,'0')+' · Click to add music':'MP3, WAV, FLAC, M4A + more';
 const clips=art?.sequenceClips||null;
 const key=clips?'sequence:'+clips.map(c=>c.id+':'+c.duration).join('|'):art?.id||null;
 $('art-label').textContent=clips?clips.length+' clips · Live sequence':art?art.name:'Choose your artwork';$('art-label').title=art?.name||'';
 $('art-type').textContent=clips?'LIVE SEQUENCE':art?.kind==='video'?'SYNCHRONIZED VIDEO':art?'STILL ARTWORK':'ARTWORK PREVIEW';
 $('video-note').hidden=!clips&&art?.kind!=='video';$('video-note').textContent='Preview updates as you edit. Music controls playback and seeking; clips play in order and repeat. Loop crossfade is applied during export.';
 $('crossfade').disabled=!clips&&art?.kind!=='video';$('audio-preview').hidden=!audio;
 if(previewAudioId===(audio?.id||null)&&previewArtId===key){updateLabels();return;}
 const sameAudio=previewAudioId===(audio?.id||null);
 previewPlayer.setVideo(null,sameAudio);
 if(!sameAudio){if(audio)$('audio-preview').src='/media/'+audio.id;else $('audio-preview').removeAttribute('src');$('audio-preview').load();}
 previewAudioId=audio?.id||null;previewArtId=key;
 const preview=$('preview');preview.replaceChildren();
 if(clips?.length){previewPlayer.setSequence(clips,preview);}
 else if(art&&!clips){
  const node=el(art.kind==='image'?'img':'video');
  if(art.kind==='image'){node.alt='Selected release artwork';node.onerror=()=>toast('Image preview unavailable. Please select the artwork again.');}
  else{node.preload='auto';previewPlayer.setVideo(node,sameAudio);}
  node.src='/media/'+art.id;preview.append(node);previewPlayer.follow();
 }else{preview.append(el('p','Add artwork to see your live preview.','hint'));}
 updateLabels();
}
function addTag(value){for(const raw of value.split(',')){const tag=raw.trim().slice(0,100);if(tag&&!tags.some(t=>t.toLowerCase()===tag.toLowerCase()))tags.push(tag);}$('tag-input').value='';suggestionIndex=-1;renderTags();renderSuggestions();scheduleSave();}
function renderTags(){$('chips').replaceChildren();tags.forEach((tag,i)=>{const chip=el('span',tag,'chip');const remove=button('×',()=>{tags.splice(i,1);renderTags();renderSuggestions();scheduleSave();});remove.setAttribute('aria-label','Remove tag '+tag);chip.append(remove);$('chips').append(chip);});const n=tags.join(', ').length;$('tag-count').textContent=n+' characters · comma-separated when copied'+(n>500?' · shorten for YouTube':'');}
function renderSuggestions(){const q=$('tag-input').value.trim().toLowerCase();suggestions=q?library.filter(tag=>tag.toLowerCase().includes(q)&&!tags.some(t=>t.toLowerCase()===tag.toLowerCase())).slice(0,8):[];if(suggestionIndex>=suggestions.length)suggestionIndex=-1;$('suggestions').replaceChildren();suggestions.forEach((tag,i)=>{const b=button(tag,()=>{addTag(tag);$('tag-input').focus();},'suggestion'+(i===suggestionIndex?' selected':''));b.setAttribute('role','option');b.setAttribute('aria-selected',i===suggestionIndex?'true':'false');b.id='suggestion-'+i;$('suggestions').append(b);});$('tag-input').setAttribute('aria-expanded',suggestions.length?'true':'false');if(suggestionIndex>=0)$('tag-input').setAttribute('aria-activedescendant','suggestion-'+suggestionIndex);else $('tag-input').removeAttribute('aria-activedescendant');}
$('tag-input').addEventListener('input',()=>{suggestionIndex=-1;renderSuggestions();});
$('tag-input').addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(suggestions.length){suggestionIndex=(suggestionIndex+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length;renderSuggestions();}}else if(event.key==='Enter'||event.key===','){event.preventDefault();const value=suggestionIndex>=0?suggestions[suggestionIndex]:event.key==='Enter'&&suggestions.length?suggestions[0]:$('tag-input').value;addTag(value);}else if(event.key==='Escape'){suggestionIndex=-1;$('suggestions').replaceChildren();$('tag-input').setAttribute('aria-expanded','false');}});
$('tag-input').addEventListener('paste',event=>{const value=event.clipboardData.getData('text');if(value.includes(',')){event.preventDefault();addTag(value);}});
for(const id of ['title','description','fit','format','resolution','crossfade'])$(id).addEventListener('input',()=>{updateLabels();scheduleSave();});
let importRequest=null,importCancelled=false,importing=false;
function importFile(file,kind,index,total){return new Promise((resolve,reject)=>{
 const xhr=new XMLHttpRequest();importRequest=xhr;xhr.open('POST','/api/import');
 xhr.setRequestHeader('X-Looproom-Token',token);xhr.setRequestHeader('X-File-Kind',kind);xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));
 xhr.timeout=30*60*1000;
 xhr.upload.onprogress=event=>{$('import-message').textContent=`Adding ${index} of ${total}: ${file.name} · ${event.lengthComputable?Math.floor(event.loaded/event.total*100)+'%':'working…'}`;};
 xhr.upload.onload=()=>{$('import-message').textContent=`${file.name.toLowerCase().endsWith('.gif')?'Preparing looping GIF':'Checking'} ${file.name}…`;};
 xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw new Error(result.error||'Could not add this file.');resolve(result.file);}catch(error){reject(error);}};
 xhr.onerror=()=>reject(new Error('Could not reach Looproom. Reopen the launcher and refresh the page.'));
 xhr.onabort=()=>reject(new Error('Adding files cancelled.'));
 xhr.ontimeout=()=>reject(new Error('Adding this file took too long. Please try again.'));
 xhr.send(file);
});}
function arrangeSequence(files){
 return new Promise(resolve=>{
  const ordered=[...files],dialog=$('sequence-dialog');
  const finish=value=>{dialog.close();dialog.oncancel=null;resolve(value);};
  function draw(){const list=$('sequence-list');list.replaceChildren();ordered.forEach((file,i)=>{
   const row=el('li');row.append(el('span',file.name));
   const move=delta=>{[ordered[i],ordered[i+delta]]=[ordered[i+delta],ordered[i]];draw();};
   const up=button('↑',()=>move(-1));up.disabled=i===0;up.setAttribute('aria-label','Move '+file.name+' up');
   const down=button('↓',()=>move(1));down.disabled=i===ordered.length-1;down.setAttribute('aria-label','Move '+file.name+' down');row.append(up,down);list.append(row);
  });}
  $('sequence-build').onclick=()=>finish(ordered);$('sequence-cancel').onclick=()=>finish(null);
  dialog.oncancel=event=>{event.preventDefault();finish(null);};draw();dialog.showModal();
 });
}
function sequenceClips(){const art=currentArt();return art?.sequenceClips||(art?.kind==='video'?[art]:[]);}
function setSequenceClips(clips){
 if(importing)return;
 const previous=currentArt();const staged=clips.length?{...previous,kind:'video',name:clips.length+' clips · Live sequence',sequenceClips:clips,sequenceDirty:true}:null;
 if(selected>=0)tracks[selected].art=staged;else sharedArt=staged;
 renderTracks();renderPreview();scheduleSave();
}
function drawSequenceEditor(){
 const clips=sequenceClips(),area=$('clip-cards');area.replaceChildren();
 const duration=clips.reduce((sum,c)=>sum+(c.duration||0),0);
 $('sequence-total').textContent=clips.length+' clip'+(clips.length===1?'':'s');
 $('loop-summary').textContent=clips.length?clips.length+' clip'+(clips.length===1?'':'s')+' · '+duration.toFixed(1)+'-second loop':'Your artwork, set to music';
 $('loop-order').textContent=clips.length?'Playback order: '+clips.map((_,i)=>i+1).join(' → ')+' → repeat':'Add artwork to start your release.';
 clips.forEach((clip,i)=>{
  const card=el('div',undefined,'clip-card');card.draggable=!importing;
  const toolbar=el('div',undefined,'clip-toolbar');toolbar.append(el('span','⠿  '+(i+1)));
  const remove=button('×',()=>setSequenceClips(clips.filter((_,index)=>index!==i)));remove.setAttribute('aria-label','Remove clip '+(i+1));remove.disabled=importing;toolbar.append(remove);
  const thumbnail=el('video');thumbnail.src='/media/'+clip.id;thumbnail.muted=true;thumbnail.preload='metadata';thumbnail.playsInline=true;thumbnail.setAttribute('aria-label','Thumbnail for '+clip.name);thumbnail.onloadedmetadata=()=>{thumbnail.currentTime=Math.min(.1,thumbnail.duration/2);};
  const caption=el('div',clip.name,'clip-name');caption.title=clip.name;
  const controls=el('div',undefined,'clip-toolbar');controls.append(el('small',(clip.duration||0).toFixed(1)+'s'));
  const move=to=>{const next=[...clips];next.splice(to,0,next.splice(i,1)[0]);setSequenceClips(next);};
  const up=button('←',()=>move(i-1));up.disabled=importing||i===0;up.setAttribute('aria-label','Move clip '+(i+1)+' earlier');
  const down=button('→',()=>move(i+1));down.disabled=importing||i===clips.length-1;down.setAttribute('aria-label','Move clip '+(i+1)+' later');controls.append(up,down);
  card.ondragstart=event=>{event.dataTransfer.setData('application/x-looproom-clip',String(i));event.dataTransfer.effectAllowed='move';};
  card.ondragover=event=>{if(!importing&&Array.from(event.dataTransfer.types).includes('application/x-looproom-clip')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}};
  card.ondrop=event=>{const raw=event.dataTransfer.getData('application/x-looproom-clip');if(importing||raw==='')return;event.preventDefault();event.stopPropagation();const from=Number(raw);if(Number.isInteger(from)&&from>=0&&from<clips.length){const next=[...clips];next.splice(i,0,next.splice(from,1)[0]);setSequenceClips(next);}};
  card.append(toolbar,thumbnail,caption,controls);area.append(card);
 });
 if(!clips.length)area.append(el('p','Add videos or GIFs to start your loop.','hint'));
 $('sequence-strip').replaceChildren();clips.forEach((clip,i)=>{const segment=el('span',(i+1)+'. '+clip.name);segment.style.flex=String(clip.duration||1);$('sequence-strip').append(segment);});
 $('sequence-state').textContent=clips.length?'Live preview · Changes appear immediately · Clip audio is muted.':'Add images, videos or GIFs. Each still image plays for 5 seconds.';
 $('sequence-add').disabled=importing||clips.length>=20;
}
const preparedSequences=new Map();
async function prepareArtwork(art,options=fields()){
 if(!art?.sequenceClips)return art;
 const clips=art.sequenceClips;if(!clips.length)throw new Error('Add artwork before exporting.');
 if(clips.length===1)return clips[0];
 const key=clips.map(c=>c.id).join('|')+':'+options.format+':'+options.fit;
 if(preparedSequences.has(key))return preparedSequences.get(key);
 const result=(await api('artwork/sequence',{ids:clips.map(c=>c.id),options:{format:options.format,fit:options.fit}})).file;
 preparedSequences.set(key,result);return result;
}
$('sequence-add').onclick=()=>{$('sequence-files').value='';$('sequence-files').click();};
$('sequence-files').onchange=event=>chooseFiles('art',[...event.target.files],true);
$('sequence-add').ondragover=event=>{if(Array.from(event.dataTransfer.types).includes('Files')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';}};
$('sequence-add').ondrop=event=>{event.preventDefault();event.stopPropagation();chooseFiles('art',[...event.dataTransfer.files],true);};
async function chooseFiles(kind,files,appendSequence=false){
 if(!files.length)return;if(importing)return toast('Wait for the current files to finish, or cancel them first.');
 const extensions=kind==='audio'?['mp3','wav','flac','m4a','aac','ogg','aiff','aif']:[ 'gif','png','jpg','jpeg','webp','bmp','mp4','mov','mkv','webm','avi'];
 const invalid=files.find(file=>!extensions.includes(file.name.split('.').pop().toLowerCase())||file.size===0||file.size>20*1024**3);
 if(invalid)return toast(`Cannot add ${invalid.name}. Choose a supported, nonempty ${kind==='audio'?'audio':'image or video'} file smaller than 20 GB.`);
 if(kind==='art'&&files.length+(appendSequence?sequenceClips().length:0)>20)return toast('Choose up to 20 clips for a sequence.');
 importing=true;importCancelled=false;remember();
 const art=currentArt()||sharedArt,targetTrack=selected>=0?tracks[selected]:null;let firstAdded=null;
 $('pick-audio').disabled=true;$('pick-art').disabled=true;$('quit').disabled=true;$('import-progress').hidden=false;
 const sequence=kind==='art'&&(files.length>1||appendSequence),importedClips=[];
 try{

 $('cancel-import').disabled=false;
 for(let i=0;i<files.length;i++){
   if(importCancelled)break;
   let file=await importFile(files[i],kind,i+1,files.length);
   if(sequence&&file.kind==='image'){ $('import-message').textContent='Preparing image: '+file.name;file=(await api('artwork/still',{id:file.id})).file; }
   if(kind==='audio'){const track={...defaults,audio:file,art,title:file.name.replace(/\.[^.]+$/,''),tags:[...(defaults.tags||[])]};tracks.push(track);if(!firstAdded)firstAdded=track;}
   else if(sequence){importedClips.push(file);}
   else{sharedArt=file;if(targetTrack)targetTrack.art=file;}
   renderTracks();renderPreview();await saveDraft();
 }
 if(sequence&&!importCancelled){
  let previous=targetTrack?targetTrack.art:sharedArt;
  if(appendSequence&&previous?.kind==='image'&&!previous.sequenceClips)previous=(await api('artwork/still',{id:previous.id})).file;
  const earlier=appendSequence?(previous?.sequenceClips||(previous?.kind==='video'?[previous]:[])):[];
  const next=[...earlier,...importedClips];
  const staged={...(previous||next[0]),kind:'video',name:next.length+' clips · Live sequence',sequenceClips:next,sequenceDirty:true};
  if(targetTrack&&tracks.includes(targetTrack))targetTrack.art=staged;else sharedArt=staged;
  renderTracks();renderPreview();await saveDraft();
 }
 if(firstAdded){remember();selected=tracks.indexOf(firstAdded);loadFields(firstAdded);renderTracks();renderPreview();await saveDraft();}
 toast(importCancelled?'Adding files cancelled.':'Files added. Everything stays on this computer.');
 }catch(error){toast(error.message);}finally{importRequest=null;importing=false;$('pick-audio').disabled=false;$('pick-art').disabled=false;$('quit').disabled=false;$('import-progress').hidden=true;$('cancel-import').disabled=false;drawSequenceEditor();}
}
$('pick-audio').onclick=()=>{$('audio-files').value='';$('audio-files').click();};
$('pick-art').onclick=()=>{$('art-file').value='';$('art-file').click();};
$('audio-files').onchange=event=>chooseFiles('audio',[...event.target.files]);
$('art-file').onchange=event=>chooseFiles('art',[...event.target.files]);
$('cancel-import').onclick=()=>{importCancelled=true;importRequest?.abort();};
// Keep file drops from navigating away, including when the target is missed.
const isFileDrag=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
window.addEventListener('dragover',event=>{if(isFileDrag(event)){event.preventDefault();event.dataTransfer.dropEffect='none';}});
window.addEventListener('drop',event=>{if(isFileDrag(event)){event.preventDefault();toast('Drop music onto Add your music, or artwork onto Choose your artwork.');}});
for(const [id,kind] of [['pick-audio','audio'],['pick-art','art']]){
 const zone=$(id);let dragDepth=0;
 zone.addEventListener('dragenter',event=>{if(!isFileDrag(event))return;event.preventDefault();dragDepth++;if(!importing)zone.classList.add('drag-over');});
 zone.addEventListener('dragover',event=>{if(!isFileDrag(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=importing?'none':'copy';});
 zone.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)zone.classList.remove('drag-over');});
 zone.addEventListener('drop',event=>{if(!isFileDrag(event))return;event.preventDefault();event.stopPropagation();dragDepth=0;zone.classList.remove('drag-over');const files=Array.from(event.dataTransfer.files);if(!files.length)return toast('Please drop files, not folders.');chooseFiles(kind,files);});
}
document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{try{if(b.dataset.copy==='tags'&&$('tag-input').value.trim())addTag($('tag-input').value);const value=b.dataset.copy==='tags'?tags.join(', '):$(b.dataset.copy).value;await navigator.clipboard.writeText(value);const text=b.textContent;b.textContent='Copied ✓';setTimeout(()=>b.textContent=text,1800);}catch(e){toast('Clipboard access was blocked. Select the text and press Ctrl+C.');}});
$('save-defaults').onclick=async()=>{try{if($('tag-input').value.trim())addTag($('tag-input').value);defaults=fields();delete defaults.title;await api('defaults',defaults);toast('Defaults saved for new tracks.');}catch(e){toast(e.message);}};
$('apply-all').onclick=()=>{remember();const value=fields();delete value.title;tracks.forEach(t=>Object.assign(t,value,{tags:[...value.tags],art:currentArt()}));saveDraft();toast('Artwork and details applied. Each track keeps its own title.');};
$('change-folder').onclick=()=>{$('folder-path').value=output;$('folder-error').textContent='';$('folder-dialog').showModal();};
$('close-folder').onclick=()=>$('folder-dialog').close();
$('save-folder').onclick=async()=>{try{const result=await api('output',{path:$('folder-path').value});output=result.output;$('output-path').textContent=output;$('folder-dialog').close();toast('Export folder saved.');}catch(error){$('folder-error').textContent=error.message;}};
async function showFolder(id){
 const savedFile=id?jobs.find(job=>job.id===id)?.output:null;
 $('location-path').value=savedFile?savedFile.replace(/[\\/][^\\/]+$/,''):output;
 $('location-file').textContent=savedFile?savedFile.split(/[\\/]/).pop():'';
 $('location-message').textContent='Opening File Explorer… You can also use the location below.';
 const link=$('download-export');link.hidden=!id;if(id){link.href='/export/'+id;link.download=savedFile?.split(/[\\/]/).pop()||'video.mp4';}
 $('location-dialog').showModal();
 try{const result=await api('open',id?{id}:{});
 $('location-path').value=result.folder;
 $('location-message').textContent=result.warning?'Windows could not open File Explorer. You can still copy this location or save your video below.':'File Explorer has been asked to open this location. If no window appears, use the folder path below.';
 }catch(error){$('location-message').textContent=error.message+' You can use the saved location below.';}
}
$('open-folder').onclick=()=>showFolder().catch(e=>toast(e.message));
$('close-location').onclick=()=>$('location-dialog').close();
$('copy-location').onclick=async()=>{try{await navigator.clipboard.writeText($('location-path').value);toast('Folder path copied.');}catch(error){$('location-path').select();toast('Press Ctrl+C to copy the selected path.');}};
async function render(all){
 if(importing)return toast('Wait for the current files to finish.');
 if($('tag-input').value.trim())addTag($('tag-input').value);remember();
 const chosen=(all==='checked'?tracks.filter(t=>t.checked!==false):all?tracks:tracks[selected]?[tracks[selected]]:[]).map(t=>({...t,tags:[...(t.tags||[])]}));
 if(!chosen.length)return toast('Add your music first.');
 if(chosen.some(t=>!t.art||t.art.sequenceClips?.length===0))return toast('Choose artwork for each track before exporting.');
 importing=true;$('quit').disabled=true;$('render').disabled=true;$('render-all').disabled=true;$('render-selected').disabled=true;drawSequenceEditor();
 try{
  await saveDraft();preparedSequences.clear();$('sequence-state').textContent='Preparing your export… Your live preview stays available.';
  const configs=[];
  for(const track of chosen){const art=await prepareArtwork(track.art,track);configs.push({...track,audio:track.audio.id,art:art.id});}
  await api('jobs',{configs});await refresh();toast('Your video'+(chosen.length>1?'s are':' is')+' in the export queue.');
 }catch(error){toast(error.message);}finally{importing=false;$('quit').disabled=false;$('render').disabled=false;$('render-all').disabled=false;batchCount();drawSequenceEditor();}
}
$('render').onclick=()=>render(false).catch(e=>toast(e.message));$('render-all').onclick=()=>render(true).catch(e=>toast(e.message));
async function loadJob(job){
 remember();const result=await api('load-job',{id:job.id});
 if(result.track){tracks.push(result.track);selected=tracks.length-1;loadFields(result.track);}
 else{selected=-1;loadFields(result.details);}
 renderTracks();renderPreview();scheduleSave();$('title').scrollIntoView({behavior:'smooth',block:'center'});toast(result.warning||'Sources and details loaded. Ready to copy or export again.');
}
function drawJobs(){const area=$('jobs');area.replaceChildren();$('job-count').textContent=jobs.length;if(!jobs.length){area.append(el('div','Your finished videos will live here. Ready when you are.','empty-jobs'));return;}for(const job of [...jobs].sort((a,b)=>{const rank=s=>s==='rendering'?0:s==='queued'?1:2;return rank(a.status)-rank(b.status)||(a.status==='queued'&&b.status==='queued'?a.created-b.created:b.created-a.created);})){const row=el('div',undefined,'job '+job.status);const content=el('div');const title=el('div',undefined,'job-title');title.append(el('span',job.status,'job-status'),document.createTextNode(job.config.title));content.append(title,el('div',job.message+(job.status==='rendering'?' · '+Math.floor(job.progress)+'%':''),'job-meta'));if(job.status==='rendering'){const progress=el('progress');progress.max=100;progress.value=job.progress;progress.setAttribute('aria-label','Export progress');content.append(progress);}const actions=el('div',undefined,'job-actions');actions.append(button('Load details',()=>loadJob(job)));if(['queued','rendering'].includes(job.status))actions.append(button('Cancel',async()=>{await api('cancel',{id:job.id});await refresh();}));if(['failed','cancelled','interrupted'].includes(job.status))actions.append(button('Retry',async()=>{await api('jobs/retry',{id:job.id});await refresh();toast('Retry queued using the current export folder.');}));if(job.status==='complete'){const link=el('a','Watch ↗','text-button');link.href='/export/'+job.id;link.target='_blank';actions.append(link,button('Show folder',()=>showFolder(job.id)));}row.append(content,actions);area.append(row);}}
function drawHistory(){$('history-tags').replaceChildren();if(!library.length)$('history-tags').append(el('p','Tags will appear here after your first export.'));for(const tag of library){const chip=el('span',tag,'chip');const b=button('×',async()=>{await api('tags/delete',{tag});library=library.filter(t=>t!==tag);drawHistory();renderSuggestions();});b.setAttribute('aria-label','Forget '+tag);chip.append(b);$('history-tags').append(chip);}}
$('manage-tags').onclick=()=>{drawHistory();$('tag-dialog').showModal();};$('close-dialog').onclick=()=>$('tag-dialog').close();
let lastJobs='',pollTimer;async function refresh(){const value=await api('state');library=value.tags;jobs=value.jobs;updateTemplateList(value.templates||[]);queuePaused=!!value.queuePaused;$('queue-pause').textContent=queuePaused?'Resume queue':'Pause after current';$('queue-status').textContent=queuePaused?'Paused · current export finishes; waiting exports stay queued.':'Exports run in the order you added them.';const signature=JSON.stringify(jobs);if(signature!==lastJobs){drawJobs();lastJobs=signature;}return value;}
$('quit').onclick=async()=>{try{clearTimeout(draftTimer);await saveDraft();await api('quit',{});clearInterval(pollTimer);$('save-status').textContent='Looproom is closed';document.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=true);toast('Looproom is closed. Use the launcher to open it again.');}catch(e){toast(e.message);}};
async function init(){try{const value=await refresh();defaults=value.defaults;output=value.output;$('output-path').textContent=output;const draft=value.draft;tracks=draft.tracks||[];selected=tracks.length&&draft.selected!==-1?Math.max(0,Math.min(draft.selected??0,tracks.length-1)):-1;sharedArt=draft.sharedArt||null;loadFields(selected>=0?tracks[selected]:draft.fields||defaults);renderTracks();renderPreview();if(!value.engine)toast('The video engine is missing. Restore bin/ffmpeg.exe.');pollTimer=setInterval(()=>refresh().catch(()=>{$('save-status').textContent='Connection lost — reopen Looproom';}),1500);}catch(e){toast(e.message);}}
let releaseTemplates=[],templateSignature='',editingTemplate=null,queuePaused=false;
function updateTemplateList(items){releaseTemplates=items;const signature=JSON.stringify(items);if(signature===templateSignature)return;templateSignature=signature;const select=$('release-template'),previous=select.value;select.replaceChildren();const empty=el('option','Choose a template');empty.value='';select.append(empty);for(const t of items){const option=el('option',t.name);option.value=t.id;select.append(option);}select.value=items.some(t=>t.id===previous)?previous:'';}
async function applyTemplate(checked){remember();const chosen=checked?tracks.filter(t=>t.checked!==false):tracks[selected]?[tracks[selected]]:[];if(!chosen.length)return toast('Choose at least one track.');if(!$('release-template').value)return toast('Choose a release template first.');const config=await api('templates/apply',{id:$('release-template').value});for(const track of chosen)Object.assign(track,{...config,tags:[...config.tags]});if(selected>=0)loadFields(tracks[selected]);renderTracks();renderPreview();await saveDraft();toast('Template applied to '+chosen.length+' track'+(chosen.length===1?'':'s')+'. Titles kept.');}
function openTemplate(edit){const chosen=releaseTemplates.find(t=>t.id===$('release-template').value);if(edit&&!chosen)return toast('Choose a template to update.');editingTemplate=edit?chosen.id:null;$('template-heading').textContent=edit?'Update release template':'Save release template';$('template-name').value=edit?chosen.name:'';$('template-art').checked=!!(edit&&chosen.art);$('template-art').disabled=!currentArt();$('template-delete').hidden=!edit;$('template-delete-review').hidden=true;$('template-message').textContent='';$('template-dialog').showModal();$('template-name').focus();}
$('template-new').onclick=()=>openTemplate(false);$('template-edit').onclick=()=>openTemplate(true);$('template-close').onclick=()=>$('template-dialog').close();
$('template-current').onclick=()=>applyTemplate(false).catch(e=>toast(e.message));$('template-checked').onclick=()=>applyTemplate(true).catch(e=>toast(e.message));
$('template-save').onclick=async()=>{const b=$('template-save');b.disabled=true;try{if($('tag-input').value.trim())addTag($('tag-input').value);remember();preparedSequences.clear();const templateArtwork=$('template-art').checked&&!$('template-art').disabled?await prepareArtwork(currentArt()):null;const result=await api('templates/save',{id:editingTemplate,name:$('template-name').value,config:{...fields(),art:templateArtwork?.id||null}});await refresh();$('release-template').value=result.id;$('template-dialog').close();toast('Release template saved.');}catch(e){$('template-message').textContent=e.message;}finally{b.disabled=false;}};
$('template-delete').onclick=()=>$('template-delete-review').hidden=false;
$('template-delete-confirm').onclick=async()=>{try{await api('templates/delete',{id:editingTemplate});await refresh();$('template-dialog').close();toast('Template deleted.');}catch(e){$('template-message').textContent=e.message;}};
$('batch-all').onclick=()=>{tracks.forEach(t=>t.checked=true);renderTracks();scheduleSave();};$('batch-none').onclick=()=>{tracks.forEach(t=>t.checked=false);renderTracks();scheduleSave();};
$('render-selected').onclick=()=>render('checked').catch(e=>toast(e.message));$('queue-pause').onclick=async()=>{try{await api('queue/pause',{paused:!queuePaused});await refresh();}catch(e){toast(e.message);}};
$('title').addEventListener('input',()=>{remember();const label=$('tracks').querySelectorAll('.batch-track-details .track')[selected];if(label)label.textContent=(selected+1)+'. '+(tracks[selected].title||tracks[selected].audio.name);});
init();

// Storage cleanup always starts with a scan and a separate deletion review.
let storageReport=null,storageSelection=new Set(),storagePlan=null,storageDeleting=false;
function storageBytes(bytes){if(bytes===0)return '0 B';const units=['B','KB','MB','GB','TB'];const n=Math.min(4,Math.floor(Math.log(bytes)/Math.log(1024)));return (bytes/1024**n).toFixed(n?1:0)+' '+units[n];}
function storageCount(){const rows=(storageReport?.rows||[]).filter(row=>storageSelection.has(row.id));$('storage-selected').textContent=rows.length+' files selected · '+storageBytes(rows.reduce((n,row)=>n+row.size,0));$('storage-review-button').disabled=!rows.length||storageReport?.busy;}
function storageDraw(){
 $('storage-totals').replaceChildren();
 for(const [label,value] of [['Working copies',storageReport.workingBytes],['Render logs & temporary files',storageReport.temporaryBytes],['Finished exports · kept',storageReport.exportBytes],['Free disk space',storageReport.freeBytes]]){const card=el('div',undefined,'storage-stat');card.append(el('span',label),el('strong',storageBytes(value)));$('storage-totals').append(card);}
 $('storage-busy').textContent=storageReport.busy?'Cleanup is paused while files are being imported or exported. Refresh when they finish.':'Available to clean: '+storageBytes(storageReport.eligibleBytes)+'. Recent files are protected for 10 minutes.';
 $('storage-files').replaceChildren();
 if(!storageReport.rows.length)$('storage-files').append(el('p','No working copies or render logs to clean up yet.'));
 const rows=[...storageReport.rows].sort((a,b)=>Number(a.protected)-Number(b.protected)||b.size-a.size);
 for(const row of rows){const wrap=el('div',undefined,'storage-row'+(row.protected?' storage-protected':''));const check=el('input');check.type='checkbox';check.id='storage-file-'+row.id;check.checked=storageSelection.has(row.id);check.disabled=row.protected||storageReport.busy;check.onchange=()=>{if(check.checked)storageSelection.add(row.id);else storageSelection.delete(row.id);storageCount();};const label=el('label',row.name);label.htmlFor=check.id;label.append(el('small',row.protected?row.reason:row.pastUses?'Used by '+row.pastUses+' past exports. Removing this copy keeps the finished videos, but re-exporting needs the original file.':row.kind==='copy'?'Unused working copy':'Old render log or temporary loop'));wrap.append(check,label,el('span',storageBytes(row.size),'storage-size'));$('storage-files').append(wrap);}
 $('storage-unused').disabled=storageReport.busy;storageCount();
}
async function storageScan(){
 if(importing)throw new Error('Finish adding files before opening storage cleanup.');
 clearTimeout(draftTimer);remember();await saving.catch(()=>{});await api('draft',{tracks,selected,sharedArt,fields:fields()});
 storageReport=await api('storage',{});storageSelection.clear();storagePlan=null;
 $('storage-overview').hidden=false;$('storage-review').hidden=true;$('storage-confirm').checked=false;$('storage-delete').disabled=true;
 storageDraw();
}
$('storage-open').onclick=async()=>{if(importing)return toast('Finish adding files before opening storage cleanup.');previewPlayer.audio.pause();$('storage-dialog').showModal();$('storage-status').textContent='Checking storage…';try{await storageScan();$('storage-status').textContent='Choose what to remove, then review the exact files.';}catch(error){$('storage-status').textContent=error.message;}};
$('storage-close').onclick=()=>{if(!storageDeleting){$('storage-dialog').close();storagePlan=null;}};
$('storage-dialog').addEventListener('cancel',event=>{if(storageDeleting)event.preventDefault();else storagePlan=null;});
$('storage-refresh').onclick=async()=>{try{await storageScan();$('storage-status').textContent='Storage refreshed.';}catch(error){$('storage-status').textContent=error.message;}};
$('storage-unused').onclick=()=>{storageSelection=new Set(storageReport.rows.filter(row=>!row.protected&&!row.pastUses).map(row=>row.id));storageDraw();};
$('storage-none').onclick=()=>{storageSelection.clear();storageDraw();};
$('storage-review-button').onclick=async()=>{try{storagePlan=await api('storage/review',{ids:[...storageSelection]});$('storage-overview').hidden=true;$('storage-review').hidden=false;$('storage-confirm').checked=false;$('storage-delete').disabled=true;$('storage-review-summary').textContent='Permanently remove '+storagePlan.count+' working files ('+storageBytes(storagePlan.bytes)+')?';$('storage-impact').textContent=storagePlan.pastCopies?'Some copies belong to past exports. Their finished MP4s and saved details remain, but you will need to select the original audio or artwork again to re-export.':'These files are not needed by your saved draft or export history.';$('storage-review-files').replaceChildren(...storagePlan.files.map(file=>el('li',file.name+' · '+storageBytes(file.size))));$('storage-status').textContent='Review expires after 5 minutes. Nothing has been deleted.';}catch(error){$('storage-status').textContent=error.message;}};
$('storage-confirm').onchange=()=>{$('storage-delete').disabled=!$('storage-confirm').checked||!storagePlan;};
$('storage-back').onclick=()=>{storagePlan=null;$('storage-overview').hidden=false;$('storage-review').hidden=true;$('storage-confirm').checked=false;};
$('storage-delete').onclick=async()=>{
 if(!storagePlan||!$('storage-confirm').checked||storageDeleting)return;
 storageDeleting=true;$('storage-delete').disabled=true;$('storage-back').disabled=true;$('storage-close').disabled=true;
 try{const result=await api('storage/clean',{token:storagePlan.token,confirmed:true});await storageScan();$('storage-status').textContent='Removed '+result.removed+' files · '+storageBytes(result.freedBytes)+' of working files removed.'+(result.failures.length?' Some files could not be removed: '+result.failures.join('; '):'');}
 catch(error){storagePlan=null;$('storage-status').textContent=error.message;$('storage-delete').disabled=true;}
 finally{storageDeleting=false;$('storage-back').disabled=false;$('storage-close').disabled=false;}
};
