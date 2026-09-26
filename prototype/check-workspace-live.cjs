// Isolated real backend + browser: create, save, close, reopen and reload a document.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname,'..'), data = fs.mkdtempSync(path.join(os.tmpdir(),'methodatlas-workspace-'));
  const server = spawn(process.env.PYTHON || path.join(root,'.venv/bin/python'),['-m','backend.app','--port','0','--data-dir',data,'--pdf-dir',path.join(data,'no-papers')],{cwd:root,env:{...process.env,DEEPSEEK_API_KEY:''}});
  let browser, log = '';
  try {
    const base = await new Promise((resolve,reject) => {
      const timeout = setTimeout(()=>reject(Error('Backend startup timeout: '+log)),30000);
      server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/MethodAtlas: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
      server.stderr.on('data',chunk=>{log+=chunk;});
      server.on('error',error=>{clearTimeout(timeout);reject(error);});
      server.on('exit',code=>{clearTimeout(timeout);reject(Error(`Backend exited ${code}: ${log}`));});
    });
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'})});
    const page = await browser.newPage({viewport:{width:1440,height:960}}), errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    await page.locator('[data-action=open-project]').click();
    await page.locator('#chat-input').fill('真实后端未发送草稿');
    await page.locator('[data-action=new-document]').click();
    await page.getByLabel('文档标题',{exact:true}).fill('三栏真实保存检查');
    await page.locator('#output-body [contenteditable=true]').fill('这段内容由真实文档接口保存。');
    await page.locator('[data-action=shell][data-value=library]').click();
    await page.locator('[data-action=add-source]').click();
    const sourceDialog = page.getByRole('dialog',{name:'添加来源',exact:true});
    await sourceDialog.getByRole('button',{name:'复制文字',exact:true}).click();
    await sourceDialog.locator('[name=title]').fill('真实导入文字');
    await sourceDialog.locator('[name=text]').fill('这是通过弹窗保存的真实来源。');
    await sourceDialog.getByRole('button',{name:'保存文字',exact:true}).click();
    await sourceDialog.locator('.source-result[data-result=ok]').waitFor();
    assert.equal(await sourceDialog.isVisible(),true,'successful import keeps the dialog open');
    assert.match(await page.locator('#paper-list').innerText(),/真实导入文字/);
    await sourceDialog.getByRole('button',{name:'关闭添加来源'}).click();
    assert.equal(await page.locator('#chat-input').inputValue(),'真实后端未发送草稿');
    assert.match(await page.locator('#output-body [contenteditable=true]').innerText(),/真实文档接口保存/);
    await page.getByRole('button',{name:'关闭成果，返回列表',exact:true}).click();
    const file = page.locator('#output-body [data-action=file]').filter({hasText:'三栏真实保存检查'});
    await file.click();
    assert.match(await page.locator('#output-body [contenteditable=true]').innerText(),/真实文档接口保存/);
    await page.reload();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'三栏真实保存检查');
    assert.equal(await page.locator('.shell-nav [aria-current=page]').getAttribute('data-value'),'library');
    await page.locator('[data-action=shell][data-value=chat]').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'真实后端未发送草稿');
    await page.locator('[data-action=new-chat]').click();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'三栏真实保存检查','new conversation keeps the open document');
    await page.getByRole('button',{name:'返回项目列表',exact:true}).click();
    await page.locator('[data-action=open-project]').click();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'三栏真实保存检查');
    assert.deepEqual(errors,[]);
    assert.equal(await page.getByRole('button',{name:'分享（暂未开放）'}).isDisabled(),true);
    await page.getByRole('img',{name:'用户头像（占位）'}).waitFor();
    await page.locator('.workspace-actions [data-action=new-project]').click();
    await page.getByLabel('项目名称',{exact:true}).fill('顶部栏创建的项目');
    await page.getByRole('button',{name:'创建项目',exact:true}).click();
    await page.locator('.project-title').filter({hasText:'顶部栏创建的项目'}).waitFor();
    await page.reload();
    assert.equal(await page.locator('.project-title').innerText(),'顶部栏创建的项目','header creates a persisted backend project');
    if (process.env.HEADER_PREVIEW) await page.locator('.workspace .app-header').screenshot({path:process.env.HEADER_PREVIEW});
    console.log('PASS: real backend save/reopen/reload, conversation switch and project return. Isolated data: '+data);
  } finally { if(browser)await browser.close(); server.kill(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
