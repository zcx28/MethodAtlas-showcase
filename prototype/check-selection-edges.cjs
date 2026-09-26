// Real local HTTP/UI, with failed requests intercepted only for recovery checks.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const base=process.env.METHODATLAS_SELECTION_URL||'http://127.0.0.1:8788';
 const browser=await chromium.launch({channel:'chrome',headless:true});
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
 }catch(e){await page.screenshot({path:'.check-data/selection-edge-failure.png'});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
