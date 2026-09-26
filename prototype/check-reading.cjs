// Run: node prototype/check-reading.cjs; open the printed URL in a browser.
// Exercises the real preview renderer with saved HTML and DOCX-shaped fixtures.
const http = require('node:http');
const fs = require('node:fs');
const code = fs.readFileSync(__dirname + '/app.js','utf8');
const render = code.slice(code.indexOf('function researchPreview('),code.indexOf('\nfunction renderArtifact('));
const page = String.raw`<!doctype html><meta charset="utf-8"><title>Research reading checks</title><style id="report-theme">${fs.readFileSync(__dirname + '/report.css','utf8')}</style><pre id="result">Running…</pre><script>
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
${render}
try {
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
 const citations=[{id:'a',paper_id:'p',paper_version_id:'v1',title:'Paper A',quote:'Original first quote <not markup>'},{id:'b',paper_id:'p',paper_version_id:'v1',title:'Paper A',quote:'Original second quote'},{id:'c',paper_id:'p',paper_version_id:'v2',title:'Paper A revised',quote:'Revised evidence'},{id:'foreign',paper_id:'other',paper_version_id:'other',title:'Other project',quote:'DO NOT SHOW'}];
 const version={kind:'html',title:'Research',materials:[{paper_id:'p',paper_version_id:'v1'},{paper_id:'p',paper_version_id:'v2'}],citations,payload:{},body:'<article class="research-view"><h1>Research</h1><p><button data-citation="a">原文</button><button data-citation="b">原文</button><button data-citation="c">原文</button><button data-citation="foreign">原文</button></p></article>'};
 const before=JSON.stringify(version);
 const doc=new DOMParser().parseFromString(researchPreview(version),'text/html');
 assert([...doc.querySelectorAll('[data-citation]')].map(n=>n.textContent).join(',')==='[1],[1],[2]','Same paper numbering; version isolation');
 assert(doc.querySelectorAll('.reading-reference').length===2,'Deduplicated bibliography');
 assert(doc.querySelectorAll('[popover]').length===3,'Each evidence retains its own original text');
 assert(doc.querySelector('[popover]').textContent===citations[0].quote,'Original quote is verbatim and escaped');
 assert(!doc.querySelector('not'),'Quote cannot introduce markup');
 assert(!doc.body.textContent.includes('DO NOT SHOW'),'Foreign evidence excluded');
 assert(JSON.stringify(version)===before,'Saved version unchanged');
 const textVersion={...version,kind:'docx',body:'# Findings\nA [1], B [2], revised [3]\n| Claim | Source |\n| --- | --- |\n| Retained | [2] |'};
 const text=new DOMParser().parseFromString(researchPreview(textVersion),'text/html');
 assert(text.querySelector('h2').textContent==='Findings','Text headings preserved');
 assert(text.querySelectorAll('table tr').length===2,'Text comparison table preserved');
 assert(text.querySelector('td [data-citation]').dataset.citation==='b','DOCX evidence index mapped before renumbering');
 assert(text.querySelector('td [data-citation]').textContent==='[1]','DOCX paper number matches bibliography');
 const legacy={...version,body:'<article><p data-citation="a">Only <strong>indoors</strong>.</p><button data-citation="b">Claim with <em>conditions</em></button><section><h2>原文依据</h2><p>Historical source note</p></section></article>'};
 const old=new DOMParser().parseFromString(researchPreview(legacy),'text/html');
 assert(old.querySelector('strong').parentElement.textContent==='Only indoors.','Legacy cited paragraph retained');
 assert(old.querySelector('strong').textContent==='indoors','Legacy nested formatting retained');
 assert(old.querySelector('.reading-citation').textContent==='[1]','Legacy paragraph gets an independent citation');
 assert(old.body.textContent.includes('Historical source note') && !old.querySelector('details'),'Historical source notes stay visible without disclosure');
 assert(old.querySelector('em').textContent==='conditions','Cited button claim retained');
 const duplicate={...textVersion,title:'Research',body:'# Research\n- First point\n- Second point'};
 const clean=new DOMParser().parseFromString(researchPreview(duplicate),'text/html');
 assert(clean.querySelectorAll('h1').length===1 && !clean.querySelector('h2:not(.reading-references h2)'),'Duplicate document title omitted');
 assert(clean.querySelectorAll('ul li').length===2,'Semantic list retained');
 assert(clean.head.textContent.includes('body.reading-view'),'Preview embeds shared report theme');
 const flat=new DOMParser().parseFromString(researchPreview({...version,body:'<details><summary>More</summary><p>Visible body</p></details><section class=research-detail hidden><h2>Details</h2><p>Preserved</p></section>'}),'text/html');
 assert(!flat.querySelector('details,[hidden]') && flat.body.textContent.includes('Visible body') && flat.body.textContent.includes('Preserved'),'Old reports have no nested disclosure or hidden detail');
 const dated=new DOMParser().parseFromString(researchPreview({...version,payload:{research:{nodes:[{period:'1981–1989'}]}},body:'<div class=research-timeline>Old timeline</div><section class=research-detail data-detail=0 hidden><h2>Old method</h2><p>Preserved</p></section>'}),'text/html');
 assert(dated.querySelector('.reading-period').textContent==='1981–1989','Old timeline years remain after flattening');
 const themed=new DOMParser().parseFromString(researchPreview({...version,body:'<p>Old report</p><style>body.reading-view{font-size:8px}</style>'}),'text/html');
 assert(themed.head.querySelectorAll('style').length===2 && !themed.body.querySelector('style') && themed.head.lastElementChild.textContent.includes('--report-ink'),'Current shared theme follows archived inline styles');
 document.getElementById('result').textContent='PASS: 22 reading checks';
 const frame=document.createElement('iframe');frame.title='Quote interaction check';frame.setAttribute('sandbox','allow-scripts');frame.style='width:600px;height:400px;border:1px solid #ddd';frame.srcdoc=researchPreview(version);document.body.append(frame);
} catch(error){document.getElementById('result').textContent='FAIL: '+error.stack;}
</script>`;
const server=http.createServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(page)});
server.listen(0,'127.0.0.1',()=>console.log('Open http://127.0.0.1:'+server.address().port+'/'));
