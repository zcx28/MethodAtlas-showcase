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
  const [papers,setPapers] = useState(()=>context().papers || []), [addedReferences,setAddedReferences] = useState([]), [inserting,setInserting] = useState(false);
  useEffect(()=>{const update=()=>setPapers([...(context().papers || [])]);window.addEventListener('methodatlas-papers-changed',update);return ()=>window.removeEventListener('methodatlas-papers-changed',update);},[context]);
  const [layoutBusy, setLayoutBusy] = useState(false), [layoutPreview, setLayoutPreview] = useState(false);
  const [picked, setPicked] = useState(null), [editing, setEditing] = useState(null);
  const surface = useRef(null), editInput = useRef(null);
  const layoutGenerate = useRef(null);
  const pickedRef = useRef(null);
  const commandTrigger = useRef(null);
  const decisionLock = useRef(false), generating = useRef(false);
  const working = useRef(null), editorRef = useRef(null), saving = useRef(null), selection = useRef(null), alive = useRef(true);
  const latest = item?.versions.at(-1), viewed = item && (item.versions.find(v => v.id === selectedVersion) || latest);
  const historical = viewed && viewed.id !== latest.id;
  const references = [...(viewed?.citations || [])];
  if (!historical) {
    for (const paper of papers) if (paper.current_version_id && !references.some(c=>c.paper_id===paper.id)) references.push(addedReferences.find(c=>c.paper_id===paper.id&&c.paper_version_id===paper.current_version_id)||{id:'paper:'+paper.id,paper_id:paper.id,paper_version_id:paper.current_version_id,title:paper.title,pending:true});
    for (const citation of addedReferences) if (!references.some(c=>c.id===citation.id)) references.push(citation);
  }
  const referenceNumbers = citationNumbers(references);
  const [editor, setEditor] = useState(null);
  const positionKey = `writing-position:${project}:${artifact}`;
  const rememberPosition = () => {
    try { localStorage.setItem(positionKey,JSON.stringify({scroll:document.getElementById('output-body')?.scrollTop || 0,selection:selection.current})); } catch {}
  };

  useEffect(() => {
    if (!editor) return;
    const host = document.getElementById('output-body');
    let saved;
    try { saved = JSON.parse(localStorage.getItem(positionKey) || 'null'); } catch {}
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
    if (!alive.current) return;
    setItem(loaded);
    const last = loaded.versions.at(-1), version = loaded.versions.find(v => v.id === selectedVersion) || last;
    let draft = null;
    try { draft = preserveDraft ? JSON.parse(localStorage.getItem(draftKey)) : null; } catch { setError('本地草稿损坏；请先备份浏览器草稿'); }
    if (draft && draft.base_version_id !== last.id) setError('服务器已有新版，本地未保存内容已保留。请复制需要的内容后回读正式版并合并。');
    const restored = draft && version.id === last.id ? draft : {base_version_id:last.id,title:version.title,document:version.payload.document,request_id:id()};
    working.current = clone(restored);
    const next = makeEditor(restored.document);
    editorRef.current = next; setEditor(next); setValue(restored.document); setTitle(restored.title); setEpoch(e => e + 1);
    setStatus(draft ? '已恢复浏览器中未保存的内容' : `已保存 · v${version.version_no}`);
    if (!preserveDraft) onSaved(loaded);
  }

  async function flush() {
    if (saving.current) { await saving.current; return flush(); }
    const draft = working.current;
    if (!draft || !draft.dirty || historical) return;
    const snapshot = clone(draft); delete snapshot.dirty;
    const promise = (async () => {
      try {
        setStatus('正在保存…');
        const result = await api(`${base}/save`, snapshot);
        const changedDuringSave = working.current.request_id !== snapshot.request_id;
        working.current.base_version_id = result.version_id;
        working.current.dirty = changedDuringSave;
        if (changedDuringSave) localStorage.setItem(draftKey, JSON.stringify(working.current));
        else localStorage.removeItem(draftKey);
        const loaded = await api(base);
        if (alive.current) { setItem(loaded); setStatus(`已保存 · v${result.version_no}`); setError(''); onSaved(loaded); }
      } catch (e) { if (alive.current) { setError(e.message); setStatus('未保存：内容已保留在此浏览器'); } throw e; }
    })();
    saving.current = promise;
    try { await promise; }
    finally { if (saving.current === promise) saving.current = null; }
    if (working.current.dirty) return flush();
  }

  function changed(document, nextTitle = title) {
    if (historical) return;
    // Stable top-level identities are the server's conflict boundary.
    const ids = new Set();
    document.forEach((node, index) => { if (!node.id || ids.has(node.id)) editorRef.current.tf.setNodes({id:id()}, {at:[index]}); ids.add(node.id); });
    const cleaned = clone(editorRef.current.children);
    working.current = {...working.current, title:nextTitle, document:cleaned, request_id:id(), dirty:true};
    try { localStorage.setItem(draftKey, JSON.stringify(working.current)); }
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
      onAddFragment({id:id(),artifact_id:artifact,version_id:historical?viewed.id:working.current.base_version_id,title,selection:snapshot.selection,text:snapshot.text});
      setPicked(null);pickedRef.current=null;
    }catch(e){setError(e.message);}
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
      if(proposal?.status==='failed'){if(alive.current){setItem(loaded);setError(proposal.error||'编辑失败，请重试');setStatus('编辑失败，原文保持不变');}return false;}
      if (alive.current) { setItem(loaded); setStatus('请审阅修改；接受后才会保存到正文');setEditing(null);setPicked(null);pickedRef.current=null;setInstruction('');requestAnimationFrame(()=>document.querySelector('.writing-proposal')?.scrollIntoView({block:'nearest'})); }
      return true;
    } catch (e) { if (alive.current) setError(e.message); }
    finally { generating.current = false; if (alive.current) setBusy(false); }
  }

  useEffect(() => { alive.current = true; api(base).then(loaded => install(loaded)).catch(e => setError(e.message)); return () => { alive.current = false; flush().catch(() => {}); }; }, [base]);
  useEffect(() => { active = {flush, submit: async text => {if(!chatTarget)return {handled:false};const submitted=!!await propose(text, 'chat');if(submitted)setChatTarget(false);return {handled:true,submitted};}}; return () => { active = null; }; });
  useEffect(() => {
    if (!item?.proposals.some(p => p.status === 'generating')) return;
    const handle = setTimeout(() => api(base).then(loaded => alive.current && setItem(loaded)).catch(e => setError(e.message)), 1500);
    return () => clearTimeout(handle);
  }, [item]);

  const insert = node => { if(decisionLock.current) {setError('正在提交确认；请在确认完成后再次插入');return;} const at=Math.min(editor.children.length,(editor.selection?.anchor.path?.[0] ?? editor.children.length-1)+1); editor.tf.insertNodes(node, {at:[Math.max(0,at)]}); editor.tf.focus(); };
  const block = type => type === 'task' ? {id:id(),type:'task',checked:false,children:[{text:''}]} : type === 'ul' || type === 'ol' ? {id:id(),type,children:[{type:'li',children:[{text:''}]}]} : type === 'divider' ? {id:id(),type:'divider',children:[{text:''}]} : {id:id(),type,children:[{text:''}]};
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
    try {
      await flush();
      const version = historical ? viewed.id : working.current.base_version_id;
      const response = await fetch(`${base}/versions/${version}/export?format=${kind}`);
      if (!response.ok) throw Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = `${title}.${kind}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch(e) { setError(e.message); }
  };
  const downloadDraft = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(working.current,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='未保存文稿.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
  if (!editor || !viewed) return <p role="status">{error || status}</p>;
  const pending = item.proposals.some(p => ['pending','generating'].includes(p.status));
  const saveState = status.startsWith('未保存') ? 'error' : /^(已保存|已恢复)/.test(status) ? 'saved' : 'pending';
  // The status line breathes only while this page is actually waiting on the model. A proposal that is
  // still generating on the server already shows its own breathing label, so a calm "已保存" never pulses.
  const aiWorking = busy;
  const outline = value.filter(n=>/^h[123]$/.test(n.type));
  const count = value.reduce((sum,node)=>sum+nodeText(node).length,0);
  return <div className="writing-workspace" data-preview={layoutPreview}>
    <header className="writing-head">
      <div className="writing-head-row">
        <input className="writing-title" aria-label="文档标题" value={title} disabled={historical||deciding||layoutBusy} placeholder="未命名文档" onChange={e => {setTitle(e.target.value); changed(editor.children,e.target.value);}}/>
        <details className="writing-menu">
          <summary title="更多操作" aria-label="更多操作"><span aria-hidden="true">···</span></summary>
          <div className="writing-menu-panel">
            <button type="button" disabled={deciding||layoutBusy||pending} onClick={()=>layoutGenerate.current?.()}>AI 一键排版</button>
            <button type="button" disabled={deciding} onClick={()=>flush().catch(()=>{})}>立即保存</button>
            {['html','pdf','docx'].map(kind=><button type="button" key={kind} disabled={pending} onClick={()=>exportFile(kind)}>{kind==='pdf'?'导出基础 PDF':`导出 ${kind.toUpperCase()}`}</button>)}
          </div>
        </details>
      </div>
      {!pending && <p className="writing-status" data-state={saveState} data-busy={aiWorking ? 'true' : 'false'} role="status">{status}</p>}
      {historical && <p className="writing-readonly" role="status"><span>正在查看历史版本 v{viewed.version_no}，正文只读。</span><button type="button" onClick={()=>onOpenLatest?.()}>回到最新版 v{latest.version_no}</button></p>}
      <p className="writing-meta">{viewed.payload.author} · {new Date(viewed.created).toLocaleString()} · {viewed.payload.summary}</p>
    </header>
    <PaperLayout base={base} version={viewed.id} dirty={!!working.current?.dirty} blocked={pending||busy||deciding} prepare={async()=>{await flush();return historical?viewed.id:working.current.base_version_id;}} preview={layoutPreview} onPreview={setLayoutPreview} onBusy={setLayoutBusy} registerGenerate={fn=>{layoutGenerate.current=fn}}/>
    {error && <div className="writing-error" role="status"><p>{window.MethodAtlasHttp.errorMessage(error)}</p><div className="writing-actions"><button type="button" onClick={()=>flush().catch(()=>{})}>重试保存</button><button type="button" onClick={downloadDraft}>下载未保存内容</button><button type="button" onClick={async()=>{try{const loaded=await api(base);localStorage.removeItem(draftKey);working.current.dirty=false;install(loaded,false);setError('');}catch(e){setError(e.message);}}}>回读正式版</button></div></div>}
    {outline.length > 0 && <nav className="writing-outline" aria-label="文档大纲">{outline.map(n=><button type="button" key={n.id} onClick={()=>document.querySelector(`[data-block-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({block:'center'})}>{nodeText(n)||'未命名标题'}</button>)}</nav>}
    
    <div className="writing-surface" ref={surface} onKeyUp={e=>{if(e.key==='Escape'&&!busy)closeSelection();}}>
      <Editor key={epoch} editor={editor} citations={references} readOnly={historical||deciding||layoutBusy||inserting} onKeyDown={handleKeyDown} onChange={nodes=>{changed(nodes);if(!editing){setPicked(null);pickedRef.current=null;}}} onCitation={onCitation} onSelection={range=>{if(range){selection.current=clone(range);rememberPosition();}}}/>
      {command && <div className="writing-command-menu" role="menu">{[['p','正文'],['h1','标题 1'],['h2','标题 2'],['h3','标题 3'],['ul','无序列表'],['ol','有序列表'],['task','任务列表'],['quote','引用'],['divider','分割线'],['table','表格'],['img','图片'],['equation','公式']].map(([type,label])=><button key={type} type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>chooseCommand(type)}><span><CommandIcon type={type}/></span><b>{label}</b></button>)}</div>}
      {picked && !editing && <div className="writing-selection-menu" aria-label="选中文字操作" style={{top:Math.max(-36,picked.top-38)}} onMouseDown={e=>e.preventDefault()}>
        <button type="button" onClick={addFragment}>添加到对话</button>
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
    <details className="writing-citations" open><summary>引用与参考文献{references.length ? ` · ${references.length}` : ''}</summary><div className="writing-citations-list">{references.map(citation=><p key={citation.id} className="writing-citation"><button type="button" className="writing-citation-title" title={citation.title} onClick={()=>citation.pending ? window.dispatchEvent(new CustomEvent('methodatlas-open-reference',{detail:citation})) : onCitation(citation.id)}>[{referenceNumbers[citation.id]}] {citation.title}</button>{!historical&&<button type="button" className="writing-cite-action" disabled={deciding||inserting||layoutBusy} onMouseDown={e=>e.preventDefault()} onClick={async e=>{if(decisionLock.current||inserting)return;const source=document.querySelector(`[data-source-id="${CSS.escape(citation.paper_id)}"]`);const rect=source?.getBoundingClientRect();const origin=rect?.width&&rect.top>=0&&rect.bottom<=innerHeight?rect:e.currentTarget.getBoundingClientRect();const savedSelection=editor.selection?clone(editor.selection):null;setInserting(true);try{const resolved=citation.pending?await api(`${base}/reference`,{paper_id:citation.paper_id,paper_version_id:citation.paper_version_id}):citation;if(!alive.current||editorRef.current!==editor)return;if(citation.pending)setAddedReferences(refs=>[...refs.filter(c=>c.id!==resolved.id),resolved]);if(savedSelection)editor.tf.select(savedSelection);const nodeId=id();editor.tf.insertNodes({id:nodeId,type:'citation',citation_id:resolved.id,children:[{text:''}]});requestAnimationFrame(()=>animateInsertedCitation(origin,surface.current?.querySelector(`[data-citation-node="${nodeId}"]`)));}catch(error){setError(error.message);}finally{if(alive.current)setInserting(false);}}}>插入引用</button>}</p>)}</div></details>
    {!historical && <fieldset disabled={deciding||layoutBusy} className="writing-toolbar" aria-label="编辑工具栏">
      <select className="writing-style" aria-label="段落样式" defaultValue="p" onChange={e=>{const index=selectedBlock(); if (['p','h1','h2','h3'].includes(editor.children[index].type)) editor.tf.setNodes({type:e.target.value},{at:[index]});}}><option value="p">正文</option><option value="h1">标题 1</option><option value="h2">标题 2</option><option value="h3">标题 3</option></select>
      <span className="writing-sep" aria-hidden="true"/>
      <button type="button" className="writing-mark" title="加粗" aria-label="加粗" onMouseDown={e=>e.preventDefault()} onClick={()=>editor.tf.toggleMark('bold')}><strong>B</strong></button>
      <button type="button" className="writing-mark" title="斜体" aria-label="斜体" onMouseDown={e=>e.preventDefault()} onClick={()=>editor.tf.toggleMark('italic')}><em>I</em></button>
      <button type="button" className="writing-mark" title="下划线" aria-label="下划线" onMouseDown={e=>e.preventDefault()} onClick={()=>editor.tf.toggleMark('underline')}><u>U</u></button>
      <span className="writing-sep" aria-hidden="true"/>
      <button type="button" className="writing-tool" title="添加段落" aria-label="添加段落" onClick={()=>insert(paragraph())}><span className="writing-glyph" aria-hidden="true">¶</span></button>
      <button type="button" className="writing-tool" title="任务列表" aria-label="任务列表" onClick={()=>insert(block('task'))}>☑</button>
      <button type="button" className="writing-tool" title="项目列表" aria-label="项目列表" onClick={()=>insert({id:id(),type:'ul',children:[{type:'li',children:[{text:'列表项'}]}]})}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor"><circle cx="2.1" cy="3" r="1"/><circle cx="2.1" cy="7" r="1"/><circle cx="2.1" cy="11" r="1"/></g><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="5.3" y1="3" x2="12.2" y2="3"/><line x1="5.3" y1="7" x2="12.2" y2="7"/><line x1="5.3" y1="11" x2="12.2" y2="11"/></g></svg></button>
      <button type="button" className="writing-tool" title="编号列表" aria-label="编号列表" onClick={()=>insert({id:id(),type:'ol',children:[{type:'li',children:[{text:'列表项'}]}]})}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor" fontSize="5" fontFamily="inherit"><text x="0.6" y="4.7">1</text><text x="0.6" y="8.9">2</text><text x="0.6" y="13.1">3</text></g><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="5.3" y1="3" x2="12.2" y2="3"/><line x1="5.3" y1="7" x2="12.2" y2="7"/><line x1="5.3" y1="11" x2="12.2" y2="11"/></g></svg></button>
      <button type="button" className="writing-tool" title="插入表格" aria-label="插入表格" onClick={()=>insert({id:id(),type:'table',children:[0,1].map(()=>({type:'tr',children:[0,1].map(()=>({type:'td',children:[{type:'p',children:[{text:''}]}]}))}))})}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1.5" width="12" height="11" rx="1"/><line x1="1" y1="5.2" x2="13" y2="5.2"/><line x1="1" y1="8.9" x2="13" y2="8.9"/><line x1="5" y1="1.5" x2="5" y2="12.5"/><line x1="9" y1="1.5" x2="9" y2="12.5"/></g></svg></button>
      <button type="button" className="writing-tool" title="表格加行" aria-label="表格加行" onClick={()=>{const top=selectedBlock(), table=editor.children[top]; if(table.type==='table') editor.tf.insertNodes({type:'tr',children:table.children[0].children.map(()=>({type:'td',children:[{type:'p',children:[{text:''}]}]}))},{at:[top,table.children.length]});}}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="12" height="8.5" rx="1"/><line x1="1" y1="5.2" x2="13" y2="5.2"/><line x1="5" y1="1" x2="5" y2="9.5"/><line x1="9" y1="1" x2="9" y2="9.5"/></g><g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="10.6" y1="12" x2="13.4" y2="12"/><line x1="12" y1="10.6" x2="12" y2="13.4"/></g></svg></button>
      <button type="button" className="writing-tool" title="表格加列" aria-label="表格加列" onClick={()=>{const top=selectedBlock(), table=editor.children[top]; if(table.type==='table' && table.children[0].children.length<12) table.children.forEach((row,i)=>editor.tf.insertNodes({type:'td',children:[{type:'p',children:[{text:''}]}]},{at:[top,i,row.children.length]}));}}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="1" width="9" height="10" rx="1"/><line x1="1" y1="4.3" x2="10" y2="4.3"/><line x1="1" y1="7.6" x2="10" y2="7.6"/><line x1="5" y1="1" x2="5" y2="11"/></g><g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="10.6" y1="12" x2="13.4" y2="12"/><line x1="12" y1="10.6" x2="12" y2="13.4"/></g></svg></button>
      <label className="writing-tool writing-upload" title="插入图片（PNG/JPEG，最大 500 KB）" aria-label="插入图片"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1" y="2" width="12" height="10" rx="1.5"/><path d="M2.5 10.5l2.8-2.8 2.2 2.2 1.8-1.8 2.2 2.2"/></g><circle cx="4.7" cy="5.3" r="1.1" fill="currentColor"/></svg><input type="file" accept="image/png,image/jpeg" onChange={async e=>{const file=e.target.files[0];if(!file)return;if(file.size>500000)return setError('图片最大500 KB');const reader=new FileReader();reader.onload=()=>insert({id:id(),type:'img',url:reader.result,alt:file.name,children:[{text:''}]});reader.readAsDataURL(file);}}/></label>
      <button type="button" className="writing-tool" title="编辑公式" aria-label="编辑公式" onClick={()=>{const old=editor.children[selectedBlock()]; const formula=prompt('输入 TeX 公式；PDF/DOCX 导出时排版',old.type==='equation'?old.formula:'E=mc^2');if(formula) {if(old.type==='equation') editor.tf.setNodes({formula},{at:[selectedBlock()]});else insert({id:id(),type:'equation',formula,children:[{text:''}]});}}}><span className="writing-glyph" aria-hidden="true">Σ</span></button>
      <span className="writing-count" role="status" aria-label="字数">{count} 个字</span>
    </fieldset>}
    </div>
    {historical && <button type="button" className="writing-restore" onClick={async()=>{try{const result=await api(`${base}/restore`,{request_id:id(),version_id:viewed.id,base_version_id:latest.id});onSaved(await api(base),result.version_id);}catch(e){setError(e.message);}}}>恢复此版为新版本</button>}
    {item.proposals.slice().reverse().map(p=><Proposal key={p.id} proposal={p} citations={latest.citations} base={base} flush={flush} refresh={loaded=>install(loaded,false)} error={setError} onCitation={onCitation} onDeciding={setDeciding} deciding={deciding} decisionLock={decisionLock} retry={request=>{setInstruction(request.instruction);setMode(request.mode);selection.current=null;setStatus('已准备原指令；请重新选择文字或处理整文，再明确发送');}}/>)}
  </div>;
}

window.MethodAtlasWriting = {
  mount(host, options) { this.unmount(); const root=createRoot(host);mounted=root;root.render(<Writing {...options}/>); },
  unmount() { mounted?.unmount();mounted=null; },
  flush() { return active?.flush() || Promise.resolve(); },
  submit(text) { return active?.submit(text) || Promise.resolve({handled:false}); },
  async create(project) { return api(`/api/projects/${project}/documents`,{request_id:id(),title:'未命名文档',document:[paragraph()]}); }
};
window.dispatchEvent(new Event('writing-ready'));
