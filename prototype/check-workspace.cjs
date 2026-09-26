// Real frontend/editor with deterministic HTTP responses; no model calls or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'})});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960}});
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    const paper = {id:'paper',title:'测试论文',kind:'text',source_kind:'text',current_version_id:'pv',version_id:'pv',pages:[{page:1,width:600,height:800,text:'左栏原文。'.repeat(300),blocks:[{text:'左栏原文。'.repeat(300),rect:[0,0,600,800]}]}],page_count:1};
    const project = {id:'p',name:'三栏检查',papers:[paper],artifacts:[],conversations:[{id:'c',title:'对话',messages:[],reads:[]}],created:'2026-09-20',updated:'2026-09-20'};
    let document = null, failSave = false, sequence = 0;
    // 订阅视图走真实接口：这份有状态 fixture 按 subscriptions.js 实际读取的字段给（顶层 runs + strategy），
    // 让列表、设置表单、运行记录与导航缓存都能被检查，而不需要后端。
    const subscriptionState = {archived:false,
      subscriptions:[{id:'sub-1',name:'具身操作追踪',enabled:true,time:'08:00',next_run:'2026-09-24T08:00:00+08:00',
        remaining:3,requirements:'优先真实机器人',excluded:'纯仿真综述',
        strategy:{query:'embodied manipulation generalization',prompt:'研究通用的具身操作能力，优先真实机器人上的实验。',focus:'具身操作泛化'}}],
      runs:[{id:'task-1',subscription_id:'sub-1',created:'2026-09-20T08:00:00+08:00',automatic:true,operation:'run',
        status:'succeeded',count:1,error:null,warning:null,
        sources:[{source:'arxiv',status:'succeeded',count:8}],
        payload:{from_date:'2026-09-13',to_date:'2026-09-20',
          recommendation:{papers:[{candidate_id:'candidate-1',reason:'给出了真实机器人的泛化实验。'}]},
          candidates:[{id:'candidate-1',choice:'pending',first_published:'2026-09-15',discovered_at:'2026-09-20',
            preferred:{title:'泛化实验',url:'https://arxiv.org/abs/2609.00001',published:'2026-09-15T00:00:00Z',summary:'真实机器人上的泛化实验。'},
            versions:[],availability:{fulltext:'not_fetched'},subscriptions:['sub-1']}]}}]};
    const makeVersion = body => ({id:`v${++sequence}`,version_no:sequence,title:body.title,kind:'manuscript',payload:{document:body.document,author:'user',summary:'保存'},citations:[],created:'2026-09-20'});
    await page.route('https://workspace.test/**', async route => {
      const request = route.request(), url = new URL(request.url()).pathname;
      if (url === '/api/state') return route.fulfill({json:{projects:[project]}});
      if (url === '/api/projects/p') return route.fulfill({json:project});
      if (url === '/api/skills') return route.fulfill({json:[]});
      if (url === '/api/projects/p/sources/links') return route.fulfill({status:503,json:{error:'导入服务暂不可用'}});
      if (url === '/api/projects/p/sources/files') {
        assert.match(request.headers()['content-type'],/multipart\/form-data; boundary=/);
        assert.match(request.postDataBuffer().toString(),/sample.pdf/);
        return route.fulfill({json:{succeeded:1,failed:0,items:[{result:'ok',input:'sample.pdf',imported_as:'pdf'}]}});
      }
      if (url === '/api/projects/p/papers/paper') return route.fulfill({json:paper});
      if (url === '/api/projects/p/documents') {
        const body = request.postDataJSON();
        document = {id:'d',project_id:'p',title:body.title,kind:'manuscript',versions:[makeVersion(body)],proposals:[]};
        project.artifacts.push({id:'d',title:body.title,kind:'manuscript'});
        return route.fulfill({json:{artifact_id:'d'}});
      }
      if (url === '/api/projects/p/documents/d/versions/v1/layout') return route.fulfill({json:{blocks:[]}});
      if (url === '/api/projects/p/documents/d/save') {
        if (failSave) return route.fulfill({status:503,json:{error:'检查：保存暂不可用'}});
        const body = request.postDataJSON(), version = makeVersion(body);
        document.versions.push(version); document.title = body.title;
        project.artifacts[0].title = body.title;
        return route.fulfill({json:{version_id:version.id,version_no:version.version_no}});
      }
      if (url === '/api/projects/p/documents/d' || url === '/api/projects/p/artifacts/d') return route.fulfill({json:document});
      if (url === '/api/projects/p/artifacts/g') return route.fulfill({json:{id:'g',kind:'graph',versions:[{id:'g1',kind:'graph',title:'新图谱',version_no:1,payload:{filename:'graph.html'},citations:[]}]}});
      if (url.endsWith('/g/versions/g1/preview')) return route.fulfill({json:{content:'<h1>图谱预览</h1>'}});
      if (url.endsWith('/progress')) return route.fulfill({json:{today:'2026-09-20',days:[{day:'2026-09-20',date:'2026-09-20',end:'2026-09-20',kind:'daily',status:'ready',title:'研究日报样例',excerpt:'验收记录'}],deleted:[],settings:{enabled:false}}});
      if (url.endsWith('/progress/2026-09-20/read')) return route.fulfill({json:{ok:true}});
      if (url.endsWith('/progress/2026-09-20')) return route.fulfill({json:{versions:[{id:'daily-v1',version_no:1,title:'研究日报样例',body:'# 研究日报样例\n\n## 今天发生了什么\n\n验收记录',payload:{highlights:[]}}],events:[]}});
      if (url === '/api/projects/p/subscription') return route.fulfill({json:subscriptionState});
      if (url.startsWith('/api/projects/p/subscription/')) {
        const action = url.slice('/api/projects/p/subscription/'.length), body = request.postDataJSON();
        if (action === 'settings') {
          const target = subscriptionState.subscriptions.find(item => item.id === body.subscription_id);
          assert.ok(target, 'settings must address an existing subscription');
          const {subscription_id, ...patch} = body;
          Object.assign(target, patch);
        } else if (action === 'enable') {
          const target = subscriptionState.subscriptions.find(item => item.id === body.subscription_id);
          assert.ok(target, 'enable must address an existing subscription');
          target.enabled = true;
        } else if (action === 'run' || action === 'refresh') {
          assert.ok(subscriptionState.subscriptions.some(item => item.id === body.subscription_id), action + ' must address an existing subscription');
        } else if (action === 'choose') {
          const candidate = subscriptionState.runs.flatMap(run => run.payload?.candidates || []).find(item => item.id === body.candidate_id);
          assert.ok(candidate, 'choose must address a real candidate');
          candidate.choice = body.choice;
        }
        return route.fulfill({json:subscriptionState});
      }
      if (url.endsWith('/remote')) return route.fulfill({json:{servers:[],experiments:[{id:'experiment',name:'具体实验',status:'succeeded',created:'2026-09-20',results:[],spec:{server:{id:'server',name:'测试服务器'},connection:{username:'tester',host:'test',port:22},directory:'/test',command:'echo test'}}],probes:{}}});
      if (url === '/app.js') return route.fulfill({body:['app','literature','progress','subscriptions','skills','remote'].map(name=>fs.readFileSync(path.join(__dirname,name+'.js'),'utf8')).join('\n\n'),contentType:'text/javascript'});
      const file = path.resolve(__dirname,url === '/' ? 'index.html' : ['/writing.js','/writing.css'].includes(url) ? 'dist' + url : '.' + url);
      if (file.startsWith(__dirname + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return route.fulfill({body:fs.readFileSync(file),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)] || 'application/octet-stream'});
      }
      return route.fulfill({status:404,json:{error:'Missing fixture: '+url}});
    });
    await page.goto('https://workspace.test/');
    const checkHover = async selector => {
      const target = page.locator(selector).first();
      await target.scrollIntoViewIfNeeded();
      await page.mouse.move(0,0);
      await page.waitForTimeout(300);
      const appearance = () => target.evaluate(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return {background:style.backgroundColor,transform:style.transform,shadow:style.boxShadow,x:rect.x,y:rect.y,width:rect.width,height:rect.height};
      });
      const before = await appearance();
      await target.hover();
      await page.waitForTimeout(300); // Inspect the settled normal-motion state, not reduced-motion overrides.
      const after = await appearance();
      assert.notEqual(after.background,before.background,`${selector}: hover changes background`);
      assert.deepEqual({...after,background:null},{...before,background:null},`${selector}: no hover shadow, movement or scale`);
      await page.mouse.move(0,0);
    };
    await checkHover('.nb-card');
    await checkHover('.home-menu>summary');
    await checkHover('.home .search-field');
    // Theme contract: real computed styles catch hard-coded old surfaces and focus overrides.
    const css = (selector, property) => page.locator(selector).first().evaluate((node, key) => getComputedStyle(node)[key], property);
    assert.equal(await css('body', 'backgroundColor'), 'rgb(245, 247, 251)');
    assert.equal(await css('.nb-card', 'backgroundColor'), 'rgb(255, 255, 255)');
    assert.equal(await css('.nb-card', 'boxShadow'), 'none');
    await page.locator('[data-action=open-project]').click();
    for (const selector of ['.workspace-create','.shell-nav button.active','.shell-nav button:not(.active)','.conversation-row.active','.chip']) await checkHover(selector);
    assert.equal(await page.locator('.workspace-create').evaluate(n=>n.getBoundingClientRect().height),26);
    assert.equal(await page.locator('.workspace-avatar').evaluate(n=>n.getBoundingClientRect().width),24);
    assert.equal(await page.locator('.brandmark img').evaluate(n=>n.complete && n.naturalWidth>0),true);
    assert.equal(await css('.panels', 'backgroundColor'), 'rgb(255, 255, 255)');
    assert.equal(await css('.conversation-row.active', 'backgroundColor'), 'rgb(237, 243, 255)');
    await page.keyboard.press('Tab');
    await page.locator('.shell-nav button').first().focus();
    assert.equal(await css('.shell-nav button', 'outlineStyle'), 'solid');
    assert.equal(await css('.shell-nav button', 'outlineColor'), 'rgb(36, 107, 219)');
    await page.locator('#chat-input').fill('对话草稿保持');
    assert.equal(await page.locator('.shell-nav button').count(),5);
    await page.waitForFunction(() => Boolean(window.MethodAtlasWriting));
    await page.locator('[data-action=new-document]').click();
    await page.getByLabel('文档标题',{exact:true}).fill('我的笔记').catch(async error=>{console.error(await page.locator('body').innerText());throw error;});
    await checkHover('.writing-menu>summary');
    // 这个面板里的编辑工具栏是刻意隐藏的（writing.css 的 .writing-toolbar{display:none!important}），
    // 所以只在它可见时检查 hover 反馈，不然这条断言会等一个永远不会出现的元素。
    if (await page.locator('.writing-toolbar button:visible:not(:disabled)').count()) await checkHover('.writing-toolbar button:visible:not(:disabled)');
    await page.locator('#output-body [contenteditable=true]').fill('正文必须保留');
    assert.equal(await page.locator('#output-panel .breadcrumb-back').innerText(),'成果');
    await page.evaluate(() => { window.shell = document.querySelector('.workspace'); window.editorNode = document.querySelector('[contenteditable=true]'); window.form = document.getElementById('chat-form'); });
    const toggle = id => page.locator(`#${id} [data-action=toggle-panel]`).click();
    const tab = id => page.locator(`#tab-${id}`).click();
    await page.locator('[data-action=shell][data-value=chat]').click();
    await toggle('sources-panel'); await toggle('output-panel');
    for (const id of ['sources-panel','output-panel']) {
      assert.equal(await page.locator('#'+id).evaluate(node=>node.getBoundingClientRect().width),48,'collapsed side is an icon column');
      assert.equal(await page.locator(`#${id} [data-action=toggle-panel]`).getAttribute('aria-expanded'),'false');
    }
    await page.locator('#sources-panel .panel-rail button').first().focus();
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.locator('#sources-panel .panel-rail button').first().evaluate(n=>n===document.activeElement),true,'background refresh preserves rail focus');
    const screenshots = path.resolve(__dirname,'../output/playwright'); fs.mkdirSync(screenshots,{recursive:true});
    await page.screenshot({path:path.join(screenshots,'responsive-collapsed.png')});
    for (const width of [1080,800,390,320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.locator('.panel-tabs').isVisible(),true);
      assert.equal(await page.getByRole('button',{name:'新建项目',exact:true}).isVisible(),true,'icon-only action remains named');
      assert.equal(await page.locator('#chat-panel').isVisible(),true,'conversation is the initial narrow tab');
      for (const id of ['sources-panel','output-panel','chat-panel']) {
        await tab(id);
        assert.equal(await page.locator('.panels>.panel:visible').count(),1,'one panel at a time');
        assert.equal(await page.locator('#'+id).isVisible(),true);
        assert.equal(await page.locator('.panel-toggle:visible,.panel-rail:visible').count(),0,'no collapsed strips in tab mode');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow at ${width} in ${id}`);
        assert.ok(await page.locator('.shell-nav').evaluate(n=>n.getBoundingClientRect().height>300),'navigation stays vertical');
      }
      assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    }
    await page.getByRole('tab',{name:'对话',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab',{name:'成果',exact:true}).getAttribute('aria-selected'),'true');
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab',{name:'对话列表',exact:true}).getAttribute('aria-selected'),'true');
    await tab('output-panel');
    assert.equal(await page.evaluate(()=>editorNode===document.querySelector('[contenteditable=true]')),true,'tabs keep the same live editor');
    await page.screenshot({path:path.join(screenshots,'responsive-phone-output.png')});
    await page.setViewportSize({width:1440,height:960});
    assert.equal(await page.locator('.panel-collapsed').count(),2,'desktop collapse choices survive resizing');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#output-panel').isVisible(),true,'resizing remembers the selected tab');
    await page.setViewportSize({width:1440,height:960});
    await toggle('sources-panel');
    await page.locator('#output-panel .panel-rail button').first().click();
    assert.equal(await page.locator('#output-panel').getAttribute('class'),'panel panel-active','rail item reveals its panel');
    await page.screenshot({path:path.join(screenshots,'responsive-desktop.png')});
    const nav = key => page.locator(`[data-action=shell][data-value=${key}]`).click();
    for (const key of ['library','progress','remote','subscriptions','chat']) {
      await nav(key);
      await page.locator('#source-body').waitFor();
      assert.equal(await page.evaluate(() => shell === document.querySelector('.workspace') && editorNode === document.querySelector('[contenteditable=true]')),true,`persistent shell/editor in ${key}`);
      assert.ok(await page.locator('#output-panel').evaluate(node=>node.getBoundingClientRect().width)>220);
      // The navigation drives the middle as well: a view with a middle of its own shows it, and the
      // library falls back to the conversation. Leaving the conversation and coming back keeps the
      // same chat form, so drafts survive the round trip.
      const middle = ['library','chat'].includes(key) ? 'chat' : key;
      await page.waitForFunction(expected => middleView === expected,middle);
      assert.equal(await page.evaluate(() => Boolean(document.getElementById('chat-form'))),middle === 'chat',`middle content for navigation ${key}`);
      if (middle === 'chat') assert.equal(await page.evaluate(() => form === document.getElementById('chat-form')),true,'the conversation keeps its form');
    }
    assert.equal(await page.evaluate(() => form === document.getElementById('chat-form')),true);
    assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    await nav('library');
    await page.locator('[data-action=paper]').click();
    await page.locator('#sources-panel .reader-shell').waitFor();
    assert.equal(await page.locator('.reader-toolbar [data-action=retry-source],.reader-toolbar [data-action=supplement-source],.reader-toolbar [data-action=reader-responsive],.reader-toolbar [data-action=reader-original],.reader-toolbar .reader-zoom').count(),0);
    assert.equal(await page.locator('.reader-toolbar [data-action=reader-fullscreen]').count(),1,'reader can enter full screen');
    assert.ok(await page.locator('.reader-toolbar').evaluate(node=>node.getBoundingClientRect().height)<=40,'reader toolbar stays compact');
    assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    assert.equal(await page.locator('#chat-panel .reader-shell').count(),0);
    await page.evaluate(()=>{window.readerNode=document.querySelector('.reader-shell');});
    await nav('remote'); await nav('library');
    assert.equal(await page.evaluate(()=>readerNode===document.querySelector('.reader-shell')),true,'left reader survives navigation');
    const leftWidth = await page.locator('#sources-panel').evaluate(node=>node.getBoundingClientRect().width);
    assert.equal(await page.locator('[data-action=expand-panel],.panel-expand').count(),0,'no panel expand controls remain');
    assert.equal(await page.locator('.panels').evaluate(node=>node.dataset.expanded||''),'','panels stay unexpanded');
    assert.ok(leftWidth>180,'left column keeps a usable width');
    assert.ok(await page.locator('#output-panel').evaluate(node=>node.getBoundingClientRect().width)>=220);
    await page.locator('#sources-panel .breadcrumb-back').click();
    await page.locator('#source-body [data-action=paper]').waitFor();
    await page.locator('[data-action=add-source]').click();
    assert.equal(await page.evaluate(() => shell === document.querySelector('.workspace') && editorNode === document.querySelector('[contenteditable=true]')),true,'source import stays inside shell');
    const sourceDialog = page.getByRole('dialog',{name:'添加来源',exact:true});
    await sourceDialog.waitFor();
    assert.equal(await css('#add-source-dialog', 'backgroundColor'), 'rgb(255, 255, 255)');
    assert.equal(await css('#add-source-dialog', 'borderRadius'), '16px');
    if (process.env.PREVIEW_IMAGE) await sourceDialog.screenshot({path:process.env.PREVIEW_IMAGE});
    assert.equal(await page.evaluate(() => form === document.getElementById('chat-form')),true,'import dialog cannot replace middle');
    await sourceDialog.getByRole('button',{name:'论文链接',exact:true}).click();
    await sourceDialog.locator('[name=links]').fill('https://arxiv.org/abs/2601.00001');
    await sourceDialog.getByRole('button',{name:'复制文字',exact:true}).click();
    assert.equal(await sourceDialog.locator('#link-source-form').isVisible(),false);
    await sourceDialog.locator('[name=title]').fill('导入测试文字');
    await sourceDialog.locator('[name=text]').fill('原文内容');
    await sourceDialog.getByRole('button',{name:'论文链接',exact:true}).click();
    assert.equal(await sourceDialog.locator('[name=links]').inputValue(),'https://arxiv.org/abs/2601.00001');
    await sourceDialog.getByRole('button',{name:'导入链接',exact:true}).click();
    await sourceDialog.getByText('论文链接 · 导入服务暂不可用',{exact:true}).waitFor();
    assert.equal(await sourceDialog.locator('[name=links]').inputValue(),'https://arxiv.org/abs/2601.00001','failure preserves inputs');
    await sourceDialog.getByRole('button',{name:'上传文件',exact:true}).click();
    await sourceDialog.locator('#pdf-files').setInputFiles({name:'sample.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});
    await sourceDialog.getByText('已导入 PDF',{exact:true}).waitFor();
    await sourceDialog.getByRole('button',{name:'关闭添加来源'}).click();
    assert.equal(await sourceDialog.isVisible(),false);
    await page.waitForFunction(()=>document.activeElement?.dataset.action==='add-source');
    assert.equal(await page.locator('[data-action=add-source]').evaluate(node=>node===document.activeElement),true,'close restores focus');
    assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    await page.locator('[data-action=add-source]').click();
    await sourceDialog.getByRole('button',{name:'复制文字',exact:true}).click();
    assert.equal(await sourceDialog.locator('[name=text]').inputValue(),'原文内容');
    await page.keyboard.press('Escape');
    assert.equal(await sourceDialog.isVisible(),false);
    await nav('remote');
    await page.locator('[data-experiment=experiment]').click();
    await page.locator('#chat-panel .task-detail').waitFor();
    assert.equal(await css('.state-chip[data-state=succeeded]', 'backgroundColor'), 'rgb(255, 255, 255)');
    assert.equal(await css('.state-chip[data-state=succeeded]', 'color'), 'rgb(38, 132, 79)');
    await page.locator('[data-result-form] input').fill('结果路径草稿');
    await page.locator('#chat-panel [data-action=back-chat]').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    // Navigation hands the middle to the view being entered; the middle the view left behind is cached
    // and comes back untouched, draft text included.
    await nav('library');
    assert.equal(await page.locator('#chat-panel .task-detail').count(),0,'library takes the middle');
    await nav('remote');
    assert.equal(await page.locator('[data-result-form] input').inputValue(),'结果路径草稿','the cached middle keeps its draft');
    await nav('subscriptions');
    await page.locator('[data-sub-row]').first().click();
    const subName = '#subscription-settings input[name=name]';
    await page.locator(subName).fill('订阅名称草稿');
    await nav('chat');
    assert.equal(await page.locator(subName).count(),0,'the conversation takes the middle');
    await nav('subscriptions');
    assert.equal(await page.locator(subName).inputValue(),'订阅名称草稿','the cached middle keeps its draft');
    await nav('progress');
    await page.locator('[data-memory-day]').first().click();
    await page.locator('.diary-document').waitFor();
    await page.locator('#chat-tools [data-diary=menu]').click();
    await page.locator('dialog [data-diary=edit]').click();
    await page.locator('#daily-content').fill('日报未保存的正文');
    await toggle('sources-panel');
    assert.equal(await page.locator('#sources-panel .panel-rail button').count(),1,'diary timeline survives as collapsed shortcuts');
    await toggle('sources-panel');
    await nav('chat'); await nav('progress');
    assert.equal(await page.locator('#daily-content').inputValue(),'日报未保存的正文');
    // New outputs must not take over an open editor, including polling completion.
    project.artifacts.push({id:'g',kind:'graph',title:'新图谱'});
    await page.evaluate(() => refreshTask(null,viewGeneration,current.id,conversation.id));
    assert.equal(await page.evaluate(() => editorNode === document.querySelector('[contenteditable=true]')),true);
    failSave = true;
    await page.getByLabel('文档标题',{exact:true}).fill('失败后仍保留');
    await page.getByRole('button',{name:'关闭成果，返回列表',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'保存暂不可用'}).waitFor();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'失败后仍保留');
    failSave = false;
    await page.getByRole('button',{name:'关闭成果，返回列表',exact:true}).click();
    await page.locator('#output-body [data-action=file][data-id=d]').waitFor();
    assert.equal(document.title,'失败后仍保留');
    assert.equal(document.versions.at(-1).payload.document[0].children[0].text,'正文必须保留');
    assert.equal(await page.locator('#daily-content').inputValue(),'日报未保存的正文','closing editor leaves middle intact');
    await page.locator('#output-body [data-action=file][data-id=g]').click();
    await page.locator('#html-preview').waitFor();
    await nav('library');
    assert.equal(await page.locator('#html-preview').count(),1);
    await page.getByRole('button',{name:'关闭成果，返回列表',exact:true}).click();
    await page.locator('#output-body [data-action=file][data-id=d]').click();
    await page.getByLabel('文档标题',{exact:true}).waitFor();
    await page.reload();
    await page.getByLabel('文档标题',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'失败后仍保留');
    assert.equal(await page.locator('.shell-nav [aria-current=page]').getAttribute('data-value'),'library');
    await nav('chat');
    await page.locator('#chat-input').waitFor();
    assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    await page.getByRole('button',{name:'管理 / 保存技能',exact:true}).click();
    await page.locator('.skills-dialog[open]').waitFor();
    await page.getByRole('button',{name:'关闭技能管理',exact:true}).click();
    assert.equal(await page.locator('#output-body [contenteditable=true]').count(),1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'mobile chrome fits the viewport');
    await page.locator('[data-action=shell][data-value=library]').click();
    await tab('sources-panel');
    await page.locator('[data-action=paper]').click();
    await page.locator('#sources-panel .reader-shell').waitFor();
    assert.equal(await page.locator('.reader-shell').count(),1,'narrow reader remains available');
    assert.equal(await page.locator('[data-action=reader-fullscreen]').count(),1,'reader can enter full screen on narrow screens');
    await page.locator('.reader-body').evaluate(node=>{node.scrollTop=180;});
    const readerScroll = await page.locator('.reader-body').evaluate(node=>node.scrollTop);
    assert.ok(readerScroll>0,'reader fixture can scroll');
    await tab('chat-panel');
    assert.equal(await page.locator('#chat-input').inputValue(),'对话草稿保持');
    await tab('sources-panel');
    assert.equal(await page.locator('.reader-body').evaluate(node=>node.scrollTop),readerScroll,'tab changes preserve reading position');
    assert.equal(await page.locator('.reader-shell').isVisible(),true,'tab restores the reader');
    await page.screenshot({path:path.join(screenshots,'responsive-phone-reader.png')});
    assert.equal(await page.locator('#output-body [contenteditable=true]').count(),1,'tabs preserve the editor');
    assert.deepEqual(errors,[]);
    console.log('PASS: persistent three-column shell/editor, navigation drafts, inline import, new-output isolation, save failure/retry, close/list/reopen, refresh recovery and skills dialog.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
