const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
const os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const stopServer=require('./check-server.cjs');
(async()=>{
 let base=process.argv[2],server,browser;
 try{
 if(!base){
  const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'groups-ui-'));
  server=spawn(process.env.PYTHON||path.join(root,'.research-deps/Scripts/python.exe'),['-u','-m','backend.app','--port','0','--data-dir',data,'--pdf-dir',path.join(data,'no-papers')],{cwd:root,env:{...process.env,PYTHONUTF8:'1',DEEPSEEK_API_KEY:''},windowsHide:true});
  process.on('exit',()=>stopServer(server));base=await stopServer.ready(server);
 }
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();};
 const {project_id}=await post('/api/projects',{name:'实验组页面验收'});
 await post('/api/remote/servers/save',{name:'预览专用服务器',host:'127.0.0.1',port:1,username:''});
 browser=await chromium.launch({headless:true,channel:'chromium'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));let execution=0;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/confirm'))execution++;});
  await page.goto(base);
  await page.locator(`[data-action="open-project"][data-id="${project_id}"]`).click();
  await page.locator('[data-shell-view="remote"], [data-view="remote"]').first().waitFor({timeout:1500}).catch(()=>{});
  await page.getByRole('button',{name:'远程实验',exact:true}).first().click();
  await page.getByRole('button',{name:'新建计划',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('实验目标',{exact:true}).fill('固定数据上的baseline与对照');
  await dialog.getByLabel('已有原目录（只读，Linux 绝对路径）').fill('relative/path');
  await dialog.getByLabel('实验方案、数据集、指标和判定条件').fill('固定数据和随机种子，比较accuracy，负结果照常记录。');
  await dialog.getByLabel('实验步骤（每行一项，含 baseline 和对照/消融）').fill('baseline\n对照');
  await dialog.getByRole('button',{name:'预览实验组授权'}).click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByLabel('实验目标',{exact:true}).inputValue(),'固定数据上的baseline与对照');
  await dialog.getByLabel('已有原目录（只读，Linux 绝对路径）').fill('/tmp/experiment');
  await dialog.getByRole('button',{name:'预览实验组授权'}).click();
  await page.getByRole('button',{name:'确认实验组并开始'}).waitFor();
  assert.match(await page.locator('#chat-panel .panel-head').innerText(),/固定数据上的baseline与对照/);
  assert.equal(execution,0);
  assert.equal(await page.locator('.panels.output-collapsed').count(),1,'remote detail defaults to a wide canvas');
  await page.locator('[data-remote-toggle-output]').click();
  assert.equal(await page.locator('.panels.output-collapsed').count(),0,'results can be expanded');
  await page.locator('[data-remote-toggle-output]').click();
  assert.equal(await page.locator('.panels.output-collapsed').count(),1);
  assert(await page.getByText('固定数据和随机种子，比较accuracy，负结果照常记录。',{exact:true}).isVisible());
  await page.reload();
  await page.getByRole('button',{name:/固定数据上的baseline与对照/}).click();
  await page.getByRole('button',{name:'确认实验组并开始'}).waitFor();
  fs.mkdirSync('.check-data/issue79-ui/screenshots',{recursive:true});
  await page.screenshot({path:'.check-data/issue79-ui/screenshots/desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'.check-data/issue79-ui/screenshots/mobile.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'experiment view overflows narrow viewport');
  assert.deepEqual(errors,[]);assert.equal(execution,0);
  // Exercise active-group UI without authorizing SSH or model execution.
  await page.setViewportSize({width:1440,height:1000});
  await page.route(`**/api/projects/${project_id}/remote`,async route=>{
   const response=await route.fetch(),body=await response.json();
   body.groups.forEach(g=>g.status='active');await route.fulfill({json:body});
  });
  await page.getByRole('button',{name:'刷新实验组',exact:true}).click();
  const upload=page.locator('[data-group-upload]');await upload.waitFor();
  const uploads=[];let releaseUpload,uploadStarted;
  const uploadGate=new Promise(resolve=>releaseUpload=resolve),uploadRequest=new Promise(resolve=>uploadStarted=resolve);
  await page.route('**/groups/*/upload',async route=>{
   uploads.push(route.request().postDataJSON());
   if(uploads.length===1)return route.fulfill({status:400,json:{error:'上传测试：任务忙，请稍后重试'}});
   uploadStarted();await uploadGate;await route.fulfill({json:{path:'test.py'}});
  });
  const code={name:'test.py',mimeType:'text/plain',buffer:Buffer.from('print("验收代码")\n')};
  await upload.setInputFiles({...code,buffer:Buffer.alloc(65537,65)});
  await page.getByText('请选择不超过64 KiB的文本代码文件',{exact:true}).waitFor();
  await upload.setInputFiles({...code,buffer:Buffer.from([0xff,0xfe,0x41])});
  await page.getByText('请选择 UTF-8 编码的文本代码文件',{exact:true}).waitFor();
  await upload.setInputFiles({...code,buffer:Buffer.from([65,0,66])});
  await page.getByText('请选择文本代码文件，不能包含二进制内容',{exact:true}).waitFor();
  assert.equal(uploads.length,0,'invalid files must not reach the backend');
  await upload.setInputFiles(code);
  await page.getByText('上传测试：任务忙，请稍后重试',{exact:true}).waitFor();
  assert.equal(await upload.inputValue(),'','failed upload must allow selecting the same file again');
  await upload.setInputFiles(code);await uploadRequest;
  assert.equal(uploads.length,2);assert.equal(uploads[1].content,'print("验收代码")\n');
  await page.getByRole('button',{name:'AI 对话',exact:true}).first().click();
  await page.locator('#chat-input').waitFor();
  const completed=page.waitForResponse(r=>r.url().endsWith('/upload'));
  releaseUpload();await completed;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#chat-input').isVisible(),true,'late upload completion must not reopen the old group');
  assert.deepEqual(errors,[]);assert.equal(execution,0);
  // Plan-first navigation, uncertainty and preserved failed attempts; fixture never executes a command.
  await page.unroute(`**/api/projects/${project_id}/remote`);
  const state=await (await fetch(base+`/api/projects/${project_id}/remote`)).json();
  const group=state.groups[0];
  const prepared=await post(`/api/projects/${project_id}/remote/prepare`,{server_id:state.servers[0].id,directory:'/tmp/experiment',command:'printf fixture',name:'计划内运行'});
  const failed=await post(`/api/projects/${project_id}/remote/prepare`,{server_id:state.servers[0].id,directory:'/tmp/experiment',command:'printf fixture',name:'保留的失败尝试'});
  let planStatus='active',runStatus='unknown',runKind='repair',hasEvidence=false;
  await page.route(`**/api/projects/${project_id}/remote`,async route=>{
   const response=await route.fetch(),body=await response.json(),g=body.groups[0],run=body.experiments.find(e=>e.id===prepared.id);
   g.status=planStatus;g.completed_steps=[0];g.runs=[{id:failed.id,step:0,kind:'run',summary:'负结果仍保留',record:{metrics:{delta:-0.2}}},{id:run.id,step:1,kind:runKind,summary:'证据不足，待恢复观察',...(hasEvidence ? {evidence:{id:'fixture_evidence'}} : {})}];
   const old=body.experiments.find(e=>e.id===failed.id);old.status='failed';old.job={exitCode:2};old.spec.sandbox={group_id:g.id};
   run.status=runStatus;run.spec.sandbox={group_id:g.id};
   body.groups.unshift({...g,id:'group_completed_fixture',spec:{...g.spec,title:'历史已完成计划'},status:'completed',completed_steps:[0,1],runs:[]});
   await route.fulfill({json:body});
  });
  await page.getByRole('button',{name:'远程实验',exact:true}).first().click();
  await page.getByRole('button',{name:'刷新实验组',exact:true}).click();
  assert.equal(await page.locator('#source-body [data-experiment]').first().getAttribute('data-experiment'),group.id,'unresolved plans come first');
  assert.equal(await page.locator(`#source-body [data-experiment="${prepared.id}"]`).count(),0,'plan runs must not be duplicated in the rail');
  assert.match(await page.locator('.remote-steps').innerText(),/baseline\s+已归档[\s\S]*对照\s+未归档\s+状态未知/);
  assert(await page.getByRole('button',{name:'暂停 AI 后续操作',exact:true}).isVisible());
  assert.equal(await page.locator('#source-body [data-experiment]').count(),2);
  assert.match(await page.locator('#chat-body table').innerText(),/-0.2/);
  assert(await page.getByText('负结果仍保留',{exact:true}).isVisible());
  await page.locator(`.remote-steps [data-experiment="${prepared.id}"]`).click();
  await page.locator('[data-job-notice]').filter({hasText:'无法确认远端状态'}).waitFor();
  assert.equal(await page.locator('[data-confirm]').count(),0,'group run cannot request a second authorization');
  await page.getByRole('button',{name:/返回计划：/}).click();
  await page.getByRole('button',{name:'暂停 AI 后续操作',exact:true}).waitFor();
  assert.match(await page.locator('.remote-steps li').first().innerText(),/已归档\s+执行失败/,'archiving a negative result must not erase its failed execution');
  for (const [status,kind,evidence,expected] of [
    ['succeeded','run',false,'执行成功，待固定结果'],
    ['succeeded','run',true,'执行成功，证据已固定'],
    ['succeeded','setup',true,'环境准备 · 执行成功，待提交实验'],
    ['running','run',false,'运行中'],
    ['unknown','run',false,'状态未知'],
  ]) {
    runStatus=status;runKind=kind;hasEvidence=evidence;
    await page.getByRole('button',{name:'刷新实验组',exact:true}).click();
    const row=await page.locator('.remote-steps li').nth(1).innerText();
    assert(row.includes(expected),row);assert(row.includes('未归档'),row);
    assert.match(await page.locator('.remote-steps li').first().innerText(),/执行失败/,'each step keeps its own run history');
  }
  planStatus='paused';await page.getByRole('button',{name:'刷新实验组',exact:true}).click();
  await page.getByRole('button',{name:'恢复 AI 推进',exact:true}).waitFor();
  await page.locator('[data-remote-section="servers"] > summary').click();
  await page.getByRole('button',{name:'刷新实验组',exact:true}).click();
  assert.equal(await page.locator('[data-remote-section="servers"]').evaluate(n=>n.open),false,'refresh preserves server folding');
  await page.getByRole('button',{name:'与 AI 规划实验',exact:true}).click();
  assert.match(await page.locator('#chat-input').inputValue(),/制定实验计划/);
  assert.deepEqual(errors,[]);assert.equal(execution,0);
  await page.unrouteAll({behavior:'wait'});
  console.log('PASS group UI: plan-first navigation, unknown recovery, negative results, pause/resume controls, folding, AI draft;  authorization preview, validation, reload, desktop/mobile; controlled active UI covers upload validation, same-file retry and navigation isolation; no remote execution');
 }finally{await browser?.close();stopServer(server);}
})().catch(e=>{console.error(e);process.exitCode=1;});
