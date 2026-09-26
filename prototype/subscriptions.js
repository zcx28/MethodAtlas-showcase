// Real subscriptions and pending papers share the project's durable API state.
(() => {
  let data = null, projectId = null, selectedId = null, loading = false, busy = false, dirty = false, error = '';
  const selectedSubscription = () => data?.subscriptions.find(s => s.id === selectedId);
  const stamp = value => value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '尚未运行';
  const endpoint = project => `/api/projects/${encodeURIComponent(project)}/subscription`;
  const safeURL = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? esc(u.href) : ''; } catch { return ''; } };
  const stateLabel = {running:'检索中',succeeded:'完成',partial:'部分完成',failed:'本轮说明'};
  const names = ids => (ids || []).map(id => data?.subscriptions.find(s => s.id === id)?.name || '历史订阅').join('、');
  const entries = () => (data?.runs || []).flatMap(run => (run.payload?.candidates || []).map(candidate => ({run,candidate})));
  const pending = () => entries().filter(({candidate:c}) => ['pending','saved'].includes(c.choice));
  const stateKey = (kind, project) => `methodatlas:subscription-${kind}:${project}`;
  const readSet = key => {
    try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return new Set(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []); }
    catch { return new Set(); }
  };
  const writeSet = (key, value) => { try { localStorage.setItem(key, JSON.stringify([...value])); } catch {} };
  const pendingCollapsed = () => { try { return localStorage.getItem(stateKey('collapsed',projectId)) === '1'; } catch { return false; } };
  const isUnread = items => {
    const seen = readSet(stateKey('seen',projectId));
    return items.some(({candidate}) => !seen.has(candidate.id));
  };

  document.head.insertAdjacentHTML('beforeend', `<style>
    .subscription-pending{margin:0.875rem 0 1.25rem;padding:0.875rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-2)}
    .subscription-pending>summary{margin-bottom:0.5rem}.subscription-pending-title{margin:0;font-size:0.9375rem;font-weight:600;color:var(--ink)}.subscription-unread-dot{width:0.4375rem;height:0.4375rem;border-radius:50%;background:var(--danger);flex:none}
    .subscription-candidate-list{display:flex;flex-direction:column;gap:0.5rem}
    .subscription-candidate{width:100%;cursor:pointer}.subscription-candidate:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .subscription-candidate-body{display:flex;flex-direction:column;gap:0.1875rem;min-width:0;flex:1;padding:2px 0}
    .subscription-candidate-body strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.875rem;font-weight:500;line-height:normal}
    .subscription-candidate-body .paper-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .subscription-detail-dialog{width:min(38.75rem,calc(100vw - 2rem))}.subscription-detail-dialog .modal-head{padding-bottom:0.875rem}
    .subscription-detail-title{overflow-wrap:anywhere}.subscription-detail-dialog .dialog-facts{margin-bottom:2px}
    .subscription-detail-copy{margin:0;font-size:0.875rem;line-height:1.8;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}
    .subscription-detail-dialog .dialog-section{margin-top:1.125rem;padding-top:0.9375rem}.subscription-detail-dialog .dialog-section h3{margin-bottom:0.5rem}
    .subscription-prompt{white-space:pre-wrap;font:inherit;line-height:1.7;margin:0.625rem 0}.subscription-form textarea{min-height:5.5rem;resize:vertical}.subscription-form{display:grid;gap:0.875rem}.subscription-form label{display:grid;gap:0.375rem}.subscription-status{font-size:0.8125rem;line-height:1.7;color:var(--muted)}
    .subscription-error{color:var(--ink)}.subscription-count{margin-left:0.25rem}.subscription-remove{font-size:0.75rem;padding:0.25rem 0.375rem}
  </style>`);

  const sourceLabel = source => ({arxiv:'arXiv',openalex:'OpenAlex',doi:'DOI'}[source] || source || '论文来源');
  const dateLabel = value => value ? String(value).slice(0,10).replaceAll('-', '.') : '日期待定';
  const choiceButtons = c => ['pending','saved'].includes(c.choice)
    ? `<button type="button" class="primary" data-sub-choice="collected">加入资料</button><button type="button" data-sub-choice="rejected">不再推荐</button>`
    : c.choice === 'rejected' ? '<button type="button" data-sub-choice="pending">恢复待确认</button>'
    : c.choice === 'removed' ? '<button type="button" data-sub-choice="collected">恢复到资料</button>'
    : '<button type="button" data-sub-choice="removed">移出资料</button>';

  function card({run,candidate:c}) {
    const p = c.preferred || {};
    const label = {pending:'待确认',saved:'待确认',rejected:'已屏蔽',collected:'已加入资料',removed:'已移出资料'}[c.choice];
    return `<article class="paper-row subscription-candidate" role="button" tabindex="0" aria-label="查看论文详情：${esc(p.title || '未命名论文')}" data-sub-wait="${esc(run.wait_id)}" data-sub-candidate="${esc(c.id)}">${icon('file')}<span class="paper-link subscription-candidate-body"><strong>${esc(p.title || '未命名论文')}</strong><span class="paper-meta">${esc(label)} · ${esc(sourceLabel(p.source))}</span></span></article>`;
  }

  function candidateDetailHTML({run,candidate:c}) {
    const p = c.preferred || {};
    const url = safeURL((p.url || '').startsWith('https://openalex.org/') ? (c.versions || []).find(v => v.source === 'arxiv' && v.url)?.url || p.url : p.url);
    const reason = run.payload.recommendation?.papers.find(item => item.candidate_id === c.id)?.reason || '历史候选';
    const label = {pending:'待确认',saved:'待确认',rejected:'已屏蔽',collected:'已加入资料',removed:'已移出资料'}[c.choice];
    const fulltext = c.availability?.fulltext === 'downloaded' ? '已获取' : c.availability?.fulltext === 'not_fetched' ? '未获取' : c.availability?.fulltext || '未知';
    const subscriptions = names(c.subscriptions || [run.subscription_id]) || '历史订阅';
    return `<div class="modal-head"><div class="dialog-head"><div><h2 id="subscription-detail-title" class="subscription-detail-title">${esc(p.title || '未命名论文')}</h2><p class="dialog-head-summary">${esc(label)} · ${esc(sourceLabel(p.source))}</p></div><button type="button" class="icon" data-sub-detail-close aria-label="关闭论文详情" title="关闭">${icon('close')}</button></div></div><div class="modal-body"><div class="dialog-facts"><p><strong>作者</strong><span>${esc((p.authors || []).join('、') || '未提供')}</span></p><p><strong>首次发表</strong><span>${esc(dateLabel(c.first_published || p.published))}</span></p><p><strong>发现日期</strong><span>${esc(dateLabel(c.discovered_at || run.created))}</span></p><p><strong>订阅</strong><span>${esc(subscriptions)}</span></p><p><strong>全文</strong><span>${esc(fulltext)}</span></p></div>${reason ? `<section class="dialog-section"><h3>筛选理由</h3><p class="subscription-detail-copy">${esc(reason)}</p></section>` : ''}${p.summary ? `<section class="dialog-section"><h3>摘要</h3><p class="subscription-detail-copy">${esc(p.summary)}</p></section>` : ''}${url ? `<div class="dialog-actions"><a class="dialog-chip" href="${url}" target="_blank" rel="noreferrer">打开来源 ↗</a></div>` : ''}<div class="dialog-actions">${choiceButtons(c)}</div></div>`;
  }

  function openCandidateDetail(match) {
    document.querySelector('.subscription-detail-dialog')?.close();
    const dialog = document.createElement('dialog');
    dialog.className = 'subscription-detail-dialog';
    dialog.dataset.subWait = match.run.wait_id;
    dialog.dataset.subCandidate = match.candidate.id;
    dialog.setAttribute('aria-labelledby', 'subscription-detail-title');
    dialog.innerHTML = candidateDetailHTML(match);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[data-sub-detail-close]')?.focus();
    const seen = readSet(stateKey('seen',projectId));
    seen.add(match.candidate.id);
    writeSet(stateKey('seen',projectId),seen);
    syncUnreadIndicator();
  }

  const findCandidate = (waitId, candidateId) => entries().find(({run,candidate}) => run.wait_id === waitId && candidate.id === candidateId);
  function pendingHTML() {
    if (projectId !== current?.id || !data) return '';
    const items = pending();
    if (!items.length) return '';
    const unread = isUnread(items);
    return `<details id="subscription-pending" class="subscription-pending sub-fold" data-project="${esc(projectId)}"${pendingCollapsed() ? '' : ' open'}><summary><h3 class="subscription-pending-title">待确认 · ${items.length}</h3><span class="subscription-unread-dot" aria-hidden="true"${unread ? '' : ' hidden'}></span><span class="sr-only subscription-unread-label">${unread ? '有未看论文' : ''}</span></summary><div class="subscription-candidate-list">${items.map(card).join('')}</div></details>`;
  }
  function syncUnreadIndicator() {
    const section = document.getElementById('subscription-pending');
    if (!section) return;
    const unread = isUnread(pending());
    const dot = section.querySelector('.subscription-unread-dot');
    if (dot) dot.hidden = !unread;
    const label = section.querySelector('.subscription-unread-label');
    if (label) label.textContent = unread ? '有未看论文' : '';
  }
  function renderPending() {
    if (shellView !== 'library') return;
    const slot = document.getElementById('subscription-pending');
    const items = projectId === current?.id && data ? pending() : [];
    if (!items.length) {
      const hadFocus = slot?.contains(document.activeElement);
      slot?.remove();
      if (hadFocus) document.querySelector('#source-body [data-action="add-source"]')?.focus();
      return;
    }
    const html = items.map(card).join('');
    if (!slot) {
      document.getElementById('source-body')?.insertAdjacentHTML('afterbegin',pendingHTML());
      return;
    }
    const summary = slot.querySelector(':scope > summary');
    const title = summary?.querySelector('.subscription-pending-title');
    if (title) title.textContent = `待确认 · ${items.length}`;
    syncUnreadIndicator();
    const list = slot.querySelector('.subscription-candidate-list');
    if (list && list.innerHTML !== html) {
      const active = document.activeElement;
      const focused = list.contains(active) ? {wait:active.dataset.subWait,candidate:active.dataset.subCandidate} : null;
      list.innerHTML = html;
      if (focused) {
        const target = [...list.querySelectorAll('[data-sub-candidate]')].find(node => node.dataset.subWait === focused.wait && node.dataset.subCandidate === focused.candidate);
        (target || summary)?.focus({preventScroll:true});
      }
    }
  }
  const baseSources = sourcesBodyHTML;
  sourcesBodyHTML = function sourcesWithPending() { return pendingHTML() + baseSources(); };

  function listHTML() {
    return `<button type="button" class="primary sub-create" data-sub-action="create">${icon('plus')}在聊天中创建订阅</button>${error ? `<p role="status" class="subscription-error">${esc(error)}</p>` : ''}<div class="library-list cards">${(data?.subscriptions || []).map(s => `<button type="button" class="library-row card${s.id === selectedId ? ' active' : ''}" data-sub-row="${esc(s.id)}"><span class="sub-dot" data-state="${s.enabled ? 'active' : 'paused'}"></span><span class="library-row-body"><strong>${esc(s.name)}</strong><small>${s.enabled ? '已开启' : '已暂停'} · 每天 ${esc(s.time)} · 北京时间</small></span></button>`).join('') || `<p class="sub-empty">${loading ? '读取订阅中…' : '还没有订阅。在聊天中描述你要跟踪的论文。'}</p>`}</div>`;
  }
  function runsHTML(sub) {
    return `<section class="memory-card"><header class="memory-head"><span>订阅日报与运行记录</span></header><div class="memory-proposal-body">${data.runs.filter(r => r.subscription_id === sub.id).map((r,i) => `<details class="sub-run" ${i === 0 ? 'open' : ''}><summary>${esc(stamp(r.created))} · ${r.automatic ? '自动定时' : r.operation === 'enable' ? '启用订阅' : r.operation === 'refresh' ? '更新策略' : '手动运行'} · ${stateLabel[r.status] || esc(r.status)}</summary><p>${r.status === 'running' ? (r.operation === 'run' ? '正在检索与筛选，完成后自动更新。' : '正在制定搜索策略，完成后自动更新。') : r.status === 'failed' ? '本轮没有取得可交付结果。' : r.operation === 'enable' ? '订阅已启用，将在设定时间开始检索。' : r.operation === 'refresh' ? '策略已更新，本轮未检索。' : r.count ? `新增 ${r.count} 篇候选，前往文献库确认。` : r.status === 'partial' ? '本轮未发现新增；来源覆盖不完整。' : '今日无新增符合条件的论文。'}</p>${r.payload ? `<small>首次发表日期范围：${esc(r.payload.from_date || '历史')} 至 ${esc(r.payload.to_date || r.day)}</small>` : ''}${r.error ? `<p role="status" class="subscription-error">${esc(r.explanation || r.error)}</p>` : ''}${r.warning ? `<p class="subscription-status">${esc(r.warning)}</p>` : ''}<ul>${r.sources.map(s => `<li>${esc(s.source)}：${s.status === 'succeeded' ? `${s.count || 0} 条候选` : '失败 / 未完成'}${s.truncated ? '（达到检索上限）' : ''}${s.error ? ' · ' + esc(s.error) : ''}</li>`).join('')}</ul>${(r.payload?.candidates || []).map(candidate => card({run:r,candidate})).join('')}</details>`).join('') || '<p>尚无运行记录。</p>'}</div></section>`;
  }
  function detailHTML() {
    const sub = selectedSubscription();
    if (!sub) return '<p class="empty-small">选择一条订阅查看设置和日报。</p>';
    const running = data.runs.some(r => r.subscription_id === sub.id && r.status === 'running');
    return `<section class="memory-card"><header class="memory-head"><span>订阅设置</span><span class="badge">${running ? '运行中' : sub.enabled ? '已开启' : '已暂停'}</span></header><div class="memory-proposal-body"><p class="subscription-status">${data.archived ? '项目已归档，自动任务已停止。' : sub.enabled ? `下次运行：${esc(stamp(sub.next_run))}（北京时间）` : '已暂停自动检索。'}<br>本机后台须保持运行；休眠或停止期间的检索会在恢复后补跑。</p><form id="subscription-settings" class="subscription-form" data-id="${esc(sub.id)}"><p class="subscription-status">已绑定论文：${esc((sub.materials || []).map(p => p.title).join("、") || "未选择论文，依据研究要求和日报制定策略")}</p><label>名称<input name="name" maxlength="100" required value="${esc(sub.name)}"></label><label>每天运行时间（北京时间）<input type="time" name="time" required value="${esc(sub.time)}"></label><label>研究要求<textarea name="requirements" maxlength="4000">${esc(sub.requirements)}</textarea></label><label>排除方向<textarea name="excluded" maxlength="4000">${esc(sub.excluded)}</textarea></label><button type="submit" ${busy ? 'disabled' : ''}>保存设置</button><p id="subscription-error" role="status" class="subscription-error">${esc(error)}</p></form><div class="row memory-editor-actions"><button type="button" data-sub-action="toggle" ${busy ? 'disabled' : ''}>${sub.enabled ? '暂停' : '开启订阅'}</button><button type="button" class="primary" data-sub-action="run" ${busy || running || data.archived ? 'disabled' : ''}>${running ? '正在运行…' : '立即运行'}</button><button type="button" data-sub-action="refresh" ${busy || running ? 'disabled' : ''}>重新制定搜索策略</button></div><p class="subscription-status">arXiv · OpenAlex · 每条订阅每日最多 5 篇，今日剩余 ${sub.remaining} 篇。首次查近 7 天，后续补检并回看 7 天以覆盖延迟收录；项目内去重。</p></div></section><section class="memory-card"><header class="memory-head"><span>AI 检索与筛选提示词</span></header><div class="memory-proposal-body"><p role="status">${sub.strategy.needs_refresh ? "研究要求已保存，策略待更新；下次检索前会重新制定。" : ""}</p><p>${esc(sub.strategy.query || '尚未生成检索词')}</p><div class="subscription-prompt">${esc(sub.strategy.prompt || sub.strategy.focus || '尚未生成')}</div><small>策略按创建时选中的论文与研究日报制定并固定；修改研究要求或排除方向时更新，单独修改时间不影响策略。</small></div></section>${runsHTML(sub)}`;
  }
  function paint() {
    if (!current || projectId !== current.id) return;
    if (shellView === 'subscriptions') shellPaint({titles:['论文订阅'],badges:[String(data?.subscriptions.length || 0)],bodies:[listHTML()]});
    if (middleView === 'subscriptions' && !dirty && !document.activeElement?.closest('#subscription-settings')) paintMiddle('subscriptions',selectedSubscription()?.name || '订阅详情',detailHTML());
    renderPending();
    for (const nav of document.querySelectorAll('[data-action="shell"][data-value="library"]')) {
      nav.querySelector('.subscription-count')?.remove();
      if (pending().length) nav.insertAdjacentHTML('beforeend',`<span class="badge subscription-count" aria-label="${pending().length} 篇待确认">${pending().length}</span>`);
    }
  }
  async function load() {
    if (!current?.id || loading) return;
    const project = current.id;
    if (projectId !== project) { data = null; selectedId = null; dirty = false; error = ''; projectId = project; }
    loading = true;
    try {
      const next = await api(endpoint(project));
      if (current?.id !== project) return;
      const changed = JSON.stringify(next) !== JSON.stringify(data) || error;
      data = next; error = '';
      if (!data.subscriptions.some(s => s.id === selectedId)) selectedId = data.subscriptions[0]?.id || null;
      if (changed) paint();
    } catch (e) { if (current?.id === project) { error = '订阅读取失败：' + e.message; paint(); } }
    finally { loading = false; }
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let rowAnimations = [];
  reducedMotion.addEventListener('change', () => {
    if ((window.MethodAtlasSettings?.reducedMotion() || reducedMotion.matches)) rowAnimations.forEach(animation => animation.cancel());
  });
  const sourceRows = () => [...document.querySelectorAll('#source-body [data-source-id], #subscription-pending [data-sub-candidate]')];
  const rowKey = node => node.dataset.sourceId ? `paper:${node.dataset.sourceId}` : `candidate:${node.dataset.subWait}:${node.dataset.subCandidate}`;
  function animateCollectedRows(before) {
    if (!before || (window.MethodAtlasSettings?.reducedMotion() || reducedMotion.matches)) return;
    // Measure all rows before starting animations; polling never calls this path.
    const rows = sourceRows().map(node => ({node, top:node.getBoundingClientRect().top, old:before.get(rowKey(node))}));
    rowAnimations.forEach(animation => animation.cancel());
    rowAnimations = rows.flatMap(({node, top, old}) => {
      if (!node.checkVisibility() || top > innerHeight || top + node.offsetHeight < 0) return [];
      const fresh = old === undefined && node.dataset.sourceId;
      if (!fresh && (old === undefined || Math.abs(old - top) < 1)) return [];
      return [node.animate(fresh
        ? [{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'none'}]
        : [{transform:`translateY(${old - top}px)`},{transform:'none'}], {duration:180,easing:'ease-out'})];
    });
  }

  async function mutate(action, body) {
    if (busy) return;
    const project = current.id, generation = viewGeneration;
    let beforeRows = null;
    busy = true; error = ''; paint();
    try {
      const result = await api(endpoint(project) + '/' + action,{method:'POST',body:JSON.stringify(body)});
      if (current?.id !== project) return;
      data = result; projectId = project; if (action === 'settings') dirty = false;
      if (action === 'choose') {
        const latest = await api(`/api/projects/${encodeURIComponent(project)}`);
        if (current?.id !== project) return;
        if (body.choice === 'collected' && shellView === 'library' && generation === viewGeneration) {
          beforeRows = new Map(sourceRows().map(node => [rowKey(node),node.getBoundingClientRect().top]));
        }
        current = {...current,papers:latest.papers};
        for (const id of selected) if (!current.papers.some(p => p.id === id)) selected.delete(id);
        renderSources();
      }
    } catch (e) { if (current?.id === project) { error = e.message; toast(error); } }
    finally { busy = false; if (current?.id === project) { if (!dirty) document.activeElement?.blur(); paint(); animateCollectedRows(beforeRows); const alert = document.getElementById('subscription-error'); if (alert) alert.textContent = error; } }
  }
  function activate() { if (projectId !== current?.id) { data = null; projectId = current?.id; selectedId = null; dirty = false; } paint(); load(); }
  window.MethodAtlasSubscriptions = {activate,open:async id => { await load(); selectedId = id || data?.subscriptions[0]?.id; dirty = false; openMiddle('subscriptions',selectedSubscription()?.name || '订阅详情',selectedId); paint(); }};
  document.addEventListener('input',e => { if (e.target.closest('#subscription-settings')) dirty = true; });
  document.addEventListener('toggle',e => {
    const section = e.target;
    if (section.id !== 'subscription-pending' || section.dataset.project !== projectId) return;
    try { localStorage.setItem(stateKey('collapsed',projectId),section.open ? '0' : '1'); } catch {}
  },true);
  document.addEventListener('submit',e => {
    if (e.target.id !== 'subscription-settings') return;
    e.preventDefault();
    mutate('settings',{subscription_id:e.target.dataset.id,...Object.fromEntries(new FormData(e.target))});
  });
  document.addEventListener('click',e => {
    const row = e.target.closest('[data-sub-row]');
    if (row) { selectedId = row.dataset.subRow; dirty = false; openMiddle('subscriptions',selectedSubscription()?.name,selectedId); paint(); return; }
    const candidate = e.target.closest('.subscription-candidate');
    if (candidate) { const match = findCandidate(candidate.dataset.subWait, candidate.dataset.subCandidate); if (match) openCandidateDetail(match); return; }
    const detailClose = e.target.closest('[data-sub-detail-close]');
    if (detailClose) { detailClose.closest('dialog')?.close(); return; }
    const choice = e.target.closest('[data-sub-choice]');
    if (choice) { const card = choice.closest('[data-sub-wait]'); if (!card) return; card.closest('dialog')?.close(); mutate('choose',{wait_id:card.dataset.subWait,candidate_id:card.dataset.subCandidate,choice:choice.dataset.subChoice}); return; }
    const action = e.target.closest('[data-sub-action]')?.dataset.subAction;
    if (action === 'create') { switchShellView('chat'); openMiddle('chat'); const input = document.getElementById('chat-input'); if (input) { if (!input.value) input.value = '创建一个每日订阅，基于选中的论文和每日研究报告，跟踪我关注领域的最新论文，每天北京时间早上 8:00。'; input.dispatchEvent(new Event('input',{bubbles:true})); input.focus(); } return; }
    if (!action || !selectedSubscription()) return;
    if (dirty) return toast('请先保存订阅设置。');
    const sub = selectedSubscription();
    if (action === 'toggle') mutate(sub.enabled ? 'settings' : 'enable',{subscription_id:sub.id,...(sub.enabled ? {enabled:false} : {})});
    else if (['run','refresh'].includes(action)) mutate(action,{subscription_id:sub.id});
  });
  document.addEventListener('keydown', e => {
    const candidate = e.target.closest?.('.subscription-candidate');
    if (!candidate || !['Enter',' '].includes(e.key)) return;
    e.preventDefault();
    const match = findCandidate(candidate.dataset.subWait, candidate.dataset.subCandidate);
    if (match) openCandidateDetail(match);
  });
  setInterval(load,3000);
  load();
})();
