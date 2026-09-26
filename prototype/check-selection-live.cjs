const {chromium}=require('playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
 const base=process.env.METHODATLAS_SELECTION_URL || 'http://127.0.0.1:8788';
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(base);await page.locator('[data-action=open-project]').first().click();await page.locator('[data-action=new-chat]').click();
 await page.locator('[data-action=new-document]').click();
 await page.getByLabel('文档标题',{exact:true}).fill('选区功能真实验收');
 const editor=page.locator('.writing-surface [contenteditable=true]');
 await editor.fill('这段文字写得有些啰嗦，我们希望通过编辑让它更加简洁。');
 await page.locator('#chat-input').fill('请用一句话解释这两个片段的意思。');
 async function select(text){
  await editor.click();
  const points=await page.evaluate(text=>{const root=document.querySelector('.writing-surface [contenteditable=true]'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.textContent.indexOf(text);if(at<0)continue;const r=document.createRange();r.setStart(node,at);r.collapse(true);const a=r.getBoundingClientRect();r.setStart(node,at+text.length);r.collapse(true);const b=r.getBoundingClientRect();return {a:{x:a.left,y:a.top+a.height/2},b:{x:b.left,y:b.top+b.height/2}};}throw Error('Text missing');},text);
  await page.mouse.move(points.a.x,points.a.y);await page.mouse.down();await page.mouse.move(points.b.x,points.b.y,{steps:12});await page.mouse.up();
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
 await page.screenshot({path:'.check-data/selection-diff.png'});
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
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({project:item.project_id,artifact:item.id,proposal:item.proposals.at(-1),answer:await page.locator('.answer-text').last().innerText(),errors},null,2));
 }catch(e){await page.screenshot({path:'.check-data/selection-failure.png'});console.log(await page.locator('#output-body').innerText());console.log(await page.evaluate(()=>JSON.stringify(localStorage)));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
