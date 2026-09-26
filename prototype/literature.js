(() => {
  if (typeof renderSources !== 'function' || typeof renderDetail !== 'function') return;

  const baseRenderSources = renderSources;
  const baseShowPaper = showPaper;
  let addProjectId = null, addConversationId = null;
  const positionKey = (project,version) => `reader-position:${project}:${version}`;
  let readerMode = 'responsive', fullscreenPosition = null;
  // Zoom is a view setting, not a paper setting: one ratio follows the reader across papers and
  // sessions, and it drives both reading modes — a CSS zoom on the text, a higher raster scale on the
  // PDF, so zooming in sharpens the page instead of blowing up a bitmap.
  const ZOOM_MIN = 0.5, ZOOM_MAX = 3;
  const clampZoom = value => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((Number(value) || 1) * 100) / 100));
  let readerZoom = clampZoom(localStorage.getItem('reader-zoom') || 1);
  // Full screen lives on <body>, not on a panel: the reader is mounted in whichever column owns it
  // (the library reads in the middle one, the workbench docks it over the source column), and what has
  // to change is the whole window. Reading the class back keeps one source of truth, so no stale flag
  // can strand the shell in a reading surface with no way out.
  const inFullscreen = () => document.body.classList.contains('reader-fullscreen');
  let pdfjsPromise = null, pdfDocumentKey = null, pdfDocumentPromise = null, pdfRenderGeneration = 0;

  function warningText(paper) {
    const availability = paper.availability || {};
    const conversion = availability.conversion || {};
    if (availability.fulltext === 'pending') return '正在后台获取全文，链接和摘要已保存。';
    if (availability.error) return availability.error;
    if (conversion.fallback_pages?.length) return `第 ${conversion.fallback_pages.join('、')} 页无法可靠转换，已保留原页图像。`;
    if (availability.fulltext && !['downloaded','provided'].includes(availability.fulltext)) return '未取得可公开访问的完整 PDF；当前内容可能只有摘要或元数据。';
    if (availability.parse && !['parsed'].includes(availability.parse)) return '资料转换不完整，可以查看保留的原文或重试。';
    if (paper.status && paper.status.startsWith('unavailable:')) return `资料解析失败：${paper.status.slice('unavailable:'.length).trim() || '未知错误'}`;
    return '';
  }

  function externalSourceLink(paper) {
    const url = paper.metadata?.url || '';
    if (!/^https?:\/\//.test(url)) return '';
    const label = paper.metadata?.download_url ? '进入知网获取全文' : '打开来源网页';
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  function decorateWarnings() {
    document.querySelectorAll('#paper-list .paper-row').forEach((row, index) => {
      const paper = current?.papers[index], message = paper && warningText(paper);
      const slot = row.querySelector('.paper-warning-slot');
      if (paper?.availability?.fulltext === 'pending') row.querySelector('.paper-meta').textContent = '正在获取全文…';
      if (paper?.availability?.fulltext === 'downloaded') row.querySelector('.paper-meta').textContent = `PDF 已导入 · ${paper.page_count} 页`;
      if (['failed','unavailable'].includes(paper?.availability?.fulltext)) row.querySelector('.paper-meta').textContent = '全文未获取 · 已保留论文信息';
      if (!slot || !message) return;
      const downloading = paper.availability?.fulltext === 'pending';
      const canRetry = !downloading && (paper.metadata?.pdf_url || paper.metadata?.doi || paper.metadata?.discovery_sources?.length || ['doi','arxiv'].includes(paper.metadata?.source));
      const retry = canRetry ? `<button type="button" data-action="retry-source" data-id="${esc(paper.id)}">重新获取</button>` : '';
      const sourceUrl = /^https?:\/\//.test(paper.metadata?.url || '') ? `<a href="${esc(paper.metadata.url)}" target="_blank" rel="noopener noreferrer">打开来源网页</a>` : '';
      slot.innerHTML = `<details class="paper-warning"><summary aria-label="资料不完整：${esc(message)}" title="${esc(message)}">!</summary><div><p>${esc(message)}</p>${sourceUrl}${retry}<button type="button" data-action="supplement-source" data-id="${esc(paper.id)}">上传 PDF 补充</button></div></details>`;
    });
  }

  renderSources = function renderSourcesForImports() {
    baseRenderSources();
    decorateWarnings();
  };

  showPaper = function showPaperInReader(id, page = 1, version = null, focus = null, valid = () => true) {
    const savedVersion = version || current.papers.find(paper=>paper.id===id)?.current_version_id;
    const saved = (!focus || focus.readingPosition) && savedVersion ? JSON.parse(localStorage.getItem(positionKey(current.id,savedVersion)) || 'null') : null;
    readerMode = focus && !focus.readingPosition ? 'responsive' : saved?.mode || window.MethodAtlasSettings?.preferences().readerMode || 'responsive';
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
      .reader-toolbar .reader-expand{display:inline-flex;align-items:center;gap:0.4375rem;min-height:2rem;padding:0 0.75rem;border:1px solid var(--line-soft);border-radius:62.4375rem;background:var(--surface-2);color:var(--muted);font-size:0.8125rem;white-space:nowrap;box-shadow:none}
      .reader-toolbar .reader-expand:hover:not(:disabled){background:var(--hover);border-color:var(--line);color:var(--ink);transform:none;box-shadow:none}
      .reader-toolbar .reader-expand svg{width:0.875rem;height:0.875rem}
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
      body.reader-fullscreen .reader-exit{flex:none;display:inline-flex;align-items:center;gap:0.4375rem;height:2.125rem;padding:0 0.8125rem 0 0.6875rem;border:1px solid var(--line-soft);border-radius:62.4375rem;background:var(--surface-2);color:var(--muted);font-size:0.875rem;font-weight:500;white-space:nowrap;box-shadow:none}
      body.reader-fullscreen .reader-exit:hover:not(:disabled){background:var(--hover);border-color:var(--line);color:var(--ink);transform:none;box-shadow:none}
      body.reader-fullscreen .reader-exit svg{width:0.9375rem;height:0.9375rem}
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
          <form class="source-method" id="link-source-form" data-source-pane="links" hidden><h2>论文链接</h2><p>支持 PDF 直链、arXiv 论文页和单篇文章 DOI；不要输入期刊整期 DOI。每行一条，逐项处理。</p><label>链接<textarea name="links" required placeholder="https://arxiv.org/abs/…\nhttps://doi.org/10.…\nhttps://example.org/paper.pdf"></textarea></label><button type="submit" class="primary">导入链接</button></form>
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

  function renderBlock(block, paper, page, evidence = null) {
    const source = text => highlightedSource(text,page,block,evidence);
    const kind = block.kind || 'paragraph';
    if (kind === 'heading') { const level = Math.max(1, Math.min(3, Number(block.level) || 3)); return `<h${level}>${source(block.text)}</h${level}>`; }
    if (kind === 'list_item') return `<div class="responsive-list" style="white-space:pre-wrap">${source(block.text)}</div>`;
    if (kind === 'table') return `<div class="responsive-table-wrap"><table class="responsive-table"><tbody>${(block.rows || []).map((row,i) => `<tr>${row.map(cell => `<${i ? 'td' : 'th'}>${source(cell)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if (kind === 'image' || kind === 'formula' || kind === 'page_image') {
      const src = kind === 'page_image' ? `/api/projects/${current.id}/papers/${paper.id}/page?version_id=${paper.version_id}&page=${page.page}` : fragmentUrl(paper,page,block.rect);
      const alt = kind === 'formula' ? `原论文第 ${page.page} 页公式` : kind === 'image' ? `原论文第 ${page.page} 页图片` : `原论文第 ${page.page} 页图像回退`;
      const image = `<button class="image-button" data-action="enlarge-source-image" data-src="${esc(src)}" data-alt="${esc(alt)}"><img class="source-fragment" src="${esc(src)}" alt="${esc(alt)}"></button>`;
      return kind === 'formula' ? `<div class="formula-block">${image}<span class="sr-only">${esc(block.text || '')}</span></div>` : image;
    }
    return `<p class="responsive-paragraph">${source(block.text)}</p>`;
  }

  function renderResponsive(paper) {
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
    pdfDocumentPromise = loadPdfJs().then(pdfjs => pdfjs.getDocument({url}).promise);
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
      status.hidden = true;
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
    return `<div class="original-reader"><div class="pdfjs-page-host" id="pdfjs-page-host" data-pdf-url="${esc(pdfUrl)}"><p class="pdfjs-status" role="status">PDF.js 正在渲染第 ${page.page} 页…</p><div class="pdf-page pdfjs-canvas-page" hidden><canvas role="img" aria-label="${esc(paper.title)} 原始 PDF 第 ${page.page} 页，由 PDF.js 渲染"></canvas>${overlays}</div><div class="pdf-page pdfjs-fallback" hidden><img id="pdf-image" data-src="${fallbackUrl}" alt="${esc(paper.title)} 原始 PDF 第 ${page.page} 页兼容显示">${overlays}</div></div></div>`;
  }

  // The text scales in place (a re-render would drop the reading position); the PDF has to be
  // rasterised again, so it rebuilds and the scroll is carried over by ratio — the same spot in the
  // paper is a different number of pixels once the page is a different size.
  function setReaderZoom(value) {
    const next = clampZoom(value);
    if (Math.abs(next - readerZoom) < 0.001) return;
    readerZoom = next;
    localStorage.setItem('reader-zoom', String(readerZoom));
    const body = document.querySelector('.reader-body');
    const paper = body?.querySelector('.responsive-paper');
    if (paper) {
      const ratio = body.scrollHeight ? body.scrollTop / body.scrollHeight : 0;
      paper.style.zoom = readerZoom;
      body.scrollTop = ratio * body.scrollHeight;
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
    fullscreenPosition = position;
    installStyles();
    const renderGeneration = ++pdfRenderGeneration;
    const host = document.getElementById('paper-detail');
    if (!host) return;
    if (!detail) { releasePdfDocument(); host.innerHTML = ''; document.body.classList.remove('reader-fullscreen'); return; }
    const paper = detail.paper, hasPdf = paper.kind === 'pdf';
    if (!hasPdf) readerMode = 'responsive';
    const page = paper.pages.find(item => item.page === detail.page) || paper.pages[0];
    const fullscreen = inFullscreen();
    const showOriginal = fullscreen && readerMode === 'original' && hasPdf;
    const modeSwitch = fullscreen && hasPdf ? `<button type="button" data-action="reader-${readerMode === 'original' ? 'responsive' : 'original'}">${readerMode === 'original' ? '返回正文' : '原 PDF'}</button>` : '';
    const pageNav = showOriginal ? `<span class="reader-page-nav"><button data-action="pdf-prev" ${page.page <= 1 ? 'disabled' : ''}>上一页</button><span class="reader-page-count">第 ${page.page} / ${paper.page_count} 页</span><button data-action="pdf-next" ${page.page >= paper.page_count ? 'disabled' : ''}>下一页</button><button data-action="ask-figure">询问此页图表</button></span>` : '';
    const sourceLink = externalSourceLink(paper);
    // Reading full screen is one surface, so it is one bar: the head row stays behind and its title and
    // close control move into the bar. Leaving sits on the left, where the eye lands before the text.
    const closeButton = `<button class="icon" data-action="close-paper" aria-label="关闭阅读器">${icon('close')}</button>`;
    const head = fullscreen ? '' : `<div class="drawer-head row between"><strong>${esc(paper.title)}</strong>${closeButton}</div>`;
    const toolbar = fullscreen
      ? `<button type="button" class="reader-exit" data-action="reader-fullscreen" aria-label="退出全屏" title="退出全屏">${icon('compress')}<span>退出全屏</span></button><strong class="reader-title">${esc(paper.title)}</strong><div class="reader-toolbar-group reader-toolbar-actions">${modeSwitch}${pageNav}${sourceLink}</div>`
      : `${sourceLink}<span class="reader-toolbar-fill" aria-hidden="true"></span><button type="button" class="reader-expand" data-action="reader-fullscreen" aria-label="全屏查看论文" title="全屏查看论文">${icon('expand')}<span>放大查看</span></button>`;
    host.innerHTML = `<section class="paper-drawer reader-shell${position ? ' reader-switch' : ''}" aria-label="资料阅读器" data-version="${esc(paper.version_id)}">${head}<div class="reader-toolbar">${toolbar}</div><div class="reader-body" tabindex="-1">${showOriginal ? renderOriginal(paper) : renderResponsive(paper)}</div></section>`;
    const restorePosition = () => {
      if (renderGeneration !== pdfRenderGeneration || detail?.paper.version_id !== paper.version_id) return;
      const body=host.querySelector('.reader-body');
      if (position && body) {
        const anchor = body.querySelectorAll('.responsive-page > *, .pdf-page:not([hidden])')[position.index];
        const rect = anchor?.getBoundingClientRect();
        body.scrollTop = position.scroll === 0 ? 0 : rect
          ? body.scrollTop + rect.top + rect.height * position.fraction - body.getBoundingClientRect().top - 40
          : position.scroll;
        body.scrollLeft = position.left * body.scrollWidth / position.width;
        fullscreenPosition = null;
        host.querySelector('.reader-shell').classList.add('reader-switch-ready');
      } else if (detail.focus?.readingPosition && body) body.scrollTop=detail.focus.readingPosition.scroll;
      else if (!showOriginal) (host.querySelector('.reader-evidence') || document.getElementById(`reader-page-${detail.page}`))?.scrollIntoView({block:'start'});
    };
    if (showOriginal) requestAnimationFrame(() => mountPdfJs(paper,page,renderGeneration).then(restorePosition));
    else requestAnimationFrame(restorePosition);
    const reader=host.querySelector('.reader-body');
    localStorage.setItem(positionKey(current.id,paper.version_id),JSON.stringify({page:detail.page,scroll:detail.focus?.readingPosition?.scroll || 0,mode:readerMode}));
    reader.addEventListener('scroll',()=>{if(detail?.paper.version_id===paper.version_id)localStorage.setItem(positionKey(current.id,paper.version_id),JSON.stringify({page:detail.page,scroll:reader.scrollTop,mode:readerMode}));},{passive:true});
  };

  async function importLinks(form) {
    const projectId = addProjectId, generation = viewGeneration;
    const links = form.elements.links.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const button = form.querySelector('[type=submit]'); button.disabled = true;
    try {
      const result = await api(`/api/projects/${encodeURIComponent(projectId)}/sources/links`, {method:'POST',body:JSON.stringify({links})});
      await refreshImported(projectId,generation,result.items); renderResults(result.items,projectId,generation);
      toast(`${result.succeeded} 项导入成功${result.failed ? `，${result.failed} 项失败` : ''}。`);
    } catch (error) { renderResults([{result:'failed',input:'论文链接',error:error.message}],projectId,generation); toast(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }

  async function importText(form) {
    const projectId = addProjectId, generation = viewGeneration, button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api(`/api/projects/${encodeURIComponent(projectId)}/sources/text`, {method:'POST',body:JSON.stringify(data)});
      const items = [{input:data.title,result:'ok',paper_id:result.paper_id}];
      await refreshImported(projectId,generation,items); renderResults(items,projectId,generation); form.reset(); toast('文字资料已保存。');
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
    if (action === 'reader-responsive') { readerMode = 'responsive'; renderDetail(); }
    if (action === 'reader-original') { readerMode = 'original'; renderDetail(); }
    if (action === 'ask-figure' && detail?.paper?.kind === 'pdf') {
      const input = document.getElementById('chat-input');
      if (!input) return;
      const paper = detail.paper;
      input.value = `请实际读取「${paper.title}」（paper_id=${paper.id}，version_id=${paper.version_id}）第 ${detail.page} 页的原始图表，结合图注和附近正文解释图中主要信息。保留数据、单位、条件与图例对应；不清楚的内容不要猜，并提供同版原图引用。我想核对的问题是：${input.value}`;
      localStorage.setItem(`draft:${conversation.id}`, input.value);
      document.body.classList.remove('reader-fullscreen');
      renderDetail();
      revealPanel('chat-panel');
      input.focus();
      toast('已填入读图草稿，请补充问题后发送。图像解读仍需核对原图。');
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
    if (event.target.id === 'pdf-files') uploadFiles(event.target.files);
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'link-source-form') { event.preventDefault(); importLinks(event.target); }
    if (event.target.id === 'text-source-form') { event.preventDefault(); importText(event.target); }
  });

  document.addEventListener('dragover', event => { const zone = event.target.closest('#pdf-drop'); if (zone) { event.preventDefault(); zone.classList.add('dragging'); } });
  document.addEventListener('dragleave', event => event.target.closest('#pdf-drop')?.classList.remove('dragging'));
  document.addEventListener('drop', event => { const zone = event.target.closest('#pdf-drop'); if (zone) { event.preventDefault(); zone.classList.remove('dragging'); uploadFiles(event.dataTransfer.files); } });
})();
