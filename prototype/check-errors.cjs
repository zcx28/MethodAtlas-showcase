// Real local API + browser. No paid model, no existing user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {chromium} = require('playwright');

(async () => {
  const root = path.resolve(__dirname,'..'), data = fs.mkdtempSync(path.join(os.tmpdir(),'methodatlas-errors-'));
  const python = process.env.PYTHON || path.join(root,'.venv/bin/python');
  const setup = spawnSync(python,['-c',`
from pathlib import Path
from unittest.mock import patch
from backend.app import Service
from backend.agent import ProjectTools
from backend.errors import AppError
import sys
with patch.object(Service, 'schedule'):
 s=Service(Path(sys.argv[1])/'empty',Path(sys.argv[1]))
 p=s.store.projects()[0]['id'];c=s.store.conversations(p)[0]['id']
 for i in range(2):
  tid=s.message(p,c,{'text':['生成研究报告','核查引用'][i],'client_message_id':str(i)})['task_id']
  s.store.run("UPDATE tasks SET status='running' WHERE id=?",(tid,))
  task=s.store.task(tid)
  if not i:
   tools=ProjectTools(s.store,task);tools.set_scope(False)
   tools.call('write_file',{'title':'已完成的独立成果','kind':'docx','content':'已保存内容','citation_ids':[]})
  s.research.fail(task,AppError(['timeout','evidence'][i],'HTTP 504 select_quote private_function'))
 s.close()
`,data],{cwd:root,encoding:'utf8',env:{...process.env,DEEPSEEK_API_KEY:''}});
  assert.equal(setup.status,0,setup.stderr);
  const server=spawn(python,['-m','backend.app','--port','0','--data-dir',data,'--pdf-dir',path.join(data,'empty')],{cwd:root,env:{...process.env,DEEPSEEK_API_KEY:''}});
  let browser, log='';
  try {
    const base=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(log)),20000);
      server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/MethodAtlas: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
      server.stderr.on('data',chunk=>{log+=chunk;});
      server.on('error',reject);
    });
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[], posts=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
    await page.goto(base);
    await page.locator('[data-action=open-project]').first().click();
    await page.getByText('这次没有及时收到模型的完整回复。',{exact:false}).first().waitFor();
    let text=await page.locator('#chat-body').innerText();
    assert(!/select_quote|HTTP 504|private_function/.test(text),text);
    assert(text.includes('再发送新请求') && !text.includes('已保存：已完成的独立成果'));
    assert.equal(await page.locator('#chat-body .task-error,#chat-body [role=alert]').count(),0);
    assert.equal(await page.locator('[data-control=resume]').count(),0,'No resume controls on terminal explanations');
    await page.locator('#chat-input').fill('连接中断时保留我的草稿');
    await page.screenshot({path:process.env.ERROR_SCREENSHOT || '/tmp/methodatlas-errors-preview.png',fullPage:true});
    const project=await page.evaluate(()=>current.id);
    let rejected=0;
    await page.route(`**/api/projects/${project}`,route=>{rejected++;return route.abort('connectionrefused');});
    await page.evaluate(()=>refreshTask(null,viewGeneration,current.id,conversation.id));
    await page.getByText('暂时连接不上工作台，无法确认最新处理结果。已有内容和输入已保留；连接恢复后请刷新页面查看。',{exact:true}).waitFor();
    await page.waitForFunction(()=>pollFailures>=3);
    assert(rejected>=3 && posts.length===0,'Polling must not replay a mutation');
    assert.equal(await page.locator('#chat-input').inputValue(),'连接中断时保留我的草稿');
    await page.unroute(`**/api/projects/${project}`);
    await page.waitForFunction(()=>connectionWarning==='');
    await page.reload();
    await page.getByText('这次没有及时收到模型的完整回复。',{exact:false}).first().waitFor();
    assert.equal(await page.locator('#chat-input').inputValue(),'连接中断时保留我的草稿');
    await page.locator('#chat-input').fill('调整为一个问题后重新生成');
    await page.getByRole('button',{name:'发送任务',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-action=settings]') && document.getElementById('chat-body').textContent.includes('配置不可用'));
    assert.equal(posts.filter(url=>url.endsWith('/resume')).length,0);
    assert.equal(posts.filter(url=>url.endsWith('/messages')).length,1);
    assert(!(await page.locator('#chat-body').innerText()).includes('已保存：已完成的独立成果'));
    assert.equal(await page.locator('#chat-body .task-error,[data-control=resume],[data-control=retry],#chat-body [role=alert]').count(),0);
    await page.route('**/messages',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'目前找不到所需的材料或版本。',explanation:'请重新选择需要分析的材料，再发送新请求。'})}));
    await page.locator('#chat-input').fill('材料已移除后的请求');
    await page.getByRole('button',{name:'发送任务',exact:true}).click();
    await page.getByText('请重新选择需要分析的材料，再发送新请求。',{exact:true}).waitFor();
    assert.equal(await page.locator('#chat-input').inputValue(),'材料已移除后的请求');
    assert.deepEqual(errors,[]);
    console.log('PASS: safe errors, terminal explanations, fresh request, 3 failed polls recover without replay or draft loss');
  } finally {
    await browser?.close();server.kill('SIGINT');
    await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
    fs.rmSync(data,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
