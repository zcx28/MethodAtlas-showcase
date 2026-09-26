const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const base=process.argv[2];assert(base);
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();};
 const {project_id}=await post('/api/projects',{name:'实验组页面验收'});
 await post('/api/remote/servers/save',{name:'预览专用服务器',host:'127.0.0.1',port:1,username:''});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
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
  await dialog.getByLabel('已有原目录（只读，Linux 绝对路径）').fill('/tmp/experiment');
  await dialog.getByLabel('实验方案、数据集、指标和判定条件').fill('固定数据和随机种子，比较accuracy，负结果照常记录。');
  await dialog.getByLabel('实验步骤（每行一项，含 baseline 和对照/消融）').fill('baseline\n对照');
  await dialog.getByRole('button',{name:'预览实验组授权'}).click();
  await page.getByRole('button',{name:'确认实验组并开始'}).waitFor();
  assert.equal(execution,0);
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
  console.log('PASS real browser: prepare group, exact authorization, reload persistence, desktop/mobile; no remote execution');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
