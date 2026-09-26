// Real DOM interactions with deterministic task responses; no model calls or user data.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'})});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const task = {id:'t',status:'running',plan:[],tools:[],events:[],refs:{},waits:[],files:[],failures:[],citations:[],snapshot:[]};
    const oldTask = {...task,id:'old',status:'succeeded'};
    const chat = {id:'c',title:'动效',updated:'2026-09-21T15:00:00Z',messages:[],reads:[]};
    const other = {id:'other',title:'完善论文每日订阅设计',updated:chat.updated,messages:[{id:'old-user',role:'user',text:'之前的问题',task:oldTask},{id:'old-answer',role:'assistant',text:'已保存的回答。',task:oldTask}],reads:[]};
    const project = {id:'p',name:'聊天细节检查',papers:[],artifacts:[],conversations:[chat,other],created:chat.updated,updated:chat.updated};
    let requests = 0, posts = 0;
    await page.route('https://motion.test/**', async route => {
      const url = new URL(route.request().url()).pathname;
      if (url === '/api/state') return route.fulfill({json:{projects:[project]}});
      if (url === '/api/skills') return route.fulfill({json:[]});
      if (url === '/api/projects/p') { requests++; return route.fulfill({json:project}); }
      if (url.endsWith('/messages')) {
        posts++;
        chat.messages.push({id:'u',role:'user',text:route.request().postDataJSON().text,task});
        return route.fulfill({json:{task_id:'t'}});
      }
      if (url.startsWith('/api/')) return route.fulfill({json:{}});
      const file = path.join(__dirname,url === '/' ? 'index.html' : url);
      return fs.existsSync(file) ? route.fulfill({path:file}) : route.fulfill({status:404,body:''});
    });
    await page.goto('https://motion.test/');
    await page.locator('[data-action=open-project]').click();
    assert.equal(await page.locator('.conversation-row small').count(),0,'conversation times are removed');
    assert.equal(await page.locator('.conversation-row').first().evaluate(node => node.getBoundingClientRect().height),36,'conversation is one compact row');
    const input = page.locator('#chat-input');
    const small = await input.evaluate(node => node.getBoundingClientRect().height);
    assert.equal(small,40,'empty input is compact');
    await input.fill('第一行\n第二行\n第三行\n第四行');
    assert.ok(await input.evaluate(node => node.getBoundingClientRect().height) > small,'input grows with content');
    await input.fill('请梳理这篇论文的方法');
    const send = page.locator('.send-button');
    await send.hover(); await page.mouse.down();
    assert.equal(await send.evaluate(node => getComputedStyle(node).transform),'none','send never scales');
    await page.mouse.up();
    await page.locator('.conversation-row[data-id=c] [data-state=running]').waitFor();
    assert.equal(posts,1);
    const ring = page.locator('.conversation-row[data-id=c] .task-marker');
    assert.equal(await ring.evaluate(node => getComputedStyle(node,'::before').animationName),'status-spin');
    const first = await ring.evaluate(node => getComputedStyle(node,'::before').transform);
    await page.waitForTimeout(180);
    assert.notEqual(await ring.evaluate(node => getComputedStyle(node,'::before').transform),first,'ring really rotates');
    assert.equal(await page.locator('#chat-log .task-marker[data-state=running]').count(),1);
    // A different conversation stays current while the first finishes in the background.
    await page.locator('.conversation-row[data-id=other]').click();
    const beforePoll = requests;
    task.status = 'succeeded';
    const answer = '完整回答，不需要等待逐字播放。\n'.repeat(70);
    chat.messages.push({id:'a',role:'assistant',text:answer,task});
    project.artifacts.push({id:'result',title:'方法梳理',kind:'research'});
    await page.locator('.conversation-row[data-id=c] [data-state=succeeded]').waitFor();
    assert.ok(requests>beforePoll,'background task refreshes');
    assert.equal(await page.locator('.conversation-row.active').getAttribute('data-id'),'other');
    assert.equal(await page.locator('.artifact-fresh').count(),1,'new result is highlighted once');
    assert.equal(await ring.evaluate(node => getComputedStyle(node,'::before').animationName),'none','completed dot is still');
    await page.locator('.conversation-row[data-id=c]').click();
    assert.equal(await page.locator('[data-answer=a]').innerText(),answer);
    assert.equal(await page.locator('.message-enter').count(),0,'opening history does not replay entrances');
    assert.equal(await ring.getAttribute('data-state'),'idle','entering consumes the unread dot');
    await page.locator('.conversation-row[data-id=other]').click();
    assert.equal(await ring.getAttribute('data-state'),'idle','leaving does not restore a read dot');
    await page.reload();
    await page.locator('.conversation-row[data-id=c] [data-state=idle]').waitFor();
    await page.locator('.conversation-row[data-id=c]').click();
    const copy = page.locator('[data-action=copy-answer][data-id=a]');
    await copy.click();
    await page.getByRole('button',{name:'已复制',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),answer);
    assert.equal(await copy.locator('svg path').getAttribute('d'),'m5 12 4 4L19 6');
    await page.waitForTimeout(1900);
    assert.equal(await copy.getAttribute('aria-label'),'复制回答');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
    await copy.click();
    await page.getByText('复制失败，请选择回答文字后复制。',{exact:true}).waitFor();
    assert.equal(await copy.getAttribute('aria-label'),'复制回答','failure must not show a check');
    // A new task can produce a new reminder even after the previous reply was read.
    task.id = 'second-task'; task.status = 'running';
    await page.reload();
    await page.locator('.conversation-row[data-id=c] [data-state=running]').waitFor();
    await page.locator('.conversation-row[data-id=other]').click();
    task.status = 'succeeded';
    await page.locator('.conversation-row[data-id=c] [data-state=succeeded]').waitFor();
    await page.locator('.conversation-row[data-id=c]').click();
    await page.locator('.conversation-row[data-id=c] [data-state=idle]').waitFor();
    assert.equal(await ring.getAttribute('data-state'),'idle','a new reminder also clears on entry');
    // Reload each genuine backend state; only successful completion may show a blue dot.
    for (const state of ['waiting','failed','interrupted','stopped','queued','running']) {
      task.status = state;
      await page.reload();
      await page.locator(`.conversation-row[data-id=c] [data-state=${state}]`).waitFor();
      const animation = await ring.evaluate(node => getComputedStyle(node,'::before').animationName);
      assert.equal(animation,state === 'running' ? 'status-spin' : 'none',state);
    }
    // User scrolls up while a new answer arrives: position must stay where they were reading.
    const log = page.locator('#chat-log');
    await log.hover(); await page.mouse.wheel(0,-10000);
    await page.waitForTimeout(200);
    const top = await log.evaluate(node => node.scrollTop);
    assert.ok(top < 10);
    chat.messages.push({id:'next',role:'assistant',text:'新回答已到达。',task});
    task.id = 'next-task';
    task.status = 'succeeded';
    await page.locator('[data-answer=next]').waitFor();
    assert.equal(await ring.getAttribute('data-state'),'idle','completion while viewing needs no unread reminder');
    assert.ok(Math.abs(await log.evaluate(node => node.scrollTop)-top)<2,'new answer does not steal scroll');
    assert.equal(await page.locator('[data-message-id=next]').evaluate(node => getComputedStyle(node).animationName),'message-enter');
    // A real disclosure click uses the existing native expand/collapse transition.
    task.plan = [{id:'step',title:'梳理方法',status:'completed',summary:'已核对'}];
    task.status = 'running';
    await page.reload();
    await page.locator('.execution-record').first().waitFor();
    const disclosure = page.locator('.execution-record').first();
    await disclosure.locator('summary').first().click();
    assert.equal(await disclosure.getAttribute('open'),null);
    await disclosure.locator('summary').first().click();
    assert.notEqual(await disclosure.getAttribute('open'),null);
    const screenshot = process.env.MOTION_SCREENSHOT;
    if (screenshot) await page.screenshot({path:screenshot,fullPage:true});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await ring.evaluate(node => getComputedStyle(node,'::before').animationName),'none');
    assert.equal(await page.locator('[data-answer=a]').isVisible(),true);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'no mobile horizontal overflow');
    assert.deepEqual(errors,[]);
    console.log('PASS: submit without scale; compact/growing input; live and background statuses; full answers; clipboard success/failure; scroll retention; disclosures; new-result highlight; reduced motion; mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
