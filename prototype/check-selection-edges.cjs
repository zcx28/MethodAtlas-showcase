// Real local HTTP/UI, with failed requests intercepted only for recovery checks.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const stopServer=require('./check-server.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'methodatlas-selection-'));
 const server=process.env.METHODATLAS_SELECTION_URL ? null : spawn(process.env.PYTHON||path.join(root,process.platform==='win32'?'.research-deps/Scripts/python.exe':'.venv/bin/python'),['-u','-m','backend.app','--port','0','--data-dir',data,'--pdf-dir',path.join(data,'no-papers')],{cwd:root,env:{...process.env,PYTHONUTF8:'1',DEEPSEEK_API_KEY:''},windowsHide:true});
 process.on('exit',()=>stopServer(server));
 const base=process.env.METHODATLAS_SELECTION_URL||await stopServer.ready(server);
 const browser=await chromium.launch({channel:'chromium',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(base);
 const state=await (await page.request.get(base+'/api/state')).json(),project=state.projects[0].id;
 const conversation=(await (await page.request.post(`${base}/api/projects/${project}/conversations`,{data:{}})).json()).conversation_id;
 const doc=[{id:'p',type:'p',children:[{text:'保留原文并引用片段。'}]},
 {id:'l',type:'ul',children:[{type:'li',children:[{text:'列表内容'}]}]},
 {id:'t',type:'table',children:[{type:'tr',children:[{type:'td',children:[{type:'p',children:[{text:'表格内容'}]}]}]}]},
 {id:'eq',type:'equation',formula:'E=mc^2',children:[{text:''}]}];
 const saved=await (await page.request.post(`${base}/api/projects/${project}/documents`,{data:{request_id:crypto.randomUUID(),title:'选区边界检查',document:doc}})).json();
 await page.evaluate(({project,conversation,saved})=>{localStorage.setItem('methodatlas-view',JSON.stringify({projectId:project,conversationId:conversation}));localStorage.setItem(`workspace:${project}`,JSON.stringify({view:'chat',middle:'chat',artifact:saved.artifact_id,version:saved.version_id}));},{project,conversation,saved});
 await page.reload();await page.getByLabel('文档标题',{exact:true}).waitFor();
 async function select(selector,text){
  const points=await page.locator(selector).evaluate((root,text)=>{const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const i=n.textContent.indexOf(text);if(i<0)continue;const r=document.createRange();r.setStart(n,i);r.collapse(true);const a=r.getBoundingClientRect();r.setStart(n,i+text.length);r.collapse(true);const b=r.getBoundingClientRect();return {a:{x:a.left,y:a.top+a.height/2},b:{x:b.left,y:b.top+b.height/2}};}throw Error('missing text');},text);
  await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:12});await page.mouse.up();
  await page.getByRole('button',{name:'添加到对话',exact:true}).waitFor();
 }
 await select('.writing-surface li','列表内容');assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('描述编辑内容',{exact:true}).fill('不提交');await page.keyboard.press('Escape');
 assert.equal(await page.locator('.writing-inline-edit').count(),0);
 const documentURL=`${base}/api/projects/${project}/documents/${saved.artifact_id}`;
 const original=await (await page.request.get(documentURL)).json();let proposalAttempts=0;
 const explanation='模型未返回完整修改内容，原文已保留。请明确替换要求后再次提交。';
 await page.route('**/propose',async route=>{
  proposalAttempts++;const request=route.request().postDataJSON();
  await route.fulfill({json:{...original,proposals:[{id:request.request_id,status:'failed',request,error:'这次暂时无法生成，具体原因还需要排查。',explanation}]}});
 });
 await select('.writing-surface li','列表内容');await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByLabel('描述编辑内容',{exact:true}).fill('请缩短这句话');
 await page.getByRole('button',{name:'提交编辑',exact:true}).click();
 await page.locator('.writing-proposal[data-state=failed]').waitFor();
 assert.equal(await page.locator('.writing-error>p').innerText(),explanation);
 assert.equal(await page.locator('#writing-edit-error').innerText(),explanation);
 assert.equal(await page.getByRole('button',{name:'重试保存',exact:true}).count(),0,'proposal failure must not offer an unrelated save retry');
 assert.equal(await page.getByLabel('描述编辑内容',{exact:true}).inputValue(),'请缩短这句话');
 await page.getByRole('button',{name:'提交编辑',exact:true}).click();
 await page.waitForResponse(r=>r.url().endsWith('/propose'));
 assert.equal(proposalAttempts,2);
 assert.deepEqual((await (await page.request.get(documentURL)).json()).versions,original.versions,'failed proposals must not alter saved manuscript');
 await page.waitForFunction(()=>!document.querySelector('.writing-inline-edit button[type=submit]')?.disabled);
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='描述编辑内容');
 await page.keyboard.press('Escape');await page.locator('.writing-inline-edit').waitFor({state:'hidden'});await page.unroute('**/propose');
 await select('.writing-surface td','表格内容');assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await select('.writing-equation','mc^2');assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#chat-form .selected-fragments summary')?.textContent.includes('2 个'));
 const removeAll=page.locator('[data-remove-all-fragments]');
 assert.equal(await removeAll.evaluate(node=>getComputedStyle(node).opacity),'0');
 await page.locator('#chat-form .selected-fragments>summary').hover();
 await page.waitForTimeout(150);
 assert.equal(await removeAll.evaluate(node=>getComputedStyle(node).opacity),'1');
 await removeAll.click();
 await page.waitForFunction(()=>!document.querySelector('#chat-form .selected-fragments'));
 await select('.writing-surface td','表格内容');await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await select('.writing-equation','mc^2');await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await page.locator('#chat-form .selected-fragments summary').click();
 await page.locator('#chat-form blockquote').last().waitFor();
 assert.match(await page.locator('#chat-form .selected-fragments').innerText(),/mc\^2/);
 await page.locator('#chat-form .selected-fragment').first().hover();
 await page.waitForTimeout(150);
 await page.getByRole('button',{name:'移除文本片段 1',exact:true}).click();
 assert.match(await page.locator('#chat-form .selected-fragments summary').innerText(),/1 个/);
 // Confirm exact formula offsets are accepted at the real boundary without paying for a model.
 const clips=await page.evaluate(id=>JSON.parse(localStorage.getItem(`selected-fragments:${id}`)),conversation);
 assert.equal(clips[0].text,'mc^2');
 let release,started;
 const gate=new Promise(r=>release=r),requested=new Promise(r=>started=r);
 await page.route('**/messages',async route=>{started();await gate;await route.abort('failed');});
 await page.locator('#chat-input').fill('旧问题带公式');
 await page.getByRole('button',{name:'发送任务',exact:true}).click();await requested;
 await page.locator('#chat-input').fill('下一条新草稿');release();
 await page.getByRole('button',{name:'重试',exact:true}).waitFor();
 assert.equal(await page.locator('#chat-input').inputValue(),'下一条新草稿');
 const queue=await page.evaluate(id=>JSON.parse(localStorage.getItem(`queue:${id}`)),conversation);
 assert.equal(queue[0].text,'旧问题带公式');assert.equal(queue[0].fragments[0].text,'mc^2');assert.equal(queue[0].failed,true);
 await page.reload();await page.getByRole('button',{name:'重试',exact:true}).waitFor();
 assert.equal(await page.locator('#chat-input').inputValue(),'下一条新草稿');
 // A storage failure occurs before the optimistic message or network request.
 await page.evaluate(()=>{window.originalSelectionSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('selected-fragments:'))throw new DOMException('Quota','QuotaExceededError');return window.originalSelectionSetItem.call(this,k,v);};});
 await page.getByRole('button',{name:'发送任务',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#chat-form')?.getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('#chat-input').inputValue(),'下一条新草稿');
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSelectionSetItem;});
 // A request failing after switching chats retains the complete message in its original queue.
 await page.unroute('**/messages');
 let releaseSecond,startedSecond;
 const gateSecond=new Promise(r=>releaseSecond=r),requestedSecond=new Promise(r=>startedSecond=r);
 await page.route('**/messages',async route=>{startedSecond();await gateSecond;await route.abort('failed');});
 await select('.writing-equation','mc^2');await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await page.locator('#chat-input').fill('切换前的问题');await page.getByRole('button',{name:'发送任务',exact:true}).click();await requestedSecond;
 await page.locator('[data-action=new-chat]').click();await page.waitForFunction(id=>JSON.parse(localStorage.getItem('methodatlas-view')).conversationId!==id,conversation);
 releaseSecond();
 await page.waitForFunction(id=>JSON.parse(localStorage.getItem(`queue:${id}`)||'[]').some(m=>m.text==='切换前的问题'),conversation);
 const switchedQueue=await page.evaluate(id=>JSON.parse(localStorage.getItem(`queue:${id}`)),conversation);
 assert.equal(switchedQueue.find(m=>m.text==='切换前的问题').fragments[0].text,'mc^2');
 assert.equal(await page.locator('#chat-input').inputValue(),'');
 assert.deepEqual(errors,[]);
 console.log('PASS: list actions, Escape, table/formula quote-only, fragment removal, failed send preserves old question and new draft after reload, storage failure, and conversation switch');
 }catch(e){fs.mkdirSync(path.join(root,'output/playwright'),{recursive:true});await page.screenshot({path:path.join(root,'output/playwright/selection-edge-failure.png')});throw e;}finally{await browser.close();stopServer(server);}
})().catch(e=>{console.error(e);process.exitCode=1;});
