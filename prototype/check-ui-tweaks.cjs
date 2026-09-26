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
      const files = {'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/home.css':['home.css','text/css'],'/report.css':['report.css','text/css'],'/assets/methodatlas-mark.png':['assets/methodatlas-mark.png','image/png']};
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
      await launcher.click();
      await page.locator('#skill-workbench [data-value="review"]').click();
      await page.locator(`#skill-workbench [data-audit-mode="${mode}"]`).click();
      assert.equal(await page.locator('#chat-input').inputValue(),await page.evaluate(mode=>auditModes[mode].prompt,mode));
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
    const widths = () => page.locator('.panels>.panel').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().width));
    assert.ok((await widths())[2] >= 220, '成果区常驻');
    assert.equal(await page.getByRole('separator').count(),2);
    const before = await widths();
    await page.getByRole('separator').first().press('ArrowRight');
    assert.ok((await widths())[0] > before[0] + 20);
    assert.equal(await page.locator('#chat-input').inputValue(),'尚未发送的草稿');
    // Default-open progress must collapse, but explicit or currently read blocks stay open.
    await page.evaluate(() => {
      window.task = {id:'t',status:'running',tools:[],files:[],citations:[],events:[{status:'tool_start',message:'读取材料',step_id:'read'}],plan:[{id:'read',title:'读取材料',status:'in_progress'}]};
      window.startTask = () => { disclosureState.clear(); conversation.messages = [{role:'user',text:'请求',task}]; renderChat(true); };
      window.completeTask = () => { task.status='succeeded'; conversation.messages.push({role:'assistant',text:'已完成',task}); renderChat(); };
      startTask();
    });
    await page.waitForTimeout(50); // Let native default-open toggle events fire.
    await page.evaluate(() => { renderChat(); completeTask(); });
    assert.equal(await page.locator('.execution-record[open]').count(),0);
    await page.evaluate(() => { task.status='running'; startTask(); });
    await page.locator('.step-details>summary').click();
    await page.locator('#chat-input').fill('完成时保留我的展开选择');
    await page.evaluate(() => completeTask());
    assert.equal(await page.locator('.execution-record[open] .step-details[open]').count(),1);
    assert.equal(await page.locator('#chat-input').evaluate(n=>n===document.activeElement),true);
    assert.equal(await page.locator('#chat-input').inputValue(),'完成时保留我的展开选择');
    await page.evaluate(() => {
      task.status='running'; startTask();
      task.events = Array.from({length:40},(_,i)=>({status:'tool_start',message:'阅读步骤 '+i,step_id:'read'}));
      renderChat();
    });
    await page.locator('.step-details>summary').click();
    await page.locator('.execution-record').evaluate(node=>{node.open=true;node.querySelector('.step-details').open=true;});
    await page.locator('#chat-input').focus();
    await page.waitForFunction(()=>{const log=document.getElementById('chat-log');return log.scrollHeight > log.clientHeight + 160;});
    await page.evaluate(() => { disclosureState.clear(); document.getElementById('chat-log').scrollTop = 80; });
    const scroll = await page.locator('#chat-log').evaluate(n=>n.scrollTop);
    await page.evaluate(() => completeTask());
    assert.equal(await page.locator('.execution-record[open]').count(),1);
    assert.ok(Math.abs(await page.locator('#chat-log').evaluate(n=>n.scrollTop)-scroll)<2);
    await page.evaluate(() => renderChat(true));
    assert.ok(await page.locator('#chat-log').evaluate(n=>n.scrollHeight-n.clientHeight-n.scrollTop<2));
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
    await figureDetails.first().locator('[data-action=citation]').click();
    await page.waitForFunction(()=>detail?.paper?.version_id==='paper-v1');
    assert.equal(await page.evaluate(()=>artifact.id),'a','original-source navigation preserves the open artifact');
    assert.equal(await page.locator('#version-select').inputValue(),'v2');
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
    console.log('PASS: Persistent Studio/resize/state, progress auto-collapse/user reading, scroll/focus/drafts, task controls, versions/list and multipart upload transport. Figure crops/source versions, multi-figure history, output type, and preserved workspace also verified. Mock API; not a backend integration check.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
