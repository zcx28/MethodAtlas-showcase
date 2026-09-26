// Host-only adapter. The graph engine, filtering, forces and dragging remain upstream.
const HOST = null; // METHODATLAS_PREVIEW_CONTEXT
const evidenceById = new Map(DATA.citations.map(c => [c.id,c]));
const nodeById = new Map(DATA.nodes.map(n => [n.id,n]));
const send = (type, fields) => { if (HOST) parent.postMessage({...HOST,type,...fields}, '*'); };
// The upstream adapter repeats approach as findings and problem as significance.
readerGuide = function(n) {
  const r=n.reader_summary?.['zh-CN']; if(!r)return '';
  const seen=new Set([DATA.meta.focus]);
  return [['研究背景',r.background],['研究问题',r.problem],['核心方法',r.approach],['主要发现',r.key_findings],['研究意义',r.why_it_matters],['适用边界',r.limitations]].map(([title,value])=>{
    const items=(Array.isArray(value)?value:[value]).filter(text=>{if(!text || seen.has(text))return false;seen.add(text);return true;});
    return items.length?`<p><strong>${title}：</strong>${items.map(text=>esc(text)).join('；')}${title==='核心方法'?' '+evidenceButtons(n.evidence_ids):''}</p>`:'';
  }).join('');
};
function evidenceButtons(ids) {
  return ids.map(id=>`<button data-evidence="${esc(id)}" aria-label="查看原文 · 第 ${evidenceById.get(id).page} 页">[${DATA.citations.findIndex(c=>c.id===id)+1}]</button>`).join(' ');
}
function original(n) {
  return `<section id="original-${esc(n.id)}"><h2>${esc(n.title)}</h2>${n.pages.map(p=>`<h3>${n.is_text?'文字材料':'第 '+p.page+' 页'}</h3><pre id="page-${esc(n.id)}-${p.page}">${esc(p.text)}</pre>`).join('')}</section>`;
}
showNode = function(n) {
  document.getElementById('paper-'+n.id)?.scrollIntoView({block:'start'});
  send('methodatlas-graph-paper',{paper_id:n.id,paper_version_id:n.version_id});
};
showEdge = function(e) { document.getElementById('relation-'+DATA.edges.indexOf(e))?.scrollIntoView({block:'start'}); };
document.addEventListener('click', e => {
  const id=e.target.closest('[data-evidence]')?.dataset.evidence, c=evidenceById.get(id);
  if(!c)return;
  if(HOST)send('methodatlas-graph-citation',{id});
  else {
    const page=nodeById.get(c.paper_id)?.pages.find(p=>p.page===c.page), target=document.getElementById('page-'+c.paper_id+'-'+c.page);
    if(!page || !target)return;
    const old=document.getElementById('evidence-focus');if(old)old.replaceWith(old.textContent);
    const at=page.text.indexOf(c.quote);
    if(at>=0)target.innerHTML=esc(page.text.slice(0,at))+'<mark id="evidence-focus">'+esc(c.quote)+'</mark>'+esc(page.text.slice(at+c.quote.length));
    (document.getElementById('evidence-focus')||target).scrollIntoView({block:'center'});
  }
});
const upstreamRender = render;
const upstreamPositions = updatePositions;
updatePositions = function() {
  upstreamPositions();
  svg.querySelectorAll('.edge').forEach((path,i)=>{
    const e=state.edges[i],a=nodeById.get(e.source),b=nodeById.get(e.target),length=Math.hypot(b.x-a.x,b.y-a.y)||1;
    const siblings=state.edges.filter(other=>other.source===e.source && other.target===e.target);
    const offset=(siblings.indexOf(e)-(siblings.length-1)/2)*48;
    const d=`M ${a.x} ${a.y} Q ${(a.x+b.x)/2-(b.y-a.y)*offset/length} ${(a.y+b.y)/2+(b.x-a.x)*offset/length} ${b.x-(b.x-a.x)*13/length} ${b.y-(b.y-a.y)*13/length}`;
    path.setAttribute('d',d);path.nextSibling.setAttribute('d',d);
  });
};
render = function() {
  upstreamRender();
  svg.querySelectorAll('.node').forEach((g,i)=>{
    const title=state.nodes[i].title,label=g.querySelector('text'),short=title.split(':')[0];
    label.textContent=short.length>30?short.slice(0,27)+'…':short;label.setAttribute('x','0');label.setAttribute('y',i%2?'-18':'26');label.setAttribute('text-anchor','middle');
    g.tabIndex=0;g.setAttribute('role','button');g.setAttribute('aria-label',title);g.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();showNode(state.nodes[i]);}};
  });
  svg.querySelectorAll('.edge-hit').forEach((g,i)=>{g.tabIndex=0;g.setAttribute('role','button');g.setAttribute('aria-label',`${state.edges[i].relationship.join('/')}：${nodeById.get(state.edges[i].source).title} → ${nodeById.get(state.edges[i].target).title}`);g.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();showEdge(state.edges[i]);}};});
};
// A report has one reading flow. Engine controls stay unmounted in the hidden sidebar.
document.querySelector('.sidebar').hidden=true;
document.querySelector('.canvas').hidden=!DATA.edges.length;
detail.className='';
detail.innerHTML=DATA.edges.map((e,i)=>`<section id="relation-${i}"><h2>${esc(nodeById.get(e.source).title)} → ${esc(nodeById.get(e.target).title)}</h2><p>${esc(e.explanation)} ${evidenceButtons(e.evidence_ids)}</p></section>`).join('')
  +DATA.nodes.map(n=>`<section id="paper-${esc(n.id)}"><h2>${esc(n.title)}</h2>${readerGuide(n)}</section>`).join('')
  +(!HOST?`<section class="originals"><h2>原文</h2>${DATA.nodes.map(original).join('')}</section>`:'');
// Wheel scrolling continues through the document instead of zooming an inner canvas.
svg.addEventListener('wheel',e=>e.stopImmediatePropagation(),true);
document.head.insertAdjacentHTML('beforeend',`<style>
:root{--bg:#fff;--panel:#fff;--text:#182230;--muted:#667085;--line:#c5d4ec;--accent:#246bdb}
body{height:auto;overflow:auto;background:#fff;color:#182230;font:15px/1.85 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;padding:32px clamp(20px,5vw,64px) 56px;overflow-wrap:anywhere}
header{display:block;height:auto;padding:0;border:0;max-width:960px;margin:auto;background:none}header h1{font-size:clamp(23px,3.2vw,30px);line-height:1.4;margin:0 0 20px}header .focus{color:#475467;font-size:15px;max-width:none}header h1,header .focus{max-width:none;white-space:normal;overflow:visible;text-overflow:clip}
.app{display:block;height:auto;max-width:960px;margin:auto}.sidebar[hidden],.canvas[hidden]{display:none}.canvas{height:300px;margin:24px 0;background:#fff;border:0}.detail{padding:0;overflow:visible;background:none;border:0;font-size:15px}.detail section{margin:28px 0}.detail h2{font-size:19px;line-height:1.5;margin:28px 0 12px}.detail h3{font-size:14px;line-height:1.6;margin:20px 0 6px}.detail p{font-size:inherit;line-height:inherit;color:#344054;margin:8px 0 16px}.detail button{border:0;border-radius:0;background:none;padding:0 3px;color:#246bdb;font:inherit;font-size:12px;cursor:pointer}.detail pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:#475467}.node text{font-size:13px;text-shadow:none;fill:#344054}.node circle{fill:#246bdb}.node:focus circle,.edge-hit:focus{stroke:#246bdb;stroke-width:4px}.edge{marker-end:url(#arrow)}button:focus-visible{outline:2px solid #246bdb;outline-offset:3px}.originals{border-top:1px solid #e4e7ec}
</style>`);
render();fit();
new ResizeObserver(()=>fit()).observe(svg);
