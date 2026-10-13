(() => {
  if (typeof renderSources !== 'function' || typeof renderDetail !== 'function') return;

  const baseRenderSources = renderSources;
  const baseShowPaper = showPaper;
  const baseOpenMiddle = openMiddle;
  let addProjectId = null, addConversationId = null;
  const positionKey = (project,version) => `reader-position:${project}:${version}`;
  let readerMode = 'original', fullscreenPosition = null;
  let readingKey = '', entries = [], selection = null, aidTab = '', activeAid = null, showHighlights = false;
  let webMarks = [], noteWidth = 280;
  let aidRun = null, noteTimer = null, regionStart = null, pdfOutline = null;
  let readerSearch = '', readerSearchDraft = '', readerPageError = '';
  let selectionAnchor = null, selectionTimer = null, press = null, inlineRequest = 0;
  let translationSize = 15, readerError = null, inlineKind = null;
  let translationView = {visible:true, paragraphs:{}}, entriesState = 'loading';
  const readerApi = (paper = detail.paper, project = current.id) => `/api/projects/${project}/papers/${paper.id}/reader`;
  const sameReader = key => Boolean(current?.id&&detail?.paper&&`${current.id}:${detail.paper.version_id}`===key);
  // Zoom is a view setting, not a paper setting: one ratio follows the reader across papers and
  // sessions, and it drives both reading modes — a CSS zoom on the text, a higher raster scale on the
  // PDF, so zooming in sharpens the page instead of blowing up a bitmap.
  const ZOOM_MIN = 0.5, ZOOM_MAX = 3;
  const clampZoom = value => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((Number(value) || 1) * 100) / 100));
  let readerZoom = clampZoom((globalThis.MethodAtlasStorage?.local || localStorage).getItem('reader-zoom') || 1);
  // Full screen lives on <body>, not on a panel: the reader is mounted in whichever column owns it
  // (the library reads in the middle one, the workbench docks it over the source column), and what has
  // to change is the whole window. Reading the class back keeps one source of truth, so no stale flag
  // can strand the shell in a reading surface with no way out.
  const inFullscreen = () => document.body.classList.contains('reader-fullscreen');
  let pdfjsPromise = null, pdfDocumentKey = null, pdfDocumentPromise = null, pdfRenderGeneration = 0;
  let pdfResize = null, readerResize = null;

  function warningText(paper) {
    const availability = paper.availability || {};
    const conversion = availability.conversion || {};
    if (availability.fulltext === 'pending') return '正在后台获取全文，链接和摘要已保存。';
    if (availability.error) return availability.error;
    if (conversion.fallback_pages?.length) return `第 ${conversion.fallback_pages.join('、')} 页部分内容无法可靠转换，请核对保留的原图。`;
    if (availability.fulltext && !['downloaded','provided'].includes(availability.fulltext)) return '未取得可公开访问的完整 PDF；当前内容可能只有摘要或元数据。';
    if (availability.parse && !['parsed'].includes(availability.parse)) return '资料转换不完整，可以查看保留的原文或重试。';
    if (paper.status && paper.status.startsWith('unavailable:')) return `资料解析失败：${paper.status.slice('unavailable:'.length).trim() || '未知错误'}`;
    return '';
  }

  function externalSourceLink(paper) {
    const source = paperSource(paper), url = source.url || source.doi || source.pdf_url || '';
    if (!/^https?:\/\//.test(url)) return '';
    const label = source.download_url ? '进入知网获取全文' : '打开来源网页';
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  function decorateWarnings() {
    installStyles();
    const papers = new Map((current?.papers || []).map(paper => [paper.id,paper]));
    document.querySelectorAll('#paper-list .paper-row').forEach(row => {
      const paper = papers.get(row.dataset.sourceId), message = paper && warningText(paper);
      const slot = row.querySelector('.paper-warning-slot');
      if (paper) row.querySelector('.paper-meta').textContent = paperMeta(paper);
      if (!slot || !message) return;
      const downloading = paper.availability?.fulltext === 'pending';
      const canRetry = !downloading && (paper.metadata?.pdf_url || paper.metadata?.doi || paper.metadata?.discovery_sources?.length || ['doi','arxiv'].includes(paper.metadata?.source));
      const retry = canRetry ? `<button type="button" data-action="retry-source" data-id="${esc(paper.id)}">重新获取</button>` : '';
      const sourceUrl = externalSourceLink(paper);
      slot.innerHTML = `<details class="paper-warning"><summary aria-label="资料不完整：${esc(message)}" title="${esc(message)}">!</summary><div><p>${esc(message)}</p>${sourceUrl}${retry}<button type="button" data-action="supplement-source" data-id="${esc(paper.id)}">上传 PDF 补充</button></div></details>`;
    });
  }

  renderSources = function renderSourcesForImports() {
    baseRenderSources();
    decorateWarnings();
  };

  showPaper = function showPaperInReader(id, page = 1, version = null, focus = null, valid = () => true) {
    const savedVersion = version || current.papers.find(paper=>paper.id===id)?.current_version_id;
    const saved = (!focus || focus.readingPosition) && savedVersion ? JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(positionKey(current.id,savedVersion)) || 'null') : null;
    readerMode = saved?.mode || window.MethodAtlasSettings?.preferences().readerMode || 'original';
    page = saved?.page ?? page ?? 1;
    if (focus?.quote && focus.page == null) focus = {...focus,page};
    if(saved && !focus) focus = {readingPosition:saved};
    // Opening another paper starts in the column: full screen is a way of reading, not a mode that follows you.
    document.body.classList.remove('reader-fullscreen');
    return baseShowPaper(id,page,version,focus,valid);
  };

  function installStyles() {
    if (document.getElementById('source-reader-styles')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="source-reader-styles">
      #add-source-dialog{width:min(56.25rem,calc(100vw - 2rem));max-height:90dvh;padding:1.5rem;border:1px solid var(--line-soft);border-radius:var(--radius-xl);overflow:auto;background:var(--surface)}
      #add-source-dialog::backdrop{background:rgb(0 0 0/.3)}
      .source-dialog-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.375rem}.source-dialog-head h2{font-size:1.125rem}
      .source-picker{border:1px dashed var(--control-line);border-radius:var(--radius-lg);background:var(--surface-2);padding:1.75rem}
      .source-file-pane{text-align:center}.drop-zone{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;min-height:10.625rem;border-radius:0.75rem}.drop-zone strong{font-size:1.125rem;font-weight:500}.drop-zone p{font-size:0.8125rem;color:var(--muted)}.drop-zone.dragging{background:var(--accent-soft);outline:2px dashed var(--accent)}
      .source-switcher{display:flex;justify-content:center;flex-wrap:wrap;gap:0.5rem;margin-top:1.5rem}.source-switcher button{display:flex;align-items:center;justify-content:center;gap:0.5rem;border-radius:var(--radius-sm);padding:0.5rem 1rem;background:var(--surface);box-shadow:none}.source-switcher button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}.source-switcher svg{width:1rem;height:1rem}
      .source-method{display:flex;flex-direction:column;gap:0.875rem}.source-method[hidden],.source-file-pane[hidden]{display:none}.source-method h2{font-size:1.125rem}.source-method p{font-size:0.875rem;color:var(--muted);line-height:1.7}.source-method label{display:flex;flex-direction:column;gap:0.4375rem;font-size:0.875rem}.source-method input[type=text],.source-method textarea{width:100%}.source-method textarea{min-height:8.75rem;resize:vertical}.source-method button[type=submit]{align-self:flex-start}
      .source-results{display:flex;flex-direction:column;gap:0.5rem}.source-results:not(:empty){margin-top:1.25rem}.source-result{display:flex;justify-content:space-between;gap:0.875rem;padding:0.6875rem 0.875rem;border:1px solid var(--line-soft);border-radius:var(--radius);font-size:0.875rem}.source-result[data-result=failed]{color:var(--danger)}.source-result small{overflow-wrap:anywhere;text-align:right}
      .paper-warning-slot{margin-left:auto}.paper-warning{position:static}.paper-row:has(.paper-warning[open]){z-index:20;transform:none}.paper-warning>summary{--hover:#844214;display:grid;place-items:center;width:1.25rem;height:1.25rem;border-radius:50%;background:#a34d22;color:white;font-size:0.875rem;font-weight:700;cursor:pointer;list-style:none}.paper-warning>summary::-webkit-details-marker{display:none}.paper-warning>div{position:absolute;left:0.5rem;right:0.5rem;top:calc(100% + 0.25rem);z-index:12;width:auto;padding:0.75rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow-2);font-size:0.84375rem;line-height:1.6}.paper-warning p{margin-bottom:0.5rem}.paper-warning button{font-size:0.84375rem;padding:0.3125rem 0.5rem;margin:2px}.reader-shell{top:var(--panel-head-height);bottom:0;max-height:none;height:auto;display:flex;flex-direction:column}.reader-toolbar{display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.75rem;border-bottom:1px solid var(--line-soft);flex-wrap:wrap}.reader-toolbar .active{background:var(--accent-soft);color:var(--accent)}.reader-body{overflow:auto;padding:1.125rem;flex:1;background:var(--surface)}/* The reading column follows the paper's own line width: at 45rem the extracted text only filled ~37.5rem, so the block sat left of centre with a wide empty band on the right. */.responsive-paper{width:min(38.75rem,100%);margin:0 auto;color:var(--ink);font-family:Georgia,"Noto Serif SC",serif;font-size:1.0625rem;line-height:1.85;overflow-wrap:anywhere}.responsive-page{position:relative;padding:0.5rem 0 1.625rem;border-bottom:1px solid var(--line-soft)}.responsive-page:last-child{border:0}.responsive-page-number{font:0.78125rem "Segoe UI",sans-serif;color:var(--faint);margin-bottom:0.75rem}.responsive-paper h1,.responsive-paper h2,.responsive-paper h3{line-height:1.45;margin:1.2em 0 .55em}.responsive-paper h1{font-size:1.65em}.responsive-paper h2{font-size:1.35em}.responsive-paper h3{font-size:1.12em}.responsive-paragraph{white-space:pre-wrap;margin:.7em 0}.responsive-list{margin:.5em 0 .5em 1.5em}.responsive-table-wrap{max-width:100%;overflow-x:auto;margin:1rem 0;border:1px solid var(--line)}.responsive-table{border-collapse:collapse;min-width:100%;font:0.875rem "Segoe UI",sans-serif}.responsive-table th,.responsive-table td{border:1px solid var(--line);padding:0.4375rem 0.5625rem;text-align:left;vertical-align:top;white-space:pre-wrap}.source-fragment{display:block;max-width:100%;height:auto;margin:0.875rem auto;border:1px solid var(--line-soft)}.image-button{display:block;width:100%;padding:0.25rem;border:0;background:none;box-shadow:none}.formula-block{margin:0.75rem 0;padding:0.5rem;overflow-x:auto;text-align:center}.page-warning{padding:0.5625rem 0.6875rem;border-radius:var(--radius);background:#fff3df;color:#844214;font:0.8125rem "Segoe UI",sans-serif;line-height:1.6}.reader-body:has(.original-reader){background:var(--preview)}.original-reader{height:100%;display:flex;flex-direction:column;align-items:center}.original-reader .pdf-page{width:min(57.5rem,100%)}.original-reader iframe{width:100%;height:100%;border:0;background:#777}.image-lightbox{width:min(68.75rem,calc(100vw - 1.875rem));height:min(90vh,56.25rem);padding:1.125rem}.image-lightbox img{display:block;max-width:100%;max-height:calc(90vh - 4.375rem);margin:auto}.image-lightbox .icon{position:absolute;right:0.5rem;top:0.5rem;background:white}.reader-evidence{background:#fff0a6;color:inherit;scroll-margin-block:5rem;border-radius:2px}.reader-source-context{padding:0.75rem;border:1px solid var(--line-soft);border-radius:0.5rem}.reader-source-context small{font:0.75rem system-ui;color:var(--faint)}.reader-focus{border-left:0.1875rem solid #d49500;padding-left:0.625rem}.source-actions .primary{width:100%}
      .reader-body{padding:0.5rem 1rem}
      .reader-toolbar{flex-wrap:nowrap;gap:0.875rem;padding:0.25rem 1rem;min-height:2.5rem;overflow-x:auto}
      .reader-toolbar>button,.reader-toolbar>a{flex:none;font-size:0.75rem;padding:0.25rem 0.375rem;white-space:nowrap;box-shadow:none}
      .reader-toolbar .icon{width:1.75rem;height:1.75rem;padding:0.3125rem}
      .reader-toolbar .reader-page-nav{flex:none;white-space:nowrap}
      .reader-toolbar-group{display:flex;align-items:center;gap:1rem;flex:none}
      .reader-toolbar-group>a{display:inline-flex;align-items:center;margin:0;font-size:0.8125rem;white-space:nowrap}
      .reader-toolbar .reader-toolbar-fill{flex:1 1 auto;min-width:1.25rem}
      .reader-toolbar-actions{gap:1.125rem}
      .reader-body .page-warning{margin:0.25rem 0;padding:0.3125rem 0.5rem;font-size:0.75rem;line-height:1.5}
      .reader-toolbar a.icon{display:inline-grid;place-items:center;margin:0}
      .reader-toolbar-fill{flex:1 1 0;min-width:0}
      .reader-page-nav{display:flex;align-items:center;gap:0.375rem;font-size:0.875rem;color:var(--muted)}
      .reader-page-count{white-space:nowrap;font-variant-numeric:tabular-nums}
      .responsive-page{padding:0.625rem 0 1.875rem}
      .paper-warning a,.reader-toolbar a{display:inline-block;margin:2px 0.375rem 2px 0}
      /* 全屏阅读：整个窗口就是阅读面。阅读器可能挂在左栏（工作台的底部抽屉）也可能挂在中栏（文献库的
         阅读器列），所以这里不去猜是哪一栏 —— 只留下装着 .reader-shell 的那一栏，其余栏和外壳一起让位。
         顶部只留一条细栏：出口、标题、阅读方式与页码；正文是唯一的滚动盒子，所以栏不会滚走、也不会多出
         第二条滚动条。正文左右留白随窗口长，底部留出一屏的余量，读到最后一段不会贴着底边。 */
      body.reader-fullscreen .app-header,body.reader-fullscreen .shell-nav,body.reader-fullscreen .workspace-foot{display:none!important}
      body.reader-fullscreen .shell{padding:0;gap:0}
      body.reader-fullscreen .panels{display:block;border:0;border-radius:0;box-shadow:none}
      body.reader-fullscreen .panel-resizer,body.reader-fullscreen .panels>.panel:not(:has(.reader-shell)){display:none!important}
      body.reader-fullscreen .panels>.panel:has(.reader-shell){height:100%;max-height:none}
      body.reader-fullscreen .panels>.panel:has(.reader-shell)>.panel-head{display:none}
      body.reader-fullscreen .panels>.panel:has(.reader-shell)>#chat-body{overflow:hidden;padding:0}
      body.reader-fullscreen .panels>.panel:has(.reader-shell)>#source-body{display:none}
      body.reader-fullscreen #paper-detail{height:100%;min-height:0}
      body.reader-fullscreen .paper-drawer{position:static;height:100%;max-height:none;border:0;border-radius:0;box-shadow:none;animation:none;background:var(--surface)}
      body.reader-fullscreen .drawer-head{display:none}
      body.reader-fullscreen .reader-toolbar{flex:none;flex-wrap:nowrap;height:3.375rem;padding:0 clamp(1.25rem,3vw,3rem);gap:1rem;background:var(--surface)}
      body.reader-fullscreen .reader-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.96875rem;font-weight:600}
      body.reader-fullscreen .reader-toolbar-actions{gap:1.25rem}
      body.reader-fullscreen .reader-body{padding:clamp(2.125rem,6vh,4rem) clamp(1.5rem,5vw,5rem) 20vh;outline:none}
      body.reader-fullscreen .original-reader{height:auto;min-height:100%}
      .pdfjs-page-host{width:min(57.5rem,100%);margin:0 auto}.pdfjs-status{padding:1.75rem;text-align:center;color:var(--muted)}.pdfjs-canvas-page{margin:0 auto;background:#fff;box-shadow:0 0.5rem 1.625rem rgb(32 33 36/.18)}.pdfjs-canvas-page canvas{display:block;width:100%;height:auto}.pdfjs-fallback img{display:block;width:100%;height:auto}
      @container app (max-width:37.5rem){#add-source-dialog{padding:1rem}.source-picker{padding:1.125rem}.source-switcher button{padding:0.5625rem 0.75rem}}
    </style>`);
  }

  function renderResults(items, projectId, generation) {
    if (projectId !== addProjectId || projectId !== current?.id || generation !== viewGeneration) return;
    const host = document.getElementById('source-results');
    if (!host) return;
    host.innerHTML = items.map(item => {
      const label = item.result !== 'ok' ? '失败' : item.duplicate ? '已存在' : item.imported_as === 'metadata' ? '仅保存元数据' : item.imported_as === 'abstract' ? '已保存摘要' : item.imported_as === 'pdf' ? '已导入 PDF' : '已导入';
      return `<div class="source-result" data-result="${esc(item.result)}"><strong>${label}</strong><small>${esc(item.input)}${item.error ? ` · ${esc(item.error)}` : ''}</small></div>`;
    }).join('');
  }

  function renderAddSources() {
    installStyles();
    let dialog = document.getElementById('add-source-dialog');
    if (dialog && addProjectId !== current.id) { dialog.remove(); dialog = null; }
    addProjectId = current.id;
    addConversationId = conversation?.id || null;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'add-source-dialog';
      dialog.setAttribute('aria-labelledby','add-source-title');
      dialog.innerHTML = `<header class="source-dialog-head"><h2 id="add-source-title">添加来源</h2><button class="icon" data-action="close-add-source" aria-label="关闭添加来源">${icon('close')}</button></header>
        <div class="source-picker">
          <section data-source-pane="files" id="source-files" class="source-file-pane">
            <div id="pdf-drop" class="drop-zone"><strong>拖放 PDF 文件到这里</strong><p>最多 20 个文件，单个不超过 40 MB，整批不超过 120 MB</p><button type="button" data-action="choose-pdf">选择 PDF 文件</button><input id="pdf-files" type="file" accept="application/pdf,.pdf" multiple hidden aria-label="上传 PDF 文件"></div>
          </section>
          <form class="source-method" id="link-source-form" data-source-pane="links" hidden><h2>论文链接</h2><p>支持 DOI、arXiv、论文网页和 PDF 直链。每行一条；未取得全文时仅保存可获得的论文信息。</p><label>链接<textarea name="links" required placeholder="doi:10.…\nhttps://arxiv.org/abs/…\nhttps://publisher.org/article/…\nhttps://example.org/paper.pdf"></textarea></label><button type="submit" class="primary">导入链接</button></form>
          <form class="source-method" id="text-source-form" data-source-pane="text" hidden><h2>复制文字</h2><p>保留标题、正文、段落和列表，不自动总结或改写。</p><label>标题<input name="title" type="text" required maxlength="300"></label><label>正文<textarea name="text" required maxlength="200000"></textarea></label><button type="submit" class="primary">保存文字</button></form>
          <nav class="source-switcher" aria-label="导入方式">
            <button type="button" data-action="source-method" data-method="files" aria-controls="source-files" aria-pressed="true">${icon('file')}上传文件</button>
            <button type="button" data-action="source-method" data-method="links" aria-controls="link-source-form" aria-pressed="false">${icon('link')}论文链接</button>
            <button type="button" data-action="source-method" data-method="text" aria-controls="text-source-form" aria-pressed="false">${icon('file')}复制文字</button>
          </nav>
        </div><div class="source-results" id="source-results" role="status" aria-live="polite"></div>`;
      document.body.append(dialog);
      dialog.addEventListener('close',()=>document.querySelector('[data-action=add-source]')?.focus({preventScroll:true}));
    }
    if (!dialog.open) dialog.showModal();
  }

  function switchSourceMethod(method) {
    const dialog = document.getElementById('add-source-dialog');
    dialog.querySelectorAll('[data-source-pane]').forEach(pane => { pane.hidden = pane.dataset.sourcePane !== method; });
    dialog.querySelectorAll('[data-method]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.method === method)));
  }

  async function refreshImported(projectId, generation, items) {
    if (generation !== viewGeneration || addProjectId !== projectId) return;
    const latest = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    if (generation !== viewGeneration || addProjectId !== projectId) return;
    current = latest;
    (items || []).filter(item => item.result === 'ok' && item.paper_id).forEach(item => selected.add(item.paper_id));
    saveSelection(); renderSources();
  }

  async function uploadFiles(fileList, targetPaperId = null) {
    const files = [...fileList];
    if (!files.length) return;
    const projectId = targetPaperId ? current.id : addProjectId;
    const generation = viewGeneration;
    const form = new FormData();
    files.forEach(file => form.append('files', file, file.name));
    if (targetPaperId) form.append('target_paper_id', targetPaperId);
    try {
      const result = await api(`/api/projects/${encodeURIComponent(projectId)}/sources/files`, {method:'POST', body:form});
      if (targetPaperId) {
        if (generation !== viewGeneration || current?.id !== projectId) return;
        const latest = await api(`/api/projects/${encodeURIComponent(projectId)}`);
        if (generation !== viewGeneration || current?.id !== projectId) return;
        current = latest; renderSources();
      } else {
        await refreshImported(projectId, generation, result.items); renderResults(result.items,projectId,generation);
      }
      toast(`${result.succeeded} 项导入成功${result.failed ? `，${result.failed} 项失败` : ''}。`);
    } catch (error) { if (!targetPaperId) renderResults([{result:'failed',input:'上传文件',error:error.message}],projectId,generation); toast(error.message); }
  }

  function fragmentUrl(paper, page, rect) {
    const params = new URLSearchParams({version_id:paper.version_id,page:String(page.page),x0:rect[0],y0:rect[1],x1:rect[2],y1:rect[3]});
    return `/api/projects/${current.id}/papers/${paper.id}/fragment?${params}`;
  }

  // Citation offsets count Unicode code points, just like the stored Python source.
  function readerEvidence(page, focus) {
    if (!focus?.quote || focus.page !== page.page) return null;
    if (focus.start === null || focus.end === null) return null;
    const source = Array.from(page.text || '');
    let start=focus.start, end=focus.end;
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      const at=(page.text || '').indexOf(focus.quote);
      if (at < 0 || page.text.indexOf(focus.quote,at+1) >= 0) return null;
      start=Array.from(page.text.slice(0,at)).length; end=start+Array.from(focus.quote).length;
    }
    if (start < 0 || end <= start || source.slice(start,end).join('') !== focus.quote) return null;
    return {start,end,source,covered:new Set()};
  }

  function highlightedSource(text, page, block, evidence) {
    text=String(text || '');
    if (!evidence || !text) return esc(text);
    const sameRect=(a,b)=>a?.length===4 && b?.length===4 && a.every((n,i)=>Math.abs(n-b[i]) < 0.1);
    const candidates=(page.blocks || []).filter(b=>sameRect(b.rect,block.rect) && b.text.includes(text));
    let start=-1;
    if (candidates.length===1) {
      const b=candidates[0], at=b.text.indexOf(text);
      if (b.text.indexOf(text,at+1)<0) start=b.start+Array.from(b.text.slice(0,at)).length;
    } else {
      const at=(page.text || '').indexOf(text);
      if (at>=0 && page.text.indexOf(text,at+1)<0) start=Array.from(page.text.slice(0,at)).length;
    }
    const chars=Array.from(text), from=Math.max(0,evidence.start-start), to=Math.min(chars.length,evidence.end-start);
    if (start < 0 || from>=to || evidence.source.slice(start,start+chars.length).join('')!==text) return esc(text);
    for (let i=from;i<to;i++) evidence.covered.add(start+i);
    return esc(chars.slice(0,from).join(''))+'<mark class="reader-evidence">'+esc(chars.slice(from,to).join(''))+'</mark>'+esc(chars.slice(to).join(''));
  }

  function renderBlock(block, paper, page, evidence = null, sourceOverride = null) {
    const source = sourceOverride || (text => highlightedSource(text,page,block,evidence));
    const kind = block.kind || 'paragraph';
    if (kind === 'heading') { const level = Math.max(1, Math.min(3, Number(block.level) || 3)); return `<h${level}>${source(block.text)}</h${level}>`; }
    if (kind === 'list_item') return `<div class="responsive-list" style="white-space:pre-wrap">${source(block.text)}</div>`;
    if (kind === 'table') return `<div class="responsive-table-wrap"><table class="responsive-table"><tbody>${(block.rows || []).map((row,i) => `<tr>${row.map(cell => `<${i ? 'td' : 'th'}>${source(cell)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (kind === 'image' || kind === 'formula' || kind === 'page_image') {
      const src = kind === 'page_image' ? `/api/projects/${current.id}/papers/${paper.id}/page?version_id=${paper.version_id}&page=${page.page}` : fragmentUrl(paper,page,block.rect);
      const alt = block.warning ? `原论文第 ${page.page} 页原图（文字转换提示）` : kind === 'formula' ? `原论文第 ${page.page} 页公式` : kind === 'image' ? `原论文第 ${page.page} 页图片` : `原论文第 ${page.page} 页图像回退`;
      const box=kind==='page_image'?[0,0,page.width,page.height]:block.rect;
      const dimensions=box?` width="${Math.max(1,Math.ceil((box[2]-box[0])*1.8))}" height="${Math.max(1,Math.ceil((box[3]-box[1])*1.8))}"`:'';
      const image = `<button class="image-button" data-action="enlarge-source-image" data-src="${esc(src)}" data-alt="${esc(alt)}"><img class="source-fragment" src="${esc(src)}" alt="${esc(alt)}"${dimensions}></button>`;
      return kind === 'formula' ? `<div class="formula-block">${image}<span class="sr-only">${esc(block.text || '')}</span></div>` : `${block.warning ? `<p class="page-warning" role="note">${esc(block.warning)}</p>` : ''}${image}`;
    }
    return `<p class="responsive-paragraph">${source(block.text)}</p>`;
  }

  function renderResponsive(paper) {
    if (paper.reader_document) return renderContinuous(paper);
    return `<article class="responsive-paper" style="zoom:${readerZoom}">${paper.pages.map(page => {
      const layout = page.layout?.length ? page.layout : (page.blocks || []).map(block => ({kind:'paragraph',text:block.text,rect:block.rect}));
      const focused = detail.focus?.page === page.page;
      const warning = paper.kind === 'pdf' ? page.conversion?.warning : warningText(paper);
      const evidence=readerEvidence(page,detail.focus);
      let content = layout.map(block => renderBlock(block,paper,page,evidence)).join('');
      if (evidence && evidence.source.slice(evidence.start,evidence.end).some((char,i)=>/\S/.test(char) && !evidence.covered.has(evidence.start+i))) {
        const {source,start,end}=evidence;
        content += `<div class="responsive-paragraph reader-source-context"><small>原文定位</small><p>${esc(source.slice(Math.max(0,start-120),start).join(''))}<mark class="reader-evidence">${esc(source.slice(start,end).join(''))}</mark>${esc(source.slice(end,end+120).join(''))}</p></div>`;
      } else if (focused && detail.focus.quote && !evidence) {
        content = '<p class="page-warning" role="status">未能在此版本正文中准确定位该引用。</p>'+content;
      }
      return `<section class="responsive-page ${focused ? 'reader-focus' : ''}" id="reader-page-${page.page}">${paper.kind === 'pdf' ? `<div class="responsive-page-number">第 ${page.page} 页</div>` : ''}${warning ? `<p class="page-warning" role="note">${esc(warning)}</p>` : ''}${content}</section>`;
    }).join('')}</article>`;
  }

  function renderContinuous(paper) {
    const pages=new Map(paper.pages.map(page=>[page.page,page])), anchored=new Set();
    const evidence=new Map(paper.pages.map(page=>[page.page,readerEvidence(page,detail.focus)]));
    const content=paper.reader_document.paragraphs.map(paragraph=>{
      const pageAnchors=[];
      const maps=paragraph.fragments.map(fragment=>displayMap(fragment,paragraph.kind));
      const sourceSpan=(fragment,index,left=0,right=fragment.display_text.length)=>{
        const target=anchored.has(fragment.page)?'':` id="reader-page-${fragment.page}"`;
        if(target)pageAnchors.push(fragment.page);
        anchored.add(fragment.page);
        const focus=evidence.get(fragment.page),chars=Array.from(fragment.text);
        let html=esc(fragment.display_text.slice(left,right));
        if(focus && fragment.start!==null) {
          const from=Math.max(0,focus.start-fragment.start),to=Math.min(chars.length,focus.end-fragment.start);
          const map=maps[index],start=chars.slice(0,from).join('').length,end=chars.slice(0,to).join('').length;
          const offset=map?.findIndex(unit=>unit.end>start),a=offset>=0?Math.max(left,offset):-1,b=map?Math.min(right,map.findLastIndex(unit=>unit.start<end)+1):0;
          if(from<to && a>=0 && b>a && focus.source.slice(fragment.start,fragment.end).join('')===fragment.text) {
            const first=Array.from(fragment.text.slice(0,map[a].start)).length,last=Array.from(fragment.text.slice(0,map[b-1].end)).length;
            for(let at=first;at<last;at++)focus.covered.add(fragment.start+at);
            html=esc(fragment.display_text.slice(left,a))+'<mark class="reader-evidence">'+esc(fragment.display_text.slice(a,b))+'</mark>'+esc(fragment.display_text.slice(b,right));
          }
        }
        return `<span class="reader-source-fragment"${target} data-fragment-index="${index}" data-display-start="${left}" data-page="${fragment.page}" data-start="${fragment.start??''}" data-end="${fragment.end??''}">${html}</span>`;
      };
      const source=paragraph.kind==='table'?'':paragraph.fragments.map((fragment,index)=>esc(fragment.separator)+sourceSpan(fragment,index)).join('');
      const fragment=paragraph.fragments[0],page=pages.get(fragment.page);
      let block;
      if(paragraph.kind==='heading') {const level=Math.max(1,Math.min(3,paragraph.level||2));block=`<h${level} class="reader-original">${source}</h${level}>`;}
      else if(paragraph.kind==='table') {
        let cursor=0;
        block=`<div class="reader-original">${renderBlock(paragraph,paper,page,null,cell=>{
          const value=String(cell),at=fragment.text.indexOf(value,cursor),map=maps[0];
          if(!value||at<0||!map)return esc(value);
          cursor=at+value.length;
          const a=map.findIndex(unit=>unit.end>at),b=map.findLastIndex(unit=>unit.start<cursor)+1;
          return a>=0&&b>a?sourceSpan(fragment,0,a,b):esc(value);
        })}</div>`;
      }
      else if(['image','formula','page_image'].includes(paragraph.kind)) {
        const formulaSource=paragraph.kind==='formula'&&paragraph.text.trim();
        block=`<div class="reader-original">${renderBlock({...paragraph,text:formulaSource?'':paragraph.text,rect:fragment.rects[0]},paper,page)}${formulaSource?`<p class="responsive-paragraph reader-formula-source">${source}</p>`:''}</div>`;
        if(!formulaSource)block+=pageAnchors.map(n=>`<span class="reader-page-anchor" id="reader-page-${n}" data-page="${n}"></span>`).join('');
      } else block=`<p class="reader-original ${paragraph.kind==='list_item'?'responsive-list':'responsive-paragraph'}">${source}</p>`;
      const pageNumbers=[...new Set(paragraph.fragments.map(f=>f.page))];
      const sources=paper.kind==='pdf'?`<div class="reader-paragraph-source">${pageNumbers.map(n=>`<button class="reader-source-page" type="button" data-action="reader-source-page" data-page="${n}" aria-label="查看原 PDF 第 ${n} 页">第 ${n} 页</button>`).join('')}</div>`:'';
      return `<section class="reader-paragraph responsive-page" id="${paragraph.id}" data-paragraph-id="${paragraph.id}" data-page="${fragment.page}" data-kind="${paragraph.kind}">${block}${translatable(paragraph)?`<div class="reader-paragraph-translation" data-paragraph-id="${paragraph.id}">${paragraphTranslation(paragraph)}</div>`:''}${sources}</section>`;
    }).join('');
    const focus=evidence.get(detail.focus?.page),page=pages.get(detail.focus?.page);
    let fallback='';
    if(focus && focus.source.slice(focus.start,focus.end).some((char,i)=>/\S/.test(char)&&!focus.covered.has(focus.start+i))) {
      const {source,start,end}=focus;
      fallback=`<div class="reader-source-context" data-page="${page.page}"><small>原文定位 · 第 ${page.page} 页</small><p>${esc(source.slice(Math.max(0,start-120),start).join(''))}<mark class="reader-evidence">${esc(source.slice(start,end).join(''))}</mark>${esc(source.slice(end,end+120).join(''))}</p></div>`;
    } else if(detail.focus?.quote&&!focus) fallback='<p class="page-warning" role="status">未能在此版本正文中准确定位该引用。</p>';
    const warningPages=new Map();
    for(const page of paper.pages)if(page.conversion?.warning){
      const message=page.conversion.warning;
      if(!warningPages.has(message))warningPages.set(message,[]);
      warningPages.get(message).push(page.page);
    }
    const warnings=[...warningPages].map(([message,numbers])=>`<p class="page-warning" role="note">第 ${numbers.join('、')} 页：${esc(message)}</p>`).join('');
    return `<article class="responsive-paper reader-continuous" style="zoom:${readerZoom}">${warnings}${content}${fallback}</article>`;
  }

  function captureReaderPosition(preferred=null) {
    const body=document.querySelector('.reader-body');
    if(!body||!detail)return null;
    const position={page:detail.page,scroll:body.scrollTop,mode:readerMode,width:body.clientWidth};
    const edge=body.getBoundingClientRect().top+24;
    const frame=body.querySelector('.pdfjs-canvas-page:not([hidden])');
    if(frame) {
      const bounds=frame.getBoundingClientRect(),page=detail.paper.pages.find(p=>p.page===detail.page);
      const sourceY=Math.max(0,Math.min(page.height,(edge-bounds.top)/bounds.height*page.height));
      const candidates=(detail.paper.reader_document?.paragraphs||[]).flatMap(p=>p.fragments.map((fragment,index)=>({paragraph:p,fragment,index}))).filter(p=>p.fragment.page===page.page&&p.fragment.rects.length);
      const chosen=candidates.sort((a,b)=>{
        const distance=p=>Math.max(0,p.fragment.rects[0][1]-sourceY,sourceY-p.fragment.rects[0][3]);
        return distance(a)-distance(b);
      })[0];
      if(chosen) {const rect=chosen.fragment.rects[0];Object.assign(position,{paragraph_id:chosen.paragraph.id,fragment_index:chosen.index,fraction:Math.max(0,Math.min(1,(sourceY-rect[1])/(rect[3]-rect[1]))),source_y:sourceY});}
    } else {
      const saved=preferred||JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(positionKey(current.id,detail.paper.version_id))||'null');
      const savedParagraph=saved?.paragraph_id?document.getElementById(saved.paragraph_id):null;
      const source=savedParagraph?.querySelector(`[data-fragment-index="${saved.fragment_index||0}"]`)||savedParagraph?.querySelector('.reader-original');
      const bounds=source?.getBoundingClientRect(),viewport=body.getBoundingClientRect();
      // Inline fragments can share a line, and the scroll range can end before a target reaches the top.
      // Keep the chosen source through one CSS pixel of scroll rounding; real scrolling resumes geometry sampling.
      const keep=source&&bounds.bottom>viewport.top&&bounds.top<viewport.bottom&&(preferred||(saved.mode===readerMode&&Math.abs(saved.scroll-body.scrollTop)<=1));
      const anchor=keep?source:[...body.querySelectorAll('.reader-source-fragment,.reader-paragraph[data-page]:not(:has(.reader-source-fragment))')].find(node=>node.getBoundingClientRect().bottom>edge);
      const paragraph=anchor?.closest('.reader-paragraph'),rect=anchor?.getBoundingClientRect();
      if(paragraph&&rect) {
        const index=Number(anchor.dataset.fragmentIndex)||0,fragment=detail.paper.reader_document?.paragraphs.find(p=>p.id===paragraph.id)?.fragments[index];
        const fraction=Math.max(0,Math.min(1,(edge-rect.top)/Math.max(1,rect.height)));
        // A chosen search source can sit below the reading edge. Async view updates must preserve that point.
        Object.assign(position,{page:Number(anchor.dataset.page)||Number(paragraph.dataset.page),paragraph_id:paragraph.id,fragment_index:index,fraction,viewport_offset:rect.top+fraction*rect.height-viewport.top});
        if(fragment?.rects.length){const original=fragment.rects[0];position.source_y=original[1]+fraction*(original[3]-original[1]);}
      }
    }
    return position;
  }

  function switchReaderMode(mode) {
    const position=captureReaderPosition();
    readerMode=mode;
    if(position){detail.page=position.page;detail.focus={readingPosition:position};}
    renderDetail();saveWorkspaceState();
  }

  function restoreReaderAnchor(saved) {
    const body=document.querySelector('.reader-body');
    if(!body||!saved?.paragraph_id||readerMode!=='responsive')return;
    const paragraph=document.getElementById(saved.paragraph_id);
    const anchor=paragraph?.querySelector(`[data-fragment-index="${saved.fragment_index||0}"]`)||paragraph?.querySelector('.reader-original');
    const rect=anchor?.getBoundingClientRect();
    if(rect) {
      const offset=saved.mode===readerMode&&Number.isFinite(saved.viewport_offset)?saved.viewport_offset:24;
      body.scrollTop+=rect.top+(saved.fraction||0)*rect.height-body.getBoundingClientRect().top-offset;
      const position=captureReaderPosition(saved);
      if(position){detail.page=position.page;(globalThis.MethodAtlasStorage?.local || localStorage).setItem(positionKey(current.id,detail.paper.version_id),JSON.stringify(position));}
    }
  }

  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('/vendor/pdfjs/pdf.min.mjs').then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
        return pdfjs;
      });
    }
    return pdfjsPromise;
  }

  function releasePdfDocument() {
    const previous = pdfDocumentPromise;
    pdfDocumentKey = null;
    pdfDocumentPromise = null;
    if (previous) previous.then(pdfDocument => pdfDocument.destroy()).catch(() => {});
  }

  function getPdfDocument(paper, url) {
    const key = `${current.id}:${paper.id}:${paper.version_id}`;
    if (pdfDocumentKey === key && pdfDocumentPromise) return pdfDocumentPromise;
    releasePdfDocument();
    pdfDocumentKey = key;
    pdfDocumentPromise = loadPdfJs().then(pdfjs => pdfjs.getDocument({url,wasmUrl:'/vendor/pdfjs/wasm/'}).promise);
    return pdfDocumentPromise;
  }

  async function mountPdfJs(paper, page, generation) {
    const host = document.getElementById('pdfjs-page-host');
    if (!host) return;
    const frame = host.querySelector('.pdfjs-canvas-page');
    const fallback = host.querySelector('.pdfjs-fallback');
    const fallbackImage = fallback.querySelector('img');
    const status = host.querySelector('.pdfjs-status');
    const canvas = frame.querySelector('canvas');
    try {
      const pdfDocument = await getPdfDocument(paper, host.dataset.pdfUrl);
      if (generation !== pdfRenderGeneration || !host.isConnected) return;
      const pdfPage = await pdfDocument.getPage(page.page);
      if (generation !== pdfRenderGeneration || !host.isConnected) return;
      const natural = pdfPage.getViewport({scale:1});
      // Zoom multiplies the fitted page instead of replacing it, so 100% stays "fit the column".
      const fitWidth = Math.max(240, Math.min(920, host.clientWidth || 920));
      const cssWidth = Math.round(fitWidth * readerZoom);
      const viewport = pdfPage.getViewport({scale:cssWidth / natural.width});
      // A 300% page is ~2760 CSS px wide: cap the bitmap so zooming in cannot allocate a canvas that big.
      const outputScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, 3200 / viewport.width));
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      // The page owns the zoomed width. `.original-reader .pdf-page{width:min(920px,100%)}` is a hard
      // `width`, so setting max-width alone left the sheet pinned at 920px and zoom-in changed nothing
      // (only zoom-out below 100% did). The host stays at 100% so an over-wide page overflows to the
      // right and the reader body can scroll — a centred flex item would cut off its left edge instead.
      host.style.width = '100%';
      frame.style.width = `${viewport.width}px`;
      frame.style.maxWidth = 'none';
      frame.hidden = false;
      const context = canvas.getContext('2d', {alpha:false});
      const transform = outputScale === 1 ? null : [outputScale,0,0,outputScale,0,0];
      await pdfPage.render({canvasContext:context,viewport,transform}).promise;
      if (generation !== pdfRenderGeneration || !host.isConnected) return;
      const pdfjs = await loadPdfJs();
      const textLayer = frame.querySelector('.textLayer');
      textLayer.style.setProperty('--total-scale-factor', viewport.scale);
      await new pdfjs.TextLayer({textContentSource:await pdfPage.getTextContent(),container:textLayer,viewport}).render();
      if (generation !== pdfRenderGeneration || !host.isConnected) return;
      const links = frame.querySelector('.reader-links');
      const annotations = await pdfPage.getAnnotations();
      if (generation !== pdfRenderGeneration || !host.isConnected) return;
      for (const item of annotations) {
        if (item.subtype !== 'Link' || !item.rect || !(item.dest || /^https?:\/\//i.test(item.url || ''))) continue;
        const rect = [...viewport.convertToViewportPoint(item.rect[0],item.rect[1]),...viewport.convertToViewportPoint(item.rect[2],item.rect[3])];
        const link = document.createElement(item.url ? 'a' : 'button');
        link.className = 'reader-pdf-link';
        link.style.cssText = `left:${Math.min(rect[0],rect[2])}px;top:${Math.min(rect[1],rect[3])}px;width:${Math.abs(rect[2]-rect[0])}px;height:${Math.abs(rect[3]-rect[1])}px`;
        link.setAttribute('aria-label',item.url ? `打开链接：${item.url}` : '跳转论文内部引用');
        if (item.url) { link.href=item.url; link.target='_blank'; link.rel='noopener noreferrer'; }
        else link.onclick=()=>gotoPdfDestination(item.dest);
        links.append(link);
      }
      if (pdfOutline === null) {
        const outline = await pdfDocument.getOutline() || [];
        if (generation !== pdfRenderGeneration || !host.isConnected) return;
        const locate=async items=>Promise.all(items.map(async item=>{
          let number=null;
          try {
            const dest=typeof item.dest==='string'?await pdfDocument.getDestination(item.dest):item.dest;
            if(dest)number=(Number.isInteger(dest[0])?dest[0]:await pdfDocument.getPageIndex(dest[0]))+1;
          } catch {}
          return {...item,page:number,items:await locate(item.items||[])};
        }));
        const located=await locate(outline);
        if (generation !== pdfRenderGeneration || !host.isConnected) return;
        pdfOutline = located;
      }
      if (aidTab==='outline') renderAid();
      paintOverlays();
      paintSearch();
      status.hidden = true;
      pdfResize?.disconnect();
      pdfResize=new ResizeObserver(()=>{
        if (!host.isConnected) return;
        const zoom=Math.min(920,host.clientWidth)*readerZoom/viewport.width;
        const previous=Number(frame.style.zoom)||1;
        if (Math.abs(previous-zoom)<.002) return;
        const body=host.closest('.reader-body'), scroll=body.scrollTop;
        frame.style.zoom=String(zoom); body.scrollTop=scroll*zoom/previous;
      });
      pdfResize.observe(host);
    } catch (error) {
      if (generation !== pdfRenderGeneration || !host.isConnected) return;
      frame.hidden = true;
      // The fallback page sheet follows the same zoom, so the control behaves identically when PDF.js bails.
      if (frame.style.width) { fallback.style.width = frame.style.width; fallback.style.maxWidth = 'none'; }
      fallbackImage.src = fallbackImage.dataset.src;
      fallback.hidden = false;
      status.textContent = `PDF.js 无法渲染此页，已切换兼容显示：${error.message}`;
      console.warn('PDF.js render fallback', error);
      await fallbackImage.decode().catch(() => {});
    }
  }

  function renderOriginal(paper) {
    const page = paper.pages.find(item => item.page === detail.page) || paper.pages[0];
    const refs = detail.focus?.id ? [detail.focus] : [...conversation.messages.flatMap(message => message.task?.citations || []), ...(liveTask?.citations || []), ...(artifact?.versions.flatMap(version => version.citations) || [])];
    const citations = [...new Map(refs.filter(citation => citation.paper_version_id === paper.version_id && citation.page === page.page && (citation.rect || citation.rects?.length)).map(citation => [citation.id,citation])).values()];
    const overlays = citations.flatMap(citation => (citation.rects?.length ? citation.rects : [citation.rect]).map((rect,index) => `<button class="pdf-highlight ${detail.focus?.id === citation.id && index === 0 ? 'focused' : ''}" title="${esc(citation.quote)}" aria-label="引用原文：${esc(citation.quote)}" style="left:${rect[0]/page.width*100}%;top:${rect[1]/page.height*100}%;width:${(rect[2]-rect[0])/page.width*100}%;height:${(rect[3]-rect[1])/page.height*100}%"></button>`)).join('');
    const base = `/api/projects/${current.id}/papers/${paper.id}`;
    const pdfUrl = `${base}/pdf?version_id=${encodeURIComponent(paper.version_id)}`;
    const fallbackUrl = `${base}/page?version_id=${encodeURIComponent(paper.version_id)}&page=${page.page}`;
    return `<div class="original-reader"><div class="pdfjs-page-host" id="pdfjs-page-host" data-pdf-url="${esc(pdfUrl)}"><p class="pdfjs-status" role="status">正在打开第 ${page.page} 页…</p><div class="pdf-page pdfjs-canvas-page" hidden><canvas role="img" aria-label="${esc(paper.title)} 原始 PDF 第 ${page.page} 页，由 PDF.js 渲染"></canvas><div class="textLayer"></div><div class="reader-links"></div>${overlays}<div class="reader-marks"></div><div class="reader-region" hidden></div></div><div class="pdf-page pdfjs-fallback" hidden><img id="pdf-image" data-src="${fallbackUrl}" alt="${esc(paper.title)} 原始 PDF 第 ${page.page} 页兼容显示">${overlays}</div></div></div>`;
  }

  // The text scales in place (a re-render would drop the reading position); the PDF has to be
  // rasterised again, so it rebuilds and the scroll is carried over by ratio — the same spot in the
  // paper is a different number of pixels once the page is a different size.
  function setReaderZoom(value) {
    const next = clampZoom(value);
    if (Math.abs(next - readerZoom) < 0.001) return;
    readerZoom = next;
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem('reader-zoom', String(readerZoom));
    const body = document.querySelector('.reader-body');
    const paper = body?.querySelector('.responsive-paper');
    if (paper) {
      const position=captureReaderPosition();
      paper.style.zoom = readerZoom;
      restoreReaderAnchor(position);
      return;
    }
    const before = body ? {top: body.scrollTop, height: body.scrollHeight} : null;
    renderDetail();
    requestAnimationFrame(() => {
      const after = document.querySelector('.reader-body');
      if (!after || !before?.height) return;
      after.scrollTop = Math.round(before.top * (after.scrollHeight / before.height));
    });
  }

  function toggleReaderFullscreen() {
    const reader = document.querySelector('.reader-body');
    if (!reader || !detail) return;
    reader.closest('.reader-shell').getAnimations().forEach(animation => animation.finish());
    const top = reader.getBoundingClientRect().top + 40;
    const blocks = [...reader.querySelectorAll('.responsive-page > *, .pdf-page:not([hidden])')];
    const index = blocks.findIndex(node => node.getBoundingClientRect().bottom > top);
    const rect = blocks[index]?.getBoundingClientRect();
    const position = fullscreenPosition || {index, fraction:rect?.height ? (top - rect.top) / rect.height : 0, scroll:reader.scrollTop,left:reader.scrollLeft,width:reader.scrollWidth};
    document.body.classList.toggle('reader-fullscreen');
    renderDetail(position);
    const target = document.querySelector(inFullscreen() ? '.reader-body' : '[data-action=reader-fullscreen]');
    target?.focus({preventScroll:true});
  }

  renderDetail = function renderSourceReader(position = null) {
    pdfResize?.disconnect();readerResize?.disconnect();
    clearTimeout(selectionTimer); clearTimeout(press?.timer); press=null; inlineRequest++;
    fullscreenPosition = position;
    installStyles();
    const renderGeneration = ++pdfRenderGeneration;
    const host = document.getElementById('paper-detail');
    if (!host) return;
    if (!detail) { window.MethodAtlasComments?.syncPaper(null,null,null); if(aidRun)aidRun.stop=true; releasePdfDocument(); host.innerHTML = ''; readingKey=''; document.body.classList.remove('reader-fullscreen','reader-layout'); return; }
    const paper = detail.paper, hasPdf = paper.kind === 'pdf';
    const key = `${current.id}:${paper.version_id}`;
    if (key !== readingKey) {
      readingKey=key; entries=[]; entriesState='loading'; selection=null; activeAid=null; aidTab=''; pdfOutline=null; readerSearch='';readerSearchDraft='';readerPageError='';
      if (aidRun) aidRun.stop=true;
      showHighlights=(globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-highlights:${key}`)==='true';
      noteWidth=Number((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-note-width:${key}`))||280;
      try {translationView=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-translation-view:${key}`))||{visible:true,paragraphs:{}};} catch {translationView={visible:true,paragraphs:{}};}
      loadEntries(key);
    }
    document.body.classList.toggle('reader-layout',shellView === 'library' && !narrowWorkspace.matches && document.body.dataset.readerLayout !== 'off');
    if (!hasPdf) readerMode = 'responsive';
    const page = paper.pages.find(item => item.page === detail.page) || paper.pages[0];
    const fullscreen = inFullscreen();
    const showOriginal = readerMode === 'original' && hasPdf;
    const tool = (action, label, glyph, attrs = '') => `<button type="button" class="reader-icon" data-action="${action}" aria-label="${label}" title="${label}" ${attrs}>${icon(glyph)}</button>`;
    const modeSwitch = hasPdf ? `<button type="button" class="reader-mode" data-action="reader-${readerMode === 'original' ? 'responsive' : 'original'}" title="切换到${readerMode === 'original' ? '网页原文' : '原 PDF'}">${icon(readerMode === 'original' ? 'book' : 'file')}<span>${readerMode === 'original' ? '网页原文' : '原 PDF'}</span></button>` : '';
    const pageNav = showOriginal ? `<span class="reader-page-nav">${tool('pdf-prev','上一页','previous',page.page <= 1 ? 'disabled' : '')}<span class="reader-page-count">第 ${page.page} / ${paper.page_count} 页</span>${tool('pdf-next','下一页','chevron',page.page >= paper.page_count ? 'disabled' : '')}${tool('ask-figure','询问此页图表','image')}</span>` : '';
    const aidTool = (tab, label, glyph) => tool('reader-aid',label,glyph,`data-tab="${tab}" aria-pressed="${aidTab === tab}"`);
    const sourceLink = externalSourceLink(paper);
    const sourceNote = '';
    // Reading full screen is one surface, so it is one bar: the head row stays behind and its title and
    // close control move into the bar. Leaving sits on the left, where the eye lands before the text.
    const closeButton = `<button class="icon" data-action="close-paper" aria-label="关闭阅读器" title="关闭阅读器">${icon('close')}</button>`;
    const head = fullscreen ? '' : `<div class="drawer-head row between"><strong>${esc(paper.title)}</strong>${closeButton}</div>`;
    const toolbar = fullscreen
      ? `${tool('reader-fullscreen','退出全屏','compress')}<strong class="reader-title">${esc(paper.title)}</strong><div class="reader-toolbar-group reader-toolbar-actions">${modeSwitch}${pageNav}${sourceLink}</div>`
      : `${modeSwitch}${pageNav}<span class="reader-toolbar-fill" aria-hidden="true"></span>${tool('reader-fullscreen','全屏查看论文','expand')}`;
    host.innerHTML = `<section class="paper-drawer reader-shell${position ? ' reader-switch' : ''}" aria-label="资料阅读器" data-version="${esc(paper.version_id)}">${head}<div class="reader-toolbar">${toolbar}${window.MethodAtlasCollaboration?.relatedButton('paper',paper.id,paper.version_id) || ''}</div>
      <nav class="reader-tools" aria-label="论文阅读工具"><div class="reader-tool-group">${aidTool('outline','目录','list')}${aidTool('search','查找','search')}</div><div class="reader-tool-group">${tool('reader-zoom','缩小论文','minus','data-step="-0.1"')}<button class="reader-zoom-value" data-action="reader-zoom" data-step="0" aria-label="适应栏宽" title="适应栏宽">${Math.round(readerZoom*100)}%</button>${tool('reader-zoom','放大论文','plus','data-step="0.1"')}</div><div class="reader-tool-group"><span class="reader-translation-controls"></span>${tool('reader-toggle-highlights','AI 重点','highlight',`aria-pressed="${showHighlights}"`)}${tool('reader-regenerate-highlights','重新生成整篇重点','history',entriesState!=='ready'||aidRun?'disabled':'')}${aidTool('notes','批注','edit')}${aidTool('explanations','解释','chat')}${showOriginal ? tool('reader-region','框选图表','crop','aria-pressed="false"') : ''}</div><span class="reader-highlight-status" role="status"></span><details class="reader-unlocated" hidden><summary></summary><div></div></details></nav><div class="reader-translation-state" hidden></div>
      <div class="reader-stage"><div class="reader-body" tabindex="-1">${sourceNote}${showOriginal ? renderOriginal(paper) : renderResponsive(paper)}</div><div class="reader-note-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整批注列表宽度" hidden></div><aside class="reader-aid" aria-label="阅读辅助" ${aidTab && !['outline','search','translation'].includes(aidTab) ? '' : 'hidden'}></aside></div><section class="reader-top-popover" role="dialog" aria-label="阅读导航" hidden></section><div class="reader-selection" role="toolbar" aria-orientation="vertical" aria-label="原文选区操作" hidden></div></section>`;
    host.querySelector('.reader-unlocated').addEventListener('toggle', event => {
      const notice=event.currentTarget;
      if (!notice.open) return;
      const anchor=notice.querySelector('summary').getBoundingClientRect(), popup=notice.querySelector('div');
      // Anchor to the actual toolbar height so larger text never covers its own toggle.
      const top=anchor.bottom+8;
      popup.style.top=top+'px';
      popup.style.left=Math.max(12,Math.min(anchor.right-popup.offsetWidth,innerWidth-popup.offsetWidth-12))+'px';
      popup.style.right='auto';
      popup.style.maxHeight=Math.max(0,Math.min(innerHeight/2,innerHeight-top-12))+'px';
    });
    renderAid();
    window.MethodAtlasComments?.syncPaper(current.id,paper.id,paper.version_id);
    if(state?.collaboration){const button=document.createElement('button');button.type='button';button.className='reader-icon';button.dataset.action='reader-shared-comment';button.title='项目共享评论';button.setAttribute('aria-label','项目共享评论');button.innerHTML=icon('chat');host.querySelector('.reader-tools .reader-tool-group:last-of-type').append(button);}
    const restorePosition = () => {
      if (renderGeneration !== pdfRenderGeneration || detail?.paper.version_id !== paper.version_id) return;
      const body=host.querySelector('.reader-body');
      const focused=Number.isInteger(detail.focus?.start)?paper.reader_document?.paragraphs.flatMap(paragraph=>paragraph.fragments.map((fragment,index)=>({paragraph,fragment,index}))).find(({fragment})=>fragment.page===detail.page&&fragment.start!==null&&fragment.start<=detail.focus.start&&fragment.end>detail.focus.start):null;
      const focusedParagraph=focused?document.getElementById(focused.paragraph.id):null;
      const focusedSource=focusedParagraph?.querySelector(`[data-fragment-index="${focused?.index}"]`)||focusedParagraph?.querySelector('.reader-original');
      if (position && body) {
        const anchor = body.querySelectorAll('.responsive-page > *, .pdf-page:not([hidden])')[position.index];
        const rect = anchor?.getBoundingClientRect();
        body.scrollTop = position.scroll === 0 ? 0 : rect
          ? body.scrollTop + rect.top + rect.height * position.fraction - body.getBoundingClientRect().top - 40
          : position.scroll;
        body.scrollLeft = position.left * body.scrollWidth / position.width;
        fullscreenPosition = null;
        host.querySelector('.reader-shell').classList.add('reader-switch-ready');
      } else if (detail.focus?.readingPosition && body) {
        const saved=detail.focus.readingPosition;
        const paragraph=saved.paragraph_id?body.querySelector(`#${saved.paragraph_id}`):null;
        const anchor=paragraph?.querySelector(`[data-fragment-index="${saved.fragment_index||0}"]`)||paragraph?.querySelector('.reader-original');
        if(saved.mode===readerMode&&(!saved.width||saved.width===body.clientWidth))body.scrollTop=saved.scroll;
        else if(!showOriginal&&anchor){const rect=anchor.getBoundingClientRect(),offset=saved.mode===readerMode&&Number.isFinite(saved.viewport_offset)?saved.viewport_offset:24;body.scrollTop+=rect.top+(saved.fraction||0)*rect.height-body.getBoundingClientRect().top-offset;}
        else if(showOriginal&&saved.source_y!==undefined){const frame=body.querySelector('.pdfjs-canvas-page'),rect=frame?.getBoundingClientRect();if(rect)body.scrollTop+=rect.top+saved.source_y/page.height*rect.height-body.getBoundingClientRect().top-24;}
        else if(showOriginal)body.scrollTop=saved.scroll||0;
        else document.getElementById(`reader-page-${detail.page}`)?.scrollIntoView({block:'start'});
      }
      else if (!showOriginal) { (host.querySelector('.reader-evidence') || focusedSource || document.getElementById(`reader-page-${detail.page}`))?.scrollIntoView({block:'start'}); paintSearch(); }
      else host.querySelector('.focused')?.scrollIntoView({block:'center'});
      const target=showOriginal?null:(focusedSource||host.querySelector('.reader-evidence')?.closest('.reader-source-fragment')||document.getElementById(`reader-page-${detail.page}`));
      const paragraph=target?.closest('.reader-paragraph');
      const preferred=detail.focus?.readingPosition|| (paragraph?{paragraph_id:paragraph.id,fragment_index:focused?focused.index:Number(target.dataset.fragmentIndex)||0}:null);
      const saved=captureReaderPosition(preferred);
      if(saved){detail.page=saved.page;(globalThis.MethodAtlasStorage?.local || localStorage).setItem(positionKey(current.id,paper.version_id),JSON.stringify(saved));}
    };
    if (showOriginal) requestAnimationFrame(() => mountPdfJs(paper,page,renderGeneration).then(restorePosition));
    else requestAnimationFrame(restorePosition);
    if(!showOriginal)requestAnimationFrame(paintOverlays);
    const reader=host.querySelector('.reader-body');
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(positionKey(current.id,paper.version_id),JSON.stringify({page:detail.page,scroll:detail.focus?.readingPosition?.scroll || 0,mode:readerMode}));
    reader.addEventListener('scroll',()=>{
      if(detail?.paper.version_id!==paper.version_id)return;
      const position=captureReaderPosition();if(!position)return;
      detail.page=position.page;(globalThis.MethodAtlasStorage?.local || localStorage).setItem(positionKey(current.id,paper.version_id),JSON.stringify(position));
    },{passive:true});
    let width=reader.clientWidth;
    readerResize=new ResizeObserver(()=>{
      if(!reader.isConnected||readerMode!=='responsive'||reader.clientWidth===width)return;
      width=reader.clientWidth;
      const saved=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(positionKey(current.id,paper.version_id))||'null');
      restoreReaderAnchor(saved);
    });
    readerResize.observe(reader);
  };

  async function loadEntries(key) {
    entriesState='loading';renderAid();
    try {
      const result = await api(`${readerApi()}?version_id=${encodeURIComponent(detail.paper.version_id)}`);
      if (!sameReader(key)) return;
      entries=[...new Map([...result,...entries].map(x=>[x.id,x])).values()]; entriesState='ready'; paintTranslations(); renderAid(); paintOverlays();
    } catch (error) { if (sameReader(key)){entriesState='failed';paintTranslations();renderAid();toast(error.message);} }
  }

  function goReaderPage(page, focus=null) {
    if (!detail || !Number.isInteger(page) || page < 1 || page > detail.paper.page_count) return;
    readerPageError='';detail.page=page; detail.focus=focus; selection=null; renderDetail(); saveWorkspaceState();
    if(aidTab==='outline')document.getElementById('reader-page-input')?.focus({preventScroll:true});
  }

  async function gotoPdfDestination(destination) {
    const key=readingKey;
    try {
      const pdf=await pdfDocumentPromise;
      const dest=typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
      if (!dest || !sameReader(key)) return;
      const index=Number.isInteger(dest[0]) ? dest[0] : await pdf.getPageIndex(dest[0]);
      if (sameReader(key)) goReaderPage(index+1);
    } catch (error) { toast('无法定位这条论文内部引用'); }
  }

  function putEntry(entry) { entries=entries.filter(x=>x.id!==entry.id).concat(entry); }
  openMiddle = function openMiddleWithReaderPause(...args) {
    const result=baseOpenMiddle(...args);
    if(aidRun&&!document.querySelector('.reader-shell'))aidRun.stop=true;
    if(args[0]==='reader'){paintTranslations();renderAid();}
    return result;
  };
  const translatable = paragraph => paragraph.text.trim() && !['image','page_image'].includes(paragraph.kind) && paragraph.text !== '表格的行列或数值未能可靠转换，请查看原表图像；不要从转换文本推断数值。';
  const paragraphEntry = id => entries.find(entry=>entry.kind==='translation'&&entry.payload.translation_version===3&&entry.payload.paragraph_id===id);
  const legacyTranslations = () => entries.filter(entry=>entry.kind==='translation'&&!entry.payload.quote&&!entry.payload.paragraph_id);
  const historicalTranslations = () => {
    const paragraphs=detail?.paper.reader_document?.paragraphs;
    const active=new Set(paragraphs?.map(p=>p.id));
    return entries.filter(entry=>entry.kind==='translation'&&(!entry.payload.quote&&!entry.payload.paragraph_id||
      paragraphs&&entry.payload.translation_version===3&&entry.payload.paragraph_id&&!active.has(entry.payload.paragraph_id)));
  };
  const translationVisible = id => translationView.paragraphs[id]??translationView.visible;
  const saveTranslationView = () => (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-translation-view:${readingKey}`,JSON.stringify(translationView));

  function paragraphTranslation(paragraph) {
    const entry=paragraphEntry(paragraph.id),busy=entriesState!=='ready'||aidRun&&sameReader(aidRun.key);
    const button=(action,label,glyph,attrs='')=>`<button type="button" data-action="${action}" data-paragraph-id="${paragraph.id}" ${attrs}>${glyph?icon(glyph):''}${label}</button>`;
    if(!entry)return `<div class="reader-paragraph-translation-tools">${button('reader-translate-paragraph','翻译此段','translate',busy?'disabled':'')}</div>`;
    const visible=translationVisible(paragraph.id),label=visible?'收起译文':'展开译文';
    return `<div class="reader-paragraph-translation-tools">${button('reader-toggle-paragraph',label,'',`aria-expanded="${visible}" aria-controls="translation-${paragraph.id}"`)}<button type="button" data-action="reader-copy" data-id="${entry.id}" aria-label="复制此段译文" title="复制此段译文">${icon('copy')}</button>${button('reader-translate-paragraph','', 'history',`data-refresh="true" aria-label="重新翻译此段" title="重新翻译此段" ${busy?'disabled':''}`)}</div><p class="reader-paragraph-translation-text" id="translation-${paragraph.id}" lang="zh-Hans" ${visible?'':'hidden'}>${esc(entry.payload.text)}</p>`;
  }

  function paintTranslations() {
    if(!detail)return;
    const position=captureReaderPosition(),focused=document.activeElement?.dataset.paragraphId;
    for(const paragraph of detail.paper.reader_document?.paragraphs||[]) {
      const host=document.querySelector(`.reader-paragraph-translation[data-paragraph-id="${paragraph.id}"]`);
      if(host)host.innerHTML=paragraphTranslation(paragraph);
    }
    restoreReaderAnchor(position);
    if(focused)document.querySelector(`[data-action=reader-toggle-paragraph][data-paragraph-id="${focused}"]`)?.focus({preventScroll:true});
  }

  function renderTranslationControls() {
    const host=document.querySelector('.reader-translation-controls');
    if(!host||!detail)return;
    const paragraphs=(detail.paper.reader_document?.paragraphs||[]).filter(translatable),done=paragraphs.filter(p=>paragraphEntry(p.id)).length;
    const run=aidRun&&sameReader(aidRun.key)&&aidRun.kind==='translation'&&!aidRun.inline?aidRun:null;
    const label=entriesState==='loading'?'正在读取已有译文':entriesState==='failed'?'重新读取已有译文':run?'正在翻译全文':done===paragraphs.length&&done?'全文翻译已完成':done?'继续全文翻译':legacyTranslations().length?'升级为逐段译文':'翻译全文';
    const button=(action,label,glyph,attrs='')=>`<button type="button" class="reader-icon" data-action="${action}" aria-label="${label}" title="${label}" ${attrs}>${icon(glyph)}</button>`;
    const shown=paragraphs.some(p=>paragraphEntry(p.id)&&translationVisible(p.id));
    host.innerHTML=button(entriesState==='failed'?'reader-load-translations':'reader-translate-all',label,'translate',entriesState==='loading'||run||entriesState==='ready'&&done===paragraphs.length?'disabled':'')+(done?button('reader-toggle-translations',shown?'收起全文译文':'展开全文译文',shown?'minus':'plus',`aria-pressed="${shown}"`):'')+button('reader-translation-options','翻译选项','dots',`aria-expanded="${aidTab==='translation'}"`);
    const state=document.querySelector('.reader-translation-state'),error=readerError?.key===readingKey&&readerError.kind==='translation'&&!readerError.inline;
    state.hidden=!run&&!error;
    state.innerHTML=run?`<div class="reader-progress" role="status"><span>正在翻译 · ${run.done} / ${run.total} 段</span><button type="button" data-action="reader-stop" ${run.stop?'disabled':''}>${run.stop?'当前部分保存后暂停':'暂停'}</button></div>`:error?`<p role="alert">${esc(readerError.message)}</p><button type="button" data-action="reader-retry-translation">重试翻译</button>`:'';
  }
  const drafts = () => {
    try { return JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-drafts:${readingKey}`) || '{}'); } catch { return {}; }
  };
  function writeDraft(entry, key=readingKey) {
    const all=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-drafts:${key}`) || '{}');
    all[entry.id]=entry; (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-drafts:${key}`,JSON.stringify(all));
  }
  function readingNotes(includeDeleted=false) { return Object.values({...Object.fromEntries(entries.filter(x=>x.kind==='note').map(x=>[x.id,x])),...drafts()}).filter(x=>includeDeleted || !x.payload.deleted); }
  const noteFragments=note=>note.payload.fragments||[{...note.payload,page:note.page}];
  const noteQuote=note=>noteFragments(note).map(f=>f.quote||'图表区域').join('\n\n');

  function displayMap(fragment,kind='paragraph') {
    const units=[],source=fragment.text;
    let at=0;
    const append=(from,to)=>{for(let i=from;i<to;i++)units.push({char:source[i],start:i,end:i+1});};
    const breaks=kind==='formula'?/\s*\r?\n\s*/gu:/(?<=[\p{L}\p{N}_])-\r?\n(?=[\p{L}\p{N}_])|\s*\r?\n\s*/gu;
    for(const match of source.matchAll(breaks)) {
      append(at,match.index);
      if(!match[0].startsWith('-'))units.push({char:' ',start:match.index,end:match.index+match[0].length});
      at=match.index+match[0].length;
    }
    append(at,source.length);
    while(units.length&&/\s/.test(units[0].char))units.shift();
    while(units.length&&/\s/.test(units.at(-1).char))units.pop();
    if(units.at(-1)?.char==='-'&&!fragment.display_text.endsWith('-'))units.pop();
    return units.map(u=>u.char).join('')===fragment.display_text?units:null;
  }

  function textRange(element,from,to) {
    const range=document.createRange(),walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    let at=0,started=false;
    for(let node;node=walker.nextNode();) {
      const end=at+node.textContent.length;
      if(!started&&from<end){range.setStart(node,Math.max(0,from-at));started=true;}
      if(started&&to<=end){range.setEnd(node,to-at);return range;}
      at=end;
    }
    return null;
  }

  function webRanges(location) {
    const page=detail.paper.pages.find(p=>p.page===location.page),evidence=page&&readerEvidence(page,location);
    if(!evidence)return [];
    const ranges=[];
    for(const paragraph of detail.paper.reader_document?.paragraphs||[]) {
      paragraph.fragments.forEach((fragment,index)=>{
        if(fragment.page!==location.page||fragment.start===null)return;
        const from=Math.max(evidence.start,fragment.start),to=Math.min(evidence.end,fragment.end);
        if(from>=to)return;
        const elements=document.getElementById(paragraph.id)?.querySelectorAll(`[data-fragment-index="${index}"]`),map=displayMap(fragment,paragraph.kind);
        if(!elements?.length||!map)return;
        const chars=Array.from(fragment.text),start=chars.slice(0,from-fragment.start).join('').length,end=chars.slice(0,to-fragment.start).join('').length;
        const a=map.findIndex(u=>u.end>start),b=map.findLastIndex(u=>u.start<end)+1;
        if(a>=0&&b>a)for(const element of elements){
          const left=Number(element.dataset.displayStart||0),right=left+element.textContent.length;
          if(element.textContent!==fragment.display_text.slice(left,right))continue;
          const start=Math.max(a,left)-left,end=Math.min(b,right)-left;
          if(end>start){const range=textRange(element,start,end);if(range)ranges.push(range);}
        }
      });
    }
    return ranges;
  }

  function showNote(note,anchor=selectionAnchor) {
    clearTimeout(selectionTimer);inlineRequest++;
    activeAid=note.id;selectionAnchor=anchor;
    const bar=document.querySelector('.reader-selection');
    if(!bar)return;
    bar.classList.add('reader-inline-aid');bar.hidden=false;
    bar.setAttribute('aria-label','个人批注');
    const retained=(globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-conflict:${readingKey}:${note.id}`);
    bar.innerHTML=`<header><strong>我的批注</strong><button class="reader-icon" data-action="reader-dismiss" aria-label="关闭批注" title="关闭批注">${icon('close')}</button></header><div class="reader-note-editor" data-id="${esc(note.id)}"><small>${[...new Set(noteFragments(note).map(f=>f.page))].map(p=>`第 ${p} 页`).join('、')} · 个人观点</small><blockquote>${esc(noteQuote(note))}</blockquote><label>标记颜色<select id="reader-note-color"><option value="yellow" ${note.payload.color==='yellow'?'selected':''}>黄色</option><option value="blue" ${note.payload.color==='blue'?'selected':''}>蓝色</option><option value="pink" ${note.payload.color==='pink'?'selected':''}>粉色</option></select></label><label>批注<textarea id="reader-note-comment" maxlength="8000" placeholder="记下你的想法…">${esc(note.payload.comment)}</textarea></label><span id="reader-note-status" role="status">${drafts()[note.id]?'本机草稿 · 待保存':'已保存'}</span><div class="reader-note-actions"><button data-action="reader-save-note">保存</button><button data-action="reader-note-followup">带上此批注追问</button><button data-action="reader-delete-note">删除此批注</button></div><button data-action="reader-note-reload" hidden>重新打开保存版本，保留本机副本</button>${retained?`<details><summary>冲突前的本机批注</summary><p class="reader-prose">${esc(JSON.parse(retained).payload.comment)}</p></details>`:''}</div>`;
    positionSelection();
  }

  function resizeNotes(width) {
    const stage=document.querySelector('.reader-stage'),host=document.querySelector('.reader-aid'),handle=document.querySelector('.reader-note-resizer');
    if(!stage||!host||!handle)return;
    const max=Math.max(180,stage.clientWidth-326),value=Math.max(180,Math.min(max,width));
    host.style.setProperty('--reader-note-width',value+'px');
    handle.setAttribute('aria-valuemin','180');handle.setAttribute('aria-valuemax',String(max));handle.setAttribute('aria-valuenow',String(Math.round(value)));
    noteWidth=value;(globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-note-width:${readingKey}`,String(value));
    positionSelection();
  }
  function entryButton(entry,label) { return `<button class="reader-entry" data-action="reader-entry" data-id="${esc(entry.id)}"><small>第 ${entry.page} 页</small><span>${esc(label)}</span></button>`; }

  function sourceOutline() {
    if(pdfOutline?.length)return pdfOutline;
    const roots=[],stack=[];
    const headings=detail.paper.reader_document?.paragraphs.filter(p=>p.kind==='heading') || detail.paper.pages.flatMap(page=>(page.layout||[]).filter(b=>b.kind==='heading').map(block=>({...block,fragments:[{page:page.page}]})));
    for(const heading of headings) {
      const level=heading.level||2,item={title:heading.text,page:heading.fragments[0].page,paragraph_id:heading.id,items:[]};
      while(stack.length&&stack.at(-1).level>=level)stack.pop();
      (stack.at(-1)?.item.items||roots).push(item);stack.push({level,item});
    }
    return roots;
  }

  function positionTopPopover() {
    const host=document.querySelector('.reader-top-popover');
    if(!host||host.hidden)return;
    const trigger=document.querySelector(aidTab==='translation'?'[data-action=reader-translation-options]':`[data-action=reader-aid][data-tab=${aidTab}]`),rect=trigger?.getBoundingClientRect();
    if(!rect)return;
    const width=Math.min(360,innerWidth-24),left=Math.max(12,Math.min(rect.left,innerWidth-width-12)),top=rect.bottom+8;
    host.style.cssText=`left:${left}px;top:${top}px;width:${width}px;max-height:${Math.max(100,Math.min(560,innerHeight-top-16))}px`;
  }

  function renderTopPopover() {
    const host=document.querySelector('.reader-top-popover');
    if(!host)return;
    const previousTab=host.dataset.tab,draft=previousTab==='search'?host.querySelector('input[name=query]')?.value:null;
    const focused=host.contains(document.activeElement)?document.activeElement.id:null;
    const shown=['outline','search','translation'].includes(aidTab);host.hidden=!shown;host.dataset.tab=aidTab;
    if(!shown)return;
    const title=aidTab==='outline'?'论文目录':aidTab==='translation'?'翻译选项':'查找原文';
    let body='';
    if(aidTab==='outline') {
      const outline=items=>items.map(item=>{
        const button=`<button type="button" class="reader-outline" data-action="${item.dest?'reader-destination':'reader-page'}" ${item.dest?`data-dest="${esc(JSON.stringify(item.dest))}"`:`data-page="${item.page}" data-paragraph-id="${item.paragraph_id||''}"`}><span>${esc(item.title)}</span><small>${item.page||''}</small></button>`;
        return item.items?.length?`<details class="reader-outline-branch" open><summary>${icon('chevron')}${button}</summary><div>${outline(item.items)}</div></details>`:`<div class="reader-outline-leaf">${button}</div>`;
      }).join('');
      body=`<form id="reader-page-form" novalidate><label class="sr-only" for="reader-page-input">前往页码</label><div class="reader-page-field"><input id="reader-page-input" name="page" type="text" inputmode="numeric" value="${detail.page}" aria-describedby="reader-page-range"><button type="submit" class="reader-icon" aria-label="前往页码" title="前往页码">${icon('arrow')}</button></div><small id="reader-page-range">共 ${detail.paper.page_count} 页</small><p role="alert" ${readerPageError?'':'hidden'}>${esc(readerPageError)}</p></form><div class="reader-outline-scroll">${outline(sourceOutline())||'<p>这篇论文没有目录，可按页码跳转。</p>'}</div>`;
    } else if(aidTab==='translation') {
      const legacy=legacyTranslations(),history=historicalTranslations(),entry=history.find(e=>e.id===activeAid)||history.find(e=>e.page===detail.page)||history[0];
      const busy=entriesState==='loading'||aidRun&&sameReader(aidRun.key);
      body=`<div class="reader-outline-scroll reader-translation-options"><button type="button" data-action="${entriesState==='failed'?'reader-load-translations':'reader-translate-all'}" ${busy?'disabled':''}>${entriesState==='loading'?'正在读取已有译文':entriesState==='failed'?'重新读取已有译文':legacy.length?'升级为逐段译文':'继续全文翻译'}</button>${history.length?`<h3>历史译文</h3><p>按原来源保留，可继续回看。生成完整段落的新译文不会改写这些历史内容。</p><div class="reader-legacy-pages">${history.map(e=>`<button type="button" data-action="reader-legacy-entry" data-id="${e.id}" aria-pressed="${e.id===entry?.id}">第 ${e.page} 页 · ${e.payload.paragraph_id?'旧段落译文':'旧版整页译文'}</button>`).join('')}</div>${entry?`<p>${entry.payload.paragraph_id?'旧段落译文':'旧版整页译文'} · 第 ${entry.page} 页 · ${esc(entry.payload.model||'历史模型')}</p><button type="button" data-action="reader-copy" data-id="${entry.id}">复制旧译文</button>${translationProse(entry)}`:''}`:''}</div>`;
    } else body=`<div class="compact-search"><form id="reader-search-form" class="compact-search-field"><label class="sr-only" for="reader-search-input">搜索原文</label>${icon('search')}<input id="reader-search-input" name="query" type="search" maxlength="200" placeholder="输入原文关键词" value="${esc(draft??readerSearchDraft)}"><button type="submit" class="reader-icon" aria-label="查找原文" title="查找原文">${icon('arrow')}</button></form></div><div class="reader-outline-scroll" id="reader-search-results" aria-live="polite">${readerSearch?searchResults():''}</div>`;
    host.setAttribute('aria-label',title);
    const scroll=host.querySelector('.reader-outline-scroll')?.scrollTop||0;
    host.innerHTML=`<header><strong>${title}</strong><button type="button" class="reader-icon" data-action="reader-close-aid" aria-label="关闭${title}" title="关闭">${icon('close')}</button></header>${body}`;
    host.querySelector('.reader-outline-scroll').scrollTop=scroll;positionTopPopover();
    if(focused)document.getElementById(focused)?.focus({preventScroll:true});
  }

  function renderAid() {
    const host=document.querySelector('.reader-aid');
    if (!host || !detail) return;
    const previous=host.querySelector('.reader-aid-content'), scroll=host.dataset.location===`${aidTab}:${detail.page}` ? previous?.scrollTop || 0 : 0;
    host.dataset.location=`${aidTab}:${detail.page}`; host.dataset.tab=aidTab;
    document.querySelectorAll('.reader-tools [data-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===aidTab)));
    renderTranslationControls();
    renderTopPopover();
    host.hidden=!aidTab || ['outline','search','translation'].includes(aidTab);
    const handle=document.querySelector('.reader-note-resizer');
    if(handle)handle.hidden=aidTab!=='notes';
    if(aidTab==='notes')resizeNotes(noteWidth);
    if (host.hidden) return;
    const titles={outline:'论文目录',search:'查找原文',translation:'中文翻译',notes:'我的批注',explanations:'原文解释'};
    let body='';
    const progress=aidRun && sameReader(aidRun.key) ? `<div class="reader-progress" role="status"><span>${esc(aidRun.label)}${aidRun.total>1?` · ${aidRun.done} / ${aidRun.total}`:'…'}</span>${aidRun.total>1?'<button data-action="reader-stop">停止</button>':''}</div>` : '';
    if (aidTab==='notes') {
      body='<p class="reader-hint">个人批注 · 点击条目回到原文并就地编辑。</p>';
      body+='<button data-action="reader-notes-followup">带上我的批注</button>'+readingNotes().map(x=>entryButton(x,x.payload.comment || noteQuote(x))).join('');
      const removed=readingNotes(true).filter(x=>x.payload.deleted).at(-1);
      if(removed)body+=`<button data-action="reader-restore-note" data-id="${removed.id}">撤销最近删除</button>`;
    }
    if (aidTab==='explanations') {
      const saved=entries.filter(x=>['explanation','figure'].includes(x.kind) || x.kind==='translation' && x.payload.quote);
      const entry=saved.find(x=>x.id===activeAid);
      if (entry) body+=`<small>第 ${entry.page} 页 · ${entry.kind==='translation' ? '选区翻译' : entry.kind==='figure' ? '图表解释' : '原文解释'}</small><blockquote>${esc(entry.payload.quote || '所选图表区域')}</blockquote><div class="reader-prose">${esc(entry.payload.text)}</div><button data-action="reader-followup" data-id="${entry.id}">继续追问</button>`;
      body+=saved.map(x=>entryButton(x,(x.kind==='translation'?'译文 · ':'')+(x.payload.quote || '图表区域'))).join('') || '<p>划选原文后解释或翻译，也可框选图表解释。已保存的结果可在这里回看。</p>';
    }
    host.innerHTML=`<header><strong>${titles[aidTab]}</strong><button class="reader-icon" data-action="reader-close-aid" aria-label="关闭阅读辅助" title="关闭阅读辅助">${icon('close')}</button></header><div class="reader-aid-content">${progress}${body}</div>`;
    host.querySelector('.reader-aid-content').scrollTop=scroll;
  }

  function translationProse(entry) {
    const segments=entry.payload.segments;
    if (!segments) return `<div class="reader-prose reader-translation-prose" style="font-size:${translationSize}px">${entry.payload.text.split(/\n+/).filter(Boolean).map(line=>`<p>${esc(line)}</p>`).join('')}</div>`;
    const start=segments.findIndex(part=>/^(?:Abstract\b|Fig(?:ure)?\.?\s*\d)/i.test(part.source));
    const metadata=entry.page===1 && segments[0]?.kind==='heading' && start>1;
    const block=part=>`<section class="reader-translation-block">${part.kind==='heading'?`<h3>${esc(part.text)}</h3>`:`<p>${esc(part.text)}</p>`}<details class="reader-original-text"><summary>原文</summary><p>${esc(part.source.replace(/\n/g,' '))}</p></details></section>`;
    return `<article class="reader-prose reader-translation-prose" style="font-size:${translationSize}px">${segments.map((part,index)=>metadata && index===1 ? `<details class="reader-frontmatter"><summary>作者与机构</summary>${segments.slice(1,start).map(block).join('')}</details>` : metadata && index>1 && index<start ? '' : block(part)).join('')}</article>`;
  }

  function paintOverlays() {
    if (!detail) return;
    const host=document.querySelector('.reader-marks'),page=detail.paper.pages.find(x=>x.page===detail.page);
    const missing=[],colors={yellow:'#ffdc64',blue:'#8ec5ff',pink:'#f8accb'};
    const groups={'reader-note-yellow':[],'reader-note-blue':[],'reader-note-pink':[],'reader-ai':[]};
    let html='';webMarks=[];
    document.querySelectorAll('.reader-image-note-mark').forEach(mark=>mark.remove());
    const imageRegion=(location,title,id,color)=>{
      let located=0;const used=new Set();
      const area=paragraph=>{const rect=paragraph.fragments[0].rects[0];return rect?(rect[2]-rect[0])*(rect[3]-rect[1]):Infinity;};
      const images=(detail.paper.reader_document?.paragraphs||[]).filter(p=>['image','formula','page_image'].includes(p.kind)).sort((a,b)=>area(a)-area(b));
      for(const paragraph of images) {
        const fragment=paragraph.fragments[0],crop=fragment.rects[0];
        if(fragment.page!==location.page||!crop)continue;
        const rects=(location.rects||[]).filter(rect=>!used.has(rect)&&rect[0]>=crop[0]&&rect[1]>=crop[1]&&rect[2]<=crop[2]&&rect[3]<=crop[3]);
        const image=document.getElementById(paragraph.id)?.querySelector('img.source-fragment');
        if(!image||!rects.length)continue;
        rects.forEach(rect=>used.add(rect));
        const button=image.closest('.image-button');let wrapper=button.parentElement;
        if(!wrapper.classList.contains('reader-image-note-host')){wrapper=document.createElement('div');wrapper.className='reader-image-note-host';button.before(wrapper);wrapper.append(button);}
        wrapper.insertAdjacentHTML('beforeend',rects.map(rect=>`<button type="button" class="reader-mark reader-mark-note reader-image-note-mark" data-action="reader-note-mark" data-id="${esc(id)}" data-source="note" aria-label="${esc(title)}" title="${esc(title)}" style="--mark:${colors[color]};left:${(rect[0]-crop[0])/(crop[2]-crop[0])*100}%;top:${(rect[1]-crop[1])/(crop[3]-crop[1])*100}%;width:${(rect[2]-rect[0])/(crop[2]-crop[0])*100}%;height:${(rect[3]-rect[1])/(crop[3]-crop[1])*100}%"></button>`).join(''));
        located+=rects.length;
      }
      return located>0&&located===(location.rects||[]).length;
    };
    const paint=(location,title,source,id,index='',color='yellow')=>{
      const rects=location.rects||[],ranges=readerMode==='responsive'?webRanges(location):[];
      const region=readerMode==='responsive'&&source==='note'&&!location.quote&&imageRegion(location,title,id,color);
      if(readerMode==='responsive') {
        groups[source==='note'?'reader-note-'+color:'reader-ai'].push(...ranges);
        ranges.forEach(range=>webMarks.push({range,source,id,index}));
      } else if(host&&location.page===page.page) {
        html+=rects.map(rect=>`<button type="button" class="reader-mark reader-mark-${source}" data-action="${source==='note'?'reader-note-mark':'reader-highlight'}" data-id="${esc(id)}" data-index="${index}" data-source="${source}" title="${esc(title)}" aria-label="${esc(title)}" style="--mark:${source==='note'?colors[color]:'var(--accent)'};left:${rect[0]/page.width*100}%;top:${rect[1]/page.height*100}%;width:${(rect[2]-rect[0])/page.width*100}%;height:${(rect[3]-rect[1])/page.height*100}%"></button>`).join('');
      }
      if(readerMode==='responsive'?!ranges.length&&!region:!rects.length)missing.push({title,location,source,id,index});
    };
    readingNotes().forEach(note=>noteFragments(note).forEach(location=>paint(location,'我的批注：'+(note.payload.comment||'个人高亮'),'note',note.id,'',note.payload.color)));
    if(showHighlights)entries.filter(x=>x.kind==='highlights').forEach(entry=>entry.payload.items.forEach((item,index)=>paint({...item,page:entry.page},`AI 重点 · ${item.category}：${item.reason}`,'ai',entry.id,index)));
    if(CSS.highlights)Object.entries(groups).forEach(([name,ranges])=>CSS.highlights.set(name,new Highlight(...ranges)));
    if(host){host.querySelectorAll('.reader-mark').forEach(mark=>mark.remove());host.insertAdjacentHTML('afterbegin',html);}
    const status=document.querySelector('.reader-highlight-status'),button=document.querySelector('[data-action=reader-toggle-highlights]');
    button?.setAttribute('aria-pressed',String(showHighlights));
    if(status)status.textContent=highlightStatusText();
    document.querySelectorAll('[data-action=reader-regenerate-highlights]').forEach(button=>{button.disabled=entriesState!=='ready'||Boolean(aidRun);});
    const notice=document.querySelector('.reader-unlocated');
    if(notice){notice.hidden=!missing.length;notice.querySelector('summary').textContent=`${missing.length} 处未定位`;notice.querySelector('div').innerHTML=missing.map(item=>`<p><small>第 ${item.location.page} 页 · ${item.source==='note'?'个人批注':'AI 重点'} · 未定位</small><q>${esc(item.location.quote||'图表区域')}</q><span>${esc(item.title)}</span></p>`).join('');}
    document.querySelectorAll('.reader-web-note').forEach(button=>button.remove());
    if(readerMode==='responsive')readingNotes().forEach(note=>{
      const ids=[...new Set(webMarks.filter(mark=>mark.source==='note'&&mark.id===note.id).map(mark=>mark.range.startContainer.parentElement.closest('.reader-paragraph')?.id).filter(Boolean))];
      ids.forEach(id=>document.getElementById(id)?.querySelector('.reader-paragraph-source')?.insertAdjacentHTML('afterbegin',`<button type="button" class="reader-web-note reader-source-page" data-action="reader-note-mark" data-id="${esc(note.id)}" aria-label="查看个人批注：${esc(note.payload.comment||noteQuote(note))}">${icon('edit')}我的批注</button>`));
    });
  }

  function highlightStatusText() {
    const run=aidRun?.key===readingKey&&aidRun.kind==='highlights'?aidRun:null;
    if(run)return `${run.refresh?'正在重新生成整篇重点':'AI 重点'} · ${run.done} / ${run.total}`;
    const error=readerError?.key===readingKey&&readerError.kind==='highlights'?readerError:null;
    if(error)return error.refresh
      ? `整篇重点重新生成失败（第 ${error.page} 页）：${error.message}；已更新 ${error.done} / ${error.total} 页，其余页面原有重点已保留。可点击重新生成整篇重点重试。`
      : `重点生成失败：${error.message}；已完成内容保留，再次开启可继续。`;
    if(!showHighlights)return '';
    const highlights=entries.filter(entry=>entry.kind==='highlights');
    const empty=entriesState==='ready'&&detail.paper.pages.length>0&&detail.paper.pages.every(page=>highlights.some(entry=>entry.page===page.page))&&highlights.every(entry=>entry.payload.items.length===0);
    return empty?'AI 重点 · 未发现可标记重点':'AI 重点 · 虚线标记';
  }

  function searchResults() {
    if(!readerSearch)return '';
    const pattern=new RegExp(readerSearch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
    const hits=detail.paper.pages.flatMap(p=>{
      const values=[];
      for(const match of p.text.matchAll(pattern)) {
        const at=match.index,quote=match[0],start=Array.from(p.text.slice(0,at)).length,end=start+Array.from(quote).length;
        values.push(`<button type="button" class="reader-entry reader-search-hit" data-action="reader-search-hit" data-page="${p.page}" data-start="${start}" data-end="${end}" data-quote="${esc(quote)}"><small>第 ${p.page} 页</small><span>${esc(p.text.slice(Math.max(0,at-60),at+quote.length+100))}</span></button>`);
        // cap rendered hits per page; paginate if one-letter searches become a normal workflow.
        if(values.length===100)break;
      }
      return values;
    });
    return hits.join('') || '<p>没有匹配的原文。</p>';
  }

  function paintSearch() {
    if (!readerSearch || !CSS.highlights) return;
    const body=document.querySelector('.reader-body'), ranges=[];
    if(!body)return;
    const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);
    for(let node;node=walker.nextNode();) {
      if(!node.parentElement.closest('.textLayer,.reader-original,.responsive-page:not(.reader-paragraph)'))continue;
      const value=node.textContent.toLocaleLowerCase(),query=readerSearch.toLocaleLowerCase();
      for(let at=value.indexOf(query);at>=0;at=value.indexOf(query,at+query.length)) {
        const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+query.length);ranges.push(range);
      }
    }
    CSS.highlights.set('reader-search',new Highlight(...ranges));
  }

  function positionSelection() {
    const bar=document.querySelector('.reader-selection'), body=document.querySelector('.reader-body');
    if (!bar || bar.hidden || !body) return;
    const bounds=body.getBoundingClientRect(), anchor=selectionAnchor || bounds;
    const left=Math.max(8,bounds.left+8), right=Math.min(innerWidth-8,bounds.right-8);
    const top=Math.max(8,bounds.top+8), bottom=Math.min(innerHeight-8,bounds.bottom-8);
    bar.style.maxWidth=Math.max(0,right-left)+'px';
    bar.style.maxHeight=Math.max(0,bottom-top)+'px';
    const size=bar.getBoundingClientRect();
    bar.style.left=Math.max(left,Math.min(anchor.right-size.width,right-size.width))+'px';
    bar.style.top=Math.max(top,Math.min(anchor.bottom+8+size.height<=bottom ? anchor.bottom+8 : anchor.top-size.height-8,bottom-size.height))+'px';
  }

  function dismissSelection(clearNative=false) {
    clearTimeout(selectionTimer); inlineRequest++; selection=null;
    if (clearNative) window.getSelection()?.removeAllRanges();
    const bar=document.querySelector('.reader-selection');
    if (bar) bar.hidden=true;
    paintOverlays();
  }

  function showSelection() {
    const bar=document.querySelector('.reader-selection');
    if (!bar || !selection) return;
    bar.classList.remove('reader-inline-aid');
    const item=(action,label,glyph,key)=>`<button type="button" data-action="${action}" aria-label="${label}" aria-keyshortcuts="${key}">${icon(glyph)}<span>${label}</span><kbd aria-hidden="true">${key}</kbd></button>`;
    bar.innerHTML=item('reader-explain','解释','bulb','E')+(selection.quote?item('reader-translate','翻译','translate','T'):'')+item('reader-new-note','个人批注','edit','C')+(state?.collaboration?item('reader-shared-comment','共享评论','chat',''):'')+item('reader-followup','提问','chat','Enter');
    bar.hidden=false;
    paintOverlays(); positionSelection();
  }

  function showInlineAid(entry=null, message='正在解释所选原文…', kind=entry?.kind) {
    const bar=document.querySelector('.reader-selection');
    if (!bar) return;
    bar.classList.add('reader-inline-aid');bar.hidden=false;
    inlineKind=kind;
    const title=kind==='translation'?'简体中文':kind==='figure'?'图表解释':kind==='highlights'?'AI 重点':'原文解释';
    bar.innerHTML=`<header><strong>${title}</strong><div>${entry?.id?`<button class="reader-icon" data-action="reader-copy" data-id="${entry.id}" title="复制" aria-label="复制结果">${icon('copy')}</button>`:''}<button class="reader-icon" data-action="reader-dismiss" aria-label="关闭${kind==='translation'?'选区翻译':kind==='highlights'?'AI 重点':'原文解释'}" title="关闭">${icon('close')}</button></div></header><div class="reader-prose" role="status">${esc(entry?.payload.text || message)}</div>${entry?`<footer><button data-action="reader-followup" ${entry.id?`data-id="${entry.id}"`:''}>${icon('chat')}继续追问</button>${kind==='highlights'?`<button type="button" data-action="reader-regenerate-highlights" ${entriesState!=='ready'||aidRun?'disabled':''}>${icon('history')}重新生成整篇重点</button>`:entry.id?`<button class="reader-icon" data-action="reader-retry" title="重新生成" aria-label="重新生成">${icon('history')}</button>`:''}</footer>`:readerError?'<button data-action="reader-retry">重试</button>':''}`;
    positionSelection();
  }

  function regenerateHighlights() {
    if(aidRun)return toast('阅读分析正在进行');
    if(entriesState!=='ready')return toast('请先读取已有阅读辅助内容，再重新生成重点');
    showHighlights=true;
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-highlights:${readingKey}`,'true');
    dismissSelection();
    return runAid('highlights',true,false,true);
  }

  async function runAid(kind, all=false, selected=false, refresh=false) {
    if (aidRun) return toast('阅读分析正在进行');
    const paper=detail.paper, project=current.id, key=readingKey, conversationId=serverConversationId();
    const chosen=selection && {...selection};
    const inline=selected || ['explanation','figure'].includes(kind);
    if (inline && !chosen) return toast('请先选择原文或图表');
    const locations=inline?(chosen.fragments||[chosen]):(all?paper.pages.map(x=>({page:x.page})):[{page:detail.page}]);
    const pages=locations.map(location=>location.page),completed=[];
    const run=aidRun={key,kind,inline,refresh,done:0,total:pages.length,stop:false,label:kind==='translation'?'正在翻译':kind==='highlights'?refresh?'正在重新生成整篇重点':'正在标记':'正在解释'};
    readerError=null;
    clearTimeout(selectionTimer);
    if (inline) showInlineAid(null,kind==='translation'?'正在翻译所选原文…':'正在解释所选原文…',kind);
    else if(kind==='translation') {aidTab='translation';renderAid();}
    else paintOverlays();
    const token=++inlineRequest;
    try {
      for (const location of locations) {
        if (run.stop || !sameReader(key)) break;
        const page=location.page;
        const entry=await api(readerApi(paper,project)+'/generate',{method:'POST',body:JSON.stringify({version_id:paper.version_id,conversation_id:conversationId,kind,page,refresh,...(inline?location:{})})});
        if (!sameReader(key)||aidRun!==run) break;
        if(kind==='highlights'&&(entry.project_id!==project||entry.version_id!==paper.version_id||entry.kind!==kind||entry.page!==page||!Array.isArray(entry.payload?.items)))throw Error('重点来源与当前论文不一致，已有重点已保留');
        putEntry(entry);if(inline&&token===inlineRequest)activeAid=entry.id;run.done++;renderAid();paintOverlays();
        if (inline && token===inlineRequest) {completed.push(entry);showInlineAid(locations.length===1?entry:{kind,payload:{text:completed.map(item=>`第 ${item.page} 页\n${item.payload.text}`).join('\n\n')}});}
      }
      if(kind==='highlights'&&refresh&&sameReader(key))toast(run.done===run.total?`整篇重点已重新生成 · ${run.done} / ${run.total} 页`:`重点更新已暂停 · ${run.done} / ${run.total} 页，其余页面保留原有重点。`);
    } catch (error) { if (sameReader(key)) {readerError={key,kind,inline,refresh,done:run.done,total:run.total,page:pages[run.done],message:error.message};if(inline && token===inlineRequest)showInlineAid(null,error.message,kind);} }
    finally { if (aidRun===run) aidRun=null; if (sameReader(key)) {renderAid();paintOverlays();} }
  }

  async function runParagraphTranslation(paragraphId=null, refresh=false) {
    if(entriesState!=='ready')return toast('请先读取已有译文');
    if(aidRun)return toast('阅读分析正在进行');
    const paper=detail.paper,project=current.id,key=readingKey,conversationId=serverConversationId();
    const ids=paragraphId?(Array.isArray(paragraphId)?paragraphId:[paragraphId]):null;
    const paragraphs=(paper.reader_document?.paragraphs||[]).filter(translatable).filter(p=>!ids||ids.includes(p.id));
    const pending=paragraphs.filter(p=>refresh||!paragraphEntry(p.id)),batches=[];
    if(!paragraphs.length)return toast('此文献没有可译原文，请先取得全文或完成 OCR');
    if(!pending.length)return;
    for(const paragraph of pending) {
      let batch=batches.at(-1);
      if(!batch||batch.length>=12||batch.reduce((sum,p)=>sum+p.text.length,0)+paragraph.text.length>8000)batches.push(batch=[]);
      batch.push(paragraph);
    }
    aidTab='';readerError=null;dismissSelection();saveTranslationView();
    if(readerMode==='original')switchReaderMode('responsive');
    const run=aidRun={key,kind:'translation',inline:false,label:ids?.length===1?'正在翻译此段':'正在翻译全文',done:paragraphs.length-pending.length,total:paragraphs.length,stop:false};
    paintTranslations();renderAid();
    let nextBatch=0;
    try {
      for(const batch of batches) {
        if(run.stop||!sameReader(key))break;
        const result=await api(readerApi(paper,project)+'/generate',{method:'POST',body:JSON.stringify({
          version_id:paper.version_id,conversation_id:conversationId,kind:'translation',page:batch[0].fragments[0].page,
          paragraph_ids:batch.map(p=>p.id),refresh})});
        if(!sameReader(key))break;
        if(result.version_id!==paper.version_id||!Array.isArray(result.entries))throw Error('译文来源版本不一致，已有内容已保留');
        result.entries.forEach(putEntry);run.done+=batch.length;paintTranslations();renderAid();
        nextBatch++;
      }
    } catch(error) {if(sameReader(key))readerError={key,kind:'translation',message:error.message,paragraph_ids:batches.slice(nextBatch).flat().map(p=>p.id),refresh};}
    finally {if(aidRun===run)aidRun=null;if(sameReader(key)){paintTranslations();renderAid();}}
  }

  const savingNotes=new Set();
  async function saveNote(id) {
    const key=readingKey, project=current.id, paper=detail.paper;
    if (savingNotes.has(id)) return;
    savingNotes.add(id);
    try {
      while (sameReader(key) && drafts()[id]) {
        const draft=drafts()[id], sent=JSON.stringify(draft.payload);
        const status=document.getElementById('reader-note-status');
        if (status) status.textContent='正在保存…';
        const saved=await api(readerApi(paper,project)+'/note',{method:'POST',body:JSON.stringify({id,revision:draft.revision,version_id:paper.version_id,page:draft.page,...draft.payload})});
        const all=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`reader-drafts:${key}`)||'{}');
        if (all[id] && JSON.stringify(all[id].payload)===sent) delete all[id];
        else if (all[id]) all[id].revision=saved.revision;
        (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-drafts:${key}`,JSON.stringify(all));
        if (!sameReader(key)) break;
        putEntry(saved); paintOverlays();
        if (status?.isConnected) status.textContent=all[id]?'有新修改待保存':'已保存';
      }
    } catch (error) { if (sameReader(key)) { toast(error.message); const status=document.getElementById('reader-note-status'); if(status) status.textContent=error.message+' · 本机草稿已保留，可点击保存重试'; const reload=document.querySelector('[data-action=reader-note-reload]');if(reload)reload.hidden=error.code!=='conflict'; } }
    finally { savingNotes.delete(id); }
  }

  function noteChanged() {
    const editor=document.querySelector('.reader-note-editor');
    if (!editor) return;
    const entry=readingNotes().find(x=>x.id===editor.dataset.id);
    if (!entry) return;
    writeDraft({...entry,payload:{...entry.payload,comment:document.getElementById('reader-note-comment').value,color:document.getElementById('reader-note-color').value}});
    document.getElementById('reader-note-status').textContent='本机草稿 · 待保存';
    clearTimeout(noteTimer); noteTimer=setTimeout(()=>{if(sameReader(entry.project_id+':'+entry.version_id))saveNote(entry.id);},650);
  }

  async function followup(location, notes=[]) {
    if (!detail || !location) return;
    const paper=detail.paper;
    if(notes.some(note=>drafts()[note.id]))return toast('请先保存批注；本机草稿仍保留。');
    const fragments=location.fragments||[location];
    for(let index=0;index<fragments.length;index++) {
      const fragment=fragments[index],quote=fragment.quote||'',comments=index===0?notes.map(x=>({id:x.id,page:x.page,comment:x.payload.comment})):[];
      if(!await window.MethodAtlasAI.open({id:uid(),kind:'paper',paper_id:paper.id,version_id:paper.version_id,page:fragment.page,quote,rects:fragment.rects||[],notes:comments,title:`${paper.title} · 第 ${fragment.page} 页`,text:quote||(comments.length?'所选个人批注':fragment.rects?.length?'所选图表区域':'当前页原文')}))break;
    }
  }

  function captureSelection() {
    if (!detail) return false;
    const chosen=window.getSelection();
    const quote=chosen?.toString().trim();
    if (!quote || !chosen.rangeCount) return false;
    const range=chosen.getRangeAt(0), node=range.commonAncestorContainer;
    const element=node.nodeType===Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element.closest('.reader-body')) return false;
    const frame=element.closest('.pdfjs-canvas-page'), section=element.closest('.responsive-page');
    let rects=[],page=detail.page,fragments=null;
    if(!document.querySelector('.reader-continuous')&&Array.from(quote).length>12000)return false;
    if (frame) {
      const bounds=frame.getBoundingClientRect(), original=detail.paper.pages.find(x=>x.page===page);
      rects=Array.from(range.getClientRects()).filter(r=>r.width>1 && r.height>1).slice(0,100).map(r=>[Math.max(0,(r.left-bounds.left)/bounds.width*original.width),Math.max(0,(r.top-bounds.top)/bounds.height*original.height),Math.min(original.width,(r.right-bounds.left)/bounds.width*original.width),Math.min(original.height,(r.bottom-bounds.top)/bounds.height*original.height)]).filter(r=>r[2]>r[0] && r[3]>r[1]);
    } else if (document.querySelector('.reader-continuous')) {
      if([...document.querySelectorAll('.reader-paragraph-translation-text:not([hidden])')].some(node=>range.intersectsNode(node))){dismissSelection();toast('选区包含译文，请选择原文提问或批注。');return false;}
      fragments=[];
      for(const span of document.querySelectorAll('.reader-source-fragment')) {
        if(!range.intersectsNode(span))continue;
        const paragraph=detail.paper.reader_document.paragraphs.find(p=>p.id===span.closest('.reader-paragraph').id),index=Number(span.dataset.fragmentIndex),fragment=paragraph?.fragments[index],map=fragment&&displayMap(fragment,paragraph.kind);
        const sub=document.createRange();sub.selectNodeContents(span);
        if(range.compareBoundaryPoints(Range.START_TO_START,sub)>0)sub.setStart(range.startContainer,range.startOffset);
        if(range.compareBoundaryPoints(Range.END_TO_END,sub)<0)sub.setEnd(range.endContainer,range.endOffset);
        const before=document.createRange();before.selectNodeContents(span);before.setEnd(sub.startContainer,sub.startOffset);
        const start=Number(span.dataset.displayStart||0)+before.toString().length,end=start+sub.toString().length;
        if(end>start&&(!map||fragment.start===null)){dismissSelection();toast('此选区未能可靠定位，请在原 PDF 选择原文或区域。');return false;}
        if(end<=start||!map[start]||!map[end-1])continue;
        const raw=fragment.text.slice(map[start].start,map[end-1].end),chosen=raw.trim();
        if(!chosen)continue;
        const prefix=fragment.text.slice(0,map[start].start)+raw.slice(0,raw.length-raw.trimStart().length);
        const from=fragment.start+Array.from(prefix).length;
        fragments.push({paragraph_id:paragraph.id,fragment_index:index,source_path:fragment.source_path,page:fragment.page,quote:chosen,start:from,end:from+Array.from(chosen).length,rects:[]});
      }
      if(!fragments.length){dismissSelection();toast('此选区未能可靠定位，请在原 PDF 选择原文或区域。');return false;}
      if(fragments.reduce((length,fragment)=>length+Array.from(fragment.quote).length,0)>12000)return false;
      page=fragments[0].page;
    } else if (section && section.contains(range.commonAncestorContainer)) {
      page=Number(section.dataset.page||section.id.replace('reader-page-',''));
    }
    else return false;
    const bounds=document.querySelector('.reader-body').getBoundingClientRect();
    const visible=Array.from(range.getClientRects()).filter(r=>r.width>1 && r.height>1 && r.bottom>bounds.top && r.top<bounds.bottom);
    if (!visible.length) return false;
    selectionAnchor=visible.at(-1);
    selection={quote:fragments?fragments[0].quote:quote,page,rects,...(fragments?{fragments}:{})}; inlineRequest++; showSelection(); return true;
  }

  // Native selection handles remain usable; selectionchange also covers touch and keyboard selection.
  document.addEventListener('selectionchange',()=>{
    clearTimeout(selectionTimer);
    if (press || document.querySelector('.reader-inline-aid:not([hidden])')) return;
    selectionTimer=setTimeout(captureSelection,180);
  });
  document.addEventListener('pointerdown',event=>{
    clearTimeout(press?.timer); press=null;
    if (event.target.closest('.reader-selection')) {
      if (event.pointerType==='mouse' && event.target.closest('button')) event.preventDefault();
      return;
    }
    // Overlay controls must survive pointerdown until their click handler runs.
    if (event.target.closest('.reader-body button,.reader-body a')) return;
    dismissSelection();
    const text=event.target.closest('.textLayer span,.responsive-paragraph,.responsive-page h1,.responsive-page h2,.responsive-page h3,.responsive-list,.responsive-table td,.responsive-table th');
    if (!text || event.button!==0) return;
    const x=event.clientX,y=event.clientY;
    press={x,y,timer:setTimeout(()=>{
      if (!text.isConnected) return;
      if (!captureSelection()) {
        const caret=document.caretPositionFromPoint?.(x,y), fallback=!caret && document.caretRangeFromPoint?.(x,y);
        const node=caret?.offsetNode || fallback?.startContainer, offset=caret?.offset ?? fallback?.startOffset;
        if (node?.nodeType!==Node.TEXT_NODE || !text.contains(node)) return;
        const word=Array.from(new Intl.Segmenter(undefined,{granularity:'word'}).segment(node.textContent)).find(s=>s.isWordLike && s.index<=offset && s.index+s.segment.length>offset);
        if (!word) return;
        const range=document.createRange(); range.setStart(node,word.index); range.setEnd(node,word.index+word.segment.length);
        const chosen=window.getSelection(); chosen.removeAllRanges(); chosen.addRange(range); captureSelection();
      }
    },500)};
  });
  document.addEventListener('pointermove',event=>{
    if (press && Math.hypot(event.clientX-press.x,event.clientY-press.y)>8) clearTimeout(press.timer);
  });
  document.addEventListener('pointerup',event=>{
    clearTimeout(press?.timer); press=null;
    if (event.target.closest('.reader-body') && !event.target.closest('.reader-region,button,a')) {
      clearTimeout(selectionTimer); captureSelection();
    }
  });
  document.addEventListener('pointercancel',()=>{clearTimeout(press?.timer);press=null;});
  document.addEventListener('contextmenu',event=>{
    if (event.target.closest('.textLayer,.responsive-page') && captureSelection()) event.preventDefault();
  });
  document.addEventListener('scroll',event=>{
    if (event.target.matches?.('.reader-body')) {clearTimeout(press?.timer);press=null;if(!document.querySelector('.reader-inline-aid:not([hidden])'))dismissSelection();}
  },true);
  window.addEventListener('resize',()=>{positionSelection();positionTopPopover();});
  window.addEventListener('typographychange',()=>{
    if(!detail)return;
    const saved=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(positionKey(current.id,detail.paper.version_id))||'null');
    restoreReaderAnchor(saved);positionTopPopover();
  });
  document.addEventListener('keydown',event=>{
    const bar=document.querySelector('.reader-selection:not([hidden])');
    if (!bar || event.target.closest('.ai-dialog,input,textarea,select,[contenteditable=true]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();dismissSelection(true);document.querySelector('.reader-body')?.focus({preventScroll:true});return;}
    if (bar.classList.contains('reader-inline-aid')) return;
    const buttons=[...bar.querySelectorAll('button')], index=buttons.indexOf(document.activeElement);
    if (['ArrowDown','ArrowUp'].includes(event.key)) {
      event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length].focus();return;
    }
    if (event.key==='Enter' && index>=0) return;
    const action={e:'reader-explain',t:'reader-translate',c:'reader-new-note',Enter:'reader-followup'}[event.key.length===1?event.key.toLowerCase():event.key];
    if (action) {event.preventDefault();bar.querySelector(`[data-action=${action}]`)?.click();}
  });

  document.addEventListener('pointerdown',event=>{
    if (!event.target.matches('.reader-region')) return;
    const layer=event.target; layer.setPointerCapture(event.pointerId);
    const bounds=layer.getBoundingClientRect(); regionStart={x:event.clientX-bounds.left,y:event.clientY-bounds.top};
    layer.innerHTML='<span class="reader-region-box"></span>'; event.preventDefault();
  });
  document.addEventListener('pointermove',event=>{
    if (!regionStart || !event.target.matches('.reader-region')) return;
    const bounds=event.target.getBoundingClientRect(),x=Math.max(0,Math.min(bounds.width,event.clientX-bounds.left)),y=Math.max(0,Math.min(bounds.height,event.clientY-bounds.top));
    event.target.firstChild.style.cssText=`left:${Math.min(x,regionStart.x)}px;top:${Math.min(y,regionStart.y)}px;width:${Math.abs(x-regionStart.x)}px;height:${Math.abs(y-regionStart.y)}px`;
  });
  document.addEventListener('pointerup',event=>{
    if (!regionStart || !event.target.matches('.reader-region')) return;
    const layer=event.target,bounds=layer.getBoundingClientRect(),rect=layer.firstChild.getBoundingClientRect(),page=detail.paper.pages.find(x=>x.page===detail.page);
    if (rect.width>8 && rect.height>8) {selectionAnchor=rect;selection={page:page.page,quote:'',rects:[[(rect.left-bounds.left)/bounds.width*page.width,(rect.top-bounds.top)/bounds.height*page.height,(rect.right-bounds.left)/bounds.width*page.width,(rect.bottom-bounds.top)/bounds.height*page.height]]};}
    regionStart=null; layer.hidden=true; document.querySelector('[data-action=reader-region]')?.setAttribute('aria-pressed','false'); showSelection();
  });

  document.addEventListener('input',event=>{
    if(event.target.id==='reader-note-comment')noteChanged();
    if(event.target.id==='reader-search-input')readerSearchDraft=event.target.value;
  });
  document.addEventListener('change',event=>{if(event.target.id==='reader-note-color')noteChanged();});
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.reader-note-resizer');
    if(!handle||event.button!==0)return;
    const width=noteWidth,x=event.clientX;
    handle.setPointerCapture(event.pointerId);event.preventDefault();
    const move=e=>resizeNotes(width+x-e.clientX),end=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('lostpointercapture',end);};
    handle.addEventListener('pointermove',move);handle.addEventListener('lostpointercapture',end);
  });
  document.addEventListener('keydown',event=>{
    if(!event.target.matches('.reader-note-resizer')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();resizeNotes(event.key==='Home'?180:event.key==='End'?Number(event.target.getAttribute('aria-valuemax')):noteWidth+(event.key==='ArrowLeft'?16:-16));
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('.reader-source-fragment')||getSelection()?.toString().trim())return;
    const hit=webMarks.find(mark=>Array.from(mark.range.getClientRects()).some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom));
    if(!hit)return;
    if(hit.source==='note'){const note=readingNotes().find(n=>n.id===hit.id);if(note)showNote(note,hit.range.getBoundingClientRect());}
    else {const entry=entries.find(n=>n.id===hit.id),item=entry?.payload.items[hit.index];if(item){selection={...item,page:entry.page};selectionAnchor=hit.range.getBoundingClientRect();showInlineAid({kind:'highlights',payload:{text:`AI 重点 · ${item.category}\n${item.reason}\n\n${item.quote}`}});}}
  });
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-action]');
    if (!target || !detail) return;
    const action=target.dataset.action;
    if (action==='reader-aid') {aidTab=aidTab===target.dataset.tab?'':target.dataset.tab;dismissSelection();renderAid();document.querySelector('.reader-top-popover:not([hidden]) input')?.focus({preventScroll:true});}
    if (action==='reader-close-aid') {const previous=aidTab;aidTab='';renderAid();document.querySelector(previous==='translation'?'[data-action=reader-translation-options]':`[data-action=reader-aid][data-tab=${previous}]`)?.focus({preventScroll:true});}
    if(action==='reader-translate-all')runParagraphTranslation();
    if(action==='reader-load-translations')loadEntries(readingKey);
    if(action==='reader-retry-translation'&&readerError?.key===readingKey)runParagraphTranslation(readerError.paragraph_ids,readerError.refresh);
    if(action==='reader-translate-paragraph')runParagraphTranslation(target.dataset.paragraphId,target.dataset.refresh==='true');
    if(action==='reader-toggle-paragraph'){translationView.paragraphs[target.dataset.paragraphId]=!translationVisible(target.dataset.paragraphId);saveTranslationView();paintTranslations();renderAid();}
    if(action==='reader-toggle-translations'){translationView={visible:!(detail.paper.reader_document?.paragraphs||[]).some(p=>paragraphEntry(p.id)&&translationVisible(p.id)),paragraphs:{}};saveTranslationView();paintTranslations();renderAid();}
    if(action==='reader-translation-options'){aidTab=aidTab==='translation'?'':'translation';dismissSelection();renderAid();}
    if(action==='reader-legacy-entry'){activeAid=target.dataset.id;renderAid();}
    if (action==='reader-zoom') setReaderZoom(Number(target.dataset.step) ? readerZoom+Number(target.dataset.step) : 1);
    if (action==='reader-page') {goReaderPage(Number(target.dataset.page));if(readerMode==='responsive'&&target.dataset.paragraphId)document.getElementById(target.dataset.paragraphId)?.scrollIntoView({block:'start'});}
    if (action==='reader-source-page') {readerMode='original';goReaderPage(Number(target.dataset.page));}
    if (action==='reader-search-hit') {aidTab='';goReaderPage(Number(target.dataset.page),{page:Number(target.dataset.page),start:Number(target.dataset.start),end:Number(target.dataset.end),quote:target.dataset.quote});}
    if (action==='reader-destination') gotoPdfDestination(JSON.parse(target.dataset.dest));
    if (action==='reader-generate') runAid(target.dataset.kind,target.dataset.all==='true',false,target.dataset.refresh==='true');
    if (action==='reader-regenerate-highlights') regenerateHighlights();
    if (action==='reader-retry') runAid(inlineKind,false,true,true);
    if (action==='reader-copy') {const entry=entries.find(x=>x.id===target.dataset.id);if(entry)navigator.clipboard.writeText(entry.payload.text).then(()=>toast('已复制')).catch(()=>toast('无法复制，请选中译文复制'));}
    if (action==='reader-text-size') {translationSize=Math.max(13,Math.min(22,translationSize+Number(target.dataset.step)));renderAid();}
    if (action==='reader-stop' && aidRun) {aidRun.stop=true;target.textContent='当前部分保存后暂停';target.disabled=true;}
    if (action==='reader-toggle-highlights') {showHighlights=!showHighlights;(globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-highlights:${readingKey}`,String(showHighlights));paintOverlays();if(showHighlights)runAid('highlights',true);}
    if (action==='reader-dismiss') dismissSelection(true);
    if (action==='reader-explain') runAid(selection?.quote?'explanation':'figure');
    if (action==='reader-translate' && selection?.quote) runAid('translation',false,true);
    if (action==='reader-region') {const layer=document.querySelector('.reader-region');if(layer){layer.hidden=!layer.hidden;layer.innerHTML='';target.setAttribute('aria-pressed',String(!layer.hidden));if(!layer.hidden)toast('在原页拖动框选图表或公式');}}
    if (action==='reader-figure') {selectionAnchor=target.getBoundingClientRect();selection={page:detail.page,quote:'',rects:[JSON.parse(target.dataset.rect)]};runAid('figure');}
    if (action==='reader-new-note' && selection) {
      const entry={id:'note_'+crypto.randomUUID(),project_id:current.id,version_id:detail.paper.version_id,kind:'note',page:selection.page,revision:0,payload:{...selection,comment:'',color:'yellow'}};
      delete entry.payload.page; writeDraft(entry);showNote(entry);document.getElementById('reader-note-comment')?.focus({preventScroll:true});saveNote(entry.id);
    }
    if(action==='reader-shared-comment') {
      const source=selection?{version_id:detail.paper.version_id,anchor:{...selection,kind:'paper'}}:null;
      dismissSelection();aidTab='';renderAid();
      window.MethodAtlasComments?.openPaper(source).catch(error=>toast(error.message));
    }
    if (action==='reader-entry') {
      const entry=[...readingNotes(),...entries].find(x=>x.id===target.dataset.id);
      if(entry){activeAid=entry.id;goReaderPage(entry.page,{...noteFragments(entry)[0],page:entry.page});selection={...entry.payload,page:entry.page};paintOverlays();if(entry.kind==='note')requestAnimationFrame(()=>{const mark=document.querySelector(`.reader-mark[data-id="${entry.id}"],.reader-web-note[data-id="${entry.id}"]`);showNote(entry,mark?.getBoundingClientRect()||document.querySelector('.reader-body').getBoundingClientRect());});}
    }
    if (action==='reader-note-mark') {const note=readingNotes().find(x=>x.id===target.dataset.id);if(note){selection={...note.payload,page:note.page};showNote(note,target.getBoundingClientRect());}}
    if (action==='reader-highlight') {
      const entry=entries.find(x=>x.id===target.dataset.id),item=entry?.payload.items[Number(target.dataset.index)];
      if(item){selection={...item,page:entry.page};selectionAnchor=target.getBoundingClientRect();showInlineAid({kind:'highlights',payload:{text:`AI 重点 · ${item.category}\n${item.reason}\n\n${item.quote}`}});}
    }
    if (action==='reader-save-note') saveNote(activeAid);
    if (action==='reader-delete-note' || action==='reader-restore-note') {
      const note=readingNotes(true).find(x=>x.id===(target.dataset.id || activeAid));
      if(note){writeDraft({...note,payload:{...note.payload,deleted:action==='reader-delete-note'}});saveNote(note.id);activeAid=null;dismissSelection();renderAid();paintOverlays();}
    }
    if(action==='reader-note-reload') {
      const id=activeAid,key=readingKey,draft=drafts()[id];
      api(`${readerApi()}?version_id=${encodeURIComponent(detail.paper.version_id)}`).then(result=>{
        if(!sameReader(key)||activeAid!==id)return;
        const saved=result.find(x=>x.id===id);if(!saved)return toast('保存版本不可用，本机草稿仍保留');
        (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-conflict:${key}:${id}`,JSON.stringify(draft));const all=drafts();delete all[id];(globalThis.MethodAtlasStorage?.local || localStorage).setItem(`reader-drafts:${key}`,JSON.stringify(all));
        putEntry(saved);showNote(saved);paintOverlays();
      }).catch(error=>toast(error.message));
    }
    if (action==='reader-followup') {const entry=entries.find(x=>x.id===target.dataset.id);if(!entry)captureSelection();followup(entry?{...entry.payload,page:entry.page}:selection);}
    if (action==='reader-note-followup') {const note=readingNotes().find(x=>x.id===activeAid);if(note)followup({...note.payload,page:note.page},[note]);}
    if (action==='reader-notes-followup') followup({page:detail.page,quote:'',rects:[]},readingNotes());
  });
  document.addEventListener('submit',event=>{
    if (event.target.id==='reader-page-form') {
      event.preventDefault();const raw=event.target.elements.page.value.trim(),page=Number(raw);
      if(!/^\d+$/.test(raw)||!Number.isInteger(page)||page<1||page>detail.paper.page_count) {
        readerPageError=`请输入 1–${detail.paper.page_count} 之间的整数页码。`;renderTopPopover();document.getElementById('reader-page-input')?.focus({preventScroll:true});
      } else goReaderPage(page);
    }
    if (event.target.id==='reader-search-form') {
      event.preventDefault(); readerSearch=event.target.elements.query.value.trim();
      document.getElementById('reader-search-results').innerHTML=readerSearch?searchResults():'';
      CSS.highlights?.delete('reader-search');paintSearch();
    }
  });

  async function importLinks(form) {
    const projectId = addProjectId, generation = viewGeneration;
    const links = form.elements.links.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = '正在获取论文…';
    const progress = document.getElementById('source-results');
    if (progress) progress.textContent = '正在查找并下载全文，通常需要几十秒；请稍候。';
    try {
      const result = await api(`/api/projects/${encodeURIComponent(projectId)}/sources/links`, {method:'POST',body:JSON.stringify({links})});
      await refreshImported(projectId,generation,result.items); renderResults(result.items,projectId,generation);
      toast(`${result.succeeded} 项导入成功${result.failed ? `，${result.failed} 项失败` : ''}。`);
    } catch (error) { renderResults([{result:'failed',input:'论文链接',error:error.message}],projectId,generation); toast(error.message); }
    finally { if (button.isConnected) { button.disabled = false; button.textContent = '导入链接'; } }
  }

  async function importText(form) {
    const projectId = addProjectId, generation = viewGeneration, button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api(`/api/projects/${encodeURIComponent(projectId)}/sources/text`, {method:'POST',body:JSON.stringify(data)});
      const items = [{input:data.title,result:'ok',paper_id:result.paper_id}];
      await refreshImported(projectId,generation,items); renderResults(items,projectId,generation);
      if (form.elements.title.value === data.title && form.elements.text.value === data.text) form.reset();
      toast('文字资料已保存。');
    } catch (error) { renderResults([{result:'failed',input:'复制文字',error:error.message}],projectId,generation); toast(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action === 'add-source') renderAddSources();
    if (action === 'close-add-source') target.closest('dialog').close();
    if (action === 'source-method') switchSourceMethod(target.dataset.method);
    if (action === 'choose-pdf') document.getElementById('pdf-files')?.click();
    if (action === 'reader-responsive') switchReaderMode('responsive');
    if (action === 'reader-original') switchReaderMode('original');
    if (action === 'ask-figure' && detail?.paper?.kind === 'pdf') {
      const paper=detail.paper;
      await window.MethodAtlasAI.open({id:uid(),kind:'paper',paper_id:paper.id,version_id:paper.version_id,page:detail.page,quote:'',rects:[],notes:[],title:`${paper.title} · 第 ${detail.page} 页`,text:'当前页原始图表'},'请实际读取所引用页面的原始图表，结合图注和附近正文解释主要信息，提供同版原图引用。');
    }
    if (action === 'reader-fullscreen') {
      toggleReaderFullscreen();
    }
    if (action === 'enlarge-source-image') {
      const dialog = document.createElement('dialog'); dialog.className = 'image-lightbox'; dialog.innerHTML = `<button class="icon" data-action="close-image" aria-label="关闭图片">×</button><img src="${esc(target.dataset.src)}" alt="${esc(target.dataset.alt)}">`; document.body.append(dialog); dialog.addEventListener('close',() => dialog.remove()); dialog.showModal();
    }
    if (action === 'close-image') target.closest('dialog')?.close();
    if (action === 'retry-source') {
      const projectId = current.id, generation = viewGeneration; target.disabled = true;
      try {
        const result = await api(`/api/projects/${projectId}/papers/${target.dataset.id}/retry`,{method:'POST',body:'{}'});
        if (generation !== viewGeneration || current?.id !== projectId) return;
        const latest = await api(`/api/projects/${projectId}`);
        if (generation !== viewGeneration || current?.id !== projectId) return;
        current = latest; renderSources(); toast(result.imported_as === 'pdf' ? '已取得并解析全文。' : '仍未取得公开全文，已刷新来源信息。');
      }
      catch (error) { toast(error.message); target.disabled = false; }
    }
    if (action === 'supplement-source') {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/pdf,.pdf'; input.onchange = () => uploadFiles(input.files,target.dataset.id); input.click();
    }
  });

  // Esc leaves full screen the same way the button does. A dialog owns Esc while it is open, so the
  // reading surface only takes the key when nothing else is on top of it.
  document.addEventListener('keydown', event => {
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&document.querySelector('.reader-shell')&&!document.querySelector('dialog[open]')) {
      event.preventDefault();aidTab='search';renderAid();document.getElementById('reader-search-input')?.focus({preventScroll:true});return;
    }
    if(event.key==='Escape'&&['outline','search'].includes(aidTab)) {
      event.preventDefault();const previous=aidTab;aidTab='';renderAid();document.querySelector(`[data-action=reader-aid][data-tab=${previous}]`)?.focus({preventScroll:true});return;
    }
    // Zoom keeps the browser's own shortcuts, scoped to the reader: Ctrl/Cmd with minus, plus and zero.
    if ((event.ctrlKey || event.metaKey) && !document.querySelector('dialog[open]') && document.querySelector('.reader-shell')) {
      const step = ['=','+'].includes(event.key) ? 0.1 : ['-','_'].includes(event.key) ? -0.1 : null;
      if (step !== null || event.key === '0') {
        event.preventDefault();
        setReaderZoom(event.key === '0' ? 1 : readerZoom + step);
        return;
      }
    }
    if (event.key !== 'Escape' || !inFullscreen() || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    toggleReaderFullscreen();
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'pdf-files') {
      const files = [...event.target.files];
      event.target.value = '';
      uploadFiles(files);
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'link-source-form') { event.preventDefault(); importLinks(event.target); }
    if (event.target.id === 'text-source-form') { event.preventDefault(); importText(event.target); }
  });

  window.MethodAtlasReader={locateComment:location=>{const focus=location.fragments?.[0] || location;goReaderPage(focus.page,focus);}};
  document.addEventListener('dragover', event => { const zone = event.target.closest('#pdf-drop'); if (zone) { event.preventDefault(); zone.classList.add('dragging'); } });
  document.addEventListener('dragleave', event => event.target.closest('#pdf-drop')?.classList.remove('dragging'));
  document.addEventListener('drop', event => { const zone = event.target.closest('#pdf-drop'); if (zone) { event.preventDefault(); zone.classList.remove('dragging'); uploadFiles(event.dataTransfer.files); } });
})();
