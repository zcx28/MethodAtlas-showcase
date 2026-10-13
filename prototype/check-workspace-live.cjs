// Isolated real backend + browser: create, save, close, reopen and reload a document.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn,execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const stopServer = require('./check-server.cjs');

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
    await page.locator('.app-header [data-panel=output-panel]').click();
    await page.locator('[data-action=new-document]').click();
    const initialSave=page.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='POST');
    await page.getByLabel('文档标题',{exact:true}).fill('三栏真实保存检查');
    await page.locator('#output-body [contenteditable=true]').fill('这段内容由真实文档接口保存。');
    const documentUrl=(await initialSave).url().replace(/\/draft$/,'');
    await page.waitForFunction(()=>document.querySelector('.writing-status')?.textContent==='已自动保存草稿');
    await page.getByLabel('更多操作').click();await page.getByRole('button',{name:'存档',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.writing-status')?.textContent.startsWith('已存档'));
    const archived=await (await fetch(documentUrl)).json(),restoreFrom=archived.versions.at(-1).id;
    await page.locator('[data-action=shell][data-value=library]').click();
    await page.locator('.app-header [data-panel=sources-panel]').click();
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
    await page.locator('[data-action=shell][data-value=chat]').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'真实后端未发送草稿');
    await page.locator('[data-action=shell][data-value=library]').click();
    assert.match(await page.locator('#output-body [contenteditable=true]').innerText(),/真实文档接口保存/);
    await page.getByRole('button',{name:'关闭成果，返回列表',exact:true}).click();
    const file = page.locator('#output-body [data-action=file]').filter({hasText:'三栏真实保存检查'});
    await file.click();
    assert.match(await page.locator('#output-body [contenteditable=true]').innerText(),/真实文档接口保存/);
    await page.reload();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'三栏真实保存检查');
    assert.equal(await page.locator('.shell-nav [aria-current=page]').getAttribute('data-value'),'library');
    // Autosave changes only the draft; explicit confirmed restore preserves every archive.
    const savedResponse=page.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='POST');
    await page.locator('#output-body [contenteditable=true]').fill('这是一份用于检查恢复的后续版本。');
    await savedResponse;
    await page.waitForFunction(()=>document.querySelector('.writing-status')?.textContent==='已自动保存草稿');
    const beforeRestore=await (await fetch(documentUrl)).json();
    assert.deepEqual(beforeRestore.versions,archived.versions,'autosave does not create an archive');
    await page.locator('#version-select').selectOption(restoreFrom,{force:true});
    const restoreResponse=page.waitForResponse(r=>r.url().endsWith('/restore')&&r.request().method()==='POST');
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'恢复到当前草稿',exact:true}).click();await restoreResponse;
    await page.locator('.writing-readonly').waitFor({state:'detached'});
    assert.equal(await page.locator('#output-body [contenteditable=true]').innerText(),'这段内容由真实文档接口保存。');
    const afterRestore=await (await fetch(documentUrl)).json();
    assert.deepEqual(afterRestore.versions,beforeRestore.versions);
    assert.deepEqual(afterRestore.draft.payload.document,beforeRestore.versions.find(v=>v.id===restoreFrom).payload.document);
    // Browser download events and saved bytes, not just a successful export API response.
    for (const format of ['HTML','基础 PDF','DOCX']) {
      const button = page.getByRole('button',{name:format==='基础 PDF'?'导出基础 PDF':`导出 ${format}`,exact:true});
      if (!await button.isVisible()) await page.getByLabel('更多操作').click();
      const [download] = await Promise.all([
        page.waitForEvent('download').catch(async error=>{throw Error(`${format} download failed: ${await page.locator('.writing-error').allTextContents()}; ${log}; ${error.message}`);}),
        button.click()
      ]);
      assert.equal(await download.failure(),null);
      const saved = await download.path();
      assert.ok(saved && fs.statSync(saved).size > 100);
      console.log(`Downloaded ${format}: ${fs.statSync(saved).size} bytes`);
      execFileSync(process.env.PYTHON || path.join(root,'.venv/bin/python'),['-c',`
import sys, zipfile
from pathlib import Path
import pymupdf
path, kind = sys.argv[1:]
if kind == 'DOCX':
    with zipfile.ZipFile(path) as archive:
        content = archive.read('word/document.xml').decode('utf-8')
elif kind == '基础 PDF':
    with pymupdf.open(path) as document:
        content = ''.join(page.get_text() for page in document)
else:
    content = Path(path).read_text(encoding='utf-8')
assert '这段内容由真实文档接口保存。' in content, repr(content[:1000])
`,saved,format],{env:{...process.env,PYTHONUTF8:'1'}});
    }
    await page.locator('[data-action=shell][data-value=chat]').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'真实后端未发送草稿');
    const projectUrl=documentUrl.replace(/\/documents\/[^/]+$/,'');
    const beforeChats=(await (await fetch(projectUrl)).json()).conversations.length;
    await page.route('**/conversations',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'创建对话失败，请重试。'}}):route.continue());
    await page.locator('[data-action=new-chat]').click();await page.getByText('创建对话失败，请重试。',{exact:true}).waitFor();
    assert.equal(await page.locator('#chat-input').inputValue(),'真实后端未发送草稿');
    assert.equal((await (await fetch(projectUrl)).json()).conversations.length,beforeChats);
    await page.unroute('**/conversations');
    let releaseChat,chatStarted,chatRequests=0;const chatGate=new Promise(r=>releaseChat=r),chatReady=new Promise(r=>chatStarted=r);
    await page.route('**/conversations',async route=>{if(route.request().method()!=='POST')return route.continue();chatRequests++;chatStarted();await chatGate;await route.continue();});
    await page.locator('[data-action=new-chat]').click();await chatReady;await page.locator('[data-action=new-chat]').click();
    const chatRefresh=page.waitForResponse(r=>r.url().split('?')[0]===projectUrl&&r.request().method()==='GET');releaseChat();await chatRefresh;
    assert.equal(chatRequests,1,'double-click created two conversation requests');
    assert.equal((await (await fetch(projectUrl)).json()).conversations.length,beforeChats+1);
    await page.unroute('**/conversations');
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'三栏真实保存检查','new conversation keeps the open document');
    await page.getByRole('button',{name:'项目首页',exact:true}).click();
    await page.locator('[data-action=open-project]').click();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'三栏真实保存检查');
    assert.deepEqual(errors,[]);
    assert.equal(await page.locator('.workspace-share').isDisabled(),true);
    assert.equal(await page.locator('.workspace-avatar').getAttribute('aria-label'),'用户头像（占位）');
    await page.locator('.workspace-actions [data-action=new-project]').click();
    await page.getByLabel('项目名称',{exact:true}).fill('后台完成的旧项目');
    let releaseProject,projectStarted;const projectGate=new Promise(r=>releaseProject=r),projectReady=new Promise(r=>projectStarted=r);
    await page.route('**/api/projects',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();projectStarted();await projectGate;await route.fulfill({response});});
    await page.getByRole('button',{name:'创建项目',exact:true}).click();await projectReady;
    await page.getByRole('button',{name:'关闭新建项目',exact:true}).click();await page.locator('.workspace-actions [data-action=new-project]').click();
    await page.getByLabel('项目名称',{exact:true}).fill('顶部栏创建的项目');
    const projectSaved=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');releaseProject();await projectSaved;await page.waitForTimeout(300);
    assert(await page.locator('#project-dialog').isVisible(),'old project save closed the new dialog');
    assert.equal(await page.getByLabel('项目名称',{exact:true}).inputValue(),'顶部栏创建的项目');
    await page.unroute('**/api/projects');
    await page.route('**/api/projects',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'创建失败，请重试。'}}):route.continue());
    await page.getByRole('button',{name:'创建项目',exact:true}).click();await page.locator('#project-error').filter({hasText:'创建失败，请重试。'}).waitFor();
    assert.equal(await page.getByLabel('项目名称',{exact:true}).inputValue(),'顶部栏创建的项目');
    assert(await page.getByRole('button',{name:'创建项目',exact:true}).isEnabled());
    await page.unroute('**/api/projects');
    await page.getByRole('button',{name:'创建项目',exact:true}).click();
    await page.locator('.project-title').filter({hasText:'顶部栏创建的项目'}).waitFor();
    await page.reload();
    assert.equal(await page.locator('.project-title').innerText(),'顶部栏创建的项目','header creates a persisted backend project');
    if (process.env.HEADER_PREVIEW) await page.locator('.workspace .app-header').screenshot({path:process.env.HEADER_PREVIEW});
    console.log('PASS: real backend save/reopen/reload, browser HTML/PDF/DOCX downloads retain text, conversation switch and project return. Isolated data: '+data);
  } finally {
    if(browser)await browser.close();
    const closed=server.exitCode!==null?Promise.resolve():new Promise(resolve=>server.once('exit',resolve));
    stopServer(server);await closed;fs.rmSync(data,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
