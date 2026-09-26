const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'), data=fs.mkdtempSync(path.join(os.tmpdir(),'diary-ui-'));
const port=Number(process.env.METHODATLAS_CHECK_PORT || 8893), base=`http://127.0.0.1:${port}`;
const python=process.env.PYTHON || path.join(root,'.venv/bin/python');
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
const server=spawn(python,['-m','backend.app','--port',String(port),'--data-dir',data,'--pdf-dir',path.join(data,'no-papers')],{cwd:root,env:{...process.env,DEEPSEEK_API_KEY:''},stdio:'ignore'});
process.on('exit',()=>server.kill());

(async()=>{
 const browser=await chromium.launch({headless:true,...process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}});
 const context=await browser.newContext({viewport:{width:1500,height:980},locale:'zh-CN',permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 for(let n=0;n<100;n++){try{await fetch(base+'/api/state');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await page.goto(base);await page.locator('[data-action=open-project]').first().click();await page.locator('[data-action=shell][data-value=progress]').click();await page.locator('.diary-document h1').waitFor();
 assert.equal(await page.locator('#daily-content').count(),0);
 const menu=()=>page.locator('#chat-tools [data-diary=menu]').click();
 await menu();await page.locator('dialog [data-diary=edit]').click();await page.locator('#daily-content').fill('# 验收修订\n\n## 今天发生了什么\n\n保存一次独立人工修订。\n\n## 下一步研究计划\n\n检查版本恢复。');await page.locator('[data-diary=save]').click();await page.locator('#daily-content').waitFor({state:'detached'});
 await page.locator('#chat-tools [data-diary=history]').click();assert.ok(await page.locator('dialog .version-row').count()>=2);await page.locator('dialog [data-diary=view-version]').last().click();await page.locator('.diary-notice [data-diary=latest]').waitFor();assert.equal(await page.locator('#daily-content').count(),0);
 await page.locator('.diary-notice [data-diary=restore]').click();await page.locator('.diary-notice [data-diary=latest]').waitFor({state:'detached'});
 await menu();await page.locator('dialog [data-diary=copy]').click();assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes('今天发生了什么'));
 let download=page.waitForEvent('download');await page.locator('dialog [data-diary=share]').click();assert.match((await download).suggestedFilename(),/\.md$/);
 download=page.waitForEvent('download');await page.locator('dialog [data-diary=markdown]').click();assert.match((await download).suggestedFilename(),/\.md$/);
 download=page.waitForEvent('download');await page.locator('dialog [data-diary=pdf]').click();assert.match((await download).suggestedFilename(),/\.pdf$/);
 await page.locator('dialog [data-diary=settings]').click();await page.locator('[name=daily_time]').fill('21:30');await page.locator('[data-diary=scope]').click();await page.locator('[name=scope][value=materials]').uncheck();await page.locator('#diary-scope button[type=submit]').click();assert.equal(await page.locator('[name=daily_time]').inputValue(),'21:30');await page.locator('[name=daily_time]').fill('22:00');await page.locator('#diary-settings button[type=submit]').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});
 await menu();await page.locator('dialog [data-diary=note]').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});await page.waitForTimeout(600);assert.ok(await page.locator('#output-body').innerText());
 await menu();await page.locator('dialog [data-diary=note]').click();await page.locator('.diary-dialog').waitFor({state:'hidden'});
 await page.locator('[data-memory-day="2026-09-14-w"]').click();await page.locator('.diary-document h1').waitFor();await page.locator('#chat-body').evaluate(el=>el.scrollTop=190);const before=await page.locator('#chat-body').evaluate(el=>el.scrollTop);
 await page.locator('#chat-body [data-diary=chat]').click();await page.locator('[data-diary=return]').waitFor();assert.ok(await page.locator('#chat-input').count());
 await page.route('**/progress/*/generate',route=>route.fulfill({json:{status:'running'}}));
 await page.locator('#diary-revise-next').check();await page.locator('#chat-input').fill('请精简这份回顾');
 await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
 await page.getByText('这篇回顾正在整理，请稍后重试；修订要求已保留。',{exact:true}).waitFor();
 assert.equal(await page.locator('#chat-input').inputValue(),'请精简这份回顾');await page.unroute('**/progress/*/generate');
 await page.locator('[data-diary=return]').click();await page.locator('.diary-document h1').waitFor();assert.equal(await page.locator('#chat-body').evaluate(el=>el.scrollTop),before);
 await menu();await page.locator('dialog [data-diary=delete]').click();await page.locator('dialog [data-diary=confirm-delete]').click();await page.locator('[data-memory-day="2026-09-14-w"]').waitFor({state:'detached'});await page.locator('.diary-deleted summary').click();await page.locator('[data-diary=undo][data-day="2026-09-14-w"]').click();await page.locator('[data-memory-day="2026-09-14-w"]').waitFor();
 // A slow save must not clear a different report's unsaved draft.
 await page.locator('[data-memory-day="2026-09-22"]').click();await menu();await page.locator('dialog [data-diary=edit]').click();await page.locator('#daily-content').fill('# 慢保存\n\n检查切换期间的草稿保护。');
 let releaseSave, saveStarted;const gate=new Promise(r=>releaseSave=r), started=new Promise(r=>saveStarted=r);
 await page.route('**/progress/2026-09-22/save',async route=>{saveStarted();await gate;await route.continue();});
 await page.locator('[data-diary=save]').click();await started;
 await page.locator('[data-memory-day="2026-09-19"]').click();await menu();await page.locator('dialog [data-diary=edit]').click();await page.locator('#daily-content').fill('另一份未保存草稿');
 const response=page.waitForResponse(r=>r.url().endsWith('/progress/2026-09-22/save'));releaseSave();await response;await page.waitForTimeout(100);
 assert.equal(await page.locator('#daily-content').inputValue(),'另一份未保存草稿');
 assert.ok(await page.evaluate(()=>Object.entries(localStorage).some(([k,v])=>k.endsWith(':2026-09-19') && v.includes('另一份未保存草稿'))));
 assert.deepEqual(errors,[]);console.log('PASS readonly/edit/history/restore/copy/PDF/MD/settings/scope/note twice/chat-return/delete-undo; zero JS errors');
 if(process.env.DIARY_SCREENSHOT)await page.screenshot({path:process.env.DIARY_SCREENSHOT,fullPage:true});await browser.close();server.kill();
})().catch(e=>{console.error(e);process.exit(1)});
