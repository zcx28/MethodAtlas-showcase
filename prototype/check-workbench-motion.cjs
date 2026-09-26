// Real frontend with isolated, deterministic API fixtures; no model calls or personal data.
// --serve keeps the same fixture available for visual review.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
// Small valid one-page PDF, so the PDF.js check has no external fixture dependency.
const pdfText = Array.from({length:35},(_,i)=>`BT /F1 12 Tf 40 ${1740-i*45} Td (Original PDF line ${i+1}: preserve this location.) Tj ET`).join('\n');
const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${pdfText.length} >>\nstream\n${pdfText}\nendstream`];
let pdf = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
const xref = pdf.length;
pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const blocks = Array.from({length:40},(_,i)=>({kind:'paragraph',text:`第 ${i+1} 段 · 阅读位置检查。`+'研究方法、实验条件和结果应保持可追溯。'.repeat(8)}));
const paper = {id:'paper',title:'动效验收论文',kind:'pdf',source_kind:'pdf',version_id:'pv',current_version_id:'pv',page_count:1,metadata:{url:'https://arxiv.org/abs/2609.00001',discovery_accepted:{pv:{pdf_url:'https://arxiv.org/pdf/2609.00001'}}},pages:[{page:1,width:600,height:1800,text:blocks.map(b=>b.text).join('\n'),layout:blocks,blocks:[]}]};
const before = [{id:'para',type:'p',children:[{text:'原文需要核对。'}]}], after = [{id:'para',type:'p',children:[{text:'修订后的结果已核对。'}]}];
const extraCitations=[];
const version = (n,document) => ({id:`v${n}`,version_no:n,title:'动效检查文稿',kind:'manuscript',payload:{document,author:'user'},citations:[{id:'cite-motion',paper_id:'paper',paper_version_id:'pv',title:paper.title,page:1,quote:'原文需要核对。'},{id:'cite-second',paper_id:'paper-second',paper_version_id:'pv-second',title:'另一篇论文：用于检验很长很长的参考文献标题也不会挤走右侧插入引用按钮',page:1,quote:'第二篇论文的证据。'},...extraCitations]});
const manuscript = {id:'d',project_id:'p',title:'动效检查文稿',kind:'manuscript',versions:[version(1,before)],proposals:[{id:'proposal',status:'pending',before_nodes:before,after_nodes:after,request:{instruction:'核对结果',mode:'polish'}}]};
const project = {id:'p',name:'四处动效 · 独立验收',papers:[paper,{...paper,id:'paper-second',version_id:'pv-second',current_version_id:'pv-second',title:'另一篇论文：长标题与编号检查'}],artifacts:[{id:'d',title:manuscript.title,kind:'manuscript'}],conversations:[{id:'c',title:'动效检查',messages:[],reads:[]}],created:'2026-09-22',updated:'2026-09-22'};
const candidates = ['one','two','three'].map(id=>({id,choice:'pending',preferred:{title:`待确认论文 ${id}`,summary:'动效测试用候选，收录后进入左侧资料。',source:'arxiv'},versions:[],availability:{fulltext:'not_fetched'},subscriptions:['sub']}));
const subscription = {subscriptions:[{id:'sub',name:'动效检查订阅',enabled:true,time:'08:00',remaining:3,strategy:{}}],runs:[{id:'run',wait_id:'wait',subscription_id:'sub',created:'2026-09-22',status:'succeeded',sources:[],payload:{candidates}}]};
// Optional snapshot preserves the user's isolated trial when restarting this preview.
if(process.argv.includes('--serve')&&process.env.MOTION_PREVIEW_STATE){
  const saved=JSON.parse(fs.readFileSync(process.env.MOTION_PREVIEW_STATE,'utf8'));
  Object.assign(project,saved.project);Object.assign(manuscript,saved.manuscript);Object.assign(subscription,saved.subscription);
  const restored=subscription.runs[0]?.payload.candidates||[];
  for(const candidate of candidates)Object.assign(candidate,restored.find(c=>c.id===candidate.id)||{});
  subscription.runs[0].payload.candidates=candidates;
}
let failChoice = false, failAccept = false, polls = 0;
const server = http.createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost').pathname;
  const json = (data,status=200) => {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url === '/api/state') return json({projects:[project]});
  if(url === '/api/skills') return json([]);
  if(url === '/api/projects/p') return json(project);
  if(url.startsWith('/api/projects/p/citations/')) return json(manuscript.versions.at(-1).citations.find(c=>url.endsWith('/'+c.id)));
  if(/^\/api\/projects\/p\/papers\/(one|two|three)$/.test(url))return json(project.papers.find(p=>url.endsWith('/'+p.id)));
  if(url === '/api/projects/p/papers/paper-second') return json({...paper,id:'paper-second',title:'另一篇论文：长标题与编号检查',version_id:'pv-second'});
  if(url === '/api/projects/p/papers/paper') return json(paper);
  if(url === '/api/projects/p/papers/paper/pdf') {res.writeHead(200,{'Content-Type':'application/pdf'});return res.end(pdf);}
  if(url === '/api/projects/p/subscription') {polls++;return json(subscription);}
  if(url.endsWith('/subscription/choose')) {
    if(failChoice) return json({error:'验收：收录失败，请重试'},503);
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw), candidate=candidates.find(c=>c.id===body.candidate_id);
    candidate.choice=body.choice;
    if(body.choice==='collected')project.papers.unshift({...paper,id:candidate.id,version_id:'pv-'+candidate.id,current_version_id:'pv-'+candidate.id,title:candidate.preferred.title});
    return json(subscription);
  }
  if(url === '/api/projects/p/documents/d' || url === '/api/projects/p/artifacts/d') return json(manuscript);
  if(url === '/api/projects/p/documents/d/reference') {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),source=project.papers.find(p=>p.id===body.paper_id&&p.current_version_id===body.paper_version_id);
    if(!source)return json({error:'文献不属于当前项目'},400);
    let citation=extraCitations.find(c=>c.paper_id===body.paper_id&&c.paper_version_id===body.paper_version_id);
    if(!citation){citation={id:'cite-'+source.id,paper_id:source.id,paper_version_id:source.current_version_id,title:source.title,page:1,kind:'bibliography',quote:''};extraCitations.push(citation);}
    return json(citation);
  }
  if(url === '/api/projects/p/documents/d/save') {
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw), next=version(manuscript.versions.length+1,body.document);
    manuscript.versions.push(next);return json({version_id:next.id,version_no:next.version_no});
  }
  if(url.endsWith('/proposals/proposal/accept')) {
    if(failAccept)return json({error:'验收：接受失败，原文保留'},503);
    manuscript.versions.push(version(2,after));manuscript.proposals[0].status='accepted';return json(manuscript);
  }
  if(url.startsWith('/api/')) return json({});
  if(url === '/app.js') {res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(['app','literature','progress','subscriptions','skills','remote'].map(n=>fs.readFileSync(path.join(__dirname,n+'.js'),'utf8')).join('\n\n'));}
  const file=path.resolve(__dirname,url==='/'?'index.html':['/writing.js','/writing.css'].includes(url)?'dist'+url:'.'+url);
  if(!file.startsWith(__dirname+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json({error:'Not found'},404);
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.MOTION_PREVIEW_PORT)||0,'127.0.0.1',async()=>{
  const url=`http://127.0.0.1:${server.address().port}`;
  if(process.argv.includes('--serve'))return console.log(`Motion preview (fixture data): ${url}`);
  const {chromium}=require('playwright');
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{channel:'chromium'})});
    const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(8000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.motionEvents=[];
      document.addEventListener('animationstart',e=>motionEvents.push({name:e.animationName,state:e.target.dataset.state}));
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(...args){motionEvents.push({target:this.className,row:this.dataset.sourceId||this.dataset.subCandidate,frames:args[0]});return animate.apply(this,args);};
    });
    await page.goto(url);await page.locator('[data-action=open-project]').click();
    const pop=page.locator('#skill-workbench'),trigger=page.locator('[data-action=skill-workbench]');
    await trigger.click();
    assert.equal(await pop.getAttribute('data-pointer-motion'),'true');
    assert.equal(await pop.evaluate(n=>getComputedStyle(n).transitionDuration),'0.14s');
    await page.keyboard.press('Escape');
    await trigger.focus();await page.keyboard.press('Enter');
    assert.equal(await pop.getAttribute('data-pointer-motion'),'false');
    assert.equal(await pop.evaluate(n=>n.getAnimations().length),0,'keyboard popover is immediate');
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(n=>document.activeElement===n),true,'popover restores focus');
    await page.locator('[data-action=file][data-id=d]').click();
    await page.locator('.writing-proposal[data-state=pending]').waitFor();
    await page.locator('[data-action=shell][data-value=library]').click();
    await page.locator('[data-action=paper][data-id=paper]').click();
    await page.waitForTimeout(260);
    await page.evaluate(()=>{window.editorBefore=document.querySelector('[contenteditable=true]');const reader=document.querySelector('.reader-body');reader.scrollTop=1800;});
    assert.equal(await page.locator('[data-action=reader-fullscreen]').count(),1);
    assert.equal(await page.locator('[data-action=reader-original], [data-action=reader-responsive]').count(),0,'PDF toggle stays in full screen');
    assert.equal(await page.locator('.reader-toolbar a[aria-label="下载原 PDF"],.reader-toolbar a:has-text("全文来源")').count(),0,'download and PDF source links are removed');
    assert.equal(await page.locator('.reader-toolbar a:has-text("打开来源网页")').count(),1,'the source page link remains');
    assert.equal(await page.evaluate(()=>editorBefore===document.querySelector('[contenteditable=true]')),true,'right editor survives');
    await page.locator('[data-action=reader-fullscreen]').click();
    await page.waitForFunction(()=>document.body.classList.contains('reader-fullscreen'));
    assert.equal(await page.locator('[data-action=reader-original]').count(),1,'PDF toggle appears in full screen');
    await page.locator('[data-action=reader-original]').click();
    await page.waitForFunction(()=>document.querySelector('.pdfjs-status')?.hidden);
    await page.locator('[data-action=reader-fullscreen]').click();
    await page.waitForFunction(()=>!document.body.classList.contains('reader-fullscreen'));
    assert.equal(await page.locator('.original-reader').count(),0,'PDF is hidden after leaving full screen');
    assert.equal(await page.locator('[data-action=reader-original], [data-action=reader-responsive]').count(),0,'PDF toggle is hidden after leaving full screen');
    await page.locator('#sources-panel .breadcrumb-back').click();
    const collect=async id=>{await page.locator(`#subscription-pending [data-sub-candidate=${id}]`).click();await page.locator('[data-sub-choice=collected]').click();};
    failChoice=true;await collect('one');await page.getByRole('alert').filter({hasText:'收录失败'}).first().waitFor();
    assert.equal(await page.locator('[data-source-id=one]').count(),0,'failure never inserts a source');
    assert.equal(await page.evaluate(()=>motionEvents.filter(e=>e.row).length),0,'failure has no success motion');
    failChoice=false;await collect('one');await page.locator('[data-source-id=one]').waitFor();await page.waitForTimeout(220);
    assert.ok(await page.evaluate(()=>motionEvents.some(e=>e.row==='one')),'new source animates once');
    const proposalEnters=await page.evaluate(()=>motionEvents.filter(e=>e.name==='proposal-enter').length);
    const rowCount=await page.evaluate(()=>motionEvents.filter(e=>e.row).length), pollBefore=polls;
    await page.waitForTimeout(3200);assert.ok(polls>pollBefore);assert.equal(await page.evaluate(()=>motionEvents.filter(e=>e.row).length),rowCount,'polling never replays motion');
    assert.equal(await page.evaluate(()=>motionEvents.filter(e=>e.name==='proposal-enter').length),proposalEnters,'unrelated updates do not replay proposal entry');
    const proposal=page.locator('.writing-proposal');
    failAccept=true;await proposal.getByRole('button',{name:'接受',exact:true}).click();await page.getByRole('alert').filter({hasText:'接受失败'}).waitFor();
    assert.equal(await proposal.getAttribute('data-state'),'pending');
    assert.match(await page.locator('[contenteditable=true]').innerText(),/原文需要核对/);
    failAccept=false;await proposal.getByRole('button',{name:'接受',exact:true}).click();
    await proposal.waitFor({state:'detached'});
    assert.match(await page.locator('[contenteditable=true]').innerText(),/修订后的结果已核对/);
    assert.ok(await page.evaluate(()=>motionEvents.some(e=>e.name==='proposal-exit')),'accepted proposal exits');
    await page.emulateMedia({reducedMotion:'reduce'});
    await collect('two');await page.locator('[data-source-id=two]').waitFor();
    await page.locator('.writing-citation').filter({hasText:'待确认论文 two'}).waitFor();
    assert.equal(await page.evaluate(()=>motionEvents.filter(e=>e.row).length),rowCount,'reduced motion skips list animation');
    await trigger.click();assert.equal(await pop.evaluate(n=>n.getAnimations().length),0);await page.keyboard.press('Escape');
    await page.locator('[data-action=paper][data-id=paper]').click();await page.locator('.reader-shell').waitFor();
    assert.equal(await page.locator('.reader-shell').evaluate(n=>n.getAnimations().length),0);
    await page.keyboard.press('Escape');
    manuscript.proposals[0].status='pending'; manuscript.versions=[version(1,before)];
    await page.reload();
    await page.locator('[data-action=shell][data-value=chat]').click();
    // The saved workspace restores the open manuscript.
    await page.locator('.writing-proposal[data-state=pending]').waitFor();
    assert.equal(await page.locator('.writing-proposal').evaluate(n=>n.getAnimations().length),0);
    await page.locator('.writing-proposal').getByRole('button',{name:'接受',exact:true}).click();
    await page.locator('.writing-proposal').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>motionEvents.some(e=>e.name==='proposal-exit')),false);
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('[data-action=shell][data-value=library]').click();
    const closeReader=page.locator('#sources-panel .breadcrumb-back[data-action=close-paper]');
    if(await closeReader.count())await closeReader.click();
    await page.locator('[data-action=paper][data-id=paper]').click();
    await page.waitForFunction(()=>motionEvents.some(e=>String(e.target).includes('reader-shell')&&Array.isArray(e.frames)&&e.frames[0].transform?.includes('scale')));
    assert.equal(await page.locator('.writing-citations').getAttribute('open'),'');
    await page.getByRole('button',{name:'插入引用',exact:true}).nth(1).click();
    await page.locator('.writing-cite[data-citation-node]').waitFor();
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(()=>motionEvents.some(e=>Array.isArray(e.frames)&&e.frames[0].offsetDistance==='0%')),'citation flies to its inserted node');
    assert.equal(await page.locator('.citation-flight').count(),0,'flight overlay removed');
    await page.getByRole('button',{name:'插入引用',exact:true}).nth(0).click();
    await page.getByRole('button',{name:'插入引用',exact:true}).nth(1).click();
    assert.deepEqual(await page.locator('.writing-surface .writing-cite button').allTextContents(),['[2]','[1]','[2]']);
    const metrics=await page.locator('.writing-citation').nth(1).evaluate(row=>{const button=row.querySelector('.writing-cite-action'), title=row.querySelector('.writing-citation-title');return {fits:button.getBoundingClientRect().right<=row.getBoundingClientRect().right+1,blue:getComputedStyle(button).backgroundColor,clipped:title.scrollWidth>title.clientWidth};});
    assert.ok(metrics.fits);assert.notEqual(metrics.blue,'rgba(0, 0, 0, 0)');
    assert.equal(await page.locator('.writing-cite button').first().evaluate(el=>getComputedStyle(el).borderWidth),'0px');
    assert.equal(await page.locator('.writing-citations small').count(),0);
    const newRef=page.locator('.writing-citation').filter({hasText:'待确认论文 two'});
    await newRef.getByRole('button',{name:'插入引用',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.writing-surface .writing-cite').length===4);
    await page.locator('.writing-menu summary').click();
    await page.getByRole('button',{name:'立即保存',exact:true}).click();
    await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('writing-draft:p:d')||'null'));
    assert.ok(manuscript.versions.at(-1).citations.some(c=>c.paper_id==='two'),'new library reference survives save');
    await page.reload();await page.locator('.writing-surface .writing-cite').nth(3).waitFor();
    assert.equal(await page.locator('.writing-citation').filter({hasText:'待确认论文 two'}).count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: motion and citations; PDF loading, editor persistence, keyboard focus, failure states, polling and reduced motion');
  }catch(error){console.error(error);process.exitCode=1;}finally{await browser?.close();server.close();}
});
