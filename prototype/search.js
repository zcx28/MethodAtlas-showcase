// Source filtering and the shared search dialog use the existing navigation and saved content.
(() => {
  const sources = new Map();
  const listFilters = new Map();
  const listFields = {project:{id:'project-search',name:'项目',placeholder:'搜索项目'},conversation:{id:'conversation-search',name:'对话',placeholder:'搜索对话'},source:{id:'source-search-input',name:'资料',placeholder:'搜索资料'}};
  const listState = scope => {
    if(scope==='source')return local();
    const key = scope === 'project' ? scope : `${scope}:${current?.id || ''}`;
    if (!listFilters.has(key)) listFilters.set(key,{open:false,query:''});
    return listFilters.get(key);
  };
  function compact(scope) {
    const state = listState(scope), field = listFields[scope];
    return `<div class="compact-search compact-search-${scope}" data-search-for="${scope}" data-search-open="${state.open}"><button type="button" class="compact-search-trigger ${scope==='source'?'icon':''} ${state.query?'search-active':''}" data-search-compact="${scope}" ${scope==='source'?'data-search-local="toggle"':''} aria-label="搜索${field.name}" aria-expanded="${state.open}" aria-controls="${field.id}-field" ${state.open && scope!=='source'?'hidden':''} ${state.open?'inert':''}>${icon('search')}<span ${scope==='project'?'':'class="sr-only"'}>搜索${field.name}</span></button><div class="compact-search-field ${scope==='source'?'source-search-field':''}" id="${field.id}-field" ${state.open?'':'hidden'}>${icon('search')}<input id="${field.id}" type="search" ${scope==='source'?'maxlength="200"':''} autocomplete="off" aria-label="${scope==='source'?'搜索当前项目资料':'搜索'+field.name}" placeholder="${field.placeholder}" value="${esc(state.query)}"><button type="button" class="icon" data-search-list="close" data-search-scope="${scope}" aria-label="关闭${field.name}搜索">${icon('close')}</button></div></div>`;
  }
  function syncCompact(scope) {
    const state=listState(scope), host=document.querySelector(`[data-search-for="${scope}"]`);
    if(!host)return;
    host.dataset.searchOpen=String(state.open);
    const trigger=host.querySelector('[data-search-compact]');
    trigger.hidden=state.open && scope!=='source';trigger.inert=state.open;trigger.setAttribute('aria-expanded',String(state.open));
    trigger.classList.toggle('search-active',!!state.query);
    host.querySelector('.compact-search-field').hidden=!state.open;
    document.querySelectorAll(`[data-search-background="${scope}"]`).forEach(node=>node.inert=state.open);
    (state.open?host.querySelector('input'):trigger).focus({preventScroll:true});
  }
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
  const local = () => {
    const id = current?.id || '';
    if (!sources.has(id)) sources.set(id,{open:false,query:'',closed:new Set()});
    return sources.get(id);
  };
  const query = () => local().query.trim();
  const terms = value => normalize(value).trim().split(/\s+/).filter(Boolean);
  const label = paper => sourceOrganization().labels.find(item=>item.id===sourceOrganization().assignments[paper.id])?.name || '未分类';
  function filter(papers) {
    const words = terms(query());
    if (!words.length) return papers;
    return papers.filter(paper => {
      const meta = paper.metadata || {}, authors = Array.isArray(meta.authors) ? meta.authors.map(a=>typeof a==='string' ? a : a.name || a.display_name || '').join(' ') : meta.authors || '';
      const text = normalize([paper.title,authors,label(paper),meta.summary || meta.abstract || ''].join(' '));
      return words.every(word=>text.includes(word));
    });
  }
  function highlight(text, value = query()) {
    const words = value.trim().split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
    if (!words.length) return esc(text);
    const pattern = new RegExp(`(${words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'gi');
    return String(text).split(pattern).map((part,i)=>i%2 ? `<mark class="search-match">${esc(part)}</mark>` : esc(part)).join('');
  }
  function footer() {
    if (!query()) return '';
    const hidden = current.papers.filter(p=>selected.has(p.id) && !filter([p]).length).length;
    return hidden ? `<p class="sr-only" role="status">另有 ${hidden} 篇已选资料被筛选隐藏。</p>` : '';
  }
  function refreshLocal(focus = true) {
    const input = document.getElementById('source-search-input'), position = input?.selectionStart;
    renderSources();
    if (focus) {
      const next = document.getElementById('source-search-input');
      next?.focus({preventScroll:true});
      if (position !== null && position !== undefined) next?.setSelectionRange(position,position);
    }
  }
  const types = {all:'全部',paper:'资料',conversation:'对话',artifact:'成果'};
  let dialog, results = [], more = false, active = 0, request = 0, timer, controller, busy = false;
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.id = 'workspace-search'; dialog.setAttribute('aria-label','搜索已保存的内容');
    dialog.innerHTML = `<div class="workspace-search-input compact-search-field">${icon('search')}<input id="workspace-search-query" type="search" maxlength="200" placeholder="搜索已保存的内容" aria-label="搜索关键词" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="workspace-search-results" aria-expanded="false"><button class="icon" type="button" data-search-close aria-label="关闭搜索">${icon('close')}</button></div><div id="workspace-search-status" class="sr-only" role="status"></div><div id="workspace-search-results" role="listbox" aria-label="搜索结果" hidden></div>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => { clearTimeout(timer); controller?.abort(); request++; const input = document.getElementById('workspace-search-query'); if (input) input.value = ''; });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) { const r=dialog.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close(); }
    });
  }
  function selectResult(index, scroll = false) {
    active = Math.max(0,Math.min(index,results.length-1));
    dialog.querySelectorAll('[data-search-result]').forEach(node=>node.setAttribute('aria-selected',String(Number(node.dataset.searchResult)===active)));
    const node = dialog.querySelector(`[data-search-result="${active}"]`), input = document.getElementById('workspace-search-query');
    if(node) input.setAttribute('aria-activedescendant',node.id); else input.removeAttribute('aria-activedescendant');
    if(scroll) node?.scrollIntoView({block:'nearest'});
  }
  function paintResults() {
    const q = document.getElementById('workspace-search-query').value;
    const host = document.getElementById('workspace-search-results');
    host.hidden = !q.trim();
    document.getElementById('workspace-search-query').setAttribute('aria-expanded',String(!host.hidden));
    host.innerHTML = results.map((item,i)=>`<button type="button" id="workspace-search-result-${i}" role="option" tabindex="-1" data-search-result="${i}" aria-selected="${i===active}" aria-disabled="${!item.openable}" aria-label="${esc(types[item.kind])}：${esc(item.title)}，${esc(item.project_name)}${item.openable ? '' : '，暂无正文'}" class="workspace-search-result">${icon({paper:'file',conversation:'chat',artifact:'output'}[item.kind])}<span class="search-result-copy"><strong>${highlight(item.title,q)}</strong><small>${esc(item.project_name)}${item.openable ? '' : ' · 暂无正文'}</small></span></button>`).join('') || (q.trim() ? '<p class="search-empty">没有找到匹配内容</p>' : '');
    if(more) host.insertAdjacentHTML('beforeend','<button type="button" class="search-load-more" data-search-more>显示更多结果</button>');
    host.setAttribute('aria-busy','false');
    document.getElementById('workspace-search-status').textContent = q.trim() ? `显示 ${results.length} 条结果` : '';
    selectResult(active);
  }
  async function runSearch(append = false) {
    clearTimeout(timer); controller?.abort(); controller = new AbortController();
    const sequence = ++request, q = document.getElementById('workspace-search-query').value.trim();
    if (!append) {results=[];active=0;more=false;paintResults();}
    if (!q) return;
    const host = document.getElementById('workspace-search-results');
    host.setAttribute('aria-busy','true');
    if (!append) host.innerHTML='<p class="search-empty" role="status">正在搜索…</p>';
    const params = new URLSearchParams({q,scope:'all',kind:'all',project_id:current?.id || '',offset:String(append ? results.length : 0)});
    try {
      const data = await api('/api/search?'+params,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(sequence!==request || !dialog.open) return;
      results = append ? [...results,...data.results] : data.results;
      more=data.has_more;paintResults();
    } catch(error) {
      if(sequence!==request || !dialog.open) return;
      host.setAttribute('aria-busy','false');
      host.innerHTML=`<div class="search-empty" role="alert">${esc(error.message)}<button type="button" class="quiet" data-search-retry>重新搜索</button></div>`;
    }
  }
  function open() {
    ensureDialog();
    document.getElementById('source-menu')?.hidePopover();
    if(!dialog.open) dialog.showModal();
    document.getElementById('workspace-search-query').focus();
    runSearch();
  }
  async function navigate(index) {
    const item = results[index];
    if(!item || busy || !item.openable) return;
    busy=true;
    try {
      await window.MethodAtlasWriting?.flush();
      if(current?.id!==item.project_id || item.kind==='conversation') await openProject(item.project_id,item.kind==='conversation' ? item.id : null);
      if(current?.id!==item.project_id || item.kind==='conversation' && conversation?.id!==item.id) throw Error('未能打开对应项目，请重试。');
      dialog.close();
      if(item.kind==='paper') await showPaper(item.id,item.page,item.version_id);
      if(item.kind==='artifact') await loadArtifact(item.id,item.version_id);
      if(item.kind==='conversation') {
        switchShellView('chat'); revealPanel('chat-panel');
        const message = document.querySelector(`[data-message-id="${CSS.escape(item.message_id || '')}"]`);
        if(message) {message.tabIndex=-1;message.focus({preventScroll:true});message.scrollIntoView({block:'center'});message.classList.add('search-located');setTimeout(()=>message.classList.remove('search-located'),1800);}
      }
    } catch(error) { document.getElementById('workspace-search-status').textContent=error.message;toast(error.message); }
    finally {busy=false;}
  }
  function updateInput(event) {
    if(event.isComposing) return;
    if(event.target.id==='project-search') {listState('project').query=event.target.value;renderProjects();}
    if(event.target.id==='conversation-search') {listState('conversation').query=event.target.value;renderConversationRows();}
    if(event.target.id==='source-search-input') {local().query=event.target.value;local().closed.clear();refreshLocal();}
    if(event.target.id==='workspace-search-query') {
      controller?.abort();request++;clearTimeout(timer);
      results=[];more=false;active=0;paintResults();
      if(event.target.value.trim()) timer=setTimeout(()=>runSearch(),180);
    }
  }
  document.addEventListener('input',updateInput);
  document.addEventListener('compositionend',updateInput);
  document.addEventListener('click',event=>{
    const target=event.target.closest('button'); if(!target || target.disabled) return;
    if(target.hasAttribute('data-search-global')) open();
    if(target.hasAttribute('data-search-close')) dialog.close();
    if(target.hasAttribute('data-search-result')) navigate(Number(target.dataset.searchResult));
    if(target.hasAttribute('data-search-more')) runSearch(true);
    if(target.hasAttribute('data-search-retry')) runSearch();
    if(target.dataset.searchCompact) {const scope=target.dataset.searchCompact;listState(scope).open=true;syncCompact(scope);}
    if(target.dataset.searchList) {
      // × 一键收起：清空关键词（列表恢复全量）并关闭搜索框。
      const scope=target.dataset.searchScope, input=document.getElementById(listFields[scope].id), hadQuery=listState(scope).query;
      listState(scope).open=false; listState(scope).query='';
      if(input) input.value='';
      if(scope==='source') refreshLocal(false);
      else if(hadQuery) { scope==='project' ? renderProjects() : renderConversationRows(); }
      syncCompact(scope);
    }

  });
  document.addEventListener('keydown',event=>{
    if(event.isComposing) return;
    const scope=Object.keys(listFields).find(key=>listFields[key].id===event.target.id);
    if(scope && event.key==='Escape') {
      event.preventDefault();event.stopPropagation();
      if(listState(scope).query){event.target.value='';event.target.dispatchEvent(new Event('input',{bubbles:true}));}
      else {listState(scope).open=false;syncCompact(scope);}
      return;
    }
    if(dialog?.open && event.key==='Escape') {event.preventDefault();event.stopPropagation();dialog.close();return;}
    if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k' && !event.altKey) {
      if(document.querySelector('dialog[open]') && !dialog?.open) return;
      event.preventDefault();open();return;
    }
    if(dialog?.open && (event.target.id==='workspace-search-query' || event.target.hasAttribute('data-search-result'))) {
      if(['ArrowDown','ArrowUp'].includes(event.key)) {event.preventDefault();selectResult(active+(event.key==='ArrowDown'?1:-1),true);}
      if(event.key==='Enter') {event.preventDefault();navigate(active);}
    }
    if(event.target.id==='source-search-input' || event.target.closest('#paper-list') && query()) {
      if(event.key==='Escape') {event.preventDefault();if(query())local().query='';else local().open=false;local().closed.clear();refreshLocal();if(!local().open)document.querySelector('[data-search-local=toggle]')?.focus();}
      const rows=[...document.querySelectorAll('#paper-list .paper-link')].filter(node=>!node.closest('.is-collapsed'));
      if(['ArrowDown','ArrowUp'].includes(event.key)) {event.preventDefault();const index=rows.indexOf(document.activeElement),next=index+(event.key==='ArrowDown'?1:-1);if(next<0)document.getElementById('source-search-input')?.focus();else rows[Math.min(next,rows.length-1)]?.focus();}
      if(event.key==='Enter' && event.target.id==='source-search-input') {event.preventDefault();rows[0]?.click();}
    }
  },true);
  window.MethodAtlasSearch={query,filter,highlight,footer,open,compact,listQuery:scope=>listState(scope).query,listOpen:scope=>listState(scope).open,
    header:()=>`<button type="button" class="icon workspace-search-trigger" data-search-global aria-label="搜索已保存的内容" title="搜索（Ctrl / ⌘ K）">${icon('search')}</button>`,
    toggle:()=>compact('source'),
    collapsed:(id,saved)=>query() ? local().closed.has(id) : saved,
    toggleGroup:id=>{local().closed.has(id)?local().closed.delete(id):local().closed.add(id);refreshLocal(false);}
  };
})();
