const {chromium}=require('playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
const os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const stopServer=require('./check-server.cjs');
(async()=>{
 let base=process.env.METHODATLAS_SELECTION_URL,server,browser;
 try{
 if(!base){
  const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'selection-live-'));
  server=spawn(process.env.PYTHON||path.join(root,'.research-deps/Scripts/python.exe'),['-u','-m','backend.app','--port','0','--data-dir',data,'--pdf-dir',path.join(data,'no-papers')],{cwd:root,env:{...process.env,PYTHONUTF8:'1'},windowsHide:true});
  process.on('exit',()=>stopServer(server));base=await stopServer.ready(server);
 }
 fs.mkdirSync('.check-data',{recursive:true});
 browser=await chromium.launch({channel:'chromium',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(base);await page.locator('[data-action=open-project]').first().click();await page.locator('[data-action=new-chat]').click();
 await page.locator('[data-action=new-document]').click();
 await page.getByLabel('文档标题',{exact:true}).fill('选区功能真实验收');
 const editor=page.locator('.writing-surface [contenteditable=true]');
 await editor.fill('这段文字写得有些啰嗦，我们希望通过编辑让它更加简洁。');
 await page.waitForFunction(()=>document.querySelector('.writing-status')?.textContent.includes('已保存'));
 await page.locator('#chat-input').fill('请用一句话解释这两个片段的意思。');
 async function select(text){
  await editor.click();
  const content=await editor.innerText(),start=content.indexOf(text);
  assert.ok(start>=0,'selection text exists');
  await editor.press('ControlOrMeta+Home');
  await page.waitForTimeout(150);
  for(let i=0;i<start;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(30);}
  await page.waitForTimeout(150);
  for(const character of text){await page.keyboard.press('Shift+ArrowRight');await page.waitForTimeout(30);}
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),text);
  await page.getByRole('button',{name:'添加到对话',exact:true}).waitFor();
 }
 await select('文字写得有些啰嗦');
 await page.screenshot({path:'.check-data/selection-menu.png'});
 await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await page.locator('#chat-form .selected-fragments summary').waitFor();
 await page.waitForTimeout(200);
 assert.equal(await page.locator('#chat-input').inputValue(),'请用一句话解释这两个片段的意思。');
 await select('通过编辑让它更加简洁');
 await page.getByRole('button',{name:'添加到对话',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#chat-form .selected-fragments summary')?.textContent.includes('2 个'));
 await page.locator('#chat-form .selected-fragments summary').click();
 await page.screenshot({path:'.check-data/selection-fragments.png'});
 await select('这段文字写得有些啰嗦，我们希望通过编辑让它更加简洁。');
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByLabel('描述编辑内容',{exact:true}).fill('改成一句简短自然的中文，意思不变。');
 await page.screenshot({path:'.check-data/selection-inline.png'});
 const proposed=page.waitForResponse(r=>r.url().endsWith('/propose')&&r.request().method()==='POST',{timeout:180000});
 await page.getByRole('button',{name:'提交编辑',exact:true}).click();
 const response=await proposed;const item=await response.json();
 fs.writeFileSync('.check-data/selection-live-result.json',JSON.stringify(item,null,2));
 assert.equal(item.proposals.at(-1).status,'pending',item.proposals.at(-1).error);assert.equal(item.proposals.at(-1).request.selection.anchor.offset,0);assert.equal(item.proposals.at(-1).request.selection.focus.offset,26);
 await page.getByRole('button',{name:'接受',exact:true}).waitFor();
 assert.equal(await page.locator('.writing-proposal > p').count(),0);
 assert.equal(await page.locator('.writing-proposal details').count(),0);
 assert.equal(await page.locator('.writing-proposal ins').count()>0,true);
 assert.equal(await page.locator('.writing-proposal del').count()>0,true);
 assert.deepEqual(await page.locator('.writing-proposal .writing-actions button').allTextContents(),['接受','撤销']);
 await page.screenshot({path:'.check-data/selection-diff.png',animations:'disabled'});
 await page.getByRole('button',{name:'接受',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.writing-proposal button')?.textContent.includes('接受'));
 await page.waitForTimeout(500);
 assert.notEqual(await editor.innerText(),'这段文字写得有些啰嗦，我们希望通过编辑让它更加简洁。');
 // References retain the previous version after acceptance.
 await page.reload();await page.locator('#chat-input').waitFor();
 assert.match(await page.locator('#chat-form .selected-fragments summary').innerText(),/2 个/);
 const sent=page.waitForResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'发送任务',exact:true}).click();
 const reply=await sent;assert.equal(reply.status(),202);
 const payload=reply.request().postDataJSON();assert.equal(payload.selected_fragments.length,2);
 assert.equal(payload.selected_fragments[0].text,'文字写得有些啰嗦');assert.equal(payload.selected_fragments[1].text,'通过编辑让它更加简洁');
 await page.waitForFunction(()=>!!document.querySelector('.answer-text')?.textContent,{timeout:180000});
 await page.waitForTimeout(3500);await page.screenshot({path:'.check-data/selection-chat.png'});
 const documentURL=`${base}/api/projects/${item.project_id}/documents/${item.id}`;
 const readDocument=async()=>{const r=await fetch(documentURL);assert.ok(r.ok);return r.json();};
 async function proposeAgain(){
  await select(await editor.innerText());
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('描述编辑内容',{exact:true}).fill('将选中的文字替换为：这段文字较冗长，请精简。');
  const response=page.waitForResponse(r=>r.url().endsWith('/propose'),{timeout:180000});
  await page.getByRole('button',{name:'提交编辑',exact:true}).click();
  const proposed=await (await response).json();
  assert.equal(proposed.proposals.at(-1).status,'pending',proposed.proposals.at(-1).error);
  await page.getByRole('button',{name:'接受',exact:true}).waitFor();
  return proposed.proposals.at(-1);
 }
 const beforeReject=await readDocument(),beforeText=await editor.innerText();
 const rejected=await proposeAgain();
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await page.locator('.writing-proposal[data-state=rejected]').waitFor();
 assert.equal(await editor.innerText(),beforeText);
 const afterReject=await readDocument();
 assert.equal(afterReject.versions.length,beforeReject.versions.length,'reject must not create a manuscript version');
 assert.equal(afterReject.proposals.find(p=>p.id===rejected.id).status,'rejected');
 const conflicting=await proposeAgain();
 const latest=(await readDocument()).versions.at(-1),manual=structuredClone(latest.payload.document);
 manual[0].children=[{text:'另一窗口保存的人工正文，不能被旧提案覆盖。'}];
 const saved=await fetch(documentURL+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),base_version_id:latest.id,title:latest.title,document:manual})});
 assert.ok(saved.ok,await saved.text());
 await page.getByRole('button',{name:'接受',exact:true}).click();
 await page.getByText(/同段内容已改变/).waitFor();
 const afterConflict=await readDocument();
 assert.deepEqual(afterConflict.versions.at(-1).payload.document,manual);
 assert.equal(afterConflict.proposals.find(p=>p.id===conflicting.id).status,'pending');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.writing-proposal[data-state=pending]'));
 assert.match(await editor.innerText(),/另一窗口保存的人工正文/);
 assert.equal(await page.locator('.writing-error').count(),0,'resolved conflict must not leave a stale error');
 await page.reload();await page.getByLabel('文档标题',{exact:true}).waitFor();
 assert.match(await editor.innerText(),/另一窗口保存的人工正文/);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({project:item.project_id,artifact:item.id,proposal:item.proposals.at(-1),answer:await page.locator('.answer-text').last().innerText(),errors},null,2));
 }catch(e){await page.screenshot({path:'.check-data/selection-failure.png'});console.log(await page.locator('#output-body').innerText());throw e;}
 }finally{await browser?.close();stopServer(server);}
})().catch(e=>{console.error(e);process.exitCode=1;});
