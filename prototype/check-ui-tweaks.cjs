// Frontend-only regression: real Chromium + deterministic API data, no model/backend required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'})});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900}}), errors = [];
    await page.emulateMedia({reducedMotion:'reduce'});
    page.on('pageerror', e => errors.push(e.message));
    const project = {id:'p',name:'前端微调检查',papers:[],artifacts:[],conversations:[{id:'c',title:'对话',messages:[],reads:[]}],created:'2026-09-01',updated:'2026-09-01'};
    await page.route('https://ui.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/api/state') return route.fulfill({json:{projects:[project]}});
      if (name === '/api/projects/p') return route.fulfill({json:project});
      if (name === '/api/skills') return route.fulfill({json:[]});
      const files = {'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/home.css':['home.css','text/css'],'/workspace.css':['workspace.css','text/css'],'/report.css':['report.css','text/css'],'/assets/methodatlas-mark.png':['assets/methodatlas-mark.png','image/png']};
      if (files[name]) return route.fulfill({body:fs.readFileSync(path.join(__dirname,files[name][0])),contentType:files[name][1]});
      return route.fulfill({body:'',contentType:name.endsWith('.js') ? 'text/javascript' : 'text/plain'});
    });
    await page.goto('https://ui.test/');
    await page.locator('[data-action=open-project]').click();
    await page.locator('#chat-input').fill('尚未发送的草稿');
    // The persistent composer launcher exposes every PR81 skill without submitting a task.
    const launcher = page.locator('#chat-form [popovertarget=skill-workbench]');
    await launcher.click();
    assert.equal(await page.locator('#skill-workbench .workbench-card').count(),8);
    assert.ok(await page.locator('#skill-workbench').evaluate(n=>{const r=n.getBoundingClientRect();return r.width<=440 && r.height<=600 && r.top>=12 && r.bottom<=innerHeight-12;}),'tool list stays within the viewport');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#chat-input').inputValue(),'尚未发送的草稿');
    assert.equal(await launcher.evaluate(n=>n===document.activeElement),true);
    const keys = await page.evaluate(()=>Object.keys(taskInfo));
    for (const key of keys) {
      await page.locator('#chat-input').fill('');
      await launcher.click();
      await page.locator(`#skill-workbench [data-value="${key}"]`).click();
      if (key === 'review') await page.locator('#skill-workbench [data-audit-mode="review"]').click();
      assert.equal(await page.locator('#chat-input').inputValue(),await page.evaluate(key=>taskInfo[key].prompt,key));
      assert.equal(await page.locator('#skill-workbench').isVisible(),false);
      assert.equal(await page.locator('#chat-input').evaluate(n=>n===document.activeElement),true);
    }
    for (const mode of ['novelty','citation']) {
      const draft=await page.locator('#chat-input').inputValue();
      await launcher.click();
      await page.locator('#skill-workbench [data-value="review"]').click();
      await page.locator(`#skill-workbench [data-audit-mode="${mode}"]`).click();
      assert.equal(await page.locator('#chat-input').inputValue(),draft+'\n\n'+await page.evaluate(mode=>auditModes[mode].prompt,mode));
    }
    assert.equal(await page.evaluate(()=>conversation.messages.length),0);
    await page.evaluate(()=>{pending=true;syncComposer();});
    await launcher.click();
    assert.equal(await page.locator('#skill-workbench .workbench-card:disabled').count(),8);
    await page.evaluate(()=>{pending=false;syncComposer();});
    assert.equal(await page.locator('#skill-workbench .workbench-card:disabled').count(),0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await launcher.click();
    assert.ok(await page.locator('#skill-workbench').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && n.scrollWidth<=n.clientWidth;}));
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#chat-input').fill('尚未发送的草稿');
    await page.locator('.app-header [data-panel=sources-panel]').click();
    await page.locator('.app-header [data-panel=output-panel]').click();
    const widths = () => page.locator('.panels>.panel').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
    assert.ok((await widths())[2] >= 256, '显式展开的成果区可用');
    await page.getByRole('separator').first().waitFor();
    assert.equal(await page.getByRole('separator').count(),2);
    const before = await widths();
    await page.getByRole('separator').first().press('ArrowRight');
    assert.ok((await widths())[0] > before[0] + 20);
    assert.equal(await page.locator('#chat-input').inputValue(),'尚未发送的草稿');
    // Progress starts collapsed; explicit choices, focus and scroll survive polling.
    await page.evaluate(() => {
      window.task = {id:'t',status:'running',tools:[],files:[],citations:[],events:[{status:'tool_start',message:'读取材料',step_id:'read'}],plan:[{id:'read',title:'读取材料',status:'in_progress'}]};
      window.startTask = () => { disclosureState.clear(); pending=true;liveTask=task; conversation.messages = [{role:'user',text:'请求',task}]; renderChat(true); };
      window.completeTask = () => { task.status='succeeded';pending=false;liveTask=null; conversation.messages.push({role:'assistant',text:'已完成',task}); renderChat(); };
      startTask();
    });
    assert.equal(await page.locator('.execution-record[open]').count(),0,'running starts collapsed');
    await page.evaluate(() => { renderChat(); completeTask(); });
    assert.equal(await page.locator('.execution-record[open]').count(),0);
    await page.evaluate(() => { task.status='running'; startTask(); });
    await page.locator('.execution-record>summary').click();
    await page.locator('#chat-input').fill('完成时保留我的展开选择');
    await page.evaluate(() => completeTask());
    assert.equal(await page.locator('.execution-record[open]').count(),1);
    assert.equal(await page.locator('#chat-input').evaluate(n=>n===document.activeElement),true);
    assert.equal(await page.locator('#chat-input').inputValue(),'完成时保留我的展开选择');
    await page.evaluate(() => {
      task.status='running'; startTask();
      task.events = Array.from({length:40},(_,i)=>({status:'tool_start',message:'阅读步骤 '+i,step_id:'read'}));
      renderChat();
    });
    await page.locator('.execution-record>summary').click();
    await page.locator('.execution-record').evaluate(node=>{node.open=true;});
    await page.locator('#chat-input').focus();
    await page.waitForFunction(()=>{const log=document.getElementById('chat-log');return log.scrollHeight > log.clientHeight + 160;});
    await page.evaluate(() => { disclosureState.clear(); document.getElementById('chat-log').scrollTop = 80; });
    const scroll = await page.locator('#chat-log').evaluate(n=>n.scrollTop);
    await page.evaluate(() => completeTask());
    assert.equal(await page.locator('.execution-record[open]').count(),1);
    assert.ok(Math.abs(await page.locator('#chat-log').evaluate(n=>n.scrollTop)-scroll)<2);
    await page.evaluate(() => renderChat(true));
    assert.ok(await page.locator('#chat-log').evaluate(n=>n.scrollHeight-n.clientHeight-n.scrollTop<2));
    // Changed completion labels must close their real call, not leave a false unfinished row.
    const pairing=await page.evaluate(()=>{
      const events=[
        {seq:1,status:'tool_start',message:'并行搜索论文摘要：机器人'},
        {seq:2,status:'search_progress',message:'正在并行检索论文摘要：已取回 0 条候选，筛选后分批展示。'},
        {seq:3,status:'search_progress',message:'正在并行检索论文摘要：已取回 3 条候选，筛选后分批展示。'},
        {seq:4,status:'tool_done',message:'并行搜索论文摘要：机器人'},
        {seq:5,status:'tool_start',message:'正在整理推荐论文'},
        {seq:6,status:'tool_done',message:'已展示 3 篇推荐论文，可点击收录'}
      ];
      return {live:toolActions(events.slice(0,3)),done:toolActions(events),
        failed:toolActions([{status:'tool_start',message:'正在读取成果'}, {status:'tool_failed',message:'读取失败'}]),
        ambiguous:toolActions([{status:'tool_start',message:'读取甲'}, {status:'tool_start',message:'读取乙'}, {status:'tool_done',message:'新标题'}]),
        html:renderProgress({id:'search',status:'succeeded',events})};
    });
    assert.equal(pairing.live.length,1);assert.match(pairing.live[0].detail,/3 条候选/);
    assert.equal(pairing.done.length,2);assert.ok(pairing.done.every(row=>row.state==='done' && !row.detail));
    assert.doesNotMatch(pairing.html,/未完成|0 条候选|正在整理推荐论文/);
    assert.match(pairing.html,/已展示 3 篇推荐论文/);
    assert.equal(pairing.failed.length,1);assert.equal(pairing.failed[0].state,'failed');
    assert.equal(pairing.ambiguous.length,3,'ambiguous records must not fabricate a match');
    // Flat rows, real summaries, tool pairing, keyboard, motion continuity and narrow widths.
    await page.evaluate(() => {
      task.events=[{seq:1,status:'tool_start',message:'正在阅读 · 原文 · 第二章',step_id:'read'}, {seq:2,status:'tool_done',message:'已阅读 · 原文 · 第二章',step_id:'read'}, {seq:3,status:'tool_start',message:'正在搜索 · 扩散策略',step_id:'compare'}];
      task.plan=[{id:'read',title:'理解研究问题',status:'completed',summary:'已读取论文中的任务定义和实验条件。'}, {id:'compare',title:'比较方法的共同点',status:'in_progress'}];
      task.status='running'; startTask();
    });
    const record=page.locator('.execution-record'), summary=record.locator(':scope > summary');
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await record.locator('.process-timeline > li').count(),4);
    assert.equal(await record.locator('details').count(),0,'no nested tool groups');
    assert.deepEqual(await record.locator('.process-row').evaluateAll(rows=>rows.map(n=>n.dataset.kind)),['thought','tool','thought','tool']);
    assert.match(await record.textContent(),/原文 · 第二章/,'multi-part targets stay intact');
    assert.equal(await record.locator('.process-indicator').evaluate(n=>getComputedStyle(n).animationName),'none','reduced motion has static state feedback');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForTimeout(100);
    assert.equal(await record.locator('.process-indicator').evaluate(n=>getComputedStyle(n).animationName),'process-search');
    const beforeTime=await record.locator('.process-indicator').evaluate(n=>n.getAnimations()[0].currentTime);
    await page.evaluate(()=>renderChat());
    assert.ok(await record.locator('.process-indicator').evaluate(n=>n.getAnimations()[0].currentTime)>=beforeTime,'polling does not restart motion');
    for (const [text,motion] of [['正在读取材料','process-read'],['正在保存文件','process-save'],['正在执行实验','process-execute']]) {
      await page.evaluate(text=>{task.events.push({seq:task.events.length+1,status:'tool_start',message:text});renderChat();},text);
      assert.equal(await record.locator('.process-indicator').evaluate(n=>getComputedStyle(n).animationName),motion);
    }
    await page.evaluate(()=>{
      task.plan.push({id:'new',title:'归纳比较结果',status:'in_progress'});
      task.events.push({seq:9,status:'model',message:'正在处理请求'});renderChat();
    });
    assert.equal(await record.locator('[data-process-row="t:thought:new"]').evaluate(n=>getComputedStyle(n).animationName),'process-enter');
    assert.equal(await record.locator('.process-indicator').evaluate(n=>getComputedStyle(n).animationName),'process-think');
    await page.evaluate(()=>renderChat());
    assert.equal(await record.locator('.process-row.enter').count(),0,'existing thoughts do not re-enter');
    await page.setViewportSize({width:1280,height:900});
    if(process.env.PROCESS_SCREENSHOT) await page.screenshot({path:process.env.PROCESS_SCREENSHOT+'-desktop.png'});
    // Check the scoped component at mobile width; the surrounding workbench is a desktop layout.
    const narrow=await browser.newPage();
    await narrow.setViewportSize({width:390,height:844});
    await narrow.setContent(await page.evaluate(()=>`<style>${document.querySelector('style').textContent}</style><main style="padding:24px;background:var(--surface)"><div class="message agent">${document.querySelector('.execution-record').outerHTML}</div></main>`));
    await narrow.locator('.execution-record').evaluate(n=>n.open=true);
    await narrow.waitForTimeout(250);
    assert.ok(await narrow.locator('.execution-record').evaluate(n=>n.scrollWidth<=n.clientWidth && n.getBoundingClientRect().right<=innerWidth),'timeline fits a narrow column');
    if(process.env.PROCESS_SCREENSHOT) await narrow.screenshot({path:process.env.PROCESS_SCREENSHOT+'-mobile.png'});
    await narrow.close();
    await summary.focus(); await page.keyboard.press('Space');
    await page.evaluate(()=>renderChat());
    assert.equal(await record.getAttribute('open'),null,'explicit collapse survives a new render');
    await page.evaluate(()=>completeTask());
    assert.equal(await record.locator('.process-indicator').evaluate(n=>getComputedStyle(n).animationName),'none');
    const failure=await page.evaluate(()=>renderProgress({...task,status:'failed'}));
    assert.match(failure,/执行未完成/);assert.match(failure,/data-motion="idle"/);
    await page.setViewportSize({width:1280,height:900});
    await page.emulateMedia({reducedMotion:'reduce'});
    // A task owns its process and recommendations, in that order, while live and after completion.
    await page.evaluate(()=>{
      task.waits=[{id:'papers',payload:{kind:'papers',query:'论文',candidates:[],recommendation:{summary:'推荐结果检查',papers:[]}}}];
      task.status='running';startTask();pending=false;renderChat();
    });
    const assertProcessBeforeResults=async()=>{
      assert.equal(await page.locator('.execution-record').count(),1);
      assert.equal(await page.locator('.paper-recommendations').count(),1);
      assert.equal(await page.locator('.execution-record').evaluate(n=>Boolean(n.compareDocumentPosition(document.querySelector('.paper-recommendations')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
    };
    await assertProcessBeforeResults();
    await page.evaluate(()=>completeTask());
    await assertProcessBeforeResults();
    assert.equal(await page.locator('.paper-recommendations').evaluate(n=>Boolean(n.compareDocumentPosition(document.querySelector('.answer-text')) & Node.DOCUMENT_POSITION_FOLLOWING)),true);
    await page.evaluate(()=>{task.waits=[];});
    // Existing controls, upload transport and Studio version/list behavior stay intact.
    assert.ok(await page.locator('.conversation-row').count() > 0, 'the workbench column lists conversations');
    await page.evaluate(() => {
      task.status='running'; renderChat();
      current.artifacts=[{id:'a',title:'成果'}];
      artifact={id:'a',versions:[1,2].map(n=>({id:'v'+n,version_no:n,title:'成果',kind:'text',body:'保留正文 '+n,payload:{},citations:[]}))};
      renderOutput();
    });
    // The stop control lives in the composer now: it appears while a task runs and gives way to a draft.
    assert.equal(await page.locator('#chat-form [data-control=stop]').count(),0,'a draft keeps the send button');
    await page.locator('#chat-input').fill('');
    assert.equal(await page.locator('#chat-form [data-control=stop]').count(),1);
    assert.equal(await page.locator('[data-action=control][data-control=stop]').count(),0,'the message log no longer carries its own stop button');
    await page.locator('#chat-input').fill('继续输入时变回发送');
    assert.equal(await page.locator('#chat-form [type=submit]').count(),1);
    await page.locator('#chat-input').fill('');
    let releaseStop,stopStarted,stopRequests=0;const stopGate=new Promise(r=>releaseStop=r),stopReady=new Promise(r=>stopStarted=r);
    await page.route('**/tasks/*/stop',async route=>{stopRequests++;stopStarted();await stopGate;await route.fulfill({status:503,json:{error:'停止请求失败，请重试。'}});});
    await page.getByRole('button',{name:'停止生成',exact:true}).click();await stopReady;
    await page.locator('#chat-input').fill('停止期间的新草稿');await page.locator('#chat-input').fill('');
    assert.equal(await page.getByRole('button',{name:'停止生成',exact:true}).isEnabled(),false,'composer update must not unlock an in-flight stop');
    await page.getByRole('button',{name:'停止生成',exact:true}).evaluate(button=>button.click());
    await page.locator('#chat-input').fill('停止失败也保留草稿');
    const stopResponse=page.waitForResponse(r=>r.url().endsWith('/stop'));releaseStop();await stopResponse;
    await page.getByText('停止请求失败，请重试。',{exact:true}).waitFor();assert.equal(stopRequests,1);
    assert.equal(await page.locator('#chat-input').inputValue(),'停止失败也保留草稿');
    await page.locator('#chat-input').fill('');assert(await page.getByRole('button',{name:'停止生成',exact:true}).isEnabled());
    await page.unroute('**/tasks/*/stop');
    await page.locator('#version-select').selectOption('v1');
    assert.match(await page.locator('#output-body').innerText(),/保留正文 1/);

    assert.equal(await page.locator('#version-select').inputValue(),'v1');
    await page.getByRole('button',{name:'关闭成果，返回列表',exact:true}).click();
    assert.equal(await page.locator('#output-body [data-action=file]').count(),1);
    await page.route('**/api/upload-check', route => {
      assert.match(route.request().headers()['content-type'],/^multipart\/form-data; boundary=/);
      return route.fulfill({json:{ok:true}});
    });
    assert.equal(await page.evaluate(async()=>{const body=new FormData();body.append('file',new Blob(['text']),'note.txt');return (await api('/api/upload-check',{method:'POST',body})).ok;}),true);
    // PR81 output transplant: every saved figure remains reachable without replacing an open artifact.
    await page.route('https://ui.test/api/projects/p/papers/paper**', route => {
      const url = new URL(route.request().url());
      assert.equal(url.searchParams.get('version_id'),'paper-v1');
      if (url.pathname.endsWith('/fragment')) {
        assert.equal(url.searchParams.get('x0'),'10');
        return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect width="400" height="160" fill="#f5f7fb"/><path d="M40 20V130H360 M50 110L150 85L250 100L350 40" fill="none" stroke="#246bdb" stroke-width="3"/><text x="150" y="150" font-size="12">Figure fixture</text></svg>'});
      }
      return route.fulfill({json:{id:'paper',title:'历史图表论文',version_id:'paper-v1',kind:'text',page_count:1,pages:[{page:1,width:400,height:160,text:'旧版本原文',blocks:[]}]}});
    });
    await page.route('https://ui.test/api/projects/p/citations/*', route => route.fulfill({json:{id:'figure-one',kind:'figure',paper_id:'paper',paper_version_id:'paper-v1',title:'历史图表论文',page:1,rect:[10,10,390,150]}}));
    await page.evaluate(() => {
      const figure = {id:'figure-one',kind:'figure',paper_id:'paper',paper_version_id:'paper-v1',title:'历史图表论文',page:1,rect:[10,10,390,150],observations:[{basis:'image',text:'曲线在最后一个采样点上升。',visible:'右侧曲线'},{basis:'context',text:'作者在正文中描述实验条件。',visible:'原文条件 <不可执行>'}],gaps:['无法辨认坐标单位。']};
      task.status='succeeded'; task.events=[]; task.plan=[]; task.citations=[figure,{...figure,id:'figure-two',observations:[],gaps:['第二张图不可辨认。']}];
      task.files=[{artifact_id:'a',version_id:'v2',version_no:2,title:'成果',kind:'html',payload:JSON.stringify({research:{view:'comparison'}})}];
      conversation.messages=[{id:'request',role:'user',text:'解读图表',task},{id:'answer',role:'assistant',text:'以下为解读结果。',task}];
      artifact={id:'a',versions:[{id:'v2',version_no:2,title:'成果',kind:'text',body:'保留当前成果',payload:{research:{view:'comparison'}},citations:[]}]};
      versionId='v2'; renderOutput(); renderChat();
    });
    await page.locator('#chat-input').fill('结果展开也不能丢失草稿');
    const figureDetails=page.locator('.figure-insight');
    assert.equal(await figureDetails.count(),2,'all figures are reachable even without inline cite markers');
    assert.match(await page.locator('.file-list').innerText(),/方法对比 · v2/);
    assert.equal(await page.locator('#output-panel .breadcrumb-title').innerText(),'方法对比');
    await page.waitForFunction(()=>document.querySelector('.figure-insight img').naturalWidth>0);
    assert.match(await figureDetails.first().innerText(),/图中可见[\s\S]*正文说明[\s\S]*解读边界/);
    assert.equal(await figureDetails.first().locator('details').count(),0,'figure insight is a continuous document');
    await page.evaluate(()=>renderChat());
    assert.equal(await page.locator('.figure-insight').count(),2,'all figures remain visible after polling');
    assert.equal(await page.locator('#chat-input').inputValue(),'结果展开也不能丢失草稿');
    assert.match(await page.locator('#output-body').innerText(),/保留当前成果/);
    await figureDetails.first().locator('[data-action=citation]').hover();
    await page.locator('.citation-preview [data-citation-open]').click();
    await page.waitForFunction(()=>detail?.paper?.version_id==='paper-v1');
    assert.equal(await page.evaluate(()=>artifact.id),'a','original-source navigation preserves the open artifact');
    assert.equal(await page.locator('#version-select').inputValue(),'v2');
    await page.locator('.shell-nav [data-value=chat]').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'结果展开也不能丢失草稿');
    assert.deepEqual(await page.evaluate(()=>[
      artifactKindLabel({kind:'html',title:'查新综述'}),
      artifactKindLabel({kind:'png',payload:'invalid json'}),
      renderFigureInsight({id:'bad',page:1,rect:[0,0,Infinity,5],observations:[null],gaps:[]}).includes('<img')
    ]),['研究报告','科研图表',false],'unknown tools are not inferred from titles; malformed crop is not requested');
    await page.setViewportSize({width:900,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    const screenshots=path.resolve(__dirname,'../output/playwright');
    fs.mkdirSync(screenshots,{recursive:true});
    await page.setViewportSize({width:1440,height:1100});
    await page.locator('.figure-insight').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(screenshots,'ui-tweaks.png')});
    console.log('PASS: Persistent Studio/resize/state, collapsed flat progress/state animations/user reading, scroll/focus/drafts, task controls, versions/list and multipart upload transport. Figure crops/source versions, multi-figure history, output type, and preserved workspace also verified. Mock API; not a backend integration check.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
