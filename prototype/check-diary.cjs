const assert=require('node:assert/strict');
const stopServer=require('./check-server.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'), data=fs.mkdtempSync(path.join(os.tmpdir(),'diary-ui-'));
const port=Number(process.env.METHODATLAS_CHECK_PORT || 0);
const python=process.env.PYTHON || path.join(root,process.platform==='win32'?'.research-deps/Scripts/python.exe':'.venv/bin/python');
process.env.PYTHONUTF8='1';
const seed=spawnSync(python,['-c',`
from pathlib import Path
from datetime import datetime
import sys
from backend.state import Store
from backend.writing import Writing
from backend.progress import Progress
s=Store(Path(sys.argv[1])/'methodatlas.sqlite3');Writing(s)
p=s.create_project('研究回顾界面检查');g=Progress(s,None,lambda:datetime.fromisoformat('2026-09-22T12:00:00+08:00'));g.settings(p,{'enabled':False})
for key in ('2026-09-22','2026-09-19','2026-09-14-w'):
 g.publish(p,key,'# 研究回顾验收样例\\n\\n## 今天发生了什么\\n\\n检查真实编辑与版本操作。\\n\\n## 下一步研究计划\\n\\n核对报告。','generated',None,[],['研究回顾验收样例'])
s.close()
`,data],{cwd:root,encoding:'utf8'});
if(seed.status!==0)throw new Error(seed.stderr);
const server=spawn(python,['-u','-c',`
from datetime import datetime
from pathlib import Path
from http.server import ThreadingHTTPServer
import sys
from backend.app import Service, Handler
service=Service(Path(sys.argv[1])/'no-papers',Path(sys.argv[1]),background=False)
service.progress.clock=lambda:datetime.fromisoformat('2026-09-22T12:00:00+08:00')
Handler.service=service
server=ThreadingHTTPServer(('127.0.0.1',int(sys.argv[2])),Handler)
print(f'MethodAtlas: http://127.0.0.1:{server.server_port}',flush=True)
server.serve_forever()
`,data,String(port)],{cwd:root,env:{...process.env,DEEPSEEK_API_KEY:''}});
const serverReady=stopServer.ready(server);
process.on('exit',()=>stopServer(server));

(async()=>{
 const base=await serverReady;
 const browser=await chromium.launch({headless:true,...process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{channel:'chromium'}});
 const context=await browser.newContext({viewport:{width:1500,height:980},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 // Exercise the download fallback instead of opening the native OS share sheet.
 await page.addInitScript(()=>Object.defineProperty(navigator,'canShare',{value:()=>false}));
 for(let n=0;n<100;n++){try{await fetch(base+'/api/state');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await page.goto(base);await page.locator('[data-action=open-project]').first().click();await page.locator('.app-header [data-panel=sources-panel]').click();await page.locator('[data-action=shell][data-value=progress]').click();
 await page.locator('[data-memory-day="2026-09-22"]').click().catch(async error=>{console.error(await page.locator('body').innerText());throw error;});await page.getByRole('button',{name:'更新回顾',exact:true}).waitFor();
 assert.equal(await page.locator('.diary-ai').count(),1,'only the report content has a discussion entry');
 assert.equal(await page.getByRole('button',{name:'讨论这篇回顾',exact:true}).count(),1);
 assert.equal(await page.locator('#daily-content').count(),0);
 const menu=()=>page.locator('#chat-tools [data-diary=menu]').click();
 await menu();await page.locator('dialog [data-diary=edit]').click();await page.locator('#daily-content').fill('# 验收修订\n\n## 今天发生了什么\n\n保存一次独立人工修订。\n\n## 下一步研究计划\n\n检查版本恢复。');await page.locator('[data-diary=save]').click();await page.locator('#daily-content').waitFor({state:'detached'});
 assert.equal(await page.locator('.diary-document h1').innerText(),'验收修订');
 assert.equal(await page.locator('[data-memory-day="2026-09-22"] h3').innerText(),'验收修订');
 await page.locator('#chat-tools [data-diary=history]').click();assert.ok(await page.locator('dialog .version-row').count()>=2);await page.locator('dialog [data-diary=view-version]').last().click();await page.locator('.diary-notice [data-diary=latest]').waitFor();assert.equal(await page.locator('#daily-content').count(),0);assert.equal(await page.locator('.diary-document h1').innerText(),'研究回顾验收样例');
 await page.locator('.diary-notice [data-diary=restore]').click();await page.locator('.diary-notice [data-diary=latest]').waitFor({state:'detached'});
 await menu();await page.locator('dialog [data-diary=copy]').click();assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('今天发生了什么'));
 for(const action of ['share','markdown','pdf']){
  const pending=page.waitForEvent('download');await page.locator(`dialog [data-diary=${action}]`).click();const file=await pending;
  assert.equal(await file.failure(),null);assert.equal(file.suggestedFilename(),`2026-09-22.${action==='pdf'?'pdf':'md'}`);
  const saved=await file.path();
  const extracted=action==='pdf'?spawnSync(python,['-c','import sys,pymupdf\nwith pymupdf.open(sys.argv[1]) as doc: print("".join(p.get_text() for p in doc))',saved],{encoding:'utf8'}):{status:0,stdout:fs.readFileSync(saved,'utf8')};
  assert.equal(extracted.status,0,extracted.stderr);assert(extracted.stdout.includes('检查真实编辑与版本操作。'));
 }
 await page.locator('dialog [data-diary=settings]').click();await page.locator('[name=daily_time]').fill('21:30');await page.locator('[data-diary=scope]').click();await page.locator('[name=scope][value=materials]').uncheck();await page.locator('#diary-scope button[type=submit]').click();assert.equal(await page.locator('[name=daily_time]').inputValue(),'21:30');await page.locator('[name=daily_time]').fill('22:00');await page.locator('#diary-settings button[type=submit]').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});
 await menu();await page.locator('dialog [data-diary=note]').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});await page.waitForTimeout(600);assert.ok(await page.locator('#output-body').innerText());
 await menu();await page.locator('dialog [data-diary=note]').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});
 // A delayed note save must not close a newer dialog or steal navigation.
 await menu();let releaseNote,noteStarted;const noteGate=new Promise(r=>releaseNote=r),noteReady=new Promise(r=>noteStarted=r);
 await page.route('**/documents',async route=>{if(route.request().method()!=='POST')return route.continue();noteStarted();await noteGate;await route.continue();});
 await page.locator('dialog [data-diary=note]').click();await noteReady;
 await page.locator('dialog [data-diary=close]').click();await page.locator('[data-diary=record]').click();
 await page.locator('#diary-record [name=text]').fill('后打开的记录不能被保存笔记关闭');
 const noteResponse=page.waitForResponse(r=>r.url().endsWith('/documents')&&r.request().method()==='POST');releaseNote();await noteResponse;await page.waitForTimeout(400);
 assert(await page.locator('#diary-record').isVisible());assert.equal(await page.locator('#diary-record [name=text]').inputValue(),'后打开的记录不能被保存笔记关闭');
 await page.locator('dialog [data-diary=close]').click();await page.unroute('**/documents');
 // A delayed download keeps the identity of the report whose bytes were requested.
 await menu();let releaseExport,exportStarted;const exportGate=new Promise(r=>releaseExport=r),exportReady=new Promise(r=>exportStarted=r);
 await page.route('**/progress/2026-09-22/export?*',async route=>{exportStarted();await exportGate;await route.continue();});
 const delayedDownload=page.waitForEvent('download');await page.locator('dialog [data-diary=markdown]').click();await exportReady;
 await page.locator('dialog [data-diary=close]').click();await page.locator('[data-memory-day="2026-09-19"]').click();await page.locator('.diary-kicker').filter({hasText:'19日'}).waitFor();
 releaseExport();const delayed=await delayedDownload;assert.equal(delayed.suggestedFilename(),'2026-09-22.md');
 assert(fs.readFileSync(await delayed.path(),'utf8').includes('检查真实编辑与版本操作。'));
 await page.unroute('**/progress/2026-09-22/export?*');
 // Completing an old record must not close a newly opened form or discard its input.
 await page.locator('[data-diary=record]').click();await page.locator('#diary-record [name=text]').fill('第一条研究记录');
 let releaseRecord,recordStarted,recordRequests=0;const recordGate=new Promise(r=>releaseRecord=r),recordReady=new Promise(r=>recordStarted=r);
 await page.route('**/progress/events',async route=>{recordRequests++;recordStarted();await recordGate;await route.continue();});
 await page.locator('#diary-record button.primary').click();await recordReady;
 assert.equal(await page.locator('#diary-record [name=text]').isDisabled(),true);
 await page.locator('#diary-record').evaluate(form=>form.requestSubmit());
 await page.locator('dialog [data-diary=close]').click();await page.locator('[data-diary=record]').click();
 await page.locator('#diary-record [name=text]').fill('第二条尚未提交的记录');
 const recordResponse=page.waitForResponse(r=>r.url().endsWith('/progress/events'));releaseRecord();await recordResponse;
 await page.waitForTimeout(150);
 assert.equal(await page.locator('.diary-dialog').isVisible(),true,'old save closed a new dialog');
 assert.equal(await page.locator('#diary-record [name=text]').inputValue(),'第二条尚未提交的记录');
 assert.equal(recordRequests,1,'duplicate record submitted');await page.unroute('**/progress/events');
 await page.route('**/progress/events',route=>route.fulfill({status:503,json:{error:'记录暂时无法保存，请重试'}}));
 await page.locator('#diary-record button.primary').click();await page.locator('[data-diary-dialog-status]').filter({hasText:'记录暂时无法保存'}).waitFor();
 assert.equal(await page.locator('#diary-record [name=text]').isEnabled(),true);
 assert.equal(await page.locator('#diary-record [name=text]').inputValue(),'第二条尚未提交的记录');
 await page.unroute('**/progress/events');await page.locator('#diary-record button.primary').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});
 await page.locator('[data-memory-day="2026-09-14-w"]').click();await page.locator('.diary-document h1').waitFor();await page.locator('#chat-body').evaluate(el=>el.scrollTop=190);const before=await page.locator('#chat-body').evaluate(el=>el.scrollTop);
 await page.locator('#chat-body [data-diary=chat]').click();await page.getByRole('dialog',{name:'AI 对话',exact:true}).locator('#chat-input').waitFor();
 await page.route('**/progress/*/generate',route=>route.fulfill({json:{status:'running'}}));
 await page.locator('#diary-revise-next').check();await page.locator('#chat-input').fill('请精简这份回顾');
 await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
 await page.getByText('这篇回顾正在整理，请稍后重试；修订要求已保留。',{exact:true}).waitFor();
 assert.equal(await page.locator('#chat-input').inputValue(),'请精简这份回顾');await page.unroute('**/progress/*/generate');
 await page.getByRole('button',{name:'关闭 AI 对话',exact:true}).click();await page.locator('.diary-document h1').waitFor();assert.equal(await page.locator('#chat-body').evaluate(el=>el.scrollTop),before);
 await menu();await page.locator('dialog [data-diary=delete]').click();await page.locator('dialog [data-diary=confirm-delete]').click();await page.locator('[data-memory-day="2026-09-14-w"]').waitFor({state:'detached'});await page.locator('.diary-deleted summary').click();await page.locator('[data-diary=undo][data-day="2026-09-14-w"]').click();await page.locator('[data-memory-day="2026-09-14-w"]').waitFor();
 // Late deletion must preserve a newer dialog; its server-side deletion still completes.
 await menu();await page.locator('dialog [data-diary=delete]').click();
 let releaseDelete,deleteStarted;const deleteGate=new Promise(r=>releaseDelete=r),deleteReady=new Promise(r=>deleteStarted=r);
 await page.route('**/progress/2026-09-14-w/delete',async route=>{deleteStarted();await deleteGate;await route.continue();});
 await page.locator('dialog [data-diary=confirm-delete]').click();await deleteReady;
 await page.locator('dialog [data-diary=close]').click();await page.locator('[data-memory-day="2026-09-22"]').click();await page.locator('[data-diary=record]').click();
 await page.locator('#diary-record [name=text]').fill('删除期间的新记录');
 const deletedResponse=page.waitForResponse(r=>r.url().endsWith('/2026-09-14-w/delete'));releaseDelete();await deletedResponse;await page.waitForTimeout(400);
 assert(await page.locator('#diary-record').isVisible(),'late deletion closed another dialog');assert.equal(await page.locator('#diary-record [name=text]').inputValue(),'删除期间的新记录');
 await page.locator('dialog [data-diary=close]').click();await page.unroute('**/progress/2026-09-14-w/delete');
 // The list reflects the completed deletion without replacing the new report or dialog.
 assert.equal(await page.locator('[data-memory-day="2026-09-14-w"]').count(),0);
 await page.locator('.diary-deleted summary').click();await page.locator('[data-diary=undo][data-day="2026-09-14-w"]').click();await page.locator('[data-memory-day="2026-09-14-w"]').waitFor();
 // Restoring a historical version must also leave subsequent navigation intact.
 await page.locator('[data-memory-day="2026-09-22"]').click();await page.locator('#chat-tools [data-diary=history]').click();
 let releaseRestore,restoreStarted;const restoreGate=new Promise(r=>releaseRestore=r),restoreReady=new Promise(r=>restoreStarted=r);
 await page.route('**/progress/2026-09-22/save',async route=>{restoreStarted();await restoreGate;await route.continue();});
 await page.locator('dialog [data-diary=restore]').last().click();await restoreReady;
 await page.locator('dialog [data-diary=close]').click();await page.locator('[data-action=shell][data-value=chat]').click();await page.locator('#chat-input').fill('恢复期间的新问题');
 const restoredResponse=page.waitForResponse(r=>r.url().endsWith('/2026-09-22/save'));releaseRestore();const restoredResult=await restoredResponse;assert.equal(restoredResult.status(),200);await page.waitForTimeout(400);
 assert(await page.locator('#chat-input').isVisible());assert.equal(await page.locator('#chat-input').inputValue(),'恢复期间的新问题');
 await page.unroute('**/progress/2026-09-22/save');await page.locator('[data-action=shell][data-value=progress]').click();
 // Weekly/monthly generation intentionally selects a period, but may not steal later navigation.
 for(const [action,period] of [['generate-week','2026-09-21-w'],['generate-month','2026-09-01-m']]){
  let releaseGeneration,generationStarted;const generationGate=new Promise(r=>releaseGeneration=r),generationReady=new Promise(r=>generationStarted=r);
  await page.route('**/progress/*/generate',async route=>{assert(route.request().url().endsWith('/'+period+'/generate'));generationStarted();await generationGate;await route.fulfill({json:{status:'ready'}});});
  await page.locator('[data-diary='+action+']').click();await generationReady;
  await page.locator('[data-action=shell][data-value=chat]').click();await page.locator('#chat-input').fill('生成回顾期间的新问题');
  const generatedResponse=page.waitForResponse(r=>r.url().endsWith('/'+period+'/generate'));releaseGeneration();await generatedResponse;await page.waitForTimeout(400);
  assert(await page.locator('#chat-input').isVisible());assert.equal(await page.locator('#chat-input').inputValue(),'生成回顾期间的新问题');
  await page.unroute('**/progress/*/generate');await page.locator('[data-action=shell][data-value=progress]').click();
 }
 // A slow save must not clear a different report's unsaved draft.
 await page.locator('[data-memory-day="2026-09-22"]').click();await menu();await page.locator('dialog [data-diary=edit]').click();await page.locator('#daily-content').fill('# 慢保存\n\n检查切换期间的草稿保护。');
 let releaseSave, saveStarted;const gate=new Promise(r=>releaseSave=r), started=new Promise(r=>saveStarted=r);
 await page.route('**/progress/2026-09-22/save',async route=>{saveStarted();await gate;await route.continue();});
 await page.locator('[data-diary=save]').click();await started;
 await page.locator('[data-memory-day="2026-09-19"]').click();await menu();await page.locator('dialog [data-diary=edit]').click();await page.locator('#daily-content').fill('另一份未保存草稿');
 const response=page.waitForResponse(r=>r.url().endsWith('/progress/2026-09-22/save'));releaseSave();await response;await page.waitForTimeout(100);
 assert.equal(await page.locator('#daily-content').inputValue(),'另一份未保存草稿');
 assert.ok(await page.evaluate(()=>Object.entries(localStorage).some(([k,v])=>k.endsWith(':2026-09-19') && v.includes('另一份未保存草稿'))));
 await page.unroute('**/progress/2026-09-22/save');
 // Keep typing while saving the same report; the continuation must remain editable and saveable.
 const editor=page.locator('#daily-content');await editor.fill('# 第一段修改\n\n已经保存的第一段。');
 let releaseContinuation,continuationStarted;const continuationGate=new Promise(r=>releaseContinuation=r),continuationReady=new Promise(r=>continuationStarted=r);
 await page.route('**/progress/2026-09-19/save',async route=>{continuationStarted();await continuationGate;await route.continue();});
 await page.locator('[data-diary=save]').click();await continuationReady;
 await editor.fill('# 第一段修改\n\n已经保存的第一段。\n\n保存期间补充的第二段。');
 const continuationResponse=page.waitForResponse(r=>r.url().endsWith('/progress/2026-09-19/save'));releaseContinuation();const firstSave=await continuationResponse;const firstVersion=(await firstSave.json()).version_id;
 await page.waitForTimeout(150);
 assert.equal(await editor.count(),1,'save discarded the active continuation editor');
 assert.equal(await editor.inputValue(),'# 第一段修改\n\n已经保存的第一段。\n\n保存期间补充的第二段。');
 assert.equal(await editor.getAttribute('data-base'),firstVersion);
 await page.unroute('**/progress/2026-09-19/save');
 await page.locator('[data-diary=cancel-edit]').click();assert((await page.locator('.diary-document').innerText()).includes('已经保存的第一段。'));await menu();await page.locator('dialog [data-diary=edit]').click();
 assert.equal(await editor.inputValue(),'# 第一段修改\n\n已经保存的第一段。\n\n保存期间补充的第二段。');assert.equal(await editor.getAttribute('data-base'),firstVersion);
 await page.locator('[data-diary=save]').click();await editor.waitFor({state:'detached'});
 assert((await page.locator('.diary-document').innerText()).includes('保存期间补充的第二段。'));
 const persisted=await (await fetch(firstSave.url().replace(/\/save$/,''))).json();
 assert(persisted.versions.at(-1).body.includes('保存期间补充的第二段。'));
 assert(!persisted.versions.find(v=>v.id===firstVersion).body.includes('保存期间补充的第二段。'),'continuation mutated first saved version');
 // Browser storage exhaustion must be visible; explicit server save remains available.
 await menu();await page.locator('dialog [data-diary=edit]').click();
 await editor.fill('# 空间耗尽前的旧草稿');
 await page.evaluate(()=>{window.diaryOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('progress-draft:'))throw new DOMException('quota','QuotaExceededError');return window.diaryOriginalSetItem.call(this,key,value);};});
 await editor.fill('# 草稿空间不足\n\n仍可明确保存的文字。');
 await page.locator('#diary-status').filter({hasText:'浏览器无法保存草稿'}).waitFor();
 assert.equal(await editor.inputValue(),'# 草稿空间不足\n\n仍可明确保存的文字。');
 await page.locator('[data-diary=save]').click();await editor.waitFor({state:'detached'});
 const quotaSaved=await (await fetch(firstSave.url().replace(/\/save$/,''))).json();assert(quotaSaved.versions.at(-1).body.includes('仍可明确保存的文字。'));
 await page.evaluate(()=>{Storage.prototype.setItem=window.diaryOriginalSetItem;delete window.diaryOriginalSetItem;});
 await menu();await page.locator('dialog [data-diary=edit]').click();
 assert.equal(await editor.inputValue(),'# 草稿空间不足\n\n仍可明确保存的文字。','stale local draft replaced saved text');
 // Saving a report after navigation must not reopen it over a new chat draft.
 await editor.fill('# 保存后切换页面\n\n保存应成功，聊天应保留。');
 let releaseNavigationSave,navigationSaveStarted;const navigationSaveGate=new Promise(r=>releaseNavigationSave=r),navigationSaveReady=new Promise(r=>navigationSaveStarted=r);
 await page.route('**/progress/*/save',async route=>{navigationSaveStarted();await navigationSaveGate;await route.continue();});
 await page.locator('[data-diary=save]').click();await navigationSaveReady;
 await page.locator('[data-action=shell][data-value=chat]').click();await page.locator('#chat-input').fill('保存期间的新问题');
 const navigationSaved=page.waitForResponse(r=>/\/progress\/[^/]+\/save$/.test(r.url()));releaseNavigationSave();await navigationSaved;await page.waitForTimeout(400);
 assert(await page.locator('#chat-input').isVisible(),'late diary save stole chat navigation');assert.equal(await page.locator('#chat-input').inputValue(),'保存期间的新问题');
 await page.unroute('**/progress/*/save');await page.locator('[data-action=shell][data-value=progress]').click();await page.locator('[data-memory-day="2026-09-19"]').click();
 await menu();await page.locator('dialog [data-diary=edit]').click();assert((await editor.inputValue()).includes('保存应成功，聊天应保留。'));
 for(const [width,scale] of [[390,1],[390,1.5],[800,1]]){
  await page.evaluate(scale=>document.documentElement.style.setProperty('--ui-scale',scale),scale);
  await page.setViewportSize({width,height:844});
  assert.equal(await editor.isVisible(),true);
  assert(await page.locator('#chat-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`editor overflows at ${width}`);
  await menu();await page.locator('dialog [data-diary=settings]').click();
  if(process.env.DIARY_SCREENSHOT)await page.screenshot({path:process.env.DIARY_SCREENSHOT.replace(/\.png$/,`-settings-${width}-${scale}.png`),animations:'disabled'});
  assert(await page.locator('.diary-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`settings overflow at ${width}`);
  assert(await page.locator('.diary-setting-group').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),`settings controls clipped at ${width}, scale ${scale}`);
  await page.locator('[data-diary=scope]').click();
  assert(await page.locator('.diary-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`scope overflow at ${width}`);
  await page.locator('#diary-scope button[type=submit]').click();await page.locator('#diary-settings').waitFor();
  await page.locator('dialog [data-diary=close]').click();
  await page.locator('#chat-tools [data-diary=history]').click();
  if(process.env.DIARY_SCREENSHOT)await page.screenshot({path:process.env.DIARY_SCREENSHOT.replace(/\.png$/,`-history-${width}-${scale}.png`),animations:'disabled'});
  assert(await page.locator('.diary-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`history overflow at ${width}, scale ${scale}`);
  await page.locator('dialog [data-diary=close]').click();
 }
 assert.deepEqual(errors,[]);console.log('PASS readonly/edit/history/restore/copy/PDF/MD/settings/scope/note twice/chat-return/delete-undo; zero JS errors');
 if(process.env.DIARY_SCREENSHOT)await page.screenshot({path:process.env.DIARY_SCREENSHOT,fullPage:true});await browser.close();stopServer(server);
})().catch(e=>{console.error(e);process.exit(1)});
