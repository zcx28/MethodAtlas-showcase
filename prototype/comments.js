// Shared comments extend the existing right pane and its isolated report preview.
window.MethodAtlasComments = (() => {
  let ctx = null, timer = null;
  const css = document.createElement('style');
  css.textContent = '.project-comments{border-top:1px solid var(--line);padding:12px;max-height:48%;min-height:160px;overflow:auto;flex-shrink:0;background:var(--surface)}.project-comments header{display:flex;gap:8px;align-items:center;justify-content:space-between}.project-comments h3{font-size:14px;margin:0}.project-comments article{border-bottom:1px solid var(--line);padding:10px 0}.project-comments blockquote{margin:6px 0;padding:6px 10px;border-left:3px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere;max-height:100px;overflow:auto}.project-comments p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.project-comments small{color:var(--muted)}.project-comments textarea{width:100%;min-height:70px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;resize:vertical}.project-comments button{margin:3px}.project-comments select{max-width:65%;font:inherit}.project-comments [role=alert]{color:var(--danger)}';
  document.head.append(css);
  css.textContent += '.project-comments-paper{width:min(22rem,42%);max-height:none;min-height:0;border-top:0;border-left:1px solid var(--line);overflow:auto}.project-comments-paper label{display:grid;gap:.5rem;margin:.75rem 0}.project-comments blockquote{border-left-width:1px}.project-comments header{position:sticky;top:0;background:var(--surface);padding-bottom:.5rem;z-index:1}@media(max-width:760px){.reader-stage:has(.project-comments-paper){flex-direction:column}.project-comments-paper{width:100%;max-height:50%;min-height:12rem;border-left:0;border-top:1px solid var(--line)}}';
  const active = (project, id) => !!ctx?.node.isConnected && ctx.project === project && ctx.artifact === id;
  const signal = () => window.dispatchEvent(new Event('methodatlas-comment-mode'));
  const post = (url, body) => api(url, {method:'POST',body:JSON.stringify(body)});
  function remember(c) {
    try { (globalThis.MethodAtlasStorage?.session || sessionStorage).setItem(c.key, JSON.stringify({text:c.form.elements.text.value,choice:c.choice,reply:c.reply,mentions:[...c.mentions],request:c.request})); }
    catch { c.error.textContent = '浏览器无法保存评论草稿，请在离开前复制输入。'; }
  }
  function close() {
    if (ctx) { remember(ctx); ctx.node.remove(); }
    ctx = null; clearInterval(timer); signal();
  }
  function sync(project, id, view) {
    if (!ctx || ctx.kind === 'paper') return;
    if (!ctx.node.isConnected || ctx.project !== project || ctx.artifact !== id) return close();
    if (ctx.view !== view) { ctx.view = view; void refresh(ctx); }
  }
  function syncPaper(project, id, view) {
    if (ctx?.kind !== 'paper') return;
    if (ctx.project !== project || ctx.artifact !== id) return close();
    document.querySelector('.reader-stage')?.append(ctx.node);
    if (ctx.view !== view) {ctx.view=view;void refresh(ctx);}
  }
  function target(c) {
    c.node.querySelector('[data-comment-target]').textContent = c.reply ? '正在回复这条讨论' : c.choice ? `引用原文：${c.choice.anchor.quote}` : '点击正文中的文字并划选后评论，也可以直接发表整项评论。';
  }
  async function refresh(c) {
    if (ctx !== c || c.loading) return;
    c.loading = true;
    try {
      const view = c.view;
      const data = await api(`${c.base}?version_id=${encodeURIComponent(view || 'draft')}`);
      if (ctx !== c || c.view !== view || !c.node.isConnected) return;
      c.threads = data.threads;
      c.loadedVersion = data.version_id;
      c.node.querySelector('[data-comment-list]').innerHTML = data.threads.map(t => `<article data-thread="${esc(t.id)}"><small>${t.resolved ? '已解决' : '讨论中'}${t.location.status === 'changed' ? ' · 原文已变更' : ''}</small>${t.quote ? `<blockquote>${esc(t.quote)}</blockquote>` : '<p>整项评论</p>'}${t.messages.map(m => `<div><small>${esc(m.email)} · ${esc(new Date(m.created).toLocaleString())}</small><p>${esc(m.body)}</p></div>`).join('')}<div><button type="button" class="pill" data-comment-reply="${esc(t.id)}">回复</button><button type="button" class="pill" data-comment-resolve="${esc(t.id)}">${t.resolved ? '重新打开' : '解决'}</button>${t.quote && t.location.status === 'attached' ? `<button type="button" class="pill" data-comment-locate="${esc(t.id)}">定位原文</button>` : ''}<button type="button" class="pill" data-comment-original="${esc(t.id)}">查看引用版本</button></div></article>`).join('') || '<p>暂无评论。</p>';
    } catch (e) {
      if (ctx === c) {
        c.error.textContent = e.message;
        if ([401,403].includes(e.status)) c.node.querySelector('[data-comment-list]').replaceChildren();
      }
    } finally { c.loading = false; }
  }
  async function toggle(kind='artifact', source=null) {
    const item=kind==='paper'?detail?.paper:artifact;
    if (!state?.collaboration || !current || !item) return;
    if (active(current.id, item.id) && ctx.kind === kind) {if(source)return selected(current.id,item.id,source);return close();}
    close();
    const project = current.id, id = item.id, view = kind==='paper'?item.version_id:versionId;
    const data = await api(`/api/projects/${project}/members`);
    if (current?.id !== project || (kind==='paper'?detail?.paper:artifact)?.id !== id) return;
    const node = document.createElement('section');
    node.className = 'project-comments' + (kind==='paper'?' project-comments-paper':''); node.setAttribute('aria-label', '共享评论');
    node.innerHTML = '<header><h3>共享评论</h3><div><button type="button" class="pill" data-comment-refresh>刷新</button><button type="button" class="pill" data-comment-close aria-label="关闭评论">×</button></div></header><div data-comment-list></div><form><p data-comment-target role="status"></p><button type="button" class="pill" data-comment-clear>改为整项评论</button><label>评论内容<textarea name="text" required maxlength="10000"></textarea></label><label>@ 提醒成员<select name="mention"><option value="">选择成员</option></select></label><button type="button" class="pill" data-comment-mention>添加 @</button><button type="submit" class="primary">发表评论</button></form><p role="alert"></p>';
    if(kind==='paper')document.querySelector('.reader-stage').append(node);else document.getElementById('output-body').after(node);
    const c = {kind,project,artifact:id,view,node,base:`/api/projects/${project}/${kind==='paper'?'papers':'artifacts'}/${id}/comments`,form:node.querySelector('form'),error:node.querySelector('[role=alert]'),threads:[],choice:null,reply:null,mentions:new Set(),request:crypto.randomUUID(),key:`comment-draft:${state.user.id}:${project}:${kind}:${id}`};
    ctx = c;
    for (const member of data.members) c.form.elements.mention.add(new Option(member.email, member.user_id));
    try { const saved = JSON.parse((globalThis.MethodAtlasStorage?.session || sessionStorage).getItem(c.key)); if(saved){c.form.elements.text.value=saved.text || '';c.choice=saved.choice;c.reply=saved.reply;c.mentions=new Set(saved.mentions || []);c.request=saved.request || c.request;} } catch {}
    if(source){c.choice=source;c.reply=null;c.request=crypto.randomUUID();}
    target(c); signal();
    node.querySelector('[data-comment-close]').onclick = close;
    node.querySelector('[data-comment-refresh]').onclick = () => refresh(c);
    node.querySelector('[data-comment-clear]').onclick = () => { c.choice=null;c.reply=null;c.request=crypto.randomUUID();target(c);remember(c); };
    node.querySelector('[data-comment-mention]').onclick = () => {
      const member = data.members.find(m => m.user_id === c.form.elements.mention.value);
      if (!member) return;
      c.form.elements.text.value += ` @${member.email} `; c.mentions.add(member.user_id); c.request=crypto.randomUUID(); remember(c); c.form.elements.text.focus();
    };
    c.form.elements.text.oninput = () => {c.request=crypto.randomUUID();remember(c);};
    c.form.onsubmit = async event => {
      event.preventDefault(); const button=c.form.querySelector('[type=submit]');button.disabled=true;c.error.textContent='';
      try {
        let source = c.choice;
        if (!c.reply && !source) source = c.kind==='artifact' && artifact?.kind === 'manuscript' ? await window.MethodAtlasWriting.commentSource() : {version_id:c.view};
        if (ctx !== c) return;
        const mentions = [...c.mentions].filter(id => c.form.elements.text.value.includes('@' + data.members.find(m => m.user_id === id)?.email));
        const body = {request_id:c.request,text:c.form.elements.text.value,mentions,...(c.reply ? {} : source)};
        await post(c.base + (c.reply ? `/${c.reply}/reply` : ''), body);
        if (ctx !== c) return;
        c.form.elements.text.value='';c.choice=null;c.reply=null;c.mentions.clear();c.request=crypto.randomUUID();remember(c);target(c);await refresh(c);
      } catch(e) {if(ctx===c)c.error.textContent=e.message;}
      finally {button.disabled=false;}
    };
    node.addEventListener('click', async event => {
      const button = event.target.closest('[data-comment-reply],[data-comment-resolve],[data-comment-locate],[data-comment-original]');
      if (!button) return;
      const thread = c.threads.find(t => t.id === Object.values(button.dataset)[0]);
      if (!thread) return;
      c.error.textContent='';
      try {
        if (button.dataset.commentReply) {c.reply=thread.id;c.choice=null;c.request=crypto.randomUUID();target(c);remember(c);c.form.elements.text.focus();}
        if (button.dataset.commentResolve) {button.disabled=true;await post(`${c.base}/${thread.id}/${thread.resolved?'reopen':'resolve'}`, {request_id:crypto.randomUUID(),revision:thread.revision});await refresh(c);}
        if (button.dataset.commentLocate) {
          if(c.kind==='paper')window.MethodAtlasReader.locateComment(thread.location);
          else if (thread.location.selection) window.MethodAtlasWriting.locateComment(thread.location.selection, thread.quote, c.loadedVersion);
          else document.getElementById('html-preview')?.contentWindow.postMessage({type:'methodatlas-comment-locate',nonce:document.getElementById('html-preview').dataset.commentNonce,locator:thread.location.locator}, '*');
        }
        if (button.dataset.commentOriginal) {if(c.kind==='paper')await loadPaper(c.artifact,thread.location.page || 1,thread.version_id,thread.location.fragments?.[0] || thread.location);else await loadArtifact(c.artifact, thread.version_id);}
      } catch(e) {if(ctx===c)c.error.textContent=e.message;}
      finally {button.disabled=false;}
    });
    timer=setInterval(()=>{if(ctx===c&&c.node.isConnected)void refresh(c);else close();},5000);
    await refresh(c);
  }
  function selected(project, id, source) {
    if (!active(project,id)) return;
    ctx.choice=source;ctx.reply=null;ctx.request=crypto.randomUUID();target(ctx);remember(ctx);ctx.form.elements.text.focus();
  }
  // Executed only inside the opaque-origin report iframe; all actions return to
  // the host, which checks source window, nonce, selected artifact and version.
  function previewBridge(nonce) {
    function select() {
      const selection=window.getSelection(); if(!selection?.rangeCount||selection.isCollapsed)return;
      const range=selection.getRangeAt(0);let block=range.commonAncestorContainer;
      if(block.nodeType!==1)block=block.parentElement;
      if(!document.body.contains(block)||block.closest('script,style,template'))return;
      const text=block.textContent;if(!text||text.length>40000)return;
      const before=range.cloneRange();before.selectNodeContents(block);before.setEnd(range.startContainer,range.startOffset);
      const start=before.toString().length,quote=range.toString(),end=start+quote.length;
      if(!quote.trim()||quote.length>10000||text.slice(start,end)!==quote)return;
      const path=[];let node=block;while(node!==document.body){path.unshift([...node.parentNode.childNodes].indexOf(node));node=node.parentNode;}
      parent.postMessage({type:'methodatlas-comment-selection',nonce,anchor:{kind:'preview',quote,locator:{start,end,text,path}}},'*');
    }
    document.addEventListener('mouseup',select);document.addEventListener('keyup',event=>{if(event.key.startsWith('Arrow'))select();});
    window.addEventListener('message',event=>{
      if(event.source!==parent||event.data?.nonce!==nonce||event.data.type!=='methodatlas-comment-locate')return;
      const loc=event.data.locator;let block=document.body;for(const index of loc.path)block=block?.childNodes[index];
      if(!block||block.textContent!==loc.text){parent.postMessage({type:'methodatlas-comment-missing',nonce},'*');return;}
      const walk=document.createTreeWalker(block,NodeFilter.SHOW_TEXT),range=document.createRange();let n,offset=0,started=false,ended=false;
      while(n=walk.nextNode()){const length=n.textContent.length;if(!started&&loc.start<=offset+length){range.setStart(n,loc.start-offset);started=true;}if(started&&loc.end<=offset+length){range.setEnd(n,loc.end-offset);ended=true;break;}offset+=length;}
      if(!ended)return;const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);block.scrollIntoView({block:'center'});
    });
  }
  function installPreview(doc, nonce) {
    if (!state?.collaboration) return;
    const frame=document.getElementById('html-preview');if(!frame)return;
    const token=crypto.randomUUID();frame.dataset.commentNonce=token;
    frame.dataset.commentProject=current.id;frame.dataset.commentArtifact=artifact.id;frame.dataset.commentVersion=versionId;
    const script=doc.createElement('script');script.setAttribute('nonce',nonce);script.textContent=`(${previewBridge.toString()})(${JSON.stringify(token)});`;doc.head.append(script);
  }
  document.addEventListener('click',event=>{if(event.target.closest('[data-comment-toggle]'))void toggle().catch(e=>toast(e.message));});
  window.addEventListener('message',event=>{
    const frame=document.getElementById('html-preview'),data=event.data;
    if(!ctx||!frame||event.source!==frame.contentWindow||event.origin!=='null'||!data||data.nonce!==frame.dataset.commentNonce||frame.dataset.commentProject!==ctx.project||frame.dataset.commentArtifact!==ctx.artifact||frame.dataset.commentVersion!==versionId)return;
    if(data.type==='methodatlas-comment-missing')ctx.error.textContent='原文位置已变化，请查看引用版本与原引文。';
    if(data.type==='methodatlas-comment-selection'&&data.anchor?.kind==='preview')selected(ctx.project,ctx.artifact,{version_id:frame.dataset.commentVersion,anchor:data.anchor});
  });
  async function openNotification(project, artifactId, threadId, notification={}) {
    if(current?.id!==project)return;
    const kind=notification.target_kind==='paper'?'paper':'artifact',id=kind==='paper'?notification.paper_id:artifactId;
    if(kind==='paper')await loadPaper(id,1,notification.version_id);else await loadArtifact(id);
    if(!active(project,id) || ctx.kind!==kind)await toggle(kind);
    if(ctx?.artifact===id)ctx.node.querySelector(`[data-thread="${CSS.escape(threadId)}"]`)?.scrollIntoView({block:'center'});
  }
  return {active,sync,syncPaper,selected,installPreview,openNotification,close,openPaper:source=>toggle('paper',source)};
})();
