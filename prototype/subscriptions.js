// Discovery stays separate from the materials explicitly accepted for research.
(() => {
  let data = null, projectId = null, selectedId = null, loading = false, busy = false, error = '';
  let search = null, searchMode = false, searching = false, searchError = '', query = '', recommendationScroll = 0;
  const retained = new Set(), previousChoices = new Map(), drafts = new Map();
  const expandedSearchResults = new Set();
  const endpoint = project => `/api/projects/${encodeURIComponent(project)}/subscription`;
  const post = (project, action, body) => api(endpoint(project) + '/' + action, {method:'POST',body:JSON.stringify(body)});
  const selectedSubscription = () => data?.subscriptions.find(s => s.id === selectedId);
  const keyOf = ({run,candidate}) => `${run.wait_id}:${candidate.id}`;
  const safeURL = value => { try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? esc(url.href) : ''; } catch { return ''; } };
  const entries = () => (data?.runs || []).flatMap(run => (run.payload?.candidates || []).map(candidate => ({run,candidate})));
  const searchEntries = () => (search?.waits || []).flatMap(wait => {
    const shown = new Set((wait.payload.recommendation?.papers || []).map(p => p.candidate_id));
    return (wait.payload.candidates || []).filter(c => shown.has(c.id)).map(candidate => ({run:{wait_id:wait.id,payload:wait.payload},candidate}));
  });
  const pending = c => ['pending','saved'].includes(c.choice);
  const sourceLabel = source => ({arxiv:'arXiv',openalex:'OpenAlex',semantic_scholar:'Semantic Scholar',doi:'DOI'}[source] || source || '来源未提供');
  const fulltextLabel = value => ({downloaded:'全文已获取',provided:'全文已提供',pending:'全文获取中',failed:'全文获取失败',unavailable:'全文暂不可用'})[value] || '尚未获取全文';
  const dayOf = value => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}); };

  function card(item) {
    const {run,candidate:c} = item, p = c.preferred || {}, key = keyOf(item);
    const reason = run.payload.recommendation?.papers?.find(r => r.candidate_id === c.id)?.reason;
    const authors = (p.authors || []).slice(0,2).join(', ') + ((p.authors || []).length > 2 ? ' et al.' : '');
    const meta = [authors,String(p.published || '').slice(0,4),p.venue || sourceLabel(p.source)].filter(Boolean).join(' · ');
    const label = {collected:'已加入',rejected:'已忽略',removed:'已移出'}[c.choice], url = safeURL(p.url);
    const action = pending(c)
      ? `<button type="button" class="primary" data-sub-choice="collected" ${busy ? 'disabled' : ''}>${icon('plus')}加入文献库</button><button type="button" class="quiet" data-sub-choice="rejected" ${busy ? 'disabled' : ''}>忽略</button>`
      : `<span class="recommendation-status">${esc(label)}</span>${previousChoices.has(key) ? `<button type="button" class="quiet" data-sub-undo ${busy ? 'disabled' : ''}>撤销</button>` : `<button type="button" class="quiet" data-sub-choice="${c.choice === 'rejected' ? 'pending' : c.choice === 'removed' ? 'collected' : 'removed'}" ${busy ? 'disabled' : ''}>${c.choice === 'rejected' ? '恢复推荐' : c.choice === 'removed' ? '恢复到文献库' : '移出文献库'}</button>`}`;
    return `<article class="recommendation-row" data-sub-wait="${esc(run.wait_id)}" data-sub-candidate="${esc(c.id)}"><details class="recommendation-detail" data-key="${esc(key)}"><summary><span class="recommendation-title">${esc(p.title || '未命名论文')}</span>${icon('chevron')}</summary><div class="recommendation-expanded"><p>${esc(p.summary || '来源未提供摘要，可打开原文查看。')}</p><div class="recommendation-facts"><span>${esc(fulltextLabel(c.availability?.fulltext))}</span>${run.subscription_id ? `<span>来自 ${esc(data?.subscriptions.find(s => s.id === run.subscription_id)?.name || '历史订阅')}</span>` : ''}${url ? `<a href="${url}" target="_blank" rel="noreferrer">查看原文 ↗</a>` : ''}</div></div></details><p class="recommendation-meta">${esc(meta)}</p>${reason ? `<p class="recommendation-reason">${esc(reason)}</p>` : ''}<div class="recommendation-actions">${action}</div></article>`;
  }

  function recommendationsHTML() {
    if (!data) return `<div class="discovery-empty"><h3>${error ? '暂时无法读取推荐' : '正在读取推荐…'}</h3>${error ? `<p role="alert">${esc(error)}</p><button data-sub-action="retry">重新读取</button>` : ''}</div>`;
    const all = entries(), items = all.filter(i => pending(i.candidate) || retained.has(keyOf(i)));
    const today = items.filter(i => (dayOf(i.candidate.discovered_at || i.run.created) || i.run.day) === data.today);
    const earlier = items.filter(i => !today.includes(i)), history = all.filter(i => !pending(i.candidate) && !retained.has(keyOf(i)));
    const latest = data.runs.find(r => r.operation === 'run');
    const status = error || (latest?.status === 'failed' ? latest.error : latest?.status === 'partial' ? latest.warning || '部分来源未完成，已取得的论文仍可查看。' : '');
    return `${status ? `<p class="discovery-notice" role="status">${esc(status)}<button class="quiet" data-sub-action="settings">查看设置</button></p>` : ''}<div class="discovery-section-head"><h3>今日推荐${today.length ? ` <span>${today.length}</span>` : ''}</h3><span>${esc((data.today || '').replaceAll('-','.'))}</span></div>${today.map(card).join('') || `<div class="discovery-empty"><h3>${data.subscriptions.length ? latest?.status === 'running' ? '正在寻找相关论文' : '今天暂无新推荐' : '让新论文找到你'}</h3><p>${data.subscriptions.length ? '此前未处理的论文会继续保留。也可以主动搜索。' : '设定研究方向，每天查看值得关注的新论文。'}</p>${!data.subscriptions.length ? '<button class="primary" data-sub-action="settings">设置推荐方向</button>' : ''}</div>`}${earlier.length ? `<section class="discovery-earlier"><div class="discovery-section-head"><h3>此前未处理 <span>${earlier.length}</span></h3></div>${earlier.map(card).join('')}</section>` : ''}${history.length ? `<details class="discovery-history" data-key="history"><summary>已处理 · ${history.length}</summary>${history.map(card).join('')}</details>` : ''}`;
  }
  function searchCard(item) {
    const {run,candidate:c} = item, p = c.preferred || {}, key = keyOf(item);
    const title = p.title || '未命名论文', year = String(p.published || '').slice(0,4);
    const open = expandedSearchResults.has(key), detailId = `search-result-${encodeURIComponent(key)}`;
    const metadata = [...new Set([(p.authors || []).join(', '),p.venue,sourceLabel(p.source)].filter(Boolean))].join(' · ');
    const reason = run.payload.recommendation?.papers?.find(r => r.candidate_id === c.id)?.reason;
    const indexReasons = [p.source,'openalex','semantic_scholar'].map(source => `${source} · ${p.published || '日期未提供'}；${p.summary ? '摘要：' + p.summary.slice(0,180) : '来源未提供摘要。'}`);
    const showReason = reason && reason !== p.summary && !indexReasons.includes(reason);
    const url = safeURL(p.url), disabled = busy ? 'disabled' : '';
    const label = {collected:'已加入',rejected:'已忽略',removed:'已移出'}[c.choice] || '已处理';
    const action = pending(c)
      ? `<button type="button" class="search-result-add" data-sub-choice="collected" ${disabled}>${icon('plus')}加入文献库</button>`
      : `<div class="search-result-status recommendation-status"><span>${esc(label)}</span>${previousChoices.has(key) ? `<button type="button" class="quiet" data-sub-undo ${disabled}>撤销</button>` : ''}</div>`;
    const secondary = pending(c)
      ? `<button type="button" class="quiet" data-sub-choice="rejected" ${disabled}>忽略</button>`
      : !previousChoices.has(key) ? `<button type="button" class="quiet" data-sub-choice="${c.choice === 'rejected' ? 'pending' : c.choice === 'removed' ? 'collected' : 'removed'}" ${disabled}>${c.choice === 'rejected' ? '恢复推荐' : c.choice === 'removed' ? '恢复到文献库' : '移出文献库'}</button>` : '';
    return `<article class="recommendation-row search-result-row" data-sub-wait="${esc(run.wait_id)}" data-sub-candidate="${esc(c.id)}">
      <div class="search-result-head"><div class="search-result-heading"><h3 class="recommendation-title">${esc(title)}</h3>${year ? `<p class="search-result-year">${esc(year)}</p>` : ''}</div>${action}<button type="button" class="search-result-toggle" data-sub-expand="${esc(key)}" aria-expanded="${open}" aria-controls="${esc(detailId)}" aria-label="${open ? '收起' : '展开'}详情：${esc(title)}"><span>${open ? '收起' : '详情'}</span>${icon('chevron')}</button></div>
      <div class="recommendation-expanded search-result-detail" id="${esc(detailId)}" ${open ? '' : 'hidden'}><p class="recommendation-meta">${esc(metadata)}</p><div class="search-result-summary-head"><h4>摘要</h4>${p.summary?.trim() ? `<button type="button" class="search-result-translate" data-sub-translate aria-label="翻译摘要：${esc(title)}">${icon('translate')}翻译摘要</button>` : ''}</div><p>${esc(p.summary || '来源未提供摘要，可打开原文查看。')}</p>${showReason ? `<div class="search-result-reason"><h4>推荐理由</h4><p>${esc(reason)}</p></div>` : ''}<div class="recommendation-facts"><span>${esc(fulltextLabel(c.availability?.fulltext))}</span>${p.published && String(p.published).length > 4 ? `<span>发表于 ${esc(p.published)}</span>` : ''}</div><div class="search-result-detail-actions">${url ? `<a href="${url}" target="_blank" rel="noreferrer">查看原文 ↗</a>` : ''}${secondary}</div></div>
    </article>`;
  }
  function searchHTML() {
    const items = searchEntries(), gaps = search?.refs?.partial_gaps || [];
    const failure = searchError || (search?.status === 'failed' ? search.error || '搜索失败，请重试。' : '');
    const note = failure || (searching ? '正在检索，结果会陆续显示…' : search ? `${items.length} 篇结果` : '搜索外部论文，选择后加入文献库。');
    const warning = gaps.length ? `<details class="discovery-source-warning" data-key="search-source-warning"><summary>${icon('alert')}<span>部分来源暂不可用</span><span class="discovery-warning-toggle"><span class="warning-show">查看原因</span><span class="warning-hide">收起原因</span>${icon('chevron')}</span></summary><div class="discovery-warning-detail">${gaps.map(gap => `<p>${esc(String(gap).replaceAll('semantic_scholar','Semantic Scholar').replaceAll('openalex','OpenAlex'))}</p>`).join('')}</div></details>` : '';
    return `<div class="discovery-search-page"><form id="library-search" class="discovery-search"><label class="compact-search-field">${icon('search')}<span class="sr-only">搜索外部论文</span><input id="library-query" aria-label="搜索外部论文" name="query" type="search" minlength="2" maxlength="200" required placeholder="输入论文关键词" value="${esc(query)}"><button type="button" class="icon" data-sub-action="clear-search" aria-label="清空外部论文搜索">${icon('close')}</button></label><button type="submit" class="primary" ${searching ? 'disabled' : ''}>${searching ? '搜索中…' : '搜索'}</button></form><div class="discovery-search-summary"><p class="discovery-search-note${failure ? ' search-failed' : ''}" role="${failure ? 'alert' : 'status'}">${esc(note)}</p>${warning}</div><div class="discovery-search-results">${items.map(searchCard).join('')}</div>${search && !searching && !items.length && !failure ? '<div class="discovery-empty"><h3>没有找到可展示的新论文</h3><p>试试更明确的关键词，或调整检索范围。</p></div>' : ''}</div>`;
  }
  function paint() {
    if (projectId !== current?.id) return;
    const nav = document.querySelector('[data-action="shell"][data-value="library"]');
    nav?.querySelector('.subscription-count')?.remove();
    const count = entries().filter(i => pending(i.candidate)).length;
    if (count) nav?.insertAdjacentHTML('beforeend',`<span class="badge subscription-count" aria-label="${count} 篇待确认">${count}</span>`);
    if (shellView !== 'library' || middleView !== 'library') return;
    const host = document.getElementById('chat-body');
    panelHeading('chat-panel',searchMode ? '搜索论文' : '论文推荐');
    const tools = document.getElementById('chat-tools'), toolsHTML = `<button type="button" class="quiet" data-sub-action="${searchMode ? 'back' : 'search'}">${icon(searchMode ? 'back' : 'search')}${searchMode ? '返回推荐' : '搜索论文'}</button><button type="button" class="quiet" data-sub-action="settings">订阅设置</button>`;
    if (tools.innerHTML !== toolsHTML) tools.innerHTML = toolsHTML;
    host.className = 'discovery-body';
    const html = searchMode ? searchHTML() : recommendationsHTML();
    if (host.dataset.html === html) return;
    const top = host.scrollTop, opened = new Set([...host.querySelectorAll('details[open]')].map(d => d.dataset.key));
    const active = document.activeElement, input = host.querySelector('#library-query');
    const focusedQuery = active === input, typed = input?.value, focusedCard = active?.closest('[data-sub-candidate]');
    const focus = focusedCard ? {wait:focusedCard.dataset.subWait,candidate:focusedCard.dataset.subCandidate,choice:active.dataset.subChoice,expand:active.hasAttribute('data-sub-expand'),undo:active.hasAttribute('data-sub-undo'),translate:active.hasAttribute('data-sub-translate')} : null;
    host.innerHTML = html; host.dataset.html = html;
    host.querySelectorAll('details').forEach(d => { if (opened.has(d.dataset.key)) d.open = true; });
    if (input && searchMode && typed !== undefined) host.querySelector('#library-query').value = typed;
    if (focusedQuery) host.querySelector('#library-query')?.focus({preventScroll:true});
    if (focus) {
      const row = [...host.querySelectorAll('[data-sub-candidate]')].find(n => n.dataset.subWait === focus.wait && n.dataset.subCandidate === focus.candidate);
      const control = focus.translate ? row?.querySelector('[data-sub-translate]') : focus.expand ? row?.querySelector('[data-sub-expand]') : focus.undo ? row?.querySelector('[data-sub-undo]') : focus.choice ? row?.querySelector(`[data-sub-choice="${focus.choice}"]`) : null;
      (control || row?.querySelector('[data-sub-undo], [data-sub-expand], summary'))?.focus({preventScroll:true});
    }
    host.scrollTop = top;
  }
  async function load() {
    if (!current?.id || loading || busy) return;
    const project = current.id;
    if (projectId !== project) {
      document.querySelector('.subscription-settings-dialog')?.close();
      projectId = project; data = search = null; selectedId = null; searchMode = searching = false; query = error = searchError = ''; retained.clear(); previousChoices.clear(); drafts.clear(); expandedSearchResults.clear();
    }
    loading = true;
    try {
      const next = await api(endpoint(project));
      if (current?.id !== project || busy) return;
      data = next; error = '';
      if (!data.subscriptions.some(s => s.id === selectedId)) selectedId = data.subscriptions[0]?.id || null;
      paint();
      if (current.papers.some(p => p.availability?.fulltext === 'pending')) {
        const latest = await api(`/api/projects/${encodeURIComponent(project)}`);
        if (current?.id !== project || busy) return;
        if (JSON.stringify(current.papers) !== JSON.stringify(latest.papers)) {
          current = {...current,papers:latest.papers};
          renderSources();
        }
      }
    } catch (e) { if (current?.id === project) { error = '订阅读取失败：' + e.message; paint(); } }
    finally { loading = false; }
  }
  function activate() { load(); paint(); }
  function leave() { retained.clear(); previousChoices.clear(); }
  window.MethodAtlasSubscriptions = {activate,leave,open:async id => { switchShellView('library'); await load(); selectedId = id || data?.subscriptions[0]?.id; openSettings(); }};

  const stash = () => { const form = document.getElementById('subscription-settings'); if (form && !busy) drafts.set(form.dataset.id,Object.fromEntries(new FormData(form))); };
  function formHTML(fresh = false) {
    const sub = fresh ? null : selectedSubscription(), fields = drafts.get(sub?.id || '') || {requirements:[sub?.requirements,sub?.excluded && `排除：${sub.excluded}`].filter(Boolean).join('\n\n'),time:sub?.time || '08:00',name:sub?.name || '每日论文推荐'};
    const running = data?.runs.some(r => r.subscription_id === sub?.id && r.status === 'running');
    return `<div class="modal-head"><div class="row between"><h2 id="subscription-title">${sub ? '订阅设置' : '设置推荐方向'}</h2><div class="row">${sub ? `<button type="button" class="quiet" data-sub-action="chat">${icon('chat')}与 AI 讨论</button>` : ''}<button type="button" class="icon" data-sub-close aria-label="关闭订阅设置">${icon('close')}</button></div></div></div><div class="modal-body">${data?.subscriptions.length ? `<div class="subscription-picker"><label for="subscription-picker">订阅</label><select id="subscription-picker">${data.subscriptions.map(s => `<option value="${esc(s.id)}" ${s.id === sub?.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="" ${!sub ? 'selected' : ''}>新建订阅</option></select></div>` : ''}<form id="subscription-settings" data-id="${esc(sub?.id || '')}" class="subscription-form"><div class="row between"><label for="subscription-direction">研究方向</label><button type="button" class="quiet" data-sub-action="ai">${icon('spark')}AI 帮我设定</button></div><textarea id="subscription-direction" name="requirements" maxlength="4000" required placeholder="你想持续关注哪些研究问题？">${esc(fields.requirements)}</textarea><p class="subscription-basis">AI 仅参考本项目主题、文献题名与摘要、近期研究日报。</p><div id="direction-preview" hidden></div><div class="subscription-fields"><label>每天运行时间 <span>北京时间</span><input type="time" name="time" required value="${esc(fields.time)}"></label><label>名称<input name="name" maxlength="100" required value="${esc(fields.name)}"></label></div><p id="subscription-error" role="status" hidden></p><div class="subscription-footer">${sub ? `<div class="row"><button type="button" data-sub-action="toggle">${sub.enabled ? '暂停订阅' : '启动订阅'}</button><button type="button" class="quiet" data-sub-action="run" ${running ? 'disabled' : ''}>${running ? '运行中…' : '立即运行'}</button></div>` : '<span class="subscription-basis">启用后从下一个设定时间开始推荐。</span>'}<button type="submit" class="primary">${sub ? '保存更改' : '确认启用'}</button></div></form></div>`;
  }
  function openSettings() {
    if (!data) { toast(error || '正在读取订阅，请稍后重试。'); load(); return; }
    if (document.querySelector('.subscription-settings-dialog')) return;
    const dialog = document.createElement('dialog'); dialog.className = 'subscription-settings-dialog';
    dialog.setAttribute('aria-labelledby','subscription-title'); dialog.innerHTML = formHTML();
    dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); else stash(); });
    dialog.addEventListener('close',() => dialog.remove());
    document.body.append(dialog); dialog.showModal();
    if (data.archived) { dialog.querySelectorAll('form button,form input,form textarea').forEach(n => n.disabled = true); formError('项目已归档，无法修改订阅。'); }
  }
  function formError(message) { const node = document.getElementById('subscription-error'); if (node) { node.hidden = !message; node.textContent = message; } }
  function lockForm(value) { document.querySelectorAll('.subscription-settings-dialog button,.subscription-settings-dialog input,.subscription-settings-dialog textarea,.subscription-settings-dialog select').forEach(n => { if (value) { n.dataset.disabled = String(n.disabled); n.disabled = true; } else n.disabled = n.dataset.disabled === 'true'; }); }
  async function saveSettings() {
    const form = document.getElementById('subscription-settings');
    if (!form || !form.reportValidity() || busy) return false;
    const project = current.id, ident = form.dataset.id, body = Object.fromEntries(new FormData(form));
    busy = true; lockForm(true); formError('正在保存…');
    try {
      const result = await post(project,ident ? 'settings' : 'create',ident ? {...body,excluded:'',subscription_id:ident} : body);
      if (project !== current?.id || !form.isConnected) return false;
      data = result; selectedId = ident || result.subscriptions.at(-1)?.id;
      form.dataset.id = selectedId; drafts.delete(ident);
      const failure = result.runs.find(r => r.subscription_id === selectedId)?.error;
      if (!ident && failure) { form.closest('dialog').innerHTML = formHTML(); formError(failure); return false; }
      formError('已保存'); paint(); return true;
    } catch (e) { formError(e.message); return false; }
    finally { busy = false; lockForm(false); }
  }
  async function draftDirection() {
    const form = document.getElementById('subscription-settings'); if (!form || busy) return;
    const project = current.id, requirements = form.elements.requirements.value;
    busy = true; lockForm(true); formError('正在根据项目资料拟定方向…');
    try {
      const result = await post(project,'draft',{requirements});
      if (project !== current?.id || !form.isConnected) return;
      const preview = document.getElementById('direction-preview'); preview.hidden = false;
      preview.innerHTML = '<h3>建议方向</h3><p></p><div class="row"><button type="button" class="primary" data-sub-action="adopt">采用</button><button type="button" data-sub-action="cancel-draft">取消</button></div>';
      preview.querySelector('p').textContent = result.requirements; formError('采用后仍可编辑，保存才会生效。');
    } catch (e) { formError(e.message); }
    finally { busy = false; lockForm(false); }
  }
  async function choose(node, choice, undo = false) {
    if (busy) return;
    const project = current.id, isSearch = searchMode;
    const item = (isSearch ? searchEntries() : entries()).find(i => i.run.wait_id === node.dataset.subWait && i.candidate.id === node.dataset.subCandidate);
    if (!item) return;
    const key = keyOf(item), previous = item.candidate.choice;
    if (undo) choice = previousChoices.get(key);
    if (previous === 'collected' && choice === 'saved') choice = 'pending';
    busy = true; paint();
    try {
      const result = await post(project,'choose',{wait_id:item.run.wait_id,candidate_id:item.candidate.id,choice});
      if (current?.id !== project) return;
      if (undo) previousChoices.delete(key); else previousChoices.set(key,previous);
      retained.add(key); if (isSearch) search = result; else data = result;
      const latest = await api(`/api/projects/${encodeURIComponent(project)}`);
      if (current?.id !== project) return;
      current = {...current,papers:latest.papers};
      for (const id of selected) if (!current.papers.some(p => p.id === id)) selected.delete(id);
      renderSources();
    } catch (e) { toast(e.message); }
    finally { busy = false; paint(); }
  }
  async function runSearch(form) {
    if (searching || !form.reportValidity()) return;
    const project = current.id;
    query = form.elements.query.value.trim(); search = null; searchError = ''; searching = true; expandedSearchResults.clear(); paint();
    try {
      const result = await post(project,'search',{query});
      if (current?.id !== project) return;
      search = {id:result.id,status:'running',waits:[]}; await pollSearch();
    } catch (e) { if (current?.id === project) { searchError = e.message; searching = false; paint(); } }
  }
  let pollingSearch = false;
  async function pollSearch() {
    if (!searching || !search?.id || pollingSearch || busy) return;
    const project = projectId, ident = search.id; pollingSearch = true;
    try {
      const next = await api(endpoint(project) + '/search/' + encodeURIComponent(ident));
      if (current?.id !== project || search?.id !== ident || busy) return;
      search = next; searching = ['running','queued'].includes(next.status); searchError = ''; paint();
    } catch (e) { if (current?.id === project) { searchError = '搜索状态读取失败：' + e.message; searching = false; paint(); } }
    finally { pollingSearch = false; }
  }
  document.addEventListener('submit',async event => {
    if (event.target.id === 'library-search') { event.preventDefault(); runSearch(event.target); }
    if (event.target.id === 'subscription-settings') { event.preventDefault(); if (await saveSettings()) document.querySelector('.subscription-settings-dialog')?.close(); }
  });
  document.addEventListener('change',event => {
    if (event.target.id !== 'subscription-picker') return;
    stash(); selectedId = event.target.value || null; event.target.closest('dialog').innerHTML = formHTML(!selectedId);
  });
  document.addEventListener('click',async event => {
    const translate = event.target.closest('[data-sub-translate]');
    if (translate) {
      const row = translate.closest('[data-sub-candidate]');
      const item = searchEntries().find(i => i.run.wait_id === row.dataset.subWait && i.candidate.id === row.dataset.subCandidate);
      const paper = item?.candidate.preferred;
      if (paper?.summary?.trim()) openSelectionTranslate(paper.summary, paper.title || '论文摘要', translate.getBoundingClientRect());
      return;
    }
    const disclosure = event.target.closest('[data-sub-expand]');
    if (disclosure) {
      const key = disclosure.dataset.subExpand, open = !expandedSearchResults.has(key);
      if (open) expandedSearchResults.add(key); else expandedSearchResults.delete(key);
      const detail = document.getElementById(disclosure.getAttribute('aria-controls'));
      if (detail) detail.hidden = !open;
      disclosure.setAttribute('aria-expanded',String(open));
      disclosure.setAttribute('aria-label',`${open ? '收起' : '展开'}详情：${disclosure.closest('.search-result-row').querySelector('.recommendation-title').textContent}`);
      disclosure.querySelector('span').textContent = open ? '收起' : '详情';
      document.getElementById('chat-body').dataset.html = searchHTML();
      return;
    }
    const choice = event.target.closest('[data-sub-choice],[data-sub-undo]');
    if (choice) { choose(choice.closest('[data-sub-wait]'),choice.dataset.subChoice,choice.hasAttribute('data-sub-undo')); return; }
    if (event.target.closest('[data-sub-close]')) { if (!busy) { stash(); event.target.closest('dialog')?.close(); } return; }
    const action = event.target.closest('[data-sub-action]')?.dataset.subAction; if (!action) return;
    if (action === 'retry') { load(); return; }
    if (action === 'clear-search') {
      query=''; const input=document.getElementById('library-query'); if(input) input.value='';
      paint(); document.getElementById('library-query')?.focus({preventScroll:true});
      return;
    }
    if (action === 'settings') { openSettings(); return; }
    if (action === 'chat' && !busy) {
      const sub=selectedSubscription();if(!sub)return;
      stash();
      const settings=Object.fromEntries(['id','name','requirements','excluded','time','enabled','next_run'].map(k=>[k,sub[k]]));
      if(await window.MethodAtlasAI.open({id:uid(),kind:'subscription',subscription_id:sub.id,title:sub.name,text:JSON.stringify(settings,null,2)})){
        document.querySelector('.subscription-settings-dialog')?.close();
        document.getElementById('chat-input')?.focus({preventScroll:true});
      }
      return;
    }
    if (action === 'search' || action === 'back') {
      const host = document.getElementById('chat-body');
      if (action === 'search') recommendationScroll = host.scrollTop;
      if (action === 'back') query = document.getElementById('library-query')?.value ?? query;
      searchMode = action === 'search'; paint(); host.scrollTop = searchMode ? 0 : recommendationScroll;
      if (searchMode) document.getElementById('library-query')?.focus(); return;
    }
    if (action === 'ai') { draftDirection(); return; }
    if (action === 'adopt' || action === 'cancel-draft') {
      const preview = document.getElementById('direction-preview');
      if (action === 'adopt') document.getElementById('subscription-direction').value = preview.querySelector('p').textContent;
      preview.hidden = true; preview.replaceChildren(); formError(''); document.getElementById('subscription-direction').focus(); return;
    }
    if (!['toggle','run'].includes(action) || busy) return;
    const project = current.id, sub = selectedSubscription(); if (!sub) return;
    const form = document.getElementById('subscription-settings');
    const stored = {...sub,requirements:[sub.requirements,sub.excluded && `排除：${sub.excluded}`].filter(Boolean).join('\n\n')};
    if (['requirements','name','time'].some(key => form.elements[key].value !== stored[key])) {
      formError('请先保存更改，再操作订阅。当前输入已保留。'); return;
    }
    busy = true; lockForm(true); formError(action === 'run' ? '正在运行…' : '正在更新…');
    try {
      const result = await post(project,action === 'run' ? 'run' : sub.enabled ? 'settings' : 'enable',{subscription_id:sub.id,...(action === 'toggle' && sub.enabled ? {enabled:false} : {})});
      if (current?.id !== project) return;
      data = result; const dialog = document.querySelector('.subscription-settings-dialog'); if (dialog) dialog.innerHTML = formHTML();
      const startsRun = action === 'run' || !sub.enabled;
      const run = startsRun ? data.runs.find(r => r.id === data.operation_run_id && r.subscription_id === sub.id) : null;
      if (startsRun && !run) throw Error('本次订阅未启动，请刷新状态后重试。');
      formError(run?.status === 'failed' ? run.error : startsRun ? run.status === 'running' ? '正在运行…' : run.status === 'partial' ? '部分完成，可关闭设置查看推荐。' : '运行完成，可关闭设置查看推荐。' : '已更新'); paint();
    } catch (e) { formError(e.message); }
    finally { busy = false; lockForm(false); }
  });
  setInterval(() => { load(); pollSearch(); },3000); load();
})();
