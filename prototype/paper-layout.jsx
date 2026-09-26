import React, {useEffect, useRef, useState} from 'react';

function request(url, body) {
  return window.MethodAtlasHttp.api(url, body ? {method:'POST', body:JSON.stringify(body)} : {});
}

function PdfPreview({url, onReady}) {
  const host = useRef(null), canvas = useRef(null);
  const [pdf, setPdf] = useState(null), [page, setPage] = useState(1), [zoom, setZoom] = useState(1), [width, setWidth] = useState(320);
  const [error, setError] = useState(''), [rendering, setRendering] = useState(true), [pageText, setPageText] = useState('');
  useEffect(() => {
    let disposed = false, task;
    setError(''); onReady(false);
    import('/vendor/pdfjs/pdf.min.mjs').then(lib => {
      if (disposed) return;
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      task = lib.getDocument({url});
      return task.promise;
    }).then(doc => {if (!disposed && doc) {setPdf(doc);setPage(1);}}).catch(e => {if(!disposed)setError('PDF 预览加载失败：'+e.message);});
    return () => {disposed=true; task?.destroy().catch(()=>{});};
  }, [url]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(160, entries[0].contentRect.width - 24)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf) return;
    let disposed = false, task;
    setRendering(true);setError('');setPageText('');onReady(false);
    (async () => {
      const sheet = await pdf.getPage(page);
      if (disposed) return;
      const natural = sheet.getViewport({scale:1});
      const viewport = sheet.getViewport({scale:width * zoom / natural.width});
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 3200 / viewport.width);
      // Each effect renders its own canvas; cancelled renders cannot paint the next page.
      const bitmap = document.createElement('canvas');
      bitmap.width = Math.floor(viewport.width * ratio); bitmap.height = Math.floor(viewport.height * ratio);
      task = sheet.render({canvasContext:bitmap.getContext('2d'), viewport, transform:[ratio,0,0,ratio,0,0]});
      await task.promise;
      const contents = await sheet.getTextContent();
      if (disposed) return;
      canvas.current.width=bitmap.width;canvas.current.height=bitmap.height;
      canvas.current.style.width=`${viewport.width}px`;canvas.current.style.height=`${viewport.height}px`;
      canvas.current.getContext('2d').drawImage(bitmap,0,0);
      setPageText(contents.items.map(t=>t.str).join(' '));setRendering(false);onReady(true);
    })().catch(e=>{if(!disposed){setRendering(false);setError('PDF 页面渲染失败：'+e.message);}});
    return () => {disposed=true;task?.cancel();};
  }, [pdf,page,width,zoom]);
  return <div className="paper-preview" ref={host}>
    <div className="paper-preview-tools" aria-label="PDF 翻页与缩放">
      <button type="button" disabled={!pdf||page<=1} onClick={()=>setPage(p=>p-1)} aria-label="上一页">‹</button>
      <span role="status">{pdf ? `${page} / ${pdf.numPages} 页` : '载入 PDF…'}</span>
      <button type="button" disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(p=>p+1)} aria-label="下一页">›</button>
      <label>缩放 <select value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={1}>适应宽度</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label>
    </div>
    <p className="paper-preview-status" role="status">{rendering&&!error?'正在显示页面…':''}</p>
    {error && <p role="status">{window.MethodAtlasHttp.errorMessage(error)}</p>}
    <div className="paper-preview-scroll" tabIndex={0} aria-label="PDF 页面，可横向滚动">
      <canvas ref={canvas} aria-label={`论文 PDF 第 ${page} 页`}/>
    </div>
    {pageText && <details className="paper-page-text"><summary>本页文字</summary><p>{pageText}</p></details>}
  </div>;
}

export function PaperLayout({base, version, dirty, blocked, prepare, preview, onPreview, onBusy, registerGenerate}) {
  const [layout,setLayout]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState(''), [ready,setReady]=useState(false);
  const current = useRef(version), alive = useRef(true), lock = useRef(false);
  current.current=version;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let cancelled=false;
    setLayout(null);setReady(false);setError('');
    request(`${base}/versions/${version}/layout`).then(result=>{if(!cancelled)setLayout(result);}).catch(e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[base,version]);
  const run = async action => {
    if(lock.current)return;
    lock.current=true;setBusy(true);onBusy(true);setError('');
    try {await action();} catch(e) {if(alive.current)setError(e.message);} finally {lock.current=false;if(alive.current){setBusy(false);onBusy(false);}}
  };
  const generate = () => run(async()=>{
    const target=await prepare();
    const result=await request(`${base}/layout`,{version_id:target});
    if(alive.current&&current.current===target){setLayout(result);onPreview(true);}
  });
  useEffect(()=>{registerGenerate?.(generate);return()=>registerGenerate?.(null);},[base,version,dirty,blocked]);
  const exportPdf = () => run(async()=>{
    const target=await prepare();
    if(target!==layout.version_id)throw Error('正文已修改，请重新生成排版后再导出');
    const result=await request(`${base}/layout/approve`,{version_id:target,sha256:layout.sha256});
    if(alive.current)setLayout(result);
    const response=await fetch(`${base}/versions/${target}/layout/pdf?download=1`);
    if(!response.ok)throw Error((await response.json()).error);
    const url=URL.createObjectURL(await response.blob()), link=document.createElement('a');
    link.href=url;link.download=`论文排版-v${layout.version_no}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const stale=dirty||layout?.version_id!==version;
  return <section className="writing-layout" aria-label="AI 论文排版">
    <div className="paper-layout-actions paper-layout-top-actions">
      <button className="paper-layout-generate" type="button" disabled={busy||blocked} onClick={generate}>{busy?'正在处理…':'AI 一键排版'}</button>
      {layout && <div className="paper-layout-switch" aria-label="文稿视图">
        <button type="button" aria-pressed={!preview} onClick={()=>onPreview(false)}>编辑</button>
        <button type="button" aria-pressed={preview} onClick={()=>onPreview(true)}>PDF 预览</button>
      </div>}
    </div>
    <p className="paper-layout-status" role="status">{busy?'正在处理论文排版，请稍候…':blocked?'请先处理待确认的正文修改。':stale&&layout?'正文已修改，请重新排版。':layout?`${layout.template==='charged-ieee'?'IEEE 双栏':'学术论文单栏'} · ${layout.pages} 页 · v${layout.version_no}`:'根据论文内容自动排版，预览后确认导出。'}</p>
    {error && <p className="paper-layout-error" role="status">{window.MethodAtlasHttp.errorMessage(error)}</p>}
    {preview && layout && <>
      <p className="paper-layout-reason">{layout.reason}</p>
      <PdfPreview key={`${layout.version_id}:${layout.sha256}`} url={`${base}/versions/${layout.version_id}/layout/pdf`} onReady={setReady}/>
      <button className="paper-layout-export" type="button" disabled={busy||blocked||stale||!ready} onClick={exportPdf}>{layout.approved?'导出 PDF':'确认排版并导出 PDF'}</button>
    </>}
    {preview&&!layout&&<button type="button" onClick={()=>onPreview(false)}>返回编辑</button>}
  </section>;
}
