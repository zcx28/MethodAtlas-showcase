// Research reports share the project's version store and middle-panel navigation.
(() => {
  const kinds = {daily:'日报', weekly:'周回顾', monthly:'月回顾'};
  const scopes = {discussion:'研究对话', materials:'材料变更', outputs:'研究成果与编辑', notes:'发现、判断与计划'};
  const week = ['周日','周一','周二','周三','周四','周五','周六'];
  let timeline, detail, day, projectId, month, selectedVersion, editing = false, generation = 0, chatContext = null, scroll = 0;
  const endpoint = (suffix = '', project = current.id) => `/api/projects/${project}/progress${suffix}`;
  const post = (suffix, value = {}, project = current.id) => api(endpoint(suffix, project), {method:'POST', body:JSON.stringify(value)});
  const body = (value = '') => value.split(/\n## 原始依据\s*\n/)[0].replace(/ ?\[依据\]\(#activity-[^)]*\)/g, '').trim();
  const latest = () => detail?.versions?.at(-1);
  const version = () => detail?.versions?.find(v => v.id === selectedVersion) || latest();
  const draftKey = () => `progress-draft:${current.id}:${day}`;
  const type = key => key?.endsWith('-w') ? 'weekly' : key?.endsWith('-m') ? 'monthly' : 'daily';
  const dateLabel = key => `${key.slice(0,4)}年${Number(key.slice(5,7))}月${Number(key.slice(8,10))}日`;
  const title = () => selectedVersion && version() ? (version().payload.highlights?.[0] || version().title) : timeline?.days.find(d=>d.day === day)?.title || `${dateLabel(day)} ${kinds[type(day)]}`;
  const aiButton = list => `<button class="diary-ai" data-diary="${list ? 'project-chat' : 'chat'}">${icon('spark')}<span>${list ? '和 AI 聊聊研究进展' : '围绕这篇回顾，问问 AI'}</span>${icon('arrow')}</button>`;

  function sections(content) {
    const groups = [];
    for (const line of body(content).split('\n')) {
      if (/^#\s/.test(line) || !line.trim()) continue;
      const head = line.match(/^#{2,4}\s+(.+)/);
      if (head) groups.push({title:head[1], rows:[]});
      else {
        if (!groups.length) groups.push({title:'概述',rows:[]});
        groups.at(-1).rows.push(line.replace(/^[-*]\s+/, '').trim());
      }
    }
    return groups;
  }

  function timelineHTML() {
    const rows = timeline.days.filter(d=>d.date.startsWith(month));
    return `<div class="diary-top"><label class="diary-month">月份<input type="month" aria-label="选择月份" data-diary-month value="${esc(month)}"></label><button class="diary-schedule" data-diary="settings"><span class="diary-dot ${timeline.settings.enabled ? 'on' : ''}"></span>${timeline.settings.enabled ? '每天 ' + esc(timeline.settings.daily_time) : '已暂停'}</button></div>
      <div class="diary-list-tools"><button data-diary="today">今天</button><button data-diary="generate-week">本周回顾</button><button data-diary="generate-month">本月回顾</button></div>
      <div class="diary-timeline">${rows.map(item=>`<article class="diary-entry ${item.kind} ${day === item.day ? 'selected' : ''}"><div class="diary-date"><strong>${Number(item.date.slice(8))}</strong><span>${week[new Date(item.date+'T00:00:00').getDay()]}</span></div><div class="diary-line" aria-hidden="true"></div><div class="diary-card"><button class="diary-card-content" data-memory-day="${esc(item.day)}" ${day===item.day?'aria-current="true"':''}><h3>${item.unread && timeline.settings.notifications ? '<span class="diary-unread" aria-label="未读"></span>' : ''}${esc(item.title)}</h3><p>${esc(item.error || item.excerpt || (item.status === 'running' ? '正在整理研究记录…' : '尚无实质研究变化'))}</p></button><footer><span>${kinds[item.kind]}${item.kind !== 'daily' ? ' · '+item.date.slice(5)+' – '+item.end.slice(5) : ''}</span><button class="icon" data-diary="menu" data-day="${esc(item.day)}" aria-label="${esc(item.title)}的更多操作">⋮</button></footer></div></article>`).join('') || '<div class="diary-empty">这个月还没有研究回顾。<br>有新的研究活动后，可以生成今日总结。</div>'}</div>
      ${timeline.deleted.length ? `<details class="diary-deleted"><summary>已删除 · ${timeline.deleted.length}</summary>${timeline.deleted.map(d=>`<p>${esc(dateLabel(d.day))} ${kinds[type(d.day)]}<button data-diary="undo" data-day="${esc(d.day)}">撤销删除</button></p>`).join('')}</details>` : ''}${aiButton(true)}`;
  }

  function contentHTML() {
    const v = version(), historical = v && v.id !== latest()?.id;
    let draft;
    try { draft = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch {}
    return `<div class="diary-document"><div class="diary-kicker">${kinds[type(day)]} <span>· ${dateLabel(day)}</span>${historical ? ` · 历史版本 V${v.version_no}` : ''}</div><h1>${esc(title())}</h1>
      ${timeline.days.find(d=>d.day===day)?.needs_update ? '<div class="diary-notice">有新增记录。点击“更新回顾”生成修订提案，原文会保留。</div>' : ''}
      ${detail?.error ? `<p class="answer-text" role="status">${esc(detail.explanation || detail.error)}</p>` : ''}
      ${historical ? '<div class="diary-notice">正在查看历史版本，正文只读。<button data-diary="latest">回到最新版</button><button data-diary="restore">恢复此版本</button></div>' : ''}
      ${editing && v ? `<label class="dialog-field">编辑正文（Markdown）<textarea id="daily-content" data-base="${esc(draft?.base || latest().id)}">${esc(draft?.content ?? body(v.body))}</textarea></label>${draft ? '<p class="dialog-note">已恢复本机未保存的草稿。</p>' : ''}<div class="row"><button class="primary" data-diary="save">保存修改</button><button data-diary="cancel-edit">返回阅读</button></div>` : v ? sections(v.body).map((group,i)=>`<section class="diary-section"><h2><span class="diary-section-number">${String(i+1).padStart(2,'0')}</span>${esc(group.title)}</h2><div>${group.rows.map(row=>`<p>${esc(row)}</p>`).join('')}</div></section>`).join('') : '<div class="diary-empty">这一天还没有总结。<br>AI 会根据项目中实际发生的研究活动整理。</div>'}
      ${!historical ? `<div class="diary-document-actions"><button data-diary="generate">${v ? '更新回顾' : '生成回顾'}</button><button data-diary="record">补充研究记录</button></div>` : ''}
      ${detail?.proposal && !detail.proposal.decision ? `<section class="diary-proposal"><h2>AI 修订提案</h2><p>接受后保存为新版本。</p><details><summary>查看修改前后</summary><h3>修改前</h3><pre>${esc(body(detail.versions.find(v=>v.id===detail.proposal.base_version_id)?.body))}</pre><h3>修改后</h3><pre>${esc(body(detail.proposal.content))}</pre></details><div class="row"><button class="primary" data-diary="accept">接受修改</button><button data-diary="reject">撤销提案</button></div></section>` : ''}
      <p class="dialog-status" id="diary-status" role="status"></p></div>${aiButton(false)}`;
  }

  function paint(showContent = true) {
    if (!timeline || current?.id !== projectId) return;
    if (shellView === 'progress') shellPaint({titles:['研究日报'],badges:[String(timeline.days.filter(d=>d.status==='ready').length)],bodies:[timelineHTML()]});
    if (showContent && middleView === 'progress') {
      paintMiddle('progress','研究回顾',contentHTML(),`<button class="icon" data-diary="history" aria-label="历史版本">${icon('history')}</button><button class="icon" data-diary="menu" aria-label="更多操作">⋮</button>`);
      document.getElementById('chat-body').classList.add('diary-middle');
    }
  }

  async function select(target, preserveScroll = false) {
    const request = ++generation, project = current.id;
    if (!preserveScroll) scroll = 0;
    editing = false; selectedVersion = null;
    const middle = openMiddle('progress', '研究回顾', target);
    paintMiddle('progress','研究回顾','<p role="status">正在读取…</p>');
    const exists = timeline.days.some(d=>d.day === target);
    const loaded = exists ? await api(endpoint('/'+target, project)) : {versions:[],status:'empty'};
    if (request !== generation || current?.id !== project || middle !== middleRequest) return;
    day = target; detail = loaded; month = target.slice(0,7);
    if (latest()) {
      await post('/'+day+'/read',{version_id:latest().id},project);
      if(request !== generation || current?.id !== project || middle !== middleRequest)return;
      const item = timeline.days.find(d=>d.day===day); if(item) item.unread=false;
    }
    paint(); document.getElementById('chat-body').scrollTop = scroll;
  }

  async function activate(target) {
    const project = current.id, request = ++generation;
    if (projectId !== project) {day = null; month = null; chatContext = null;}
    projectId = project;
    try {
      const result = await api(endpoint('',project));
      if (current?.id !== project || request !== generation) return;
      timeline = result; month ||= result.today.slice(0,7);
      await select(target || day || result.days.find(d=>d.status==='ready')?.day || result.today);
    } catch (error) {toast(error.message);}
  }

  let dialog;
  function modal(title, html) {
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'diary-dialog'; dialog.setAttribute('aria-labelledby','diary-dialog-title');
      document.body.append(dialog);
      dialog.addEventListener('click',event=>{if(event.target === dialog) dialog.close();});
    }
    dialog.innerHTML = `<header><h2 id="diary-dialog-title">${esc(title)}</h2><button class="icon" data-diary="close" aria-label="关闭">${icon('close')}</button></header>${html}<p class="dialog-status" data-diary-dialog-status role="status"></p>`;
    if (!dialog.open) dialog.showModal();
  }

  function settingsHTML() {
    const s = timeline.settings;
    modal('任务设置',`<form id="diary-settings"><p class="diary-setting-label">整理时间 · 北京时间</p><div class="diary-setting-group">
      <label class="diary-setting-row"><span><strong>日报</strong><small>简短记录当天的研究进展</small></span><input type="time" name="daily_time" value="${s.daily_time}" required></label>
      <div class="diary-setting-row"><label><input type="checkbox" name="weekly_enabled" ${s.weekly_enabled?'checked':''}> 周回顾</label><div class="row"><select name="weekly_day" aria-label="周回顾生成日">${['周一','周二','周三','周四','周五','周六','周日'].map((v,i)=>`<option value="${i}" ${i===s.weekly_day?'selected':''}>${v}</option>`).join('')}</select><input type="time" aria-label="周回顾时间" name="weekly_time" value="${s.weekly_time}" required></div></div>
      <div class="diary-setting-row"><label><input type="checkbox" name="monthly_enabled" ${s.monthly_enabled?'checked':''}> 月回顾</label><div class="row"><select name="monthly_day" aria-label="月回顾生成日">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${i+1===s.monthly_day?'selected':''}>${i+1}号</option>`).join('')}</select><input type="time" aria-label="月回顾时间" name="monthly_time" value="${s.monthly_time}" required></div></div></div>
      <p class="dialog-note">周回顾总结上周，月回顾总结上月。电脑休眠或后台关闭期间不运行，恢复后补齐。</p><p class="diary-setting-label">收录与通知</p><div class="diary-setting-group"><button type="button" class="diary-setting-row" data-diary="scope"><span><strong>收录范围</strong><small>选择进入研究回顾的内容</small></span><span>${s.scope.length===4?'全部':s.scope.length+' 类'} ›</span></button><label class="diary-setting-row"><span><strong>通知提醒</strong><small>生成后显示未读提示</small></span><input type="checkbox" name="notifications" ${s.notifications?'checked':''}></label></div>
      <button type="button" data-diary="notify">开启浏览器系统通知</button><div class="diary-setting-row"><label><input type="checkbox" name="enabled" ${s.enabled?'checked':''}> 开启自动整理任务</label></div><button class="primary diary-wide" type="submit">保存设置</button></form>`);
  }

  let settingsDraft;
  function readSettings(form) {
    const f = new FormData(form);
    return {daily_time:f.get('daily_time'),weekly_time:f.get('weekly_time'),monthly_time:f.get('monthly_time'),weekly_day:Number(f.get('weekly_day')),monthly_day:Number(f.get('monthly_day')),enabled:f.has('enabled'),weekly_enabled:f.has('weekly_enabled'),monthly_enabled:f.has('monthly_enabled'),notifications:f.has('notifications')};
  }
  function scopeHTML() {
    settingsDraft = readSettings(document.getElementById('diary-settings'));
    modal('选择研究回顾收录范围',`<form id="diary-scope"><div class="diary-scope-grid">${Object.entries(scopes).map(([key,label])=>`<label><input type="checkbox" name="scope" value="${key}" ${timeline.settings.scope.includes(key)?'checked':''}><span>${esc(label)}</span></label>`).join('')}</div><div class="row"><button type="button" data-diary="scope-reset">重置</button><button class="primary" type="submit">完成</button></div></form>`);
  }
  function menuHTML() {
    const saved = !!version();
    modal('更多',`<div class="diary-menu-grid">${[['edit','编辑'],['share','分享'],['note','保存为笔记'],['copy','复制']].map(([key,label])=>`<button data-diary="${key}" ${!saved?'disabled':''}>${label}</button>`).join('')}</div><div class="diary-setting-group">${[['pdf','导出为 PDF'],['markdown','导出为 Markdown'],['history','历史版本'],['settings','任务设置'],['delete','删除']].map(([key,label])=>`<button class="diary-setting-row ${key==='delete'?'danger':''}" data-diary="${key}" ${!saved && !['settings','delete'].includes(key)?'disabled':''}>${label}<span>›</span></button>`).join('')}</div>`);
  }
  function historyHTML() {
    let date;
    modal('历史版本',`<div class="version-list">${[...(detail?.versions || [])].reverse().map(v=>{
      const label = versionDay(v.created), heading = label !== date ? `<p class="version-day">${esc(label)}</p>` : ''; date=label;
      return `${heading}<div class="version-row" ${v.id===version()?.id?'data-current="true"':''}><span class="version-node"></span><div class="version-row-body"><p class="version-row-head"><button class="version-no" data-diary="view-version" data-version="${v.id}">V${v.version_no}</button><code class="version-hash">${esc((v.payload.sha256 || '').slice(0,7))}</code></p><p class="version-row-meta">${new Date(v.created).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · ${v.payload.author==='human'?'我':esc(v.payload.author==='generated'?'AI':v.payload.author)}</p><div class="version-row-actions"><button data-diary="view-version" data-version="${v.id}">查看</button>${v.id!==latest().id?`<button data-diary="restore" data-version="${v.id}">恢复</button>`:'<span>最新版</span>'}</div></div></div>`;
    }).join('') || '<p>还没有保存的版本。</p>'}</div>`);
  }
  async function refresh() {
    const project = current.id, request = generation;
    const loaded = await api(endpoint('',project));
    if(current?.id!==project || request!==generation)return;
    timeline=loaded; await select(day,true);
  }
  function download(raw, name, mime) {
    const href = URL.createObjectURL(new Blob([raw],{type:mime})), link = document.createElement('a');
    link.href=href; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  async function exportFile(format) {
    const response = await fetch(endpoint(`/${day}/export?format=${format}&version=${version().id}`));
    if(!response.ok)throw new Error((await response.json()).error || '导出失败');
    download(await response.blob(),`${day}.${format==='pdf'?'pdf':'md'}`,format==='pdf'?'application/pdf':'text/markdown');
  }
  async function openChat(projectWide = false) {
    const project = current.id, reportDay = day, reportVersion = version(), reportArtifact = detail?.artifact_id, request = generation, middle = middleRequest;
    scroll = document.getElementById('chat-body')?.scrollTop || 0;
    let cid;
    if (!projectWide && reportVersion) cid=(await post('/'+reportDay+'/chat',{},project)).conversation_id;
    else {
      const key=`progress-chat:${project}`, saved=localStorage.getItem(key);
      cid=current.conversations.find(c=>c.id===saved)?.id;
      if(!cid) {cid=(await newConversation(true)).id;localStorage.setItem(key,cid);}
    }
    const loaded=await api(`/api/projects/${project}`);
    if(current?.id!==project || request!==generation || middle!==middleRequest)return;
    current=loaded; conversation=current.conversations.find(c=>c.id===cid);
    chatContext={project,day:projectWide?null:reportDay,returnDay:reportDay,returnVersion:reportVersion?.id,conversation:cid,reference:!projectWide && reportVersion?{artifact_id:reportArtifact,version_id:reportVersion.id}:null};
    localStorage.setItem(`progress-context:${cid}`,JSON.stringify(chatContext));
    loadQueue(); openMiddle('chat'); chatHeader();
    document.getElementById('chat-input')?.focus();
  }
  function context() {
    if(!current || !conversation)return null;
    if(chatContext?.conversation!==conversation.id) {
      try{chatContext=JSON.parse(localStorage.getItem(`progress-context:${conversation.id}`)||'null');}catch{chatContext=null;}
    }
    return chatContext?.project===current.id?chatContext:null;
  }
  function chatHeader() {
    const c=context();
    if(!c || middleView!=='chat')return;
    const tools=document.getElementById('chat-tools');
    if(tools) tools.innerHTML=`<button data-diary="return">返回${c.day?kinds[type(c.day)]:'研究日报'}</button>${c.reference?'<label class="diary-chat-mode"><input id="diary-revise-next" type="checkbox">将下一条消息用于修订</label>':''}`;
  }
  let revising = false;
  async function revise(instruction) {
    const c=context();
    if(!c?.day || !document.getElementById('diary-revise-next')?.checked)return false;
    if(revising)throw new Error('正在生成修订提案，请稍候。');
    const input=document.getElementById('chat-input'), button=document.querySelector('#chat-form button[type=submit]');
    revising=true;if(button)button.disabled=true;
    toast('正在生成修订提案，原文保持不变。');
    try {
      const result=await post('/'+c.day+'/generate',{instruction,base_version_id:c.reference.version_id,conversation_id:c.conversation,chat_options:window.MethodAtlasSettings?.options()},c.project);
      if(result.error)throw new Error(result.explanation || result.error);
      if(!result.proposal_id)throw new Error(result.status==='running'?'这篇回顾正在整理，请稍后重试；修订要求已保留。':'没有生成新的修订提案，修订要求已保留。');
      const key=`draft:${c.conversation}`;
      if(localStorage.getItem(key)===instruction)localStorage.removeItem(key);
      if(current?.id===c.project && conversation?.id===c.conversation && middleView==='chat') {
        if(input?.value===instruction)input.value='';
        toast('修订提案已生成，请查看并接受。');
        await activate(c.day);
      }
    } finally {revising=false;if(button?.isConnected)button.disabled=false;}

    return true;
  }

  document.addEventListener('click',async event=>{
    const node=event.target.closest('[data-diary],[data-memory-day],[data-progress-open]');
    if(!node || !current)return;
    event.preventDefault();
    if(node.hasAttribute('data-progress-open')){switchShellView('progress');return;}
    node.disabled=true;
    const action=node.dataset.diary, actionProject=current.id, actionGeneration=generation;
    try {
      if(node.dataset.memoryDay){await select(node.dataset.memoryDay);return;}
      if(action==='close'){dialog.close();return;}
      if(action==='menu'){if(node.dataset.day && node.dataset.day!==day)await select(node.dataset.day);menuHTML();return;}
      if(action==='settings'){settingsHTML();return;}
      if(action==='scope'){scopeHTML();return;}
      if(action==='scope-reset'){dialog.querySelectorAll('[name=scope]').forEach(n=>n.checked=true);return;}
      if(action==='notify') {if(!('Notification' in window))throw new Error('当前浏览器不支持系统通知，站内提醒仍可用');const permission=await Notification.requestPermission();toast(permission==='granted'?'系统通知已开启':'未获得系统通知权限，仍保留站内提醒');return;}
      if(action==='history'){historyHTML();return;}
      if(action==='today'){await select(timeline.today);return;}
      if(action==='chat' || action==='project-chat'){await openChat(action==='project-chat');return;}
      if(action==='return'){const c=context(), returnScroll=scroll;if(shellView!=='progress')switchShellView('progress');await activate(c?.returnDay);selectedVersion=c?.returnVersion;paint();document.getElementById('chat-body').scrollTop=returnScroll;return;}
      if(action==='view-version'){selectedVersion=node.dataset.version;editing=false;dialog.close();paint();return;}
      if(action==='latest'){selectedVersion=null;paint();return;}
      if(action==='edit'){selectedVersion=null;editing=true;dialog.close();paint();document.getElementById('daily-content').focus();return;}
      if(action==='cancel-edit'){editing=false;paint();return;}
      if(action==='copy'){await navigator.clipboard.writeText(body(version().body));toast('已复制正文');return;}
      if(action==='share') {
        const file=new File([body(version().body)],`${day}.md`,{type:'text/markdown'});
        if(navigator.canShare?.({files:[file]})) await navigator.share({files:[file],title:title()});
        else {download(file,file.name,file.type);toast('已下载回顾文件，可直接转发。');}
        return;
      }
      if(action==='pdf' || action==='markdown'){await exportFile(action);return;}
      if(action==='note') {
        const project=current.id, v=version();
        const document=body(v.body).split(/\n+/).filter(l=>l.trim()).map((line,index)=>{const h=line.match(/^(#{1,3})\s+(.*)/);return {id:`${v.id}:${index}`,type:h?'h'+h[1].length:'p',children:[{text:h?h[2]:line}]};});
        const saved=await api(`/api/projects/${project}/documents`,{method:'POST',body:JSON.stringify({request_id:`progress-note:${v.id}`,title:(body(v.body).match(/^#\s+(.+)/)?.[1] || v.title).slice(0,300),document})});
        if(current?.id===project){const loaded=await api(`/api/projects/${project}`);if(current?.id!==project)return;current=loaded;dialog.close();await loadArtifact(saved.artifact_id);toast('已保存到编辑器，可独立修改。');}return;
      }
      if(action==='record') {modal('补充研究记录',`<form id="diary-record"><label class="dialog-field">类型<select name="kind"><option value="idea">研究想法</option><option value="decision">重要判断</option><option value="question">待解决问题</option></select></label><label class="dialog-field">内容<textarea name="text" required maxlength="10000" rows="5"></textarea></label><button class="primary">保存记录</button></form>`);return;}
      if(action==='delete') {modal('删除这篇回顾？','<p>删除后停止自动重新生成。可以从左栏“已删除”中撤销，历史版本保留。</p><button class="danger diary-wide" data-diary="confirm-delete">删除回顾</button>');return;}
      if(action==='confirm-delete' || action==='undo') {
        await post('/'+(node.dataset.day || day)+'/'+(action==='undo'?'undo':'delete'));dialog?.close();timeline=await api(endpoint());
        await select(action==='undo'?node.dataset.day:timeline.days[0]?.day || timeline.today);return;
      }
      if(action==='save') {
        const input=document.getElementById('daily-content'), key=draftKey(), content=input.value, savedDay=day;
        await post('/'+savedDay+'/save',{content,base_version_id:input.dataset.base,restore_file:true},actionProject);
        if(JSON.parse(localStorage.getItem(key)||'null')?.content===content)localStorage.removeItem(key);
        if(current?.id!==actionProject || generation!==actionGeneration)return;
        editing=false;
      }
      if(action==='restore') {await post('/'+day+'/save',{restore_version:node.dataset.version || version().id,base_version_id:latest().id,restore_file:true});selectedVersion=null;dialog?.close();}
      if(action==='accept' || action==='reject')await post('/'+day+'/decide',{proposal_id:detail.proposal.id,action});
      if(action==='generate-week' || action==='generate-month') {
        const d=new Date(timeline.today+'T12:00:00');
        if(action==='generate-week')d.setDate(d.getDate()-((d.getDay()+6)%7));else d.setDate(1);
        const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${action==='generate-week'?'w':'m'}`;
        await select(key);
      }
      if(['generate','generate-week','generate-month'].includes(action)) {
        document.getElementById('diary-status').textContent='正在整理真实研究活动…';
        const result=await post('/'+day+'/generate');if(result.error)throw new Error(result.explanation || result.error);
      }
      if(current?.id===actionProject && (generation===actionGeneration || ['generate-week','generate-month'].includes(action)))await refresh();
    } catch(error) {if(error.name!=='AbortError'){const status=dialog?.open?dialog.querySelector('[data-diary-dialog-status]'):document.getElementById('diary-status');if(status)status.textContent=error.message;else toast(error.message);}}
    finally {node.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['diary-settings','diary-scope','diary-record'].includes(form.id))return;
    event.preventDefault();const button=form.querySelector('[type=submit],button.primary');button.disabled=true;
    try {
      if(form.id==='diary-settings') {timeline.settings=await post('/settings',readSettings(form));dialog.close();paint(false);}
      if(form.id==='diary-scope') {const scope=new FormData(form).getAll('scope');timeline.settings=await post('/settings',{...settingsDraft,scope});settingsHTML();paint(false);}
      if(form.id==='diary-record') {const f=new FormData(form);await post('/events',{request_id:crypto.randomUUID(),kind:f.get('kind'),text:f.get('text')});dialog.close();toast('记录已保存，更新回顾后可纳入正文。');}
    } catch(error){dialog.querySelector('[data-diary-dialog-status]').textContent=error.message;}finally{button.disabled=false;}
  });
  document.addEventListener('input',event=>{if(event.target.id==='daily-content')localStorage.setItem(draftKey(),JSON.stringify({base:event.target.dataset.base,content:event.target.value}));});
  document.addEventListener('change',event=>{if(event.target.hasAttribute('data-diary-month')){month=event.target.value;paint(false);}});
  document.addEventListener('open-project-memory',event=>{if(current){if(shellView!=='progress')switchShellView('progress');activate(event.detail?.day);}});
  // Only notify about new versions, never repeat old reminders on each poll.
  let polling=false;
  setInterval(async()=>{
    if(!current || polling)return;polling=true;
    const project=current.id;
    try {
      const loaded=await api(endpoint('',project));if(current?.id!==project)return;
      const unread=loaded.days.filter(d=>d.unread && d.version_id && loaded.settings.notifications && !localStorage.getItem(`progress-notified:${project}:${d.version_id}`));
      if(unread.length) {
        for(const item of unread)localStorage.setItem(`progress-notified:${project}:${item.version_id}`,'1');
        const message=unread.length===1?`${kinds[unread[0].kind]}待查看：${unread[0].title}`:`有 ${unread.length} 篇研究回顾待查看`;
        toast(message);
        if('Notification' in window && Notification.permission==='granted')new Notification('研究回顾',{body:message,tag:`progress:${project}`});
      }
      if(project===projectId){timeline=loaded;paint(false);}
    }catch{}finally{polling=false;}
  },30000);
  window.MethodAtlasProgress={activate,paint,open:activate,context,chatHeader,revise,settings:async()=>{await activate();settingsHTML();}};
})();
