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
  const version = () => selectedVersion ? detail?.versions?.find(v => v.id === selectedVersion) : latest();
  const draftKey = () => `progress-draft:${state?.collaboration ? state.user.id + ':' : ''}${current.id}:${day}`;
  function storeDraft(key, draft) {
    try {if(draft)(globalThis.MethodAtlasStorage?.local || localStorage).setItem(key,JSON.stringify(draft));else (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(key);}
    catch {const status=document.getElementById('diary-status');if(status)status.textContent='浏览器无法保存草稿；离开或刷新前，请点击“保存修改”或复制正文。';}
  }
  const type = key => key?.endsWith('-w') ? 'weekly' : key?.endsWith('-m') ? 'monthly' : 'daily';
  const dateLabel = key => `${key.slice(0,4)}年${Number(key.slice(5,7))}月${Number(key.slice(8,10))}日`;
  const title = () => selectedVersion && version() ? (version().payload.highlights?.[0] || version().title) : timeline?.days.find(d=>d.day === day)?.title || `${dateLabel(day)} ${kinds[type(day)]}`;
  const aiButton = () => `<button class="diary-ai" data-diary="chat" ${version() && detail?.artifact_id ? '' : 'disabled title="这篇回顾尚无可引用版本"'}>${icon('chat')}<span>讨论这篇回顾</span>${icon('arrow')}</button>`;

  // Month picker: the native <input type=month> popup can't be styled, so the panel is drawn
  // with the same surface/border/menu language as the app's other dropdowns.
  let monthViewYear = 0;
  const monthPanelHTML = () => {
    const year = monthViewYear, today = timeline.today.slice(0,7);
    return `<div class="diary-month-head"><button type="button" data-diary="month-shift" data-step="-1" aria-label="上一年" ${year<=2000?'disabled':''}>${icon('previous')}</button><strong>${year}年</strong><button type="button" data-diary="month-shift" data-step="1" aria-label="下一年" ${year>=2100?'disabled':''}>${icon('chevron')}</button></div>
      <div class="diary-month-grid">${Array.from({length:12},(_,i)=>{const key=`${year}-${String(i+1).padStart(2,'0')}`,has=timeline.days.some(d=>d.date.startsWith(key));return `<button type="button" data-diary="month-pick" data-month="${key}" ${key===month?'aria-current="true"':''} ${has?'data-has="true"':''}>${i+1}月</button>`;}).join('')}</div>
      <div class="diary-month-foot"><button type="button" data-diary="month-pick" data-month="${today}">回到本月</button></div>`;
  };

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
    monthViewYear = Number(month.slice(0,4));
    return `<div class="diary-top"><details class="diary-month-picker"><summary aria-label="选择月份">${month.slice(0,4)}年${Number(month.slice(5,7))}月${icon('chevron')}</summary><div class="select-options diary-month-panel">${monthPanelHTML()}</div></details><button class="diary-schedule" data-diary="settings"><span class="diary-dot ${timeline.settings.enabled ? 'on' : ''}"></span>${timeline.settings.enabled && timeline.settings.automatic_authorized === false ? '待负责人授权' : timeline.settings.enabled ? '每天 ' + esc(timeline.settings.daily_time) : '已暂停'}</button></div>
      <div class="diary-list-tools"><button data-diary="today">今天</button><button data-diary="generate-week">本周回顾</button><button data-diary="generate-month">本月回顾</button></div>
      <div class="diary-timeline">${rows.map(item=>`<article class="diary-entry ${item.kind} ${day === item.day ? 'selected' : ''}"><div class="diary-date"><strong>${Number(item.date.slice(8))}</strong><span>${week[new Date(item.date+'T00:00:00').getDay()]}</span></div><div class="diary-line" aria-hidden="true"></div><div class="diary-card"><button class="diary-card-content" data-memory-day="${esc(item.day)}" ${day===item.day?'aria-current="true"':''}><h3>${item.unread && timeline.settings.notifications ? '<span class="diary-unread" aria-label="未读"></span>' : ''}${esc(item.title)}</h3><p>${esc(item.error || item.excerpt || (item.status === 'running' ? '正在整理研究记录…' : '尚无实质研究变化'))}</p></button><footer><span>${kinds[item.kind]}${item.kind !== 'daily' ? ' · '+item.date.slice(5)+' – '+item.end.slice(5) : ''}</span><button class="icon" data-diary="menu" data-day="${esc(item.day)}" aria-label="${esc(item.title)}的更多操作">⋮</button></footer></div></article>`).join('') || '<div class="diary-empty">这个月还没有研究回顾。<br>有新的研究活动后，可以生成今日总结。</div>'}</div>
      ${timeline.deleted.length ? `<details class="diary-deleted"><summary>已删除 · ${timeline.deleted.length}</summary>${timeline.deleted.map(d=>`<p>${esc(dateLabel(d.day))} ${kinds[type(d.day)]}<button data-diary="undo" data-day="${esc(d.day)}">撤销删除</button></p>`).join('')}</details>` : ''}`;
  }

  function contentHTML() {
    const v = version(), historical = v && v.id !== latest()?.id;
    let draft;
    try { draft = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(draftKey()) || 'null'); } catch {}
    return `<div class="diary-document"><div class="diary-kicker">${kinds[type(day)]} <span>· ${dateLabel(day)}</span>${historical ? ` · 历史版本 V${v.version_no}` : ''}</div><h1>${esc(title())}</h1>
      ${v?.payload?.timezone ? `<p class="dialog-note">研究日时区：${esc(v.payload.timezone)}${v.payload.as_of ? ` · 统计截止：${esc(new Date(v.payload.as_of).toLocaleString('zh-CN',{timeZone:v.payload.timezone}))}` : ''}</p>` : ''}
      <div class="diary-notice" id="diary-shared-update" hidden></div>${timeline.days.find(d=>d.day===day)?.needs_update ? '<div class="diary-notice">有新增记录。点击“更新回顾”生成修订提案，原文会保留。</div>' : ''}
      ${detail?.error ? `<p class="answer-text" role="status">${esc(detail.explanation || detail.error)}</p>` : ''}
      ${historical ? '<div class="diary-notice">正在查看历史版本，正文只读。<button data-diary="latest">回到最新版</button><button data-diary="restore">恢复此版本</button></div>' : ''}
      ${editing && v ? `<label class="dialog-field">编辑正文（Markdown）<textarea id="daily-content" data-base="${esc(draft?.base || latest().id)}">${esc(draft?.content ?? body(v.body))}</textarea></label>${draft ? '<p class="dialog-note">已恢复本机未保存的草稿。</p>' : ''}<div class="row"><button class="primary" data-diary="save">保存修改</button><button data-diary="cancel-edit">返回阅读</button></div>` : v ? sections(v.body).map((group,i)=>`<section class="diary-section"><h2><span class="diary-section-number">${String(i+1).padStart(2,'0')}</span>${esc(group.title)}</h2><div>${group.rows.map(row=>`<p>${esc(row)}</p>`).join('')}</div></section>`).join('') : '<div class="diary-empty">这一天还没有总结。<br>AI 会根据项目中实际发生的研究活动整理。</div>'}
      ${!historical ? `<div class="diary-document-actions"><button data-diary="generate">${v ? '更新回顾' : '生成回顾'}</button><button data-diary="record">补充研究记录</button></div>` : ''}
      ${detail?.proposal && !detail.proposal.decision ? `<section class="diary-proposal"><h2>AI 修订提案</h2><p>接受后保存为新版本。</p><details><summary>查看修改前后</summary><h3>修改前</h3><pre>${esc(body(detail.versions.find(v=>v.id===detail.proposal.base_version_id)?.body))}</pre><h3>修改后</h3><pre>${esc(body(detail.proposal.content))}</pre></details><div class="row"><button class="primary" data-diary="accept">接受修改</button><button data-diary="reject">撤销提案</button></div></section>` : ''}
      ${selectedVersion && !v ? '<p class="diary-notice" role="status">所选版本已不可用。<button data-diary="latest">回到最新版</button></p>' : ''}${aiButton()}<p class="dialog-status" id="diary-status" role="status"></p></div>`;
  }

  function paint(showContent = true) {
    if (!timeline || current?.id !== projectId) return;
    if (shellView === 'progress') shellPaint({titles:['研究日报'],badges:[String(timeline.days.filter(d=>d.status==='ready').length)],bodies:[timelineHTML()]});
    if (showContent && middleView === 'progress') {
      paintMiddle('progress','研究回顾',contentHTML(),`${version() ? window.MethodAtlasCollaboration?.relatedButton('artifact',detail.artifact_id,version().id) || '' : ''}<button class="icon" data-diary="history" aria-label="历史版本">${icon('history')}</button><button class="icon" data-diary="menu" aria-label="更多操作">⋮</button>`);
      document.getElementById('chat-body').classList.add('diary-middle');
    }
  }

  async function select(target, preserveScroll = false, focus = true, requestedVersion = null) {
    const request = ++generation, project = current.id;
    if (!preserveScroll) scroll = 0;
    editing = false; selectedVersion = null;
    const middle = openMiddle('progress', '研究回顾', target, focus);
    paintMiddle('progress','研究回顾','<p role="status">正在读取…</p>');
    const exists = timeline.days.some(d=>d.day === target);
    const loaded = exists ? await api(endpoint('/'+target, project)) : {versions:[],status:'empty'};
    if (request !== generation || current?.id !== project || middle !== middleRequest) return;
    if (requestedVersion && !loaded.versions.some(v => v.id === requestedVersion)) {
      paintMiddle('progress','研究回顾','<p role="alert">关联的回顾版本不可访问。</p>');
      return;
    }
    day = target; detail = loaded; month = target.slice(0,7);
    selectedVersion = requestedVersion;
    if (latest()) {
      await post('/'+day+'/read',{version_id:version().id},project);
      if(request !== generation || current?.id !== project || middle !== middleRequest)return;
      const item = timeline.days.find(d=>d.day===day); if(item && version().id === latest().id) item.unread=false;
    }
    paint(); document.getElementById('chat-body').scrollTop = scroll;
    return true;
  }

  async function activate(target, requestedVersion = null, listOnly = false) {
    if (typeof requestedVersion === 'boolean') { listOnly = requestedVersion; requestedVersion = null; }
    const project = current.id, request = ++generation;
    if (projectId !== project) {day = null; month = null; chatContext = null;}
    projectId = project;
    try {
      const result = await api(endpoint('',project));
      if (current?.id !== project || request !== generation) return;
      timeline = result; month ||= result.today.slice(0,7);
      if (listOnly) { paint(false); return; }
      if (shellView !== 'progress' || previewingShell) return;
      await select(target || day || result.days.find(d=>d.status==='ready')?.day || result.today, false, !!target, requestedVersion);
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
    modal('任务设置',`<form id="diary-settings"><p class="diary-setting-label">按项目时区整理</p><label>项目时区<input name="timezone" aria-label="项目时区" list="diary-timezones" value="${esc(s.timezone || 'Asia/Shanghai')}" required maxlength="100"></label><datalist id="diary-timezones">${['Asia/Shanghai','Asia/Hong_Kong','Asia/Tokyo','Asia/Singapore','Europe/London','Europe/Berlin','America/New_York','America/Los_Angeles','UTC'].map(zone=>`<option value="${zone}"></option>`).join('')}</datalist><div class="diary-setting-group">
      <label class="diary-setting-row"><span><strong>日报</strong><small>简短记录当天的研究进展</small></span><input type="time" aria-label="日报时间" name="daily_time" value="${s.daily_time}" required></label>
      <div class="diary-setting-row"><label><input type="checkbox" name="weekly_enabled" ${s.weekly_enabled?'checked':''}> 周回顾</label><div class="row"><select name="weekly_day" aria-label="周回顾生成日">${['周一','周二','周三','周四','周五','周六','周日'].map((v,i)=>`<option value="${i}" ${i===s.weekly_day?'selected':''}>${v}</option>`).join('')}</select><input type="time" aria-label="周回顾时间" name="weekly_time" value="${s.weekly_time}" required></div></div>
      <div class="diary-setting-row"><label><input type="checkbox" name="monthly_enabled" ${s.monthly_enabled?'checked':''}> 月回顾</label><div class="row"><select name="monthly_day" aria-label="月回顾生成日">${Array.from({length:28},(_,i)=>`<option value="${i+1}" ${i+1===s.monthly_day?'selected':''}>${i+1}号</option>`).join('')}</select><input type="time" aria-label="月回顾时间" name="monthly_time" value="${s.monthly_time}" required></div></div></div>
      <p class="dialog-note">周回顾总结上周，月回顾总结上月。在线项目由服务器持续整理，关闭网页不影响执行。自动整理需项目负责人保存设置授权；暂停后不再发起新整理。修改时区后按新时区划分研究日，已有人工修订保留。</p><p class="diary-setting-label">收录与通知</p><div class="diary-setting-group"><button type="button" class="diary-setting-row" data-diary="scope"><span><strong>收录范围</strong><small>选择进入研究回顾的内容</small></span><span>${s.scope.length===4?'全部':s.scope.length+' 类'} ›</span></button><label class="diary-setting-row"><span><strong>通知提醒</strong><small>生成后显示未读提示</small></span><input type="checkbox" name="notifications" ${s.notifications?'checked':''}></label></div>
      <button type="button" data-diary="notify">开启浏览器系统通知</button><div class="diary-setting-row"><label><input type="checkbox" name="enabled" ${s.enabled?'checked':''}> 开启自动整理任务</label></div><button class="primary diary-wide" type="submit">保存设置</button></form>`);
    if (state.collaboration && current?.role !== 'owner') {
      const form = document.getElementById('diary-settings');
      form.querySelectorAll('input,select,button:not([data-diary="notify"])').forEach(control => control.disabled = true);
      form.insertAdjacentHTML('afterbegin','<p class="dialog-note">项目负责人可修改自动回顾设置。协作者可以手动生成与修订回顾。</p>');
    }
  }

  let settingsDraft;
  function readSettings(form) {
    const f = new FormData(form);
    return {timezone:f.get('timezone'),daily_time:f.get('daily_time'),weekly_time:f.get('weekly_time'),monthly_time:f.get('monthly_time'),weekly_day:Number(f.get('weekly_day')),monthly_day:Number(f.get('monthly_day')),enabled:f.has('enabled'),weekly_enabled:f.has('weekly_enabled'),monthly_enabled:f.has('monthly_enabled'),notifications:f.has('notifications')};
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
    const versions = [...(detail?.versions || [])].reverse();
    modal('历史版本',`<div class="diary-history"><p class="diary-history-summary">共 ${versions.length} 个已保存版本 · 按时间倒序</p><div class="version-list">${versions.map(v=>{
      const label = versionDay(v.created), heading = label !== date ? `<p class="version-day">${esc(label)}</p>` : ''; date=label;
      const current = v.id===version()?.id, newest = v.id===latest().id;
      const name = v.payload.highlights?.[0] || v.title;
      const author = ({human:v.payload.edited_by===state?.user?.id?'我':'成员编辑',user:v.payload.edited_by===state?.user?.id?'我':'成员编辑',generated:'AI 生成'})[v.payload.author] || v.payload.author || 'AI 生成';
      return `${heading}<article class="version-row" ${current?'data-current="true"':''}><div class="history-version-main"><div class="history-version-heading"><strong>版本 ${v.version_no}</strong>${newest?'<span class="history-version-state">最新版本</span>':''}${current?'<span class="history-version-current">正在查看</span>':''}</div><p class="history-version-title">${esc(name)}</p><p class="version-row-meta" title="${esc(v.payload.sha256 ? '内容指纹：'+v.payload.sha256 : '')}"><time datetime="${esc(v.created)}">${new Date(v.created).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time><span aria-hidden="true">·</span><span>${esc(author)}</span></p></div><div class="history-version-actions"><button type="button" data-diary="view-version" data-version="${esc(v.id)}" aria-label="查看版本 ${v.version_no}">查看${icon('chevron')}</button>${!newest?`<button type="button" data-diary="restore" data-version="${esc(v.id)}" aria-label="恢复版本 ${v.version_no}">恢复此版</button>`:''}</div></article>`;
    }).join('') || '<p class="diary-history-empty">还没有保存的版本。</p>'}</div></div>`);
  }
  async function refresh(preserveContent = false) {
    const project = current.id, request = generation, middle = middleRequest;
    const loaded = await api(endpoint('',project));
    if(current?.id!==project || request!==generation || middle!==middleRequest)return;
    timeline=loaded;
    if(!preserveContent){await select(day,true);return;}
    const updated=await api(endpoint('/'+day,project));
    if(current?.id!==project || request!==generation || middle!==middleRequest)return;
    detail=updated;paint(false);
    const template=document.createElement('template');template.innerHTML=contentHTML();
    document.querySelector('#chat-body .diary-proposal')?.remove();
    const proposal=template.content.querySelector('.diary-proposal');
    if(proposal)document.getElementById('diary-status')?.before(proposal);
  }
  function download(raw, name, mime) {
    const href = URL.createObjectURL(new Blob([raw],{type:mime})), link = document.createElement('a');
    link.href=href; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  async function exportFile(format) {
    const reportDay = day;
    const response = await fetch(endpoint(`/${reportDay}/export?format=${format}&version=${version().id}`));
    if(!response.ok)throw new Error((await response.json()).error || '导出失败');
    download(await response.blob(),`${reportDay}.${format==='pdf'?'pdf':'md'}`,format==='pdf'?'application/pdf':'text/markdown');
  }
  async function openChat() {
    const report=version();
    if(!report || !detail?.artifact_id)throw new Error('这篇回顾尚无可引用版本，请先生成回顾或选择已有版本。');
    const text=body(report.body);
    await window.MethodAtlasAI.open({id:uid(),kind:'progress',artifact_id:detail.artifact_id,version_id:report.id,day,title:report.title||kinds[type(day)],text:text.slice(0,12000),truncated:text.length>12000});
  }
  function context() {
    if(!current || !conversation)return null;
    if(window.MethodAtlasAI?.isOpen()) {
      const pending=selectedFragments();
      const attached=pending.length?pending:conversation.messages.filter(m=>m.role==='user').at(-1)?.task?.refs?.context_references || [];
      const reports=attached.filter(r=>r.kind==='progress');
      if(reports.length!==1 || attached.length!==1)return null;
      const report=reports[0];
      return {project:current.id,day:report.day,conversation:conversation.id,reference:{artifact_id:report.artifact_id,version_id:report.version_id}};
    }
    if(chatContext?.conversation!==conversation.id) {
      try{chatContext=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`progress-context:${conversation.id}`)||'null');}catch{chatContext=null;}
    }
    return chatContext?.project===current.id?chatContext:null;
  }
  function chatHeader() {
    const c=context();
    if(window.MethodAtlasAI?.isOpen()) {
      const tools=document.getElementById('ai-chat-tools');
      if(!tools)return;
      const checked=tools.querySelector('#diary-revise-next')?.checked && tools.dataset.version===c?.reference?.version_id;
      tools.dataset.version=c?.reference?.version_id||'';
      tools.innerHTML=c?.reference?`<label class="diary-chat-mode"><input id="diary-revise-next" type="checkbox" ${checked?'checked':''}>修订这篇回顾</label>`:'';
      return;
    }
    if(!c || middleView!=='chat')return;
    const tools=document.getElementById('chat-tools');
    if(tools) tools.innerHTML=`<button data-diary="return">返回${c.day?kinds[type(c.day)]:'研究日报'}</button>${c.reference?'<label class="diary-chat-mode"><input id="diary-revise-next" type="checkbox">将下一条消息用于修订</label>':''}`;
  }
  let revising = false;
  async function revise(instruction) {
    const c=context();
    if(!c?.day || !document.getElementById('diary-revise-next')?.checked)return false;
    if(revising)throw new Error('正在生成修订提案，请稍候。');
    const input=document.getElementById('chat-input'), button=document.querySelector('#chat-form button[type=submit]'), view=viewGeneration, edit=draftEdits.get(c.conversation), draft=input?.value;
    const floating=window.MethodAtlasAI?.isOpen();
    let observe, watching=false;
    revising=true;if(button)button.disabled=true;
    toast('正在生成修订提案，原文保持不变。');
    try {
      const fragments=selectedFragments(), request={instruction,base_version_id:c.reference.version_id,conversation_id:c.conversation,chat_options:window.MethodAtlasSettings?.options()};
      const requestKey=`diary-revision-request:${c.conversation}`;
      if(floating){
        const signature=JSON.stringify(request);let prior;try{prior=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(requestKey));}catch{}
        request.client_message_id=prior?.signature===signature?prior.id:uid();
        (globalThis.MethodAtlasStorage?.local || localStorage).setItem(requestKey,JSON.stringify({signature,id:request.client_message_id}));
        watching=true;
        const watch=async()=>{
          if(!watching || !isCurrentView(view,c.project,c.conversation))return;
          await refreshTask(null,view,c.project,c.conversation);
          if(watching && isCurrentView(view,c.project,c.conversation)){
            if(conversation.messages.some(m=>m.client_message_id===request.client_message_id) && input?.isConnected && draftEdits.get(c.conversation)===edit && input.value===draft){
              input.value='';
              if((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`draft:${c.conversation}`)===draft)(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`draft:${c.conversation}`);
              syncComposer();
            }
            if(!busyTask())observe=setTimeout(()=>watch().catch(error=>toast(error.message)),400);
          }
        };
        observe=setTimeout(()=>watch().catch(error=>toast(error.message)),100);
      }
      const result=await post('/'+c.day+'/generate',request,c.project);
      if(result.error || result.status==='stopped'){if(floating)(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(requestKey);throw new Error(result.explanation || result.error || '回顾修订已停止，已有版本保留。');}
      if(!result.proposal_id)throw new Error(result.status==='running'?'这篇回顾正在整理，请稍后重试；修订要求已保留。':'没有生成新的修订提案，修订要求已保留。');
      const key=`draft:${c.conversation}`;
      if(draftEdits.get(c.conversation)===edit && (globalThis.MethodAtlasStorage?.local || localStorage).getItem(key)===draft)(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(key);
      if(floating){
        (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(requestKey);
        saveSelectedFragments(selectedFragments(c.conversation).filter(f=>!fragments.some(sent=>sent.id===f.id)),c.conversation);
      }
      if(current?.id===c.project && conversation?.id===c.conversation && window.MethodAtlasAI?.isOpen()) {
        if(input?.isConnected && draftEdits.get(c.conversation)===edit && input.value===draft)input.value='';
        const checkbox=document.getElementById('diary-revise-next');if(checkbox)checkbox.checked=false;
        toast('修订提案已生成，请查看并接受。');
        if(middleView==='progress' && day===c.day)await refresh(true);
        await refreshTask(result.task_id,viewGeneration,c.project,c.conversation);
      } else if(current?.id===c.project && conversation?.id===c.conversation && middleView==='chat') {
        if(input?.value===instruction)input.value='';
        toast('修订提案已生成，请查看并接受。');
        await activate(c.day);
      }
    } catch(error) {
      if(floating && draftEdits.get(c.conversation)===edit && !(globalThis.MethodAtlasStorage?.local || localStorage).getItem(`draft:${c.conversation}`)){
        (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`draft:${c.conversation}`,draft);
        if(current?.id===c.project && conversation?.id===c.conversation){const box=document.getElementById('chat-input');if(box && !box.value){box.value=draft;syncComposer();}}
      }
      throw error;
    } finally {watching=false;clearTimeout(observe);revising=false;if(button?.isConnected)button.disabled=false;}

    return true;
  }

  document.addEventListener('click',async event=>{
    const node=event.target.closest('[data-diary],[data-memory-day],[data-progress-open]');
    if(!node || !current)return;
    event.preventDefault();
    if(node.hasAttribute('data-progress-open')){switchShellView('progress');return;}
    node.disabled=true;
    const action=node.dataset.diary, actionProject=current.id, owner=node.closest('dialog');
    let actionGeneration=generation, actionMiddle=middleRequest;
    const active=()=>current?.id===actionProject && generation===actionGeneration && middleRequest===actionMiddle && (!owner || (node.isConnected && owner.open));
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
      if(action==='month-shift'){const step=Number(node.dataset.step);if(monthViewYear+step<2000||monthViewYear+step>2100)return;monthViewYear+=step;const panel=node.closest('.diary-month-panel');if(panel)panel.innerHTML=monthPanelHTML();return;}
      if(action==='month-pick'){month=node.dataset.month;node.closest('.diary-month-picker')?.removeAttribute('open');paint(false);return;}
      if(action==='chat'){await openChat();return;}
      if(action==='proposal'){if(shellView!=='progress')switchShellView('progress');await activate(node.dataset.day);return;}
      if(action==='return'){const c=context(), returnScroll=scroll;if(shellView!=='progress')switchShellView('progress');await activate(c?.returnDay);selectedVersion=c?.returnVersion;paint();document.getElementById('chat-body').scrollTop=returnScroll;return;}
      if(action==='view-version'){selectedVersion=node.dataset.version;editing=false;dialog.close();paint();return;}
      if(action==='latest' || action==='reload-shared'){await refresh();return;}
      if(action==='merge-shared') {
        const input=document.getElementById('daily-content');
        if(!input)return;
        const project=current.id,savedDay=day;
        const loaded=await api(endpoint('/'+savedDay,project));
        if(!active() || day!==savedDay)return;
        const newest=loaded.versions.at(-1);
        modal('合并回顾修改',`<p>核对服务器新版，将需要保留的修改合并到你的草稿后保存。</p><label class="dialog-field">服务器新版（只读）<textarea readonly rows="8">${esc(body(newest.body))}</textarea></label><label class="dialog-field">合并后的正文<textarea id="diary-merge-content" rows="12" data-project="${esc(project)}" data-day="${esc(savedDay)}" data-base="${esc(newest.id)}">${esc(input.value)}</textarea></label><button class="primary" data-diary="save-merge">保存合并结果</button>`);return;
      }
      if(action==='save-merge') {
        const input=document.getElementById('diary-merge-content');
        if(!input || input.dataset.project!==current.id || input.dataset.day!==day)return;
        const content=input.value,base=input.dataset.base,key=draftKey();input.readOnly=true;
        try {
          await post('/'+day+'/save',{content,base_version_id:base},actionProject);
          storeDraft(key,null);
          if(!active())return;
          dialog.close();editing=false;await refresh();
        } finally {if(input.isConnected)input.readOnly=false;}
        return;
      }
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
        if(active()){const loaded=await api(`/api/projects/${project}`);if(!active())return;current=loaded;dialog.close();await loadArtifact(saved.artifact_id);toast('已保存到编辑器，可独立修改。');}return;
      }
      if(action==='record' && state?.collaboration) { dialog?.close(); await window.MethodAtlasCollaboration.knowledge(); return; }
      if(action==='record') {modal('补充研究记录',`<form id="diary-record"><label class="dialog-field">类型<select name="kind"><option value="idea">研究想法</option><option value="decision">重要判断</option><option value="question">待解决问题</option></select></label><label class="dialog-field">内容<textarea name="text" required maxlength="10000" rows="5"></textarea></label><button class="primary">保存记录</button></form>`);return;}
      if(action==='delete') {modal('删除这篇回顾？','<p>删除后停止自动重新生成。可以从左栏“已删除”中撤销，历史版本保留。</p><button class="danger diary-wide" data-diary="confirm-delete">删除回顾</button>');return;}
      if(action==='confirm-delete' || action==='undo') {
        await post('/'+(node.dataset.day || day)+'/'+(action==='undo'?'undo':'delete'),{},actionProject);
        const loaded=await api(endpoint('',actionProject));
        if(current?.id!==actionProject || projectId!==actionProject)return;
        timeline=loaded;if(!active()){paint(false);return;}
        owner?.close();
        await select(action==='undo'?node.dataset.day:timeline.days[0]?.day || timeline.today);return;
      }
      if(action==='save') {
        const input=document.getElementById('daily-content'), key=draftKey(), content=input.value, savedDay=day, base=input.dataset.base;
        const saved=await post('/'+savedDay+'/save',{content,base_version_id:base,restore_file:true},actionProject);
        const activeInput=current?.id===actionProject && day===savedDay?document.getElementById('daily-content'):null;
        let draft;try{draft=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(key)||'null');}catch{}
        if(activeInput?.dataset.base===base)draft={base,content:activeInput.value};
        if(draft?.base===base){
          storeDraft(key,draft.content===content?null:{...draft,base:saved.version_id});
        }
        if(activeInput?.dataset.base===base)activeInput.dataset.base=saved.version_id;
        if(current?.id!==actionProject || generation!==actionGeneration || middleRequest!==actionMiddle)return;
        if(activeInput && activeInput.value!==content){
          const loaded=await api(endpoint('/'+savedDay,actionProject));
          if(current?.id===actionProject && generation===actionGeneration)detail=loaded;
          return;
        }
        editing=false;
      }
      if(action==='restore') {await post('/'+day+'/save',{restore_version:node.dataset.version || version().id,base_version_id:latest().id,restore_file:true},actionProject);if(!active())return;selectedVersion=null;owner?.close();await refresh();return;}
      if(action==='accept' || action==='reject')await post('/'+day+'/decide',{proposal_id:detail.proposal.id,action});
      if(action==='generate-week' || action==='generate-month') {
        const d=new Date(timeline.today+'T12:00:00');
        if(action==='generate-week')d.setDate(d.getDate()-((d.getDay()+6)%7));else d.setDate(1);
        const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${action==='generate-week'?'w':'m'}`;
        if(!await select(key))return;
        actionGeneration=generation;actionMiddle=middleRequest;
      }
      if(['generate','generate-week','generate-month'].includes(action)) {
        document.getElementById('diary-status').textContent='正在整理真实研究活动…';
        const result=await post('/'+day+'/generate');if(result.error)throw new Error(result.explanation || result.error);
      }
      if(active())await refresh();
    } catch(error) {if(['note','save','restore','confirm-delete','undo','accept','reject','generate','generate-week','generate-month'].includes(action) && !active())return;if(error.name!=='AbortError'){const status=dialog?.open?dialog.querySelector('[data-diary-dialog-status]'):document.getElementById('diary-status');if(status)status.textContent=error.message;else toast(error.message);}}
    finally {node.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['diary-settings','diary-scope','diary-record'].includes(form.id))return;
    event.preventDefault();if(form.dataset.submitting)return;
    const project=current.id, middle=middleRequest, owner=form.closest('dialog'), fields=new FormData(form);
    const value=form.id==='diary-settings'?readSettings(form):form.id==='diary-scope'?{...settingsDraft,scope:fields.getAll('scope')}:{request_id:crypto.randomUUID(),kind:fields.get('kind'),text:fields.get('text')};
    const active=()=>form.isConnected && owner.open && current?.id===project && middleRequest===middle;
    const controls=[...form.querySelectorAll('input,textarea,select,button')].map(node=>[node,node.disabled]);
    form.dataset.submitting='true';controls.forEach(([node])=>node.disabled=true);
    try {
      const result=await post(form.id==='diary-record'?'/events':'/settings',value,project);
      if(!active())return;
      if(form.id==='diary-record'){owner.close();toast('记录已保存，更新回顾后可纳入正文。');}
      else {timeline.settings=result;if(form.id==='diary-scope')settingsHTML();else owner.close();paint(false);}
    } catch(error){if(active())owner.querySelector('[data-diary-dialog-status]').textContent=error.message;}
    finally{delete form.dataset.submitting;controls.forEach(([node,disabled])=>node.disabled=disabled);}
  });
  document.addEventListener('input',event=>{
    const input=event.target;
    if(input.id==='daily-content')storeDraft(draftKey(),{base:input.dataset.base,content:input.value});
    if(input.id==='diary-merge-content' && input.dataset.project===current?.id && input.dataset.day===day) {
      const original=document.getElementById('daily-content');
      if(original)original.value=input.value;
      storeDraft(draftKey(),{base:original?.dataset.base || input.dataset.base,content:input.value});
    }
  });
  // The custom month panel has no native light-dismiss: close it on outside clicks and Escape.
  // A click target can already be detached (the year arrows re-render the panel inline),
  // so disconnected nodes count as inside — they were part of this panel a moment ago.
  document.addEventListener('click',event=>{const open=document.querySelector('.diary-month-picker[open]');if(open && event.target.isConnected && !open.contains(event.target))open.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelector('.diary-month-picker[open]')?.removeAttribute('open');});
  document.addEventListener('open-project-memory',event=>{if(current){if(shellView!=='progress')switchShellView('progress');activate(event.detail?.day);}});
  // Only notify about new versions, never repeat old reminders on each poll.
  let polling=false;
  async function pollReviews() {
    if(!current || polling || document.hidden)return;polling=true;
    const project=current.id, request=generation;
    try {
      const loaded=await api(endpoint('',project));if(current?.id!==project || request!==generation)return;
      const noticeKey = item => `progress-notified:${state?.user?.id || 'local'}:${project}:${item.version_id}`;
      const unread=loaded.days.filter(d=>d.unread && d.version_id && loaded.settings.notifications && !(globalThis.MethodAtlasStorage?.local || localStorage).getItem(noticeKey(d)));
      if(unread.length) {
        for(const item of unread)(globalThis.MethodAtlasStorage?.local || localStorage).setItem(noticeKey(item),'1');
        const message=unread.length===1?`${kinds[unread[0].kind]}待查看：${unread[0].title}`:`有 ${unread.length} 篇研究回顾待查看`;
        toast(message);
        if('Notification' in window && Notification.permission==='granted')new Notification('研究回顾',{body:message,tag:`progress:${project}`});
      }
      if(project===projectId){
        timeline=loaded;paint(false);
        const change=document.getElementById('diary-shared-update'), saved=loaded.days.find(d=>d.day===day);
        if(change && middleView==='progress') {
          const base=editing ? document.getElementById('daily-content')?.dataset?.base || latest()?.id : latest()?.id;
          const changed=saved?.version_id && saved.version_id!==base;
          change.hidden=!changed;
          if(changed) {
            const html=`其他成员保存了新版，当前正文和本地草稿已保留。<button data-diary="reload-shared">查看新版</button>${editing?'<button data-diary="merge-shared">合并我的修改</button>':''}`;
            if(change.innerHTML!==html)change.innerHTML=html;
          }
        }
      }
    }catch{}finally{polling=false;}
  }
  setInterval(pollReviews,30000);
  window.addEventListener('methodatlas-project-sync',event=>{if(event.detail.project===current?.id && (shellView==='progress' || middleView==='progress'))void pollReviews();});
  window.MethodAtlasProgress={activate,preview:()=>activate(null,null,true),paint,open:activate,context,chatHeader,revise,settings:async()=>{await activate();settingsHTML();}};
})();
