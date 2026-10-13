// Account/team controls extend the existing shell; the research panes stay in place.
window.MethodAtlasCollaboration = (() => {
  const styles = document.createElement('style');
  // 登录与协作面板共用 collaboration.css；顶部菜单保留现有布局。
  styles.textContent = `.collab-team{max-width:12rem;font:inherit;padding:.35rem;border:1px solid var(--line);border-radius:.4rem;background:var(--surface);color:inherit}.collab-account{max-width:12rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
  document.head.append(styles);
  styles.textContent += '.collab-menu::details-content{overflow:visible;transition:none}';
  styles.textContent += '#studio-tools{min-width:0;overflow-x:auto}#studio-tools>.pill{white-space:nowrap;flex-shrink:0}[data-related-work]{white-space:nowrap}';
  let workspace = '', showingLogin = false;

  function login(message = '') {
    showingLogin = true;
    invalidateView();
    window.MethodAtlasAI?.suspend();
    window.MethodAtlasComments?.close();
    window.MethodAtlasWriting?.unmount();
    state = current = conversation = artifact = detail = null;
    window.MethodAtlasSettings?.reset();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.getElementById('app').innerHTML = `<main class="home auth-page"><header class="auth-brand brand"><span class="brandmark" aria-hidden="true"><img src="assets/methodatlas-mark.png?v=poster-20261013" alt=""></span><span>MethodAtlas</span></header><form id="account-login" class="auth-card"><div class="auth-intro"><h1>登录 MethodAtlas</h1><p>验证邮箱，继续团队的研究工作。首次登录会创建账号。</p></div><label>邮箱<input name="email" type="email" autocomplete="email" required maxlength="254"></label><div class="auth-code-row"><button type="button" class="pill" data-send-code>发送验证码</button><label>验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required maxlength="10"></label></div><p class="collab-error" role="alert">${esc(message)}</p><p data-auth-status role="status"></p><button type="submit" class="primary">验证并登录</button></form></main>`;
    const form = document.getElementById('account-login');
    const error = form.querySelector('[role=alert]'), status = form.querySelector('[data-auth-status]');
    form.querySelector('[data-send-code]').onclick = async event => {
      if (!form.elements.email.reportValidity()) return;
      event.target.disabled = true; error.textContent = '';
      try {
        await api('/api/auth/otp', {method:'POST', body:JSON.stringify({email:form.elements.email.value})});
        status.textContent = '验证码已发送，请查看邮箱。';
        form.elements.code.focus();
      } catch (cause) { error.textContent = cause.message; }
      finally { event.target.disabled = false; }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]'); button.disabled = true; error.textContent = '';
      try {
        await api('/api/auth/verify', {method:'POST', body:JSON.stringify({email:form.elements.email.value,code:form.elements.code.value})});
        showingLogin = false;
        location.reload();
      } catch (cause) { error.textContent = cause.message; button.disabled = false; }
    };
    form.elements.email.focus();
  }

  function selectedWorkspace() {
    return state?.workspaces?.some(w => w.id === workspace) ? workspace : '';
  }

  function header() {
    if (!state?.collaboration) return '';
    if (current) return `<details class="home-menu collab-menu"><summary class="pill">项目协作</summary><div><button type="button" data-collab="members">成员与邀请</button><button type="button" data-collab="tasks">研究任务</button><button type="button" data-collab="knowledge">项目知识</button><button type="button" data-collab="activity">项目动态</button><button type="button" data-collab="notifications">通知</button></div></details>`;
    const teams = state.workspaces || [];
    return `<select class="collab-team" aria-label="团队" data-collab-team><option value="">全部团队</option>${teams.map(w => `<option value="${esc(w.id)}" ${w.id === selectedWorkspace() ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select><button type="button" class="pill" data-collab="team">新建团队</button><details class="home-menu collab-menu"><summary class="pill collab-account" title="${esc(state.user.email)}">${esc(state.user.email)}</summary><div><button type="button" data-collab="logout">退出登录</button></div></details>`;
  }

  // 协作弹窗沿用全站对话骨架：标题 + 一行说明 + 右上角圆钮关闭，下面内容区自己滚动、头部始终可见。
  function dialog(title, content, note = '') {
    const previous = document.getElementById('collaboration-dialog');
    previous?.close(); previous?.remove();
    const node = document.createElement('dialog');
    node.id = 'collaboration-dialog'; node.className = 'compact-dialog collab-dialog';
    node.setAttribute('aria-labelledby', 'collaboration-title');
    node.innerHTML = `<div class="modal-head"><div class="row between"><h2 id="collaboration-title">${esc(title)}</h2><button type="button" class="icon" aria-label="关闭" title="关闭" data-collab-close>${icon('close')}</button></div>${note ? `<p>${esc(note)}</p>` : ''}</div><div class="modal-body">${content}</div>`;
    node.querySelector('[data-collab-close]').onclick = () => node.close();
    document.body.append(node); node.showModal(); return node;
  }

  async function publishAnswer(id) {
    const project = current?.id, chat = conversation?.id;
    const message = conversation?.messages.find(item => item.id === id);
    if (!project || !message || conversation.visibility !== 'private') return;
    const raw = message.text;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    if (current?.id !== project || conversation?.id !== chat) return;
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    publishPreview(project, chat, conversation.title || '研究笔记', raw, `/api/projects/${project}/publish-message`, {message_id:id, sha256}, '下方回答及其中引用将成为项目成员可见的独立笔记。附件不会一起发布，原私人对话保持私密。');
  }

  async function publishDocument() {
    const project = current?.id, chat = conversation?.id, id = artifact?.id, selected = versionId, generation = viewGeneration;
    if (!id || current.artifacts.find(item => item.id === id)?.visibility !== 'private') return;
    await window.MethodAtlasWriting?.flush();
    const url = `/api/projects/${project}/documents/${id}`;
    const item = await api(url + (selected && selected !== 'draft' ? `?version_id=${encodeURIComponent(selected)}` : ''));
    const version = item.viewed_snapshot || item.versions.find(v => v.id === selected) || item.draft || item.versions.at(-1);
    await api(url + '/snapshot', {method:'POST', body:JSON.stringify({version_id:version.id})});
    if (viewGeneration !== generation || current?.id !== project || artifact?.id !== id || versionId !== selected) return;
    const plain = node => node.type === 'citation' ? `[cite:${node.citation_id}]` : node.type === 'img' ? `[图片:${node.alt}]` : node.type === 'equation' ? node.formula : node.text ?? (node.children || []).map(plain).join('');
    const raw = version.payload.document.map(plain).join('\n\n');
    publishPreview(project, chat, version.title, raw, url + '/publish', {version_id:version.id}, '发布当前预览版本的独立共享副本，保留格式和引用。原文稿、其他版本及评论保持私人；后续修改不会自动同步到副本。');
  }

  function publishPreview(project, chat, title, raw, url, source, notice) {
    const request_id = crypto.randomUUID(), generation = viewGeneration;
    const references = new Map();
    const preview = raw.replace(/\[cite:([^\]]+)\]/g, (_, id) => { if (!references.has(id)) references.set(id, references.size + 1); return `[引用 ${references.get(id)}]`; });
    const node = dialog('发布为共享笔记', `<form class="collab-publish"><p class="collab-note">${esc(notice)}</p><div class="collab-form-fields"><label class="collab-field" data-wide>笔记标题<input name="title" value="${esc(title)}" required maxlength="300"></label><label class="collab-field" data-wide>将发布的内容<textarea readonly rows="10">${esc(preview)}</textarea></label></div><div class="collab-foot"><span class="collab-hint">原私人内容保持不变。</span><button type="submit" class="primary">确认发布到项目</button></div><p class="collab-error" role="alert"></p></form>`, '发布后项目成员都能读到这条内容，附件和原对话不一起发布。');
    let payload;
    node.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const form = event.target, button = form.querySelector('[type=submit]');
      button.disabled = true; form.querySelector('[role=alert]').textContent = '';
      // Freeze the confirmed input across retries after a lost response.
      payload ||= {request_id, ...source, title:form.elements.title.value};
      form.elements.title.readOnly = true;
      try {
        const result = await api(url, {method:'POST', body:JSON.stringify(payload)});
        node.close();
        if (viewGeneration === generation && current?.id === project && conversation?.id === chat) {
          await openProject(project, chat);
          if (current?.id === project && conversation?.id === chat) await loadArtifact(result.artifact_id, result.version_id);
        }
        toast('已发布共享笔记，原内容仍为私人。');
      } catch (cause) { form.querySelector('[role=alert]').textContent = cause.message; button.disabled = false; }
    };
  }

  async function notifications(project = current?.id) {
    if (!project) return;
    const base = `/api/projects/${project}/notifications`;
    let data = await api(base), cursor = '', previous = [], revision = 0, busy = false, writing = false;
    if (current?.id !== project) return;
    const node = dialog('项目通知', '<div class="collab-toolbar"><p class="collab-count" data-notice-count role="status"></p><div class="collab-actions"><button type="button" class="quiet" data-notices-read>本页标为已读</button><button type="button" class="quiet" data-mail-settings>邮件订阅</button></div></div><div class="collab-list" data-notice-list></div><div class="collab-pager"><button type="button" class="quiet" data-notices-previous>上一页</button><button type="button" class="quiet" data-notices-latest>最新通知</button><button type="button" class="quiet" data-notices-next>下一页</button></div><p class="collab-error" role="alert"></p>');
    node.querySelector('[data-mail-settings]').onclick = () => mailSettings(project).catch(cause=>toast(cause.message));
    const active = () => node.isConnected && node.open && current?.id === project;
    const kinds = {comment_mentioned:'评论中提到了你',review_published:'项目回顾有新版本',task_assigned:'分配了研究任务'};
    const render = () => {
      const host = node.querySelector('[data-notice-list]');
      const unread = data.notifications.filter(n => !n.read_at).length;
      node.querySelector('[data-notice-count]').textContent = data.notifications.length ? `本页 ${data.notifications.length} 条 · ${unread} 条未读` : '';
      const html = data.notifications.map(n => `<div class="collab-card${n.read_at ? '' : ' is-unread'}"><div class="collab-main"><span class="collab-title">${n.read_at ? '' : '<span class="badge" data-tone=accent>未读</span>'}${esc(kinds[n.kind] || '项目通知')}</span><span class="collab-meta"><span>${esc(n.title || '')}</span><span>${esc(new Date(n.created).toLocaleString())}</span></span></div><div class="collab-aside"><button type="button" class="quiet" data-notice="${esc(n.id)}">查看</button></div></div>`).join('') || '<p class="collab-empty">暂无通知</p>';
      if (host.innerHTML !== html) host.innerHTML = html;
      node.querySelector('[data-notices-previous]').disabled = writing || !previous.length;
      node.querySelector('[data-notices-next]').disabled = writing || !data.next_cursor;
      node.querySelector('[data-notices-latest]').disabled = writing || !cursor;
      node.querySelector('[data-notices-read]').disabled = writing || !data.notifications.some(n=>!n.read_at);
      node.querySelector('[data-notices-read]').hidden = !data.notifications.length;
      node.querySelector('.collab-pager').hidden = !previous.length && !data.next_cursor && !cursor;
      host.querySelectorAll('[data-notice]').forEach(button=>{button.disabled=writing;});
    };
    const refresh = async (target = cursor, history = previous) => {
      const request = ++revision; busy = true;
      try {
        const loaded = await api(base + (target ? '?cursor=' + encodeURIComponent(target) : ''));
        if (!active() || request !== revision) return;
        data = loaded; cursor = target; previous = history; render();
        node.querySelector('[role=alert]').textContent = '';
      } catch (cause) { if (active() && request === revision) node.querySelector('[role=alert]').textContent = cause.message; }
      finally { if (request === revision) busy = false; }
    };
    node.querySelector('[data-notices-previous]').onclick = () => refresh(previous.at(-1), previous.slice(0,-1));
    node.querySelector('[data-notices-next]').onclick = () => refresh(data.next_cursor, [...previous,cursor]);
    node.querySelector('[data-notices-latest]').onclick = () => refresh('', []);
    node.querySelector('[data-notices-read]').onclick = async () => {
      if (writing) return;
      writing = true; ++revision; busy = false; render();
      try {
        await api(base + '/read', {method:'POST',body:JSON.stringify({ids:data.notifications.filter(n=>!n.read_at).map(n=>n.id)})});
        if (active()) await refresh();
      }
      catch(e){if(active())node.querySelector('[role=alert]').textContent=e.message;}
      finally { writing = false; if(active())render(); }
    };
    node.addEventListener('click', async event => {
      const notification = data.notifications.find(n => n.id === event.target.closest('[data-notice]')?.dataset.notice);
      if (!notification || writing) return;
      writing = true; ++revision; busy = false; render();
      try {
        await api(base + '/read', {method:'POST',body:JSON.stringify({ids:[notification.id]})});
        if(!active())return;
        node.close();
        if(notification.kind==='comment_mentioned')await window.MethodAtlasComments.openNotification(project,notification.artifact_id,notification.entity_id,notification);
        else if(notification.kind==='review_published')await loadArtifact(notification.artifact_id,notification.version_id);
        else await tasks(project,null,notification.entity_id);
      } catch(e){toast(e.message);}
      finally { writing = false; if(active())render(); }
    });
    const sync = event => { if(event.detail.project===project && active() && !document.hidden && !busy && !writing) void refresh(); };
    window.addEventListener('methodatlas-project-sync',sync);
    node.addEventListener('close',()=>{++revision;window.removeEventListener('methodatlas-project-sync',sync);},{once:true});
    render();
  }

  async function mailSettings(project) {
    const base = `/api/projects/${project}/mail-settings`;
    let data = await api(base);
    if (current?.id !== project) return;
    const node = dialog('邮件订阅', `<form class="collab-settings collab-mail-settings"><div class="collab-mail-account"><span>接收邮箱</span><strong>${esc(data.email)}</strong></div><p class="collab-mail-service" role="status">${data.available ? '仅提醒新通知，站内通知保留。' : '邮件服务未配置，暂不发送；订阅设置仍可保存。'}</p><div class="collab-mail-options"><div class="collab-mail-digest"><label class="collab-check"><input type="checkbox" name="digest" ${data.digest?'checked':''}><span class="collab-check-copy"><strong>研究回顾汇总</strong><small>日／周／月回顾，有更新时发送。</small></span></label><label class="collab-field collab-mail-time">每日发送时间<input type="time" name="time" required value="${esc(data.time)}"><small>${esc(data.timezone)}</small></label></div><label class="collab-check"><input type="checkbox" name="mentions" ${data.mentions?'checked':''}><span class="collab-check-copy"><strong>评论提及我</strong><small>有人 @ 你时立即提醒。</small></span></label><label class="collab-check"><input type="checkbox" name="assignments" ${data.assignments?'checked':''}><span class="collab-check-copy"><strong>任务分配给我</strong><small>收到研究任务时立即提醒。</small></span></label></div><div class="collab-foot"><p class="collab-status" role="status" data-mail-status></p><button class="primary" type="submit">保存设置</button></div></form><details class="collab-mail-history"><summary>${icon('chevron')}发送记录<span data-mail-delivery-count></span></summary><div class="collab-list" data-mail-deliveries></div></details><p class="collab-error" role="alert"></p>`);
    const form=node.querySelector('form'), error=node.querySelector('[role=alert]');
    const active=()=>node.isConnected && node.open && current?.id===project;
    let busy=false, loading=false, request=0;
    const labels={pending:'等待发送',preparing:'正在连接邮件服务',sending:'正在发送',sent:'邮件服务已接收',failed:'发送失败',uncertain:'发送结果不确定',cancelled:'已取消'};
    const tones={sent:'ok',failed:'bad',uncertain:'warn',cancelled:''};
    const kinds={digest:'研究回顾摘要',comment_mentioned:'评论提及',task_assigned:'任务分配'};
    const render=()=>{
      const host=node.querySelector('[data-mail-deliveries]');
      node.querySelector('[data-mail-delivery-count]').textContent=data.deliveries.length ? `${data.deliveries.length} 条` : '暂无记录';
      const html=data.deliveries.map(row=>`<div class="collab-card"><div class="collab-main"><span class="collab-title">${esc(kinds[row.kind] || '邮件')}<span class="badge"${tones[row.status] ? ` data-tone=${tones[row.status]}` : ''}>${labels[row.status]}</span></span><span class="collab-meta"><span>${esc(new Date(row.created).toLocaleString())}</span></span>${row.status==='uncertain'?'<p class="collab-note">邮件可能已送达，系统已停止自动重试。请先查看收件箱。</p>':row.status==='pending' && row.attempts?'<p class="collab-note">邮件服务暂不可用，将自动重试。</p>':''}</div>${['failed','uncertain'].includes(row.status)?`<div class="collab-aside"><button type="button" class="quiet" data-mail-retry="${esc(row.id)}">${row.status==='uncertain'?'确认重发':'重试'}</button></div>`:''}</div>`).join('') || '<p class="collab-empty">暂无发送记录</p>';
      if(host.innerHTML!==html)host.innerHTML=html;
    };
    form.onsubmit=async event=>{
      event.preventDefault(); if(busy)return;busy=true;++request;
      const button=form.querySelector('[type=submit]');button.disabled=true;error.textContent='';
      const payload={revision:data.revision,time:form.elements.time.value,...Object.fromEntries(['digest','mentions','assignments'].map(key=>[key,form.elements[key].checked]))};
      form.querySelectorAll('input').forEach(input=>{input.disabled=true;});
      try {
        const saved=await api(base,{method:'POST',body:JSON.stringify(payload)});
        if(!active())return;
        data=saved;render();node.querySelector('[data-mail-status]').textContent='邮件订阅已保存。';
      }catch(cause){if(active())error.textContent=cause.message;}
      finally{busy=false;button.disabled=false;form.querySelectorAll('input').forEach(input=>{input.disabled=false;});}
    };
    node.addEventListener('click',async event=>{
      const row=data.deliveries.find(row=>row.id===event.target.closest('[data-mail-retry]')?.dataset.mailRetry);
      if(!row || busy)return;
      if(row.status==='uncertain' && !confirm('上一封邮件可能已经送达，重发可能收到两封。确认重发？'))return;
      busy=true;++request;error.textContent='';
      try{
        const saved=await api(base+'/retry',{method:'POST',body:JSON.stringify({id:row.id,confirm_resend:row.status==='uncertain'})});
        if(active()){data.deliveries=saved.deliveries;render();}
      }catch(cause){if(active())error.textContent=cause.message;}
      finally{busy=false;}
    });
    const sync=async event=>{
      if(event.detail.project!==project || !active() || document.hidden || busy || loading)return;
      loading=true;const id=++request;
      try{
        const loaded=await api(base);
        if(!active() || id!==request)return;
        data.deliveries=loaded.deliveries;render();
        if(loaded.revision!==data.revision)node.querySelector('[data-mail-status]').textContent='订阅在其他页面已更改；当前输入保留，请重新打开后核对。';
      }catch(cause){if(active() && id===request)error.textContent=cause.message;}
      finally{loading=false;}
    };
    window.addEventListener('methodatlas-project-sync',sync);
    node.addEventListener('close',()=>{++request;window.removeEventListener('methodatlas-project-sync',sync);},{once:true});render();
  }

  async function members(project = current?.id) {
    if (!project) return;
    const data = await api(`/api/projects/${project}/members`);
    const owner = data.members.find(m => m.role === 'owner')?.user_id === state.user.id;
    const node = dialog('项目成员', `<div class="collab-list">${data.members.map(m => `<div class="collab-card"><div class="collab-main"><span class="collab-title">${esc(m.email)}<span class="badge"${m.role === 'owner' ? ' data-tone=accent' : ''}>${m.role === 'owner' ? '负责人' : '协作者'}</span></span></div>${owner && m.user_id !== state.user.id ? `<div class="collab-aside"><button type="button" class="quiet" data-remove-member="${esc(m.user_id)}">移除</button><button type="button" class="quiet" data-transfer-member="${esc(m.user_id)}">转为负责人</button></div>` : ''}</div>`).join('')}</div>${owner ? `<section class="dialog-section"><h3>邀请新成员</h3><form id="invite-member"><div class="collab-form-fields"><label class="collab-field" data-wide>成员邮箱<input name="email" type="email" required maxlength="254"></label></div><div class="collab-foot"><span class="collab-hint">邀请只对指定邮箱有效，7 天内可接受。</span><button class="primary" type="submit">生成邀请链接</button></div><div data-invite-result></div></form></section>` : ''}<p class="collab-error" role="alert"></p>`, '项目负责人可以邀请成员、移交负责人身份。');
    const error = node.querySelector('[role=alert]');
    node.querySelector('form')?.addEventListener('submit', async event => {
      event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
      try {
        const result = await api(`/api/projects/${project}/invite`, {method:'POST',body:JSON.stringify({email:form.elements.email.value})});
        const link = `${location.origin}/#invite=${encodeURIComponent(result.token)}`;
        node.querySelector('[data-invite-result]').innerHTML = `<div class="collab-form-fields"><label class="collab-field" data-wide>复制链接发给成员<textarea readonly aria-label="邀请链接">${esc(link)}</textarea></label></div><div class="collab-actions"><button type="button" class="quiet" data-revoke-invite="${esc(result.id)}">撤销此邀请</button></div>`;
      } catch (cause) { error.textContent = cause.message; }
      finally { button.disabled = false; }
    });
    node.addEventListener('click', async event => {
      const button = event.target.closest('[data-remove-member],[data-transfer-member],[data-revoke-invite]');
      if (!button) return;
      const action = button.dataset.removeMember ? 'remove-member' : button.dataset.transferMember ? 'transfer' : 'revoke-invite';
      if (action !== 'revoke-invite' && !confirm(action === 'transfer' ? '将项目负责人身份转给这位成员？' : '移除成员并撤销其项目访问权？')) return;
      button.disabled = true;
      try {
        await api(`/api/projects/${project}/manage/${action}`, {method:'POST',body:JSON.stringify(action === 'revoke-invite' ? {id:button.dataset.revokeInvite} : {user_id:button.dataset.removeMember || button.dataset.transferMember})});
        if (action === 'revoke-invite') node.querySelector('[data-invite-result]').textContent = '邀请已撤销';
        else await members(project);
      } catch (cause) { error.textContent = cause.message; button.disabled = false; }
    });
  }

  async function acceptLink() {
    const params = new URLSearchParams(location.hash.slice(1)), token = params.get('invite');
    if (!state?.collaboration || !token) return null;
    const result = await api('/api/invitations/accept', {method:'POST',body:JSON.stringify({token})});
    history.replaceState(null, '', location.pathname);
    return result.project_id;
  }
  window.addEventListener('hashchange', async () => {
    try {
      const project = await acceptLink();
      if (project) { state = await api('/api/state'); await openProject(project); }
    } catch (cause) { toast(cause.message); }
  });

  const kinds = {paper:'文献',artifact:'成果',run:'Agent Run',experiment:'实验',work:'研究任务',knowledge:'项目知识'};
  const linkData = link => ({kind:link.kind,id:link.id,...(link.version_id ? {version_id:link.version_id} : {})});
  function relatedButton(kind, id, version = null) {
    if (!state?.collaboration) return '';
    return `<button type="button" class="pill" data-related-work="${esc(JSON.stringify({kind,id,...(version ? {version_id:version} : {})}))}">相关任务</button>`;
  }
  const objectButton = link => link.unavailable ? '原关联已不可用' : `<button type="button" class="pill" data-work-object="${esc(JSON.stringify(linkData(link)))}">${kinds[link.kind]} · ${esc(link.title)}${link.version_id ? '（固定版本）' : ''}</button>`;
  async function openObject(project, link) {
    if (current?.id !== project) return;
    if (link.kind === 'work') return tasks(project,null,link.id);
    if (link.kind === 'knowledge') return knowledge(project,link.id);
    if (link.kind === 'paper') return showPaper(link.id, 1, link.version_id);
    if (link.kind === 'artifact') return loadArtifact(link.id, link.version_id);
    if (link.kind === 'experiment') return window.MethodAtlasRemote.open(link.id);
    const task = await api(`/api/projects/${project}/tasks/${link.id}`);
    if (current?.id !== project) return;
    const status = {queued:'排队中',routing:'准备中',running:'运行中',waiting:'等待确认',succeeded:'已完成',failed:'失败',stopped:'已停止',interrupted:'已中断'};
    const node = dialog('Agent Run', `<div class="collab-facts"><p><strong>状态</strong><span>${esc(status[task.status] || task.status)}</span></p><p><strong>开始时间</strong><span>${esc(new Date(task.created).toLocaleString())}</span></p></div><p class="collab-text">${esc(task.prompt)}</p>${task.error ? `<p class="collab-error" role="alert">${esc(task.error)}</p>` : ''}${renderProgress(task)}<section class="dialog-section"><h3>生成成果</h3>${(task.files || []).length ? `<div class="collab-links-row">${(task.files || []).map(f => objectButton({kind:'artifact',id:f.artifact_id,version_id:f.version_id,title:f.title})).join('')}</div>` : '<p class="collab-empty">此运行没有生成成果文件。</p>'}</section><div class="collab-actions"><button type="button" class="quiet" data-run-chat>打开原对话</button>${relatedButton('run',task.id)}</div>`, '一次 Agent 执行的完整输入、状态与产出。');
    node.querySelector('[data-run-chat]').onclick = async () => {
      try { await openProject(project, task.conversation_id); node.close(); }
      catch (cause) { toast(cause.message); }
    };
    node.addEventListener('click', async event => {
      const button = event.target.closest('[data-work-object]');
      if (!button) return;
      node.close();
      try { await openObject(project, JSON.parse(button.dataset.workObject)); }
      catch (cause) { toast(cause.message); }
    });
  }

  async function activity(project = current?.id) {
    if (!project) return;
    const people = (await api(`/api/projects/${project}/members`)).members;
    if (current?.id !== project) return;
    const node = dialog('项目动态', `<div class="collab-toolbar"><label class="collab-search">${icon('search')}<input type="search" data-activity-query maxlength="200" placeholder="搜索操作或对象名称" aria-label="搜索项目活动"></label><select aria-label="活动成员" data-activity-actor><option value="">全部成员</option>${people.map(p => `<option value="${esc(p.user_id)}">${esc(p.email)}</option>`).join('')}</select><button type="button" class="primary" data-activity-search>查询</button></div><details class="collab-filter-details"><summary>${icon('chevron')}时间范围</summary><div class="collab-form-fields"><label class="collab-field">起始时间<input type="datetime-local" data-activity-after></label><label class="collab-field">结束时间<input type="datetime-local" data-activity-before></label></div><p class="dialog-note">本机时区，不含结束时间。</p></details><p class="collab-count" data-activity-count role="status"></p><div class="collab-list" data-activity-list></div><div class="collab-pager"><button type="button" class="quiet" data-activity-prev hidden>上一页</button><button type="button" class="quiet" data-activity-next hidden>下一页</button></div><p class="collab-error" role="alert"></p>`);
    const names = new Map(people.map(p => [p.user_id,p.email]));
    const error = node.querySelector('[role=alert]');
    let filters = {}, offset = 0, next = null, sequence = 0, syncing = false;
    const active = () => node.isConnected && node.open && current?.id === project;
    const values = {todo:'待开始',doing:'进行中',blocked:'受阻',done:'已完成',cancelled:'已取消',low:'低',normal:'普通',high:'高',urgent:'紧急'};
    function changeText(changes) {
      const fields = {title:'标题',status:'状态',assignee:'负责人',priority:'优先级',due_date:'截止日期',enabled:'授权',default:'默认连接',max_concurrent:'并发上限',scope:'范围',action:'操作'};
      return Object.entries(changes).map(([key,value]) => `${fields[key] || key}：${key === 'assignee' ? names.get(value) || (value ? '原成员' : '未分配') : typeof value === 'boolean' ? value ? '启用' : '关闭' : values[value] || value || '未设置'}`).join(' · ');
    }
    async function refresh(pageOffset = 0) {
      const request = ++sequence;
      try {
        const result = await api(`/api/projects/${project}/activity?${new URLSearchParams({...filters,offset:pageOffset})}`);
        if (!active() || request !== sequence) return;
        offset = pageOffset; next = result.next_offset;
        node.querySelector('[data-activity-count]').textContent = result.total ? `共 ${result.total} 条活动` : '';
        node.querySelector('[data-activity-list]').innerHTML = result.events.map(row => `<div class="collab-card"><div class="collab-main"><span class="collab-title">${esc(row.actor_email || (row.actor_id ? '原成员' : '迁移前记录 / 作者未记录'))}<span class="badge">${esc(row.action)}</span></span><span class="collab-meta"><span>${esc(row.attribution === 'initiator' ? '主动发起' : row.attribution === 'authorizer' ? '授权后执行' : '系统记录')}</span><span>${esc(new Date(row.created).toLocaleString())}</span></span><p class="collab-note">${row.reference ? objectButton({...row.reference,title:row.title || row.action}) : esc(row.title)}</p>${Object.keys(row.changes).length ? `<p class="collab-note">${esc(changeText(row.changes))}</p>` : ''}</div></div>`).join('') || '<p class="collab-empty">暂无匹配的项目动态</p>';
        node.querySelector('[data-activity-prev]').hidden = offset === 0;
        node.querySelector('[data-activity-next]').hidden = next === null;
      } catch (cause) { if (active()) error.textContent = cause.message; }
    }
    node.querySelector('[data-activity-search]').onclick = () => {
      filters = {query:node.querySelector('[data-activity-query]').value,actor:node.querySelector('[data-activity-actor]').value};
      for (const key of ['after','before']) { const value = node.querySelector(`[data-activity-${key}]`).value; if (value) filters[key] = new Date(value).toISOString(); }
      node.querySelector('.collab-filter-details summary').innerHTML = `${icon('chevron')}${filters.after || filters.before ? '时间范围 · 已筛选' : '时间范围'}`;
      error.textContent = ''; void refresh();
    };
    node.querySelector('[data-activity-prev]').onclick = () => refresh(Math.max(0,offset - 30));
    node.querySelector('[data-activity-next]').onclick = () => refresh(next);
    node.addEventListener('click', async event => {
      const button = event.target.closest('[data-work-object]');
      if (!button) return;
      node.close();
      try { await openObject(project,JSON.parse(button.dataset.workObject)); }
      catch (cause) { toast(cause.message); }
    });
    const sync = async event => {
      if (!active() || syncing || event.detail.project !== project) return;
      syncing = true; try { await refresh(offset); } finally { syncing = false; }
    };
    window.addEventListener('methodatlas-project-sync',sync);
    node.addEventListener('close', () => window.removeEventListener('methodatlas-project-sync',sync), {once:true});
    await refresh();
  }

  async function knowledge(project = current?.id, recordId = null) {
    if (!project) return;
    const base = `/api/projects/${project}/progress`, labels = {confirmed:'成员已确认',candidate:'待验证',retracted:'已撤回',question:'待解决',legacy:'迁移前判断 · 未确认'};
    const knowledgeTone = state => ({confirmed:'ok',retracted:'bad',question:'warn',legacy:'warn'}[state] || '');
    const node = dialog('项目知识', `<div class="collab-toolbar"><button type="button" class="primary" data-knowledge-new>添加记录</button><label class="collab-search">${icon('search')}<input type="search" aria-label="搜索项目知识" maxlength="200" data-knowledge-query placeholder="搜索标题或内容"></label><select aria-label="知识状态" data-knowledge-state><option value="all">全部记录</option>${Object.entries(labels).map(([key,title]) => `<option value="${key}">${title}</option>`).join('')}</select><button type="button" class="quiet" data-knowledge-search>搜索</button></div><div class="collab-list" data-knowledge-list></div><div class="collab-pager"><button type="button" class="quiet" data-knowledge-more hidden>下一页</button></div><div class="dialog-section collab-detail" data-knowledge-detail></div><p role="alert" class="collab-error"></p>`);
    const host = node.querySelector('[data-knowledge-detail]'), error = node.querySelector('[role=alert]');
    let dirty = false, rows = [], next = null, sequence = 0, detailSequence = 0, offset = 0, viewingId = null, viewedRecord = '';
    const active = () => node.isConnected && node.open && current?.id === project;
    const mayLeave = () => !dirty || confirm('放弃尚未保存的研究记录？');
    const author = row => row.actor_email || (row.actor_id ? '原成员' : '迁移前记录');
    const sourceHTML = row => row.reference ? objectButton({...row.reference,title:row.title}) : esc(row.title);
    const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'pill'; previous.textContent = '上一页'; previous.hidden = true;
    node.querySelector('[data-knowledge-more]').before(previous);
    node.querySelector('[data-knowledge-more]').textContent = '下一页';
    previous.onclick = () => refresh(Math.max(0,offset - 20));
    async function refresh(pageOffset = 0) {
      const request = ++sequence;
      try {
        const query = new URLSearchParams({query:node.querySelector('[data-knowledge-query]').value,state:node.querySelector('[data-knowledge-state]').value,offset:pageOffset});
        const result = await api(`${base}/knowledge?${query}`);
        if (!active() || request !== sequence) return;
        rows = result.records; next = result.next_offset; offset = pageOffset; previous.hidden = offset === 0;
        node.querySelector('[data-knowledge-list]').innerHTML = rows.map(row => `<div class="collab-card"><div class="collab-main"><button type="button" class="collab-link" data-knowledge-id="${esc(row.id)}">${esc(row.title)}</button><span class="collab-meta"><span class="badge"${knowledgeTone(row.state) ? ` data-tone=${knowledgeTone(row.state)}` : ''}>${labels[row.state]}</span>${row.needs_review ? '<span class="badge" data-tone=warn>依据已撤回，需复核</span>' : ''}<span>${esc(author(row))}</span></span></div></div>`).join('') || '<p class="collab-empty">暂无匹配的知识记录</p>';
        node.querySelector('[data-knowledge-more]').hidden = next === null;
      } catch (cause) { if (active()) error.textContent = cause.message; }
    }
    async function show(id, automatic = false) {
      if (automatic ? dirty || viewingId !== id : !mayLeave()) return;
      const request = ++detailSequence;
      const result = await api(`${base}/knowledge/${encodeURIComponent(id)}`);
      if (!active() || request !== detailSequence) return;
      const fingerprint = JSON.stringify(result.record);
      if (automatic && fingerprint === viewedRecord) return;
      viewingId = id; viewedRecord = fingerprint;
      dirty = false;
      const row = result.record;
      host.innerHTML = `<div class="collab-title">${esc(row.title)}<span class="badge"${knowledgeTone(row.state) ? ` data-tone=${knowledgeTone(row.state)}` : ''}>${labels[row.state]}</span></div><div class="collab-facts"><p><strong>记录人</strong><span>${esc(author(row))}</span></p><p><strong>保存时间</strong><span>${esc(new Date(row.created).toLocaleString())}</span></p></div>${row.needs_review ? '<p class="collab-callout" role="status">此记录的依据已有撤回，需重新核对；原确认历史保留。</p>' : ''}<p class="collab-text">${esc(row.text)}</p>${row.retraction ? `<p class="collab-callout">撤回人：${esc(author(row.retraction))} · ${esc(new Date(row.retraction.created).toLocaleString())}</p><p class="collab-text">撤回理由：${esc(row.retraction.text)}</p>` : ''}<h4>保存时的依据</h4><div class="collab-list">${row.sources.map(source => `<div class="collab-card"><div class="collab-main"><span class="collab-title">${sourceHTML(source)}${source.retracted || source.needs_review ? '<span class="badge" data-tone=warn>需复核</span>' : ''}</span><span class="collab-meta"><span>${esc(new Date(source.created).toLocaleString())}</span></span><p class="collab-note">${esc(source.text.slice(0,400))}</p></div></div>`).join('') || '<p class="collab-empty">未关联依据</p>'}</div>${row.supersedes || ['candidate','legacy'].includes(row.state) || row.state === 'confirmed' ? `<div class="collab-actions">${row.supersedes ? `<button type="button" class="quiet" data-knowledge-id="${esc(row.supersedes)}">查看原判断</button>` : ''}${['candidate','legacy'].includes(row.state) ? '<button type="button" class="primary" data-knowledge-confirm>确认结论</button>' : ''}${row.state === 'confirmed' || row.state === 'legacy' ? '<button type="button" class="quiet" data-knowledge-retract>撤回判断</button>' : ''}</div>` : ''}`;
      host.querySelector('[data-knowledge-confirm]')?.addEventListener('click', () => edit('decision', row));
      host.querySelector('[data-knowledge-retract]')?.addEventListener('click', () => edit('overturned', row));
    }
    function edit(kind = 'idea', source = null) {
      if (!mayLeave()) return;
      detailSequence++;
      viewingId = null;
      dirty = false; error.textContent = '';
      const chosen = new Map(source && kind !== 'overturned' ? [[source.id,source]] : []);
      host.innerHTML = `<form class="collab-editor"><h3>${kind === 'overturned' ? '撤回判断' : '添加共享研究记录'}</h3>${source ? `<p class="collab-note">${esc(source.text.slice(0,600))}</p>` : ''}<div class="collab-form-fields"><label class="collab-field">记录类型<select aria-label="记录类型" name="kind" ${kind === 'overturned' ? 'disabled' : ''}>${Object.entries({idea:'待验证想法',decision:'人工确认结论',question:'待解决问题',...(kind === 'overturned' ? {overturned:'撤回判断'} : {})}).map(([key,title]) => `<option value="${key}" ${key === kind ? 'selected' : ''}>${title}</option>`).join('')}</select></label><label class="collab-field" data-wide>${kind === 'overturned' ? '撤回理由' : '内容'}<textarea name="text" required maxlength="10000">${kind === 'decision' ? esc(source?.text || '') : ''}</textarea></label></div><div data-knowledge-evidence ${kind === 'overturned' ? 'hidden' : ''}><p class="dialog-note">勾选的依据会固定到保存时的记录和版本。</p><div data-knowledge-chosen></div><label class="collab-field">查找项目依据<div class="collab-search">${icon('search')}<input type="search" name="query" maxlength="200" placeholder="搜索标题或内容"></div></label><div class="collab-actions"><button type="button" class="quiet" data-source-search>查找依据</button></div><div class="collab-group-list" data-source-list></div><button type="button" class="quiet" data-source-more hidden>更多依据</button></div><label class="collab-check" data-knowledge-approval ${kind === 'decision' ? '' : 'hidden'}><input type="checkbox" name="confirmed"><span class="collab-check-copy"><strong>我已核对所选依据</strong><small>确认将此内容保存为项目结论。</small></span></label><div class="collab-foot"><span class="collab-hint">保存后项目成员都能读到。</span><button type="submit" class="primary">保存记录</button></div><p class="collab-status" data-knowledge-save-status role="status"></p></form>`;
      const form = host.querySelector('form');
      let available = [], sourceNext = null, sourceSequence = 0, submission = null;
      const sourceActive = () => active() && form.isConnected;
      const paintChosen = () => { form.querySelector('[data-knowledge-chosen]').innerHTML = chosen.size ? `<p class="dialog-note">已选 ${chosen.size} 条依据</p><div class="collab-links-row">${[...chosen.values()].map(row => `<button type="button" class="pill" data-source-remove="${esc(row.id)}" title="移除这条依据">${esc(row.title || row.text.slice(0,60))}${icon('close')}</button>`).join('')}</div>` : ''; };
      async function search(more = false) {
        const request = ++sourceSequence;
        try {
          const result = await api(`${base}/events?${new URLSearchParams({query:form.elements.query.value,offset:more ? sourceNext || 0 : 0})}`);
          if (!sourceActive() || request !== sourceSequence) return;
          available = more ? [...available,...result.records] : result.records; sourceNext = result.next_offset;
          form.querySelector('[data-source-list]').innerHTML = available.map(row => `<label class="collab-check"><input type="checkbox" data-source-id="${esc(row.id)}" ${chosen.has(row.id) ? 'checked' : ''}><span class="collab-check-copy"><strong>${esc(row.title)}</strong><small>${esc(new Date(row.created).toLocaleString())}</small></span></label>`).join('') || '<p class="collab-empty">没有符合条件的共享依据。</p>';
          form.querySelector('[data-source-more]').hidden = sourceNext === null;
        } catch (cause) { if (sourceActive()) error.textContent = cause.message; }
      }
      form.oninput = () => { dirty = true; detailSequence++; };
      form.onchange = event => {
        if (event.target.name === 'kind') form.querySelector('[data-knowledge-approval]').hidden = event.target.value !== 'decision';
        const id = event.target.dataset.sourceId;
        if (id) { if (event.target.checked) chosen.set(id,available.find(r => r.id === id)); else chosen.delete(id); paintChosen(); }
      };
      form.onclick = event => {
        const id = event.target.closest('[data-source-remove]')?.dataset.sourceRemove;
        if (id) { chosen.delete(id); dirty = true; paintChosen(); const input = [...form.querySelectorAll('[data-source-id]')].find(i => i.dataset.sourceId === id); if (input) input.checked = false; }
      };
      form.querySelector('[data-source-search]').onclick = () => search();
      form.querySelector('[data-source-more]').onclick = () => search(true);
      form.onsubmit = async event => {
        event.preventDefault(); error.textContent = '';
        const button = form.querySelector('[type=submit]'); button.disabled = true;
        if (!submission) submission = {request_id:crypto.randomUUID(),kind:kind === 'overturned' ? kind : form.elements.kind.value,text:form.elements.text.value,sources:[...chosen.keys()],confirmed:form.elements.confirmed.checked,...(kind === 'overturned' ? {supersedes:source.id} : {})};
        if (submission.kind === 'decision' && (!submission.confirmed || !submission.sources.length)) { submission = null; button.disabled = false; error.textContent = '请至少选择一条依据并勾选人工确认。'; return; }
        sourceSequence++;
        form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
        try {
          const saved = await api(`${base}/events`, {method:'POST',body:JSON.stringify(submission)});
          if (!sourceActive()) return;
          dirty = false; await refresh(); await show(saved.id);
        } catch (cause) {
          if (!sourceActive()) return;
          if (cause.status === 400) {
            submission = null;
            form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = false; });
            form.elements.kind.disabled = kind === 'overturned';
            error.textContent = cause.message; return;
          }
          error.textContent = cause.message; button.disabled = false; button.textContent = '重试原保存';
          form.querySelector('[data-knowledge-save-status]').textContent = '已保留本次提交内容，重试不会重复创建。';
        }
      };
      paintChosen(); if (kind !== 'overturned') void search();
      form.elements.text.focus();
    }
    node.querySelector('[data-knowledge-new]').onclick = () => edit();
    node.querySelector('[data-knowledge-search]').onclick = () => refresh();
    node.querySelector('[data-knowledge-state]').onchange = () => refresh();
    node.querySelector('[data-knowledge-more]').onclick = () => refresh(next);
    node.addEventListener('click', async event => {
      try {
        const id = event.target.closest('[data-knowledge-id]')?.dataset.knowledgeId;
        if (id) await show(id);
        const object = event.target.closest('[data-work-object]');
        if (object && mayLeave()) { node.close(); await openObject(project,JSON.parse(object.dataset.workObject)); }
      } catch (cause) { if (active()) error.textContent = cause.message; }
    });
    node.addEventListener('cancel', event => { if (!mayLeave()) event.preventDefault(); });
    node.querySelector('[data-collab-close]').onclick = () => { if (mayLeave()) node.close(); };
    let syncing = false;
    const sync = async event => {
      if (!active() || event.detail.project !== project || syncing) return;
      syncing = true;
      try { await refresh(offset); if (viewingId) await show(viewingId,true); }
      catch (cause) {
        if (active()) {
          error.textContent = cause.message;
          if (cause.status === 403 || cause.status === 404) { host.replaceChildren(); viewingId = null; }
        }
      } finally { syncing = false; }
    };
    window.addEventListener('methodatlas-project-sync',sync);
    node.addEventListener('close', () => window.removeEventListener('methodatlas-project-sync',sync), {once:true});
    await refresh();
    if (recordId) await show(recordId);
  }

  async function tasks(project = current?.id, linked = null, itemId = null) {
    if (!project) return;
    const base = `/api/projects/${project}`, statuses = {todo:'待开始',doing:'进行中',blocked:'受阻',done:'已完成',cancelled:'已取消'};
    const [people, catalog] = await Promise.all([api(`${base}/members`), api(`${base}/work-items/candidates`)]);
    if (current?.id !== project) return;
    const query = linked ? '?' + new URLSearchParams({related_kind:linked.kind,related_id:linked.id,...(linked.version_id ? {related_version:linked.version_id} : {})}) : '';
    const names = new Map(people.members.map(m => [m.user_id, m.email]));
    const node = dialog('研究任务', `<div class="collab-toolbar"><button type="button" class="primary" data-work-new>新建任务</button><button type="button" class="quiet" data-work-refresh>刷新</button><select data-push data-work-filter aria-label="任务筛选"><option value="all">全部任务</option><option value="mine">分配给我</option><option value="open">未完成</option></select></div><div data-work-notices role="status"></div><div class="collab-list" data-work-list></div><div class="dialog-section collab-detail" data-work-editor></div><p class="collab-error" role="alert"></p>`);
    let items = [], editing = null, dirty = false, loading = false;
    const error = node.querySelector('[role=alert]'), editor = node.querySelector('[data-work-editor]');
    const label = id => id ? names.get(id) || '已离开的成员' : '未分配';
    const priorities = {low:'低',normal:'普通',high:'高',urgent:'紧急'};
    const taskTone = status => ({doing:'accent',blocked:'warn',done:'ok'}[status] || '');
    const describe = item => `<p class="collab-title">${esc(item.title)}</p><p class="collab-text">${esc(item.description || '无说明')}</p><p class="collab-meta"><span class="badge"${taskTone(item.status) ? ` data-tone=${taskTone(item.status)}` : ''}>${statuses[item.status]}</span><span>${priorities[item.priority]}优先级</span><span>${esc(label(item.assignee))}</span><span>截止 ${esc(item.due_date || '未设置')}</span></p><div class="collab-links-row">${item.links.map(link => objectButton(link)).join('')}</div>`;
    if (linked) node.querySelector('[data-work-list]').before(Object.assign(document.createElement('p'), {className:'collab-callout', textContent:`仅显示与当前${kinds[linked.kind]}${linked.version_id ? '版本' : ''}关联的任务。新建任务将自动关联此内容。`}));
    function renderList() {
      const filter = node.querySelector('[data-work-filter]').value;
      const visible = items.filter(i => filter === 'all' || (filter === 'mine' ? i.assignee === state.user.id : !['done','cancelled'].includes(i.status)));
      node.querySelector('[data-work-list]').innerHTML = visible.map(i => `<div class="collab-card"><div class="collab-main"><button type="button" class="collab-link" data-work-edit="${esc(i.id)}">${esc(i.title)}</button><span class="collab-meta"><span class="badge"${taskTone(i.status) ? ` data-tone=${taskTone(i.status)}` : ''}>${statuses[i.status]}</span><span>${esc(label(i.assignee))}</span>${i.due_date ? `<span>截止 ${esc(i.due_date)}</span>` : ''}</span></div></div>`).join('') || '<p class="collab-empty">暂无匹配的任务</p>';
    }
    async function refresh() {
      if (loading || !node.isConnected || !node.open) return;
      loading = true;
      try {
        const [data, notices] = await Promise.all([api(`${base}/work-items${query}`), api(`${base}/notifications`)]);
        if (!node.isConnected || !node.open) return;
        items = data.items; renderList();
        const unread = notices.notifications.filter(n => !n.read_at && n.kind === 'task_assigned' && (!linked || items.some(i => i.id === n.entity_id)));
        node.querySelector('[data-work-notices]').innerHTML = unread.length ? `<div class="collab-callout"><span>有 ${unread.length} 条新任务分配通知</span><button type="button" class="quiet" data-work-read>标为已读</button></div><div class="collab-links-row">${unread.map(n => `<button type="button" class="pill" data-work-edit="${esc(n.entity_id)}">${esc(items.find(i => i.id === n.entity_id)?.title || '查看任务')}</button>`).join('')}</div>` : '';
        node.querySelector('[data-work-read]')?.addEventListener('click', async () => {
          try { await api(`${base}/notifications/read`, {method:'POST',body:JSON.stringify({ids:unread.map(n => n.id)})}); await refresh(); }
          catch (cause) { error.textContent = cause.message; }
        });
        if (editing && items.find(i => i.id === editing.id)?.revision !== editing.revision) {
          editor.querySelector('[data-work-change]').textContent = '这项任务已有新修改。你的输入保留在下面，可查看最新版本后合并。';
        }
      } catch (cause) { error.textContent = cause.message; }
      finally { loading = false; }
    }
    function edit(item = null) {
      if (dirty && !confirm('放弃这项任务尚未保存的修改？')) return;
      editing = item; dirty = false; error.textContent = '';
      const value = item || {title:'',description:'',assignee:null,status:'todo',priority:'normal',due_date:null,links:linked ? [{...linked,title:catalog.candidates.find(c => c.kind === linked.kind && c.id === linked.id)?.title || '当前内容'}] : []};
      const choices = [...catalog.candidates];
      for (const link of value.links) if (!link.unavailable && !choices.some(c => c.kind === link.kind && c.id === link.id)) choices.push(link);
      editor.innerHTML = `<form class="collab-editor"><h3>${item ? '编辑任务' : '新建任务'}</h3>${item ? `<p class="collab-note">创建者：${esc(label(item.creator))} · 第 ${item.revision} 次保存</p><div class="collab-actions"><button type="button" class="quiet" data-work-history>查看修改历史</button><button type="button" class="quiet" data-work-latest>查看最新版本</button></div>` : ''}<p class="collab-status" data-work-change role="status"></p><div data-work-comparison></div><div class="collab-form-fields"><label class="collab-field" data-wide>任务标题<input name="title" required maxlength="300" value="${esc(value.title)}"></label><label class="collab-field" data-wide>说明<textarea name="description" maxlength="20000">${esc(value.description)}</textarea></label><label class="collab-field">负责人<select name="assignee"><option value="">未分配</option>${value.assignee && !names.has(value.assignee) ? `<option value="${esc(value.assignee)}" selected>已离开的成员</option>` : ''}${people.members.map(m => `<option value="${esc(m.user_id)}" ${value.assignee === m.user_id ? 'selected' : ''}>${esc(m.email)}</option>`).join('')}</select></label><label class="collab-field">状态<select name="status">${Object.entries(statuses).map(([key,name]) => `<option value="${key}" ${value.status === key ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label class="collab-field">优先级<select name="priority">${Object.entries({low:'低',normal:'普通',high:'高',urgent:'紧急'}).map(([key,name]) => `<option value="${key}" ${value.priority === key ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label class="collab-field">截止日期<input name="due_date" type="date" value="${esc(value.due_date || '')}"></label></div><fieldset class="collab-group"><legend>关联内容</legend><p class="collab-note">勾选后固定到所选文献、成果、实验或 Agent Run 的当前版本。</p>${value.links.length ? `<div class="collab-links-row">${value.links.map(link => objectButton(link)).join('')}</div>` : ''}<div class="collab-group-list">${choices.map((link,index) => `<label class="collab-check"><input type="checkbox" name="link" value="${index}" ${value.links.some(l => l.kind === link.kind && l.id === link.id) ? 'checked' : ''}><span class="collab-check-copy"><strong>${kinds[link.kind]} · ${esc(link.title)}</strong></span></label>`).join('') || '<p class="collab-empty">项目中尚无可关联的共享内容。</p>'}</div>${value.links.some(l => l.unavailable) ? '<p class="collab-callout">部分原关联内容已不可用；重新选择关联项并保存将移除这些关联。</p>' : ''}</fieldset><div class="collab-foot"><span class="collab-hint">保存后项目负责人和成员都能看到。</span><button class="primary" type="submit">保存任务</button></div></form>`;
      const form = editor.querySelector('form');
      form.addEventListener('input', () => { dirty = true; });
      form.onsubmit = async event => {
        event.preventDefault(); const submit = form.querySelector('[type=submit]'); submit.disabled = true; error.textContent = '';
        try {
          const fields = new FormData(form);
          const body = Object.fromEntries(['title','description','assignee','status','priority','due_date'].map(key => [key,fields.get(key)]));
          body.assignee ||= null; body.due_date ||= null;
          if (editing && body.assignee === editing.assignee) delete body.assignee;
          body.links = fields.getAll('link').flatMap(index => {
            const choice = choices[Number(index)], previous = value.links.filter(l => l.kind === choice.kind && l.id === choice.id);
            return (previous.length ? previous : [choice]).map(link => ({kind:link.kind,id:link.id,...(link.version_id ? {version_id:link.version_id} : {})}));
          });
          if (editing) {
            for (const key of ['title','description','assignee','status','priority','due_date']) if (body[key] === value[key]) delete body[key];
            const previousLinks = value.links.filter(l => !l.unavailable).map(({kind,id,version_id}) => ({kind,id,...(version_id ? {version_id} : {})}));
            const sameLinks = body.links.length === previousLinks.length && body.links.every(l => previousLinks.some(p => p.kind === l.kind && p.id === l.id && p.version_id === l.version_id));
            if (sameLinks) delete body.links;
            body.revision = editing.revision;
          }
          const saved = await api(`${base}/work-items${editing ? '/' + editing.id : ''}`, {method:'POST',body:JSON.stringify(body)});
          dirty = false; edit(saved.item); await refresh();
        } catch (cause) { error.textContent = cause.message; }
        finally { submit.disabled = false; }
      };
      editor.querySelector('[data-work-history]')?.addEventListener('click', async () => {
        try {
          const result = await api(`${base}/work-items/${item.id}/history`);
          editor.querySelector('[data-work-comparison]').innerHTML = result.history.map(h => `<details><summary>版本 ${h.item.revision} · ${esc(label(h.actor_id))} · ${esc(new Date(h.created).toLocaleString())}</summary>${describe(h.item)}</details>`).join('');
        } catch (cause) { error.textContent = cause.message; }
      });
      editor.querySelector('[data-work-latest]')?.addEventListener('click', async () => {
        try {
          const latest = (await api(`${base}/work-items/${item.id}`)).item;
          const comparison = editor.querySelector('[data-work-comparison]');
          comparison.innerHTML = `<p>最新版本 ${latest.revision}（下方输入未改变）</p>${describe(latest)}<button type="button" class="pill" data-work-merge>以此版本为基础保存我的修改</button><button type="button" class="pill" data-work-reload>载入此版本</button>`;
          comparison.querySelector('[data-work-merge]').onclick = () => { editing = {...editing,revision:latest.revision}; editor.querySelector('[data-work-change]').textContent = '已选择新的保存基础，请核对字段后保存。'; };
          comparison.querySelector('[data-work-reload]').onclick = () => edit(latest);
        } catch (cause) { error.textContent = cause.message; }
      });
      form.elements.title.focus();
    }
    node.querySelector('[data-work-new]').onclick = () => edit();
    node.querySelector('[data-work-refresh]').onclick = refresh;
    node.querySelector('[data-work-filter]').onchange = renderList;
    node.addEventListener('click', async event => {
      const object = event.target.closest('[data-work-object]');
      if (object) {
        if (dirty && !confirm('打开关联内容并放弃尚未保存的任务修改？')) return;
        node.close();
        try { await openObject(project, JSON.parse(object.dataset.workObject)); }
        catch (cause) { toast(cause.message); }
        return;
      }
      const id = event.target.closest('[data-work-edit]')?.dataset.workEdit;
      if (id) edit(items.find(i => i.id === id));
    });
    node.addEventListener('cancel', event => { if (dirty && !confirm('关闭并放弃尚未保存的任务修改？')) event.preventDefault(); });
    node.querySelector('[data-collab-close]').onclick = () => { if (!dirty || confirm('关闭并放弃尚未保存的任务修改？')) node.close(); };
    const sync = event => {
      if (!node.isConnected || !node.open) return window.removeEventListener('methodatlas-project-sync', sync);
      if (event.detail.project === project) void refresh();
    };
    window.addEventListener('methodatlas-project-sync', sync);
    node.addEventListener('close', () => window.removeEventListener('methodatlas-project-sync', sync), {once:true});
    await refresh();
    if (itemId) {
      const result = await api(`${base}/work-items/${encodeURIComponent(itemId)}`);
      if (node.isConnected && node.open && current?.id === project) edit(result.item);
    }
  }

  document.addEventListener('change', event => {
    if (!event.target.matches('[data-collab-team]')) return;
    workspace = event.target.value; renderProjects();
  });
  document.addEventListener('click', async event => {
    const related = event.target.closest('[data-related-work]');
    if (related) {
      try { await tasks(current?.id, JSON.parse(related.dataset.relatedWork)); }
      catch (cause) { toast(cause.message); }
      return;
    }
    const action = event.target.closest('[data-collab]')?.dataset.collab;
    if (!action) return;
    const menu = event.target.closest('.collab-menu');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
    try {
      if (action === 'members') await members();
      if (action === 'tasks') await tasks();
      if (action === 'knowledge') await knowledge();
      if (action === 'activity') await activity();
      if (action === 'notifications') await notifications();
      if (action === 'logout') {
        await window.MethodAtlasWriting?.flush();
        await api('/api/auth/logout', {method:'POST',body:'{}'});
        (globalThis.MethodAtlasStorage?.local || localStorage).removeItem('methodatlas-view'); location.reload();
      }
      if (action === 'team') {
        const node = dialog('新建团队', '<form class="collab-editor"><div class="collab-form-fields"><label class="collab-field" data-wide>团队名称<input name="name" required maxlength="300"></label></div><div class="collab-foot"><span class="collab-hint">团队用来归拢一批研究项目。</span><button type="submit" class="primary">创建团队</button></div><p class="collab-error" role="alert"></p></form>', '把同一批研究主题的项目归到一个团队里。');
        node.querySelector('form').onsubmit = async e => {
          e.preventDefault(); const form = e.target, button = form.querySelector('button'); button.disabled = true;
          try {
            const result = await api('/api/workspaces', {method:'POST',body:JSON.stringify({name:form.elements.name.value})});
            workspace = result.id; state = await api('/api/state'); node.close(); await home();
          } catch (cause) { form.querySelector('[role=alert]').textContent = cause.message; button.disabled = false; }
        };
      }
    } catch (cause) { toast(cause.message); }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    const menu = document.querySelector('.collab-menu[open]');
    if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  return {header, selectedWorkspace, acceptLink, login, publishAnswer, publishDocument, relatedButton, knowledge, expired:() => { if (!showingLogin) login('登录已过期，请重新验证邮箱。'); }};
})();
