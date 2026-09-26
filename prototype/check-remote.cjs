// Real workbench UI, isolated validation project. Never confirms remote execution.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const fs = require('node:fs');
(async () => {
  const base=process.argv[2]; assert(base,'Provide isolated workbench URL');
  const response=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'远程实验页面检查'})});
  const {project_id:project}=await response.json();
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let executions=0,messages=0;
    page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/confirm'))executions++;if(r.method()==='POST'&&r.url().endsWith('/messages'))messages++;});
    await page.goto(base);
    await page.locator(`[data-action="open-project"][data-id="${project}"]`).click();
    await page.getByLabel('项目菜单').click();
    await page.locator('[data-remote-open]').click();
    const dialog=page.getByRole('dialog',{name:'远程实验',exact:true});
    await dialog.getByText('共用服务器 · 登记与编辑',{exact:true}).click();
    await dialog.getByLabel('名称',{exact:true}).fill('只读页面检查');
    await dialog.getByLabel('主机名或 OpenSSH Host 别名').fill('127.0.0.1');
    await dialog.getByLabel('端口',{exact:true}).fill('1');
    await dialog.getByRole('button',{name:'保存服务器',exact:true}).click();
    await dialog.locator('[data-experiment-form] select').selectOption({label:'只读页面检查 · 127.0.0.1'});
    await dialog.getByLabel('已有实验目录（Linux 绝对路径）').fill('/tmp/methodatlas-check');
    await dialog.getByLabel('实际执行命令').fill('printf "review only"');
    await dialog.getByRole('button',{name:'预览授权内容',exact:true}).click();
    await dialog.locator('[data-confirm]').waitFor();
    assert.equal(executions,0);
    const state=await (await fetch(base+`/api/projects/${project}/remote`)).json();
    assert.equal(state.experiments.length,1);assert.equal(state.experiments[0].status,'awaiting_confirmation');
    await dialog.getByRole('button',{name:'带回对话分析结果'}).click();
    assert((await page.locator('#chat-input').inputValue()).includes(state.experiments[0].id));assert.equal(messages,0);
    await page.getByLabel('项目菜单').click();await page.locator('[data-remote-open]').click();
    await dialog.locator('[data-experiment]').first().click();await dialog.locator('[data-confirm]').waitFor();
    fs.mkdirSync('.check-data/issue57-ui',{recursive:true});
    await page.screenshot({path:'.check-data/issue57-ui/remote-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'.check-data/issue57-ui/remote-mobile.png'});
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
    assert.equal(executions,0);assert.deepEqual(errors,[]);
    console.log('PASS remote UI: save, exact authorization preview, persistence, keyboard close, analysis draft; zero executions/messages');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
