import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clone, nodeText, makeEditor, Editor, proposalEditor, resolveProposal, normalizedDocument, selectionSnapshot, citationNumbers } from './writing-editor.jsx';
import './writing.css';
import { PaperLayout } from './paper-layout.jsx';

const id = () => crypto.randomUUID();
const paragraph = (value = '') => ({id: id(), type:'p', children:[{text:value}]});

// 「/」命令菜单的图标：Lucide 24 网格线性图标（fill:none、stroke 2、跟随 currentColor）。
// 与工具栏那套手写 14px 图标分开维护——这套只服务命令菜单。
const commandIcons = {
  p: <><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></>,
  h1: <><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="m17 12 3-2v8"/></>,
  h2: <><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"/></>,
  h3: <><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2"/><path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"/></>,
  ul: <><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></>,
  ol: <><path d="M11 5h10"/><path d="M11 12h10"/><path d="M11 19h10"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/></>,
  task: <><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><rect x="3" y="4" width="6" height="6" rx="1"/></>,
  quote: <><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/></>,
  divider: <path d="M5 12h14"/>,
  table: <><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></>,
  img: <><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/></>,
  equation: <path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>,
};
const CommandIcon = ({type}) => <svg className="writing-command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{commandIcons[type]}</svg>;
function api(path, body) {
  return window.MethodAtlasHttp.api(path, body ? {method:'POST', body:JSON.stringify(body)} : {});
}
let mounted = null, active = null;

// An inserted citation is local draft content; this animation never implies a server save.
function animateInsertedCitation(origin, target) {
  if (!target || window.MethodAtlasSettings?.reducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  target.scrollIntoView({block:'nearest',inline:'nearest'});
  const end = target.getBoundingClientRect();
  if (!origin.width || !end.width) return;
  document.querySelector('.citation-flight')?.remove();
  const x = origin.right, y = origin.top + origin.height/2;
  const tx = end.left + end.width/2, ty = end.top + end.height/2;
  const curve = `M ${x} ${y} C ${x+(tx-x)*.45} ${y-70}, ${tx-(tx-x)*.25} ${ty-70}, ${tx} ${ty}`;
  const layer = document.createElement('div');
  layer.className = 'citation-flight';
  layer.setAttribute('aria-hidden','true');
  Object.assign(layer.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'1000'});
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width','100%'); svg.setAttribute('height','100%');
  const path = document.createElementNS(svg.namespaceURI,'path');
  for (const [key,value] of Object.entries({d:curve,fill:'none',stroke:'#76a6ed','stroke-width':'1.5',pathLength:'1','stroke-dasharray':'1','stroke-dashoffset':'1'})) path.setAttribute(key,value);
  svg.append(path); layer.append(svg);
  const bead = document.createElement('span');
  Object.assign(bead.style,{position:'absolute',left:'0',top:'0',width:'8px',height:'8px',borderRadius:'50%',background:'#246bdb',boxShadow:'0 0 0 5px #246bdb20',offsetPath:`path('${curve}')`});
  layer.append(bead); document.body.append(layer);
  path.animate([{strokeDashoffset:1},{strokeDashoffset:0}],{duration:620,fill:'forwards',easing:'ease-out'});
  const flight = bead.animate([{offsetDistance:'0%',opacity:0},{opacity:1,offset:.12},{offsetDistance:'100%',opacity:1}],{duration:680,fill:'forwards',easing:'cubic-bezier(.4,0,.2,1)'});
  flight.finished.then(()=>{
    if (target.isConnected) target.animate([{background:'#bcd5ff',boxShadow:'0 0 0 7px #246bdb20'},{background:'transparent',boxShadow:'0 0 0 0 transparent'}],{duration:420});
    layer.remove();
  },()=>layer.remove());
}


function Proposal({ proposal, citations, base, refresh, flush, error, retry, onCitation, onDeciding, deciding, decisionLock }) {
  const editor = useMemo(() => proposal.after_nodes ? proposalEditor(proposal.before_nodes, proposal.after_nodes) : null, [proposal.id, proposal.after_nodes]);
  const [busy, setBusy] = useState(false), [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (!exiting) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => setExiting(false);
    const timer = setTimeout(finish, reduced.matches ? 0 : 120);
    reduced.addEventListener('change', finish, {once:true});
    return () => { clearTimeout(timer); reduced.removeEventListener('change', finish); };
  }, [exiting]);
  const decide = async accept => {
    if (decisionLock.current) return;
    decisionLock.current = true;
    setBusy(true);
    onDeciding(true);
    try {
      await flush();
      // Check upstream transforms against the stored review, then ask the server
      // to decide. Never send editor suggestion metadata as manuscript content.
      const resolved = resolveProposal(proposalEditor(proposal.before_nodes, proposal.after_nodes), accept);
      if (normalizedDocument(resolved) !== normalizedDocument(accept ? proposal.after_nodes : proposal.before_nodes)) throw Error('差异转换与提案不一致，正文保持不变；请重新处理');
      const item = await api(`${base}/proposals/${proposal.id}/${accept ? 'accept' : 'reject'}`, {});
      // Save the real result immediately; only the obsolete proposal fades out.
      if (accept && !matchMedia('(prefers-reduced-motion: reduce)').matches) setExiting(true);
      error('');
      refresh(item);
    } catch (e) { error(e.message); }
    finally { decisionLock.current = false; setBusy(false); onDeciding(false); }
  };
  if (proposal.status === 'accepted' && !exiting) return null;
  return <section className="writing-proposal" data-state={exiting ? 'exiting' : proposal.status} inert={exiting} aria-hidden={exiting || undefined} aria-label="AI 修改提案">
    {proposal.status === 'generating' && <strong className="writing-generating" role="status">正在生成修改</strong>}
    {proposal.error && <p role="status">{proposal.explanation || window.MethodAtlasHttp.errorMessage(proposal.error)}</p>}
    {(proposal.status === 'pending' || exiting) && <>
      <Editor editor={editor} citations={citations} readOnly onCitation={onCitation}/>
      <div className="writing-actions"><button disabled={busy||deciding} onClick={() => decide(true)}>接受</button><button disabled={busy||deciding} onClick={() => decide(false)}>撤销</button></div>
    </>}
    {proposal.status === 'rejected' && <button onClick={()=>retry(proposal.request)}>基于新正文重新处理</button>}
  </section>;
}

function Writing({ project, artifact, selectedVersion, context, onSaved, onCitation, onAddFragment, onOpenLatest }) {
  const base = `/api/projects/${project}/documents/${artifact}`, draftKey = `writing-draft:${project}:${artifact}`;
  const [item, setItem] = useState(null), [error, setError] = useState(''), [status, setStatus] = useState('正在读取…');
  const [instruction, setInstruction] = useState(''), [mode, setMode] = useState('polish'), [onlySelected, setOnlySelected] = useState(false), [chatTarget, setChatTarget] = useState(false);
  const [busy, setBusy] = useState(false), [title, setTitle] = useState(''), [value, setValue] = useState([]), [epoch, setEpoch] = useState(0);
  const [deciding, setDeciding] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState('');
  const [papers,setPapers] = useState(()=>context().papers || []), [addedReferences,setAddedReferences] = useState([]), [inserting,setInserting] = useState(false);
  useEffect(()=>{const update=()=>setPapers([...(context().papers || [])]);window.addEventListener('methodatlas-papers-changed',update);return ()=>window.removeEventListener('methodatlas-papers-changed',update);},[context]);
  const [layoutBusy, setLayoutBusy] = useState(false), [layoutPreview, setLayoutPreview] = useState(false);
  const [exportStatus, setExportStatus] = useState(''), exporting = useRef(false);
  const [picked, setPicked] = useState(null), [editing, setEditing] = useState(null);
  const [commentMode, setCommentMode] = useState(false);
  useEffect(() => {
    const update = () => setCommentMode(!!window.MethodAtlasComments?.active(project, artifact));
    update(); window.addEventListener('methodatlas-comment-mode', update);
    return () => window.removeEventListener('methodatlas-comment-mode', update);
  }, [project, artifact]);
  const surface = useRef(null), editInput = useRef(null);
  const layoutGenerate = useRef(null);
  const pickedRef = useRef(null);
  const commandTrigger = useRef(null);
  const decisionLock = useRef(false), generating = useRef(false);
  const working = useRef(null), editorRef = useRef(null), saving = useRef(null), selection = useRef(null), alive = useRef(true);
  const latest = item?.draft || item?.versions.at(-1), viewed = item && (item.viewed_snapshot || item.versions.find(v => v.id === selectedVersion) || latest);
  const historical = !!selectedVersion;
  const references = [...(viewed?.citations || [])];
  if (!historical) {
    for (const paper of papers) if (paper.current_version_id && !references.some(c=>c.paper_id===paper.id)) references.push(addedReferences.find(c=>c.paper_id===paper.id&&c.paper_version_id===paper.current_version_id)||{id:'paper:'+paper.id,paper_id:paper.id,paper_version_id:paper.current_version_id,title:paper.title,pending:true});
    for (const citation of addedReferences) if (!references.some(c=>c.id===citation.id)) references.push(citation);
  }
  const referenceNumbers = citationNumbers(references);
  const [editor, setEditor] = useState(null);
  const [citationOpen,setCitationOpen] = useState(false), [referenceQuery,setReferenceQuery] = useState('');
  const citationClose = useRef(null), citationTrigger = useRef(null), citationSelection = useRef(null);
  const openCitations = () => {
    clearTimeout(citationClose.current);
    if (!citationOpen) {
      const native=window.getSelection(), activeEditor=editorRef.current;
      const range=surface.current?.contains(native?.anchorNode) ? activeEditor?.api.toSlateRange(native,{exactMatch:false,suppressThrow:true}) : null;
      if (range) activeEditor.tf.select(range);
      citationSelection.current=clone(range || activeEditor?.selection || selection.current);
    }
    setCitationOpen(true);
  };
  useEffect(()=>()=>clearTimeout(citationClose.current),[]);
  const positionKey = `writing-position:${project}:${artifact}`;
  const rememberPosition = () => {
    try { (globalThis.MethodAtlasStorage?.local || localStorage).setItem(positionKey,JSON.stringify({scroll:document.getElementById('output-body')?.scrollTop || 0,selection:selection.current})); } catch {}
  };

  useEffect(() => {
    if (!editor) return;
    const host = document.getElementById('output-body');
    let saved;
    try { saved = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(positionKey) || 'null'); } catch {}
    if (saved) {
      host.scrollTop = saved.scroll || 0;
      const validPoint = point => {
        if (!Array.isArray(point?.path) || !point.path.length) return false;
        let node = editor;
        for (const index of point.path) { if (!Number.isInteger(index) || index < 0) return false; node = node?.children?.[index]; }
        return typeof node?.text === 'string' && Number.isInteger(point.offset) && point.offset >= 0 && point.offset <= node.text.length;
      };
      if (validPoint(saved.selection?.anchor) && validPoint(saved.selection?.focus)) {
        try { editor.tf.select(saved.selection); selection.current = saved.selection; } catch {}
      }
    }
    const remember = rememberPosition;
    host.addEventListener('scroll', remember, {passive:true});
    return () => { remember(); host.removeEventListener('scroll',remember); };
  }, [editor, positionKey]);

  function install(loaded, preserveDraft = true) {
    setRemoteVersion('');
    if (!alive.current) return;
    setItem(loaded);
    const last = loaded.draft || loaded.versions.at(-1), version = loaded.viewed_snapshot || loaded.versions.find(v => v.id === selectedVersion) || last;
    let draft = null;
    try { draft = preserveDraft ? JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(draftKey)) : null; } catch { setError('本地草稿损坏；请先备份浏览器草稿'); }
    if (!historical && draft && draft.base_version_id !== last.id) setError('服务器已有新版，本地未保存内容已保留。请复制需要的内容后回读服务器草稿并合并。');
    const restored = draft && !historical ? draft : {base_version_id:last.id,title:version.title,document:version.payload.document,request_id:id()};
    working.current = clone(restored);
    const next = makeEditor(restored.document);
    editorRef.current = next; setEditor(next); setValue(restored.document); setTitle(restored.title); setEpoch(e => e + 1);
    setStatus(draft && !historical ? '已恢复浏览器中未保存的内容' : historical ? `历史存档 · v${version.version_no}` : '已自动保存草稿');
    if (!historical) onSaved(loaded);
  }

  async function flush() {
    if (saving.current) { await saving.current; return flush(); }
    const draft = working.current;
    if (!draft || !draft.dirty || historical) return;
    const snapshot = clone(draft); delete snapshot.dirty;
    const promise = (async () => {
      try {
        setStatus('正在保存…');
        const result = await api(`${base}/draft`, snapshot);
        const changedDuringSave = working.current.request_id !== snapshot.request_id;
        working.current.base_version_id = result.version_id;
        working.current.dirty = changedDuringSave;
        if (changedDuringSave) (globalThis.MethodAtlasStorage?.local || localStorage).setItem(draftKey, JSON.stringify(working.current));
        else (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(draftKey);
        const loaded = await api(base);
        if (alive.current) { setItem(loaded); setStatus('已自动保存草稿'); setError(''); onSaved(loaded); }
      } catch (e) { if (alive.current) { setError(e.message); setStatus('未保存：内容已保留在此浏览器'); } throw e; }
    })();
    saving.current = promise;
    try { await promise; }
    finally { if (saving.current === promise) saving.current = null; }
    if (working.current.dirty) return flush();
  }

  async function archive(name = '') {
    if (decisionLock.current || historical) return;
    decisionLock.current = true; setDeciding(true);
    try {
      await flush();
      const result = await api(`${base}/archive`, {request_id:id(), base_version_id:working.current.base_version_id, name});
      working.current.base_version_id = result.version_id;
      const loaded = await api(base);
      if (alive.current) { setItem(loaded); onSaved(loaded); setError(''); setStatus(result.unchanged ? '内容未变化，无需重复存档' : `已存档 · v${result.version_no}`); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { decisionLock.current = false; if (alive.current) setDeciding(false); }
  }

  function changed(document, nextTitle = title) {
    if (historical) return;
    // Stable top-level identities are the server's conflict boundary.
    const ids = new Set();
    document.forEach((node, index) => { if (!node.id || ids.has(node.id)) editorRef.current.tf.setNodes({id:id()}, {at:[index]}); ids.add(node.id); });
    const cleaned = clone(editorRef.current.children);
    working.current = {...working.current, title:nextTitle, document:cleaned, request_id:id(), dirty:true};
    try { (globalThis.MethodAtlasStorage?.local || localStorage).setItem(draftKey, JSON.stringify(working.current)); }
    catch { setError('浏览器草稿空间不足；请立即保存或下载未保存内容'); }
    setValue(cleaned); setStatus('待保存…');
  }

  function captureSelection() {
    if (editing) return;
    const native = window.getSelection(), host = surface.current;
    if (!native?.rangeCount || native.isCollapsed || !host?.querySelector('.writing-content')?.contains(native.anchorNode) || !host.querySelector('.writing-content')?.contains(native.focusNode)) {
      if (!document.activeElement?.closest('.writing-selection-menu')) {setPicked(null); pickedRef.current=null;}
      return;
    }
    let range=editorRef.current.api.toSlateRange(window.getSelection(),{exactMatch:false,suppressThrow:true});
    const domRange=native.getRangeAt(0), element=node=>node?.nodeType===1?node:node?.parentElement;
    const equation=element(native.anchorNode)?.closest('.writing-equation');
    if(equation && equation.contains(native.focusNode)){
      const block=equation.closest('[data-block-id]'), index=editorRef.current.children.findIndex(n=>n.id===block?.dataset.blockId);
      const prefix=domRange.cloneRange();prefix.selectNodeContents(equation);prefix.setEnd(domRange.startContainer,domRange.startOffset);
      const offset=prefix.toString().length;
      range={anchor:{path:[index],offset},focus:{path:[index],offset:offset+domRange.toString().length}};
    }
    const snapshot = selectionSnapshot(editorRef.current.children, range);
    if (!snapshot) {setPicked(null); pickedRef.current=null;return;}
    const rect = native.getRangeAt(0).getBoundingClientRect(), box = host.getBoundingClientRect();
    const next = {...snapshot, top:rect.top-box.top, bottom:rect.bottom-box.top, document:JSON.stringify(editorRef.current.children)};
    pickedRef.current=next; setPicked(next);
  }
  useEffect(() => {
    let frame;
    // Let Slate finish its throttled DOM selection sync before rendering the menu.
    const update = () => {clearTimeout(frame);frame=setTimeout(captureSelection,120);};
    document.addEventListener('selectionchange',update);
    return () => {clearTimeout(frame);document.removeEventListener('selectionchange',update);};
  }, [editing, editor]);
  useEffect(()=>{if(editing)editInput.current?.focus({preventScroll:true});},[editing]);
  const closeSelection = () => {setEditing(null);setPicked(null);pickedRef.current=null;setInstruction('');editor.tf.focus();};
  async function addFragment() {
    const snapshot=pickedRef.current, conversationId=context().conversation;
    if(!snapshot)return;
    try {
      await flush();
      if(!alive.current || conversationId!==context().conversation) return;
      if(snapshot.document!==JSON.stringify(editorRef.current.children))throw Error('正文已改变，请重新选择文字');
      const version = historical ? viewed.id : working.current.base_version_id;
      await api(`${base}/snapshot`, {version_id:version});
      if(!alive.current || conversationId!==context().conversation) return;
      if(snapshot.document!==JSON.stringify(editorRef.current.children) || version!==(historical?viewed.id:working.current.base_version_id))throw Error('正文已改变，请重新选择文字');
      if(await onAddFragment({id:id(),artifact_id:artifact,version_id:version,title,selection:snapshot.selection,text:snapshot.text})===false)throw Error('暂时无法打开对话，选区已保留，请重试。');
      setPicked(null);pickedRef.current=null;
    }catch(e){setError(e.message);}
  }

  async function commentSource(snapshot = null) {
    if (!working.current || !viewed) throw Error('文档尚未加载，请稍后评论');
    await flush();
    if (!alive.current) throw Error('文档已切换，请重新选择文字');
    if (snapshot && snapshot.document !== JSON.stringify(editorRef.current.children)) throw Error('正文已改变，请重新选择文字');
    const version = historical ? viewed.id : working.current.base_version_id;
    await api(`${base}/snapshot`, {version_id:version});
    return {version_id:version, ...(snapshot ? {anchor:{kind:'document',selection:snapshot.selection,quote:snapshot.text}} : {})};
  }
  async function addComment() {
    const snapshot = pickedRef.current;
    if (!snapshot) return;
    try { const source=await commentSource(snapshot);window.MethodAtlasComments?.selected(project,artifact,source);setPicked(null);pickedRef.current=null; }
    catch(e) {setError(e.message);}
  }
  function locateComment(range, quote, sourceVersion) {
    const currentVersion = historical ? viewed?.id : working.current?.base_version_id;
    if (working.current?.dirty || currentVersion !== sourceVersion || selectionSnapshot(editor.children, range)?.text !== quote) {
      throw Error('正文已改变，请保存后刷新评论，或查看引用版本。');
    }
    editor.tf.select(range); editor.tf.focus();
    surface.current?.querySelector(`[data-block-id="${CSS.escape(editor.children[range.anchor.path[0]].id)}"]`)?.scrollIntoView({block:'center'});
  }

  async function propose(message = instruction, origin = 'right') {
    if (!message.trim() || generating.current || decisionLock.current || layoutBusy || historical) return false;
    generating.current = true;
    setBusy(true); setError('');
    try {
      await flush();
      if (editing && editing.document !== JSON.stringify(editorRef.current.children)) throw Error('正文已改变，请取消并重新选择文字');
      const range = editing?.selection || selection.current;
      const request = {request_id:id(), base_version_id:working.current.base_version_id, instruction:message, mode:editing ? 'edit' : mode, only_selected:onlySelected,
        selected_paper_ids:context().selected, conversation_id:context().conversation, chat_options:window.MethodAtlasSettings?.options(), origin,
        selection:range && JSON.stringify(range.anchor) !== JSON.stringify(range.focus) ? range : null};
      setStatus(request.selection ? 'AI 正在修改选中文字…' : 'AI 正在处理整篇文稿…');
      const loaded = await api(`${base}/propose`, request);
      const proposal=loaded.proposals.find(p=>p.id===request.request_id);
      if(proposal?.status==='failed'){if(alive.current){setItem(loaded);setError(proposal.explanation||proposal.error||'编辑失败，请重试');setStatus('编辑失败，原文保持不变');}return false;}
      if (alive.current) { setItem(loaded); setStatus('请审阅修改；接受后才会保存到正文');setEditing(null);setPicked(null);pickedRef.current=null;setInstruction('');requestAnimationFrame(()=>document.querySelector('.writing-proposal')?.scrollIntoView({block:'nearest'})); }
      return true;
    } catch (e) { if (alive.current) setError(e.message); }
    finally {
      generating.current = false;
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(()=>{ if (alive.current) editInput.current?.focus({preventScroll:true}); });
      }
    }
  }

  useEffect(() => { alive.current = true; api(base + (selectedVersion ? `?version_id=${encodeURIComponent(selectedVersion)}` : '')).then(loaded => install(loaded)).catch(e => setError(e.message)); return () => { alive.current = false; flush().catch(() => {}); }; }, [base]);
  useEffect(() => { active = {flush, commentSource, locateComment, remoteVersion:(p,a,v)=>{if(p===project&&a===artifact&&!historical&&working.current&&!saving.current)setRemoteVersion(v&&v!==working.current.base_version_id?v:'');}, submit: async text => {if(!chatTarget)return {handled:false};const submitted=!!await propose(text, 'chat');if(submitted)setChatTarget(false);return {handled:true,submitted};}}; return () => { active = null; }; });
  useEffect(() => {
    if (!working.current?.dirty || historical) return;
    const timer = setTimeout(() => flush().catch(() => {}), 1100);
    return () => clearTimeout(timer);
  }, [value, title, historical]);
  useEffect(() => {
    if (!item?.proposals.some(p => p.status === 'generating')) return;
    const handle = setTimeout(() => api(base).then(loaded => alive.current && setItem(loaded)).catch(e => setError(e.message)), 1500);
    return () => clearTimeout(handle);
  }, [item]);

  const insert = node => { if(decisionLock.current) {setError('正在提交确认；请在确认完成后再次插入');return;} const at=Math.min(editor.children.length,(editor.selection?.anchor.path?.[0] ?? editor.children.length-1)+1); editor.tf.insertNodes(node, {at:[Math.max(0,at)]}); editor.tf.focus(); };
  const block = type => type === 'table' ? {id:id(),type:'table',children:[0,1].map(()=>({type:'tr',children:[0,1].map(()=>({type:'td',children:[{type:'p',children:[{text:''}]}]}))}))} : type === 'task' ? {id:id(),type:'task',checked:false,children:[{text:''}]} : type === 'ul' || type === 'ol' ? {id:id(),type,children:[{type:'li',children:[{text:''}]}]} : type === 'divider' ? {id:id(),type:'divider',children:[{text:''}]} : {id:id(),type,children:[{text:''}]};
  const handleKeyDown = event => {
    if (historical || deciding || layoutBusy) return;
    if (event.key === '/' && editor.selection) { commandTrigger.current = {...editor.selection.anchor, path:[...editor.selection.anchor.path]}; setCommand({top:0,left:0}); }
    // 任务块上回车：续行只另起一个普通段落，不再自动带出新的待办方块；
    // 空任务上回车视为「退出任务」，把这一行转回普通段落，避免留下一排空方块。
    if (event.key === 'Enter' && editor.selection) {
      const path = editor.selection.anchor.path;
      if (path.length === 2 && editor.children[path[0]]?.type === 'task') {
        event.preventDefault();
        const index = path[0], task = editor.children[index];
        const text = task.children.map(node => node.text || '').join('');
        if (!text) {
          editor.tf.insertNodes({id: id(), type: 'p', children: task.children.length ? task.children : [{text: ''}]}, {at: [index]});
          editor.tf.removeNodes({at: [index + 1]});
          editor.tf.select({path: [index, 0], offset: 0});
        } else {
          editor.tf.insertNodes(block('p'), {at: [index + 1]});
          editor.tf.select({path: [index + 1, 0], offset: 0});
        }
      }
    }
  };
  const [command,setCommand] = useState(null);
  const imageInput = useRef(null);
  const insertImage = async event => {
    const file=event.target.files[0];
    event.target.value='';
    if (!file) return;
    const index=Math.min(editor.children.length,(editor.selection?.anchor.path?.[0] ?? editor.children.length-1)+1);
    try {
      if (!['image/png','image/jpeg'].includes(file.type)) throw Error('图片须为 PNG/JPEG');
      if (file.size>500000) throw Error('图片最大 500 KB');
      const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
      const signature=file.type==='image/png'?[137,80,78,71,13,10,26,10]:[255,216,255];
      if (!signature.every((byte,i)=>bytes[i]===byte)) throw Error('图片内容与 PNG/JPEG 类型不一致');
      const url=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(Error('图片读取失败，请重新选择'));
        reader.readAsDataURL(file);
      });
      const image=new Image(); image.src=url;
      try { await image.decode(); } catch { throw Error('图片无法解码，请选择有效的 PNG/JPEG'); }
      if (image.naturalWidth*image.naturalHeight>16000000) throw Error('图片像素过大');
      if (!alive.current || editorRef.current!==editor || decisionLock.current) return;
      editor.tf.insertNodes({id:id(),type:'img',url,alt:file.name,children:[{text:''}]},{at:[index]});
      editor.tf.focus(); setError('');
    } catch(error) { if(alive.current && editorRef.current===editor) setError(error.message); }
  };
  const editEquation = async element => {
    const index=element?.type==='equation'?editor.children.findIndex(n=>n.id===element.id):selectedBlock();
    if (index<0) return;
    const old=editor.children[index];
    const formula=await window.MethodAtlasTextInput('编辑公式','TeX 公式；PDF/DOCX 导出时排版',old?.type==='equation'?old.formula:'E=mc^2');
    if (!formula?.trim() || !alive.current || editorRef.current!==editor || decisionLock.current) return;
    if(old?.type==='equation') editor.tf.setNodes({formula},{at:[index]});
    else editor.tf.insertNodes({id:id(),type:'equation',formula,children:[{text:''}]},{at:[Math.min(index+1,editor.children.length)]});
    editor.tf.focus();
  };
  // 「/」只是唤起菜单的引子：选中一项后它得自己消失，菜单没被用上时点别处或按 Esc 也要关掉。
  const dropCommandTrigger = () => {
    const point = commandTrigger.current;
    commandTrigger.current = null;
    const active = editorRef.current;
    if (!point || !active) return;
    const entry = active.api.node(point);
    const leaf = entry?.[0], path = entry?.[1];
    // 只有那个位置确实还留着引子斜杠时才动，避免误删用户后来打的字。
    if (typeof leaf?.text !== 'string' || leaf.text[point.offset] !== '/') return;
    // 只删这一个字符：对文本节点用 setNodes({text}) 在 Plate 下不生效，范围删除才可靠。
    active.tf.delete({at: {anchor: {path, offset: point.offset}, focus: {path, offset: point.offset + 1}}});
    // 删字后光标原本的位置会越界，就近落回被删掉的那个点。
    active.tf.select({path, offset: point.offset});
  };
  const chooseCommand = type => { dropCommandTrigger(); applyCommand(type); setCommand(null); };
  // 菜单里的类型要作用在「光标所在的那一块」上（像 Notion 那样转换），不能永远另起一块——
  // 否则在段落里选「标题 1」，只会看到下面多出一个空标题，原来那行的字号没变。
  const applyCommand = type => {
    if (type === 'img') return imageInput.current?.click();
    if (type === 'equation') return editEquation();
    const index = editor.selection?.anchor.path?.[0] ?? editor.children.length - 1;
    const current = editor.children[index];
    if (!current) return insert(block(type));
    const plain = ['p','h1','h2','h3','quote'];
    if (!plain.includes(current.type)) return insert(block(type));
    if (plain.includes(type)) { editor.tf.setNodes({type}, {at:[index]}); editor.tf.focus(); return; }
    if (type === 'task') { editor.tf.setNodes({type:'task', checked:false}, {at:[index]}); editor.tf.focus(); return; }
    if (type === 'ul' || type === 'ol') {
      // setNodes 不接受 children（传了会被忽略，留下 ul 里没有 li 的坏结构），
      // 所以先把包好的新块插在原位、再删掉旧块，中间不存在空文档的瞬间。
      const children = current.children.length ? current.children : [{text:''}];
      editor.tf.insertNodes({id:id(), type, children:[{type:'li', children}]}, {at:[index]});
      editor.tf.removeNodes({at:[index + 1]});
      editor.tf.focus();
      return;
    }
    insert(block(type));
  };
  useEffect(() => {
    if (!command) return;
    const dismiss = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'mousedown' && event.target.closest?.('.writing-command-menu')) return;
      setCommand(null);
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('mousedown', dismiss, true);
    return () => { document.removeEventListener('keydown', dismiss, true); document.removeEventListener('mousedown', dismiss, true); };
  }, [command]);
  const selectedBlock = () => editor.selection?.anchor.path[0] ?? 0;
  const exportFile = async kind => {
    if(exporting.current)return;
    exporting.current=true;setExportStatus('正在导出…');
    try {
      await flush();
      const version = historical ? viewed.id : working.current.base_version_id;
      const response = await fetch(`${base}/versions/${version}/export?format=${kind}`);
      if (!response.ok) {const data=await response.json().catch(()=>null);throw Error(data?.explanation || data?.error || '导出失败，请稍后重新选择导出格式重试。');}
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = `${title}.${kind}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if(alive.current)setExportStatus('导出文件已准备好。');
    } catch(e) { if(alive.current)setExportStatus(window.MethodAtlasHttp.errorMessage(e.message)); }
    finally {exporting.current=false;}
  };
  const downloadDraft = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(working.current,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='未保存文稿.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
  if (!editor || !viewed) return <p role="status">{error || status}</p>;
  const pending = item.proposals.some(p => ['pending','generating'].includes(p.status));
  const saveState = status.startsWith('未保存') ? 'error' : /^(已|内容未变化|历史存档)/.test(status) ? 'saved' : 'pending';
  // The status line breathes only while this page is actually waiting on the model. A proposal that is
  // still generating on the server already shows its own breathing label, so a calm "已保存" never pulses.
  const aiWorking = busy;
  const outline = value.filter(n=>/^h[123]$/.test(n.type));
  const count = value.reduce((sum,node)=>sum+nodeText(node).length,0);
  return <div className="writing-workspace" data-preview={layoutPreview}>
    <header className="writing-head">
      <div className="writing-head-row">
        <input className="writing-title" aria-label="文档标题" value={title} disabled={historical||deciding||layoutBusy} placeholder="未命名文档" onChange={e => {setTitle(e.target.value); changed(editor.children,e.target.value);}}/>
        {!pending && status==='已自动保存草稿' && <span className="writing-status writing-saved-dot" title={status} role="status"><span className="sr-only">{status}</span></span> }
        <details className="writing-menu">
          <summary title="更多操作" aria-label="更多操作"><span aria-hidden="true">···</span></summary>
          <div className="writing-menu-panel">
            {!historical && <button type="button" disabled={deciding||layoutBusy} onClick={e=>{e.currentTarget.closest('details').open=false;archive();}}>存档</button>}
            <button type="button" disabled={deciding||layoutBusy||pending} onClick={()=>layoutGenerate.current?.()}>AI 一键排版</button>
            {!historical && <button type="button" disabled={deciding||layoutBusy} onClick={async e=>{e.currentTarget.closest('details').open=false;const name=await window.MethodAtlasTextInput('命名存档','存档名称（可选）');if(name!==null&&alive.current)archive(name);}}>命名存档…</button>}
            {['html','pdf','docx'].map(kind=><button type="button" key={kind} disabled={pending || exportStatus==='正在导出…'} onClick={()=>exportFile(kind)}>{kind==='pdf'?'导出基础 PDF':`导出 ${kind.toUpperCase()}`}</button>)}
          </div>
        </details>
      </div>
      {exportStatus && <p className="writing-export-status" role="status">{exportStatus}</p>}
      {!pending && status!=='已自动保存草稿' && <p className="writing-status" data-state={saveState} data-busy={aiWorking ? 'true' : 'false'} role="status">{status}</p>}
      {remoteVersion && <p className="writing-readonly" role="status">其他成员已更新文稿；当前内容和输入保持不变。<button type="button" onClick={()=>setError('服务器已有新版。请先下载或复制需要保留的本地内容，再回读正式版并合并。')}>处理新版</button></p>}
      {historical && <p className="writing-readonly" role="status"><span>{item.viewed_snapshot ? '正在查看引用快照，正文只读。' : `正在查看历史存档 v${viewed.version_no}，正文只读。`}</span><button type="button" onClick={()=>onOpenLatest?.()}>回到当前草稿</button></p>}
      <p className="writing-meta">{viewed.payload.author} · {new Date(viewed.created).toLocaleString()} · {viewed.payload.summary}</p>
    </header>
    <PaperLayout base={base} version={viewed.id} dirty={!!working.current?.dirty} blocked={pending||busy||deciding} prepare={async()=>{await flush();const version=historical?viewed.id:working.current.base_version_id;await api(`${base}/snapshot`,{version_id:version});return version;}} preview={layoutPreview} onPreview={setLayoutPreview} onBusy={setLayoutBusy} registerGenerate={fn=>{layoutGenerate.current=fn}}/>
    {error && <div className="writing-error" role="status"><p>{window.MethodAtlasHttp.errorMessage(error)}</p>{!item.proposals.some(p=>p.status==='failed' && (p.explanation||p.error)===error) && <div className="writing-actions"><button type="button" onClick={()=>flush().catch(()=>{})}>重试保存</button><button type="button" onClick={downloadDraft}>下载未保存内容</button><button type="button" onClick={async()=>{if(working.current?.dirty&&!window.confirm('当前存在未保存的修改。请先下载未保存内容；确定放弃这些修改并载入服务器新版？'))return;try{const loaded=await api(base);if(!alive.current)return;(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(draftKey);working.current.dirty=false;install(loaded,false);setError('');}catch(e){setError(e.message);}}}>回读正式版</button></div>}</div>}
    {outline.length > 0 && <nav className="writing-outline" aria-label="文档大纲">{outline.map(n=><button type="button" key={n.id} onClick={()=>document.querySelector(`[data-block-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({block:'center'})}>{nodeText(n)||'未命名标题'}</button>)}</nav>}
    
    <div className="writing-surface" ref={surface} onKeyUp={e=>{if(e.key==='Escape'&&!busy)closeSelection();}}>
      <Editor key={epoch} editor={editor} citations={references} readOnly={historical||deciding||layoutBusy||inserting} onKeyDown={handleKeyDown} onEditEquation={editEquation} onChange={nodes=>{changed(nodes);if(!editing){setPicked(null);pickedRef.current=null;}}} onCitation={onCitation} onSelection={range=>{if(range){selection.current=clone(range);rememberPosition();}}}/>
      {command && <div className="writing-command-menu" role="menu">{[['p','正文'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3'],['ul','无序列表'],['ol','有序列表'],['task','任务列表'],['quote','引用'],['divider','分割线'],['table','表格'],['img','图片'],['equation','公式']].map(([type,label])=><button key={type} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>chooseCommand(type)}><span><CommandIcon type={type}/></span><b>{label}</b></button>)}</div>}
      {picked && !editing && <div className="writing-selection-menu" aria-label="选中文字操作" style={{top:Math.max(-36,picked.top-38)}} onMouseDown={e=>e.preventDefault()}>
        <button type="button" onClick={addFragment}>添加到对话</button>
        {commentMode && <button type="button" onClick={addComment}>评论所选文字</button>}
        <button type="button" disabled={historical||busy||deciding||pending||!picked.editable} title={!picked.editable?'表格、公式和图片暂不支持选区编辑':historical?'历史版本只读':pending?'请先处理待确认修改':'编辑所选文字'} onClick={()=>{setEditing(picked);setInstruction('');setError('');}}>编辑</button>
        {!picked.editable && <span className="writing-selection-hint">表格、公式和图片仅支持添加到对话</span>}
      </div>}
      {editing && <form className="writing-inline-edit" style={{top:editing.bottom+6}} aria-label="编辑选中文字" aria-busy={busy} onSubmit={e=>{e.preventDefault();propose();}} onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();closeSelection();}}}>
        <input ref={editInput} aria-label="描述编辑内容" aria-describedby={error?'writing-edit-error':undefined} placeholder="描述编辑内容…" value={instruction} disabled={busy} onChange={e=>setInstruction(e.target.value)}/>
        <button type="button" disabled={busy} aria-label="取消编辑" onClick={closeSelection}>×</button>
        <button type="submit" disabled={busy||!instruction.trim()} aria-label="提交编辑">{busy?'…':'↑'}</button>
        {error && <p id="writing-edit-error" role="status">{window.MethodAtlasHttp.errorMessage(error)}</p>}
      </form>}
    </div>
    <div className="writing-dock">
    <div className="writing-citations" onPointerEnter={e=>{if(e.pointerType!=='touch')openCitations();}} onPointerLeave={e=>{if(e.pointerType!=='touch')citationClose.current=setTimeout(()=>setCitationOpen(false),220);}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setCitationOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setCitationOpen(false);citationTrigger.current?.focus();}}}>
      <button ref={citationTrigger} type="button" className="writing-citations-trigger" aria-expanded={citationOpen} aria-controls={`citation-picker-${artifact}`} onClick={()=>citationOpen?setCitationOpen(false):openCitations()} onKeyDown={e=>{if(e.key==='ArrowUp'){e.preventDefault();openCitations();}}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v16H4z M14 4h6v16h-6z M7 8h1 M17 8h1"/></svg>引用与参考文献<span>{references.length}</span></button>
      <div className="writing-citations-popup" id={`citation-picker-${artifact}`} hidden={!citationOpen} role="region" aria-label="选择引用">
      <div className="writing-citations-card"><input type="search" aria-label="搜索参考文献" placeholder="搜索参考文献…" value={referenceQuery} onChange={e=>setReferenceQuery(e.target.value)}/>
      <div className="writing-citations-list">{!references.length && <p className="muted">添加项目文献后可在这里插入引用。</p>}{references.filter(c=>c.title.toLocaleLowerCase().includes(referenceQuery.trim().toLocaleLowerCase())).map(citation=><p key={citation.id} className="writing-citation"><button type="button" className="writing-citation-title" title={citation.title} onClick={()=>citation.pending ? window.dispatchEvent(new CustomEvent('methodatlas-open-reference',{detail:citation})) : onCitation(citation.id)}>[{referenceNumbers[citation.id]}] {citation.title}</button>{!historical&&<button type="button" className="writing-cite-action" disabled={deciding||inserting||layoutBusy} onMouseDown={e=>e.preventDefault()} onClick={async e=>{if(decisionLock.current||inserting)return;const source=document.querySelector(`[data-source-id="${CSS.escape(citation.paper_id)}"]`);const rect=source?.getBoundingClientRect();const origin=rect?.width&&rect.top>=0&&rect.bottom<=innerHeight?rect:e.currentTarget.getBoundingClientRect();const savedSelection=clone(citationSelection.current || editor.selection || selection.current);setInserting(true);try{const resolved=citation.pending?await api(`${base}/reference`,{paper_id:citation.paper_id,paper_version_id:citation.paper_version_id}):citation;if(!alive.current||editorRef.current!==editor)return;if(citation.pending)setAddedReferences(refs=>[...refs.filter(c=>c.id!==resolved.id),resolved]);if(savedSelection)editor.tf.select(savedSelection);const nodeId=id();editor.tf.insertNodes({id:nodeId,type:'citation',citation_id:resolved.id,children:[{text:''}]},savedSelection?{at:savedSelection}:{});requestAnimationFrame(()=>animateInsertedCitation(origin,surface.current?.querySelector(`[data-citation-node="${nodeId}"]`)));}catch(error){setError(error.message);}finally{if(alive.current)setInserting(false);}}}>插入引用</button>}</p>)}{references.length>0&&!references.some(c=>c.title.toLocaleLowerCase().includes(referenceQuery.trim().toLocaleLowerCase()))&&<p className="muted">没有匹配的参考文献。</p>}</div></div></div></div>
    <span className="writing-count" aria-label="字数">{count} 字</span>
    <input ref={imageInput} type="file" accept="image/png,image/jpeg" onChange={insertImage} hidden/>

    </div>
    {historical && <button type="button" className="writing-restore" disabled={deciding} onClick={async()=>{if(decisionLock.current||!window.confirm('恢复将替换当前草稿，已有历史存档保持不变。确定恢复？'))return;decisionLock.current=true;setDeciding(true);try{await api(`${base}/restore`,{request_id:id(),version_id:viewed.id,base_version_id:latest.id});if(!alive.current)return;(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(draftKey);const loaded=await api(base);if(alive.current)onSaved(loaded,'draft');}catch(e){if(alive.current)setError(e.message);}finally{decisionLock.current=false;if(alive.current)setDeciding(false);}}}>恢复到当前草稿</button>}
    {item.proposals.slice().reverse().map(p=><Proposal key={p.id} proposal={p} citations={latest.citations} base={base} flush={flush} refresh={loaded=>install(loaded,false)} error={setError} onCitation={onCitation} onDeciding={setDeciding} deciding={deciding} decisionLock={decisionLock} retry={request=>{setInstruction(request.instruction);setMode(request.mode);selection.current=null;setStatus('已准备原指令；请重新选择文字或处理整文，再明确发送');}}/>)}
  </div>;
}

window.MethodAtlasWriting = {
  mount(host, options) { this.unmount(); const root=createRoot(host);mounted=root;root.render(<Writing {...options}/>); },
  unmount() { mounted?.unmount();mounted=null; },
  flush() { return active?.flush() || Promise.resolve(); },
  remoteVersion(project, artifact, version) { active?.remoteVersion(project, artifact, version); },
  commentSource() { if(!active)throw Error('文档尚未加载');return active.commentSource(); },
  locateComment(selection, quote, sourceVersion) { return active?.locateComment(selection, quote, sourceVersion); },
  submit(text) { return active?.submit(text) || Promise.resolve({handled:false}); },
  async create(project) { return api(`/api/projects/${project}/documents`,{request_id:id(),title:'未命名文档',document:[paragraph()]}); }
};
window.dispatchEvent(new Event('writing-ready'));
