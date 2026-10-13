// Host the existing chat so model, Skill and task controls stay shared.
(() => {
  let popup, opening, selecting, materializing, stopDrag, loading = false, epoch = 0, trigger;
  const key = project => `ai-window:${project}`;
  const draftId = project => `ai-draft:${project}`;
  const isOpen = () => popup?.isConnected && popup.dataset.project === current?.id;
  const host = () => isOpen() ? popup.querySelector('.ai-dialog-body') : null;
  const persist = () => { if(isOpen())(globalThis.MethodAtlasStorage?.local || localStorage).setItem(key(current.id),JSON.stringify({open:true,conversation:conversation.id})); };
  function mainPlaceholder() {
    const main=document.getElementById('chat-body');
    if(isOpen() && (middleView==='chat' || main?.querySelector('#chat-form')))main.innerHTML=`<div class="ai-inline-state"><p>当前对话已在浮窗中打开</p><button type="button" data-ai="focus">回到对话</button></div>`;
  }
  function geometry(values = {}) {
    if(!popup)return;
    const rect=popup.getBoundingClientRect(), margin=12;
    const unit=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
    const width=Math.min(innerWidth-margin*2,Math.max(Math.min(22*unit,innerWidth-margin*2),values.width??rect.width));
    const height=Math.min(innerHeight-margin*2,Math.max(Math.min(24*unit,innerHeight-margin*2),values.height??rect.height));
    const left=Math.max(margin,Math.min(values.left??rect.left,innerWidth-width-margin));
    const top=Math.max(margin,Math.min(values.top??rect.top,innerHeight-height-margin));
    Object.assign(popup.style,{width:width+'px',height:height+'px',left:left+'px',top:top+'px'});
  }
  function mount() {
    loading=true;
    trigger=document.activeElement;
    popup=document.createElement('section'); popup.className='ai-dialog';popup.dataset.project=current.id;
    popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','false');popup.setAttribute('aria-labelledby','ai-dialog-title');
    popup.innerHTML=`<header class="ai-dialog-head"><span class="ai-dialog-drag" data-ai-drag tabindex="0" aria-label="移动 AI 对话窗口">${icon('spark')}<strong id="ai-dialog-title">AI 对话</strong></span><div class="row"><button class="icon" type="button" data-ai="history" aria-label="历史对话" aria-expanded="false">${icon('history')}</button><button class="icon" type="button" data-ai="new" aria-label="新建浮窗对话">${icon('plus')}</button><button class="icon" type="button" data-ai="close" aria-label="关闭 AI 对话">${icon('close')}</button></div></header><nav class="ai-dialog-history" aria-label="项目历史对话" hidden></nav><div class="ai-dialog-subhead"><span class="ai-dialog-topic"></span><span id="ai-chat-tools" class="row"></span></div><div class="ai-dialog-body"><p role="status">正在打开对话…</p></div><button class="ai-dialog-resize" type="button" data-ai-resize aria-label="调整 AI 对话窗口大小" title="拖动调整宽度和高度；方向键微调">${icon('expand')}</button>`;
    document.body.append(popup);mainPlaceholder();
    popup.querySelectorAll('[data-ai=history],[data-ai=new]').forEach(button=>button.disabled=true);
    let saved;try{saved=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem('ai-window-geometry'));}catch{}
    geometry(saved||{width:448,height:Math.min(640,innerHeight-96),left:innerWidth-472,top:76});
    try{
      const r=trigger?.getBoundingClientRect();
      if(r&&r.width){
        const box=popup.getBoundingClientRect();
        const x=Math.max(0,Math.min(box.width,r.left+r.width/2-box.left));
        const y=Math.max(0,Math.min(box.height,r.top+r.height/2-box.top));
        popup.style.transformOrigin=`${x}px ${y}px`;
      }
    }catch{}
  }
  function sync() {
    if(!isOpen())return;
    popup.dataset.conversation=conversation.id;
    popup.querySelector('.ai-dialog-topic').textContent=conversation.title;
    const history=popup.querySelector('.ai-dialog-history');
    popup.querySelector('[data-ai=history]').setAttribute('aria-expanded',String(!history.hidden));
    const storage=globalThis.MethodAtlasStorage?.local || localStorage;
    if(conversation.local)storage.setItem(`chat-options:${conversation.id}`,JSON.stringify(conversation.chat_options || {}));
    if(!history.hidden){
      const drafts=cid=>{
        if(storage.getItem(`draft:${cid}`)?.trim() || selectedFragments(cid).length)return true;
        try{return JSON.parse(storage.getItem(`queue:${cid}`)||'[]').length>0;}catch{return false;}
      };
      const list=current.conversations.filter(c=>(c.message_count??c.messages.length)>0 || drafts(c.id));
      if(drafts(draftId(current.id)))list.unshift({id:draftId(current.id),title:'未发送草稿',local:true});
      history.innerHTML='<h2>历史记录</h2>'+(list.map(c=>`<button type="button" data-ai-conversation="${esc(c.id)}" ${c.id===conversation.id?'aria-current="true"':''}><strong>${esc(c.title)}</strong><small>${c.local?'未发送':(c.message_count??c.messages.length)+' 条消息'}</small></button>`).join('') || '<p class="empty-small">还没有历史对话</p>');
    }
    window.MethodAtlasProgress?.chatHeader();persist();
  }
  async function select(id) {
    const project=current.id,token=epoch;invalidateView();const generation=viewGeneration;
    loading=true;
    popup.setAttribute('aria-busy','true');host().inert=true;
    popup.querySelectorAll('[data-ai=history],[data-ai=new]').forEach(button=>button.disabled=true);
    const request=(async()=>{
      try {
        const loaded=id===draftId(project)?null:await api(`/api/projects/${project}?compact=1&conversation=${encodeURIComponent(id)}`);
        if(!isOpen()||epoch!==token||current?.id!==project||viewGeneration!==generation)return false;
        let options;try{options=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`chat-options:${id}`));}catch{}
        const next=loaded?loaded.conversations.find(c=>c.id===id):{id,title:'未发送草稿',local:true,context_conversation_id:serverConversationId(),visibility:'shared',messages:[],reads:[],chat_options:options || {}};
        if(!next)throw Error('这段对话已不可用，请选择其他历史对话。');
        if(loaded)current=loaded;
        conversation=next;host().replaceChildren();lastStarted=null;
        if(loaded&&options){next.chat_options=options;window.MethodAtlasSettings.stageDraft(project,id,options);window.MethodAtlasSettings.sent(id);}
        if(!next.local)(globalThis.MethodAtlasStorage?.local || localStorage).setItem('methodatlas-view',JSON.stringify({projectId:project,conversationId:id}));
        loadQueue();loading=false;host().inert=false;
        mainPlaceholder();renderChat();sync();document.getElementById('chat-input')?.focus({preventScroll:true});
        refreshTask(null,generation,project,id).catch(error=>toast(error.message));return true;
      } finally {
        if(isOpen()&&epoch===token&&viewGeneration===generation){loading=false;host().inert=false;popup.setAttribute('aria-busy','false');popup.querySelectorAll('[data-ai=history],[data-ai=new]').forEach(button=>button.disabled=false);}
      }
    })();
    selecting=request;
    try{return await request;}finally{if(selecting===request)selecting=null;}
  }
  async function ensure() {
    if(opening)return opening;
    if(isOpen())return selecting?await selecting:true;
    invalidateView();mount();const project=current.id,token=++epoch;
    const request=(async()=>{
      try{
        if(epoch!==token||current?.id!==project||!isOpen())return false;
        return await select(draftId(project));
      }catch(error){if(isOpen()&&epoch===token){loading=false;popup.remove();popup=null;if(middleView==='chat')renderChat();}throw error;}
    })();
    opening=request;
    try{return await request;}finally{if(opening===request)opening=null;}
  }
  async function open(fragment = null, prompt = '') {
    const project=current?.id;
    try{
      if(!project||!await ensure()||current?.id!==project||!isOpen())return false;
      if(fragment)addSelectedFragment(fragment);
      if(prompt)appendChatPrompt(prompt);
      document.getElementById('chat-input')?.focus({preventScroll:true});return true;
    }catch(error){toast(error.message);return false;}
  }
  async function prepareSend(){
    if(!conversation.local)return true;
    if(materializing || !isOpen())return false;
    const draft=conversation,project=current.id,token=epoch,generation=viewGeneration;
    loading=true;popup.setAttribute('aria-busy','true');
    popup.querySelectorAll('[data-ai=history],[data-ai=new],.send-button').forEach(button=>button.disabled=true);
    const request=(async()=>{
      const created=await newConversation(true);
      if(!created||!isOpen()||epoch!==token||!isCurrentView(generation,project,draft.id))return false;
      const storage=globalThis.MethodAtlasStorage?.local || localStorage,prefixes=['draft','selected-fragments','queue'];
      for(const prefix of prefixes){const value=storage.getItem(`${prefix}:${draft.id}`);if(value!==null)storage.setItem(`${prefix}:${created.id}`,value);}
      created.chat_options=window.MethodAtlasSettings.options();
      window.MethodAtlasSettings.stageDraft(project,created.id,created.chat_options);
      for(const prefix of prefixes)storage.removeItem(`${prefix}:${draft.id}`);
      storage.removeItem(`chat-options:${draft.id}`);
      draftEdits.set(created.id,draftEdits.get(draft.id));draftEdits.delete(draft.id);
      conversation=created;loading=false;loadQueue();renderChat();sync();
      storage.setItem('methodatlas-view',JSON.stringify({projectId:project,conversationId:created.id}));
      return true;
    })();
    materializing=request;
    try{return await request;}finally{
      if(materializing===request)materializing=null;
      if(isOpen()&&epoch===token){loading=false;popup.setAttribute('aria-busy','false');popup.querySelectorAll('[data-ai=history],[data-ai=new]').forEach(button=>button.disabled=false);syncComposer();}
    }
  }
  function suspend(){stopDrag?.();persist();epoch++;popup?.remove();popup=null;opening=selecting=materializing=null;loading=false;}
  function close(){
    if(!isOpen())return;
    stopDrag?.();
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(key(current.id),JSON.stringify({open:false,conversation:conversation.id}));
    if(conversation.local){conversation=current.conversations.find(c=>c.id===conversation.context_conversation_id) || current.conversations[0];loadQueue();lastStarted=null;}
    epoch++;popup.remove();popup=null;opening=selecting=materializing=null;loading=false;
    if(middleView==='chat'){document.getElementById('chat-body').replaceChildren();renderChat();}
    if(trigger?.isConnected)trigger.focus({preventScroll:true});
  }
  async function restore(){
    if(isOpen())return;
    let saved;try{saved=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(key(current.id)));}catch{}
    if(!saved?.open||saved.conversation!==draftId(current.id)&&!current.conversations.some(c=>c.id===saved.conversation))return;
    mount();await select(saved.conversation);
  }
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-ai],[data-ai-conversation]');
    if(!target||!current||target.disabled)return;
    try{
      if(target.dataset.ai==='open')await open();
      if(target.dataset.ai==='focus')document.getElementById('chat-input')?.focus();
      if(target.dataset.ai==='close')close();
      if(target.dataset.ai==='history'){
        const history=popup.querySelector('.ai-dialog-history');history.hidden=!history.hidden;
        target.setAttribute('aria-expanded',String(!history.hidden));sync();if(!history.hidden)history.querySelector('button')?.focus();
      }
      if(target.dataset.ai==='new'){
        if(!conversation.local)await select(draftId(current.id));
        popup.querySelector('.ai-dialog-history').hidden=true;sync();document.getElementById('chat-input')?.focus({preventScroll:true});
      }
      if(target.dataset.aiConversation&&await select(target.dataset.aiConversation)){popup.querySelector('.ai-dialog-history').hidden=true;sync();document.getElementById('chat-input')?.focus({preventScroll:true});}
    }catch(error){toast(error.message);}
  });
  document.addEventListener('keydown',event=>{
    if(!isOpen() || event.defaultPrevented)return;
    if(event.key==='Escape'&&popup.contains(event.target)){
      const history=popup.querySelector('.ai-dialog-history');
      if(!history.hidden){history.hidden=true;const button=popup.querySelector('[data-ai=history]');button.setAttribute('aria-expanded','false');button.focus();}else close();
      event.preventDefault();event.stopPropagation();return;
    }
    const handle=event.target.closest('[data-ai-drag],[data-ai-resize]');
    if(!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    stopDrag?.();
    const rect=popup.getBoundingClientRect(),dx=event.key==='ArrowLeft'?-16:event.key==='ArrowRight'?16:0,dy=event.key==='ArrowUp'?-16:event.key==='ArrowDown'?16:0;
    geometry(handle.hasAttribute('data-ai-resize')?{width:rect.width+dx,height:rect.height+dy}:{left:rect.left+dx,top:rect.top+dy});
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem('ai-window-geometry',JSON.stringify(popup.getBoundingClientRect().toJSON()));event.preventDefault();
  });
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-ai-drag],[data-ai-resize]');
    if(!handle||!isOpen()||event.button!==0)return;
    stopDrag?.();
    popup.getAnimations().forEach(animation=>animation.finish());
    const win=popup,rect=win.getBoundingClientRect(),x=event.clientX,y=event.clientY,resizing=handle.hasAttribute('data-ai-resize');
    const follow=event.pointerType==='mouse'&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.dataset.motion!=='reduce';
    let left=rect.left,top=rect.top,targetLeft=left,targetTop=top,frame=0,last=performance.now(),released=false;
    handle.setPointerCapture(event.pointerId);event.preventDefault();
    if(!resizing){win.dataset.dragging='true';win.style.willChange='translate';}
    const translate=()=>{win.style.translate=`${left-rect.left}px ${top-rect.top}px`;};
    const stop=()=>{
      cancelAnimationFrame(frame);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('lostpointercapture',end);
      if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
      win.style.translate='';win.style.willChange='';delete win.dataset.dragging;
      if(win===popup&&isOpen()){
        if(!resizing)geometry({left,top});
        (globalThis.MethodAtlasStorage?.local || localStorage).setItem('ai-window-geometry',JSON.stringify(win.getBoundingClientRect().toJSON()));
      }
      if(stopDrag===stop)stopDrag=null;
    };
    const draw=now=>{
      const amount=1-Math.exp(-Math.min(now-last,64)/70);last=now;
      left+=(targetLeft-left)*amount;top+=(targetTop-top)*amount;translate();
      if(Math.abs(targetLeft-left)+Math.abs(targetTop-top)>.25)frame=requestAnimationFrame(draw);
      else{left=targetLeft;top=targetTop;translate();frame=0;if(released)stop();}
    };
    const move=e=>{
      if(resizing){geometry({width:rect.width+e.clientX-x,height:rect.height+e.clientY-y});return;}
      targetLeft=Math.max(12,Math.min(rect.left+e.clientX-x,innerWidth-rect.width-12));
      targetTop=Math.max(12,Math.min(rect.top+e.clientY-y,innerHeight-rect.height-12));
      if(!follow){left=targetLeft;top=targetTop;translate();}
      else if(!frame){last=performance.now();frame=requestAnimationFrame(draw);}
    };
    const end=()=>{if(released)return;released=true;handle.removeEventListener('pointermove',move);if(!frame)stop();};
    stopDrag=stop;
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('lostpointercapture',end);
  });
  addEventListener('resize',()=>{stopDrag?.();geometry();});
  window.MethodAtlasAI={open,isOpen,host,sync,suspend,restore,select,prepareSend,loading:()=>loading,mainPlaceholder};
})();
