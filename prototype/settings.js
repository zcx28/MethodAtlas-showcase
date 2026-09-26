(() => {
  const defaults = {theme:'system',accent:'blue',density:'comfortable',typeScale:100,motion:'system',readerMode:'responsive',language:'auto'};
  const colors = {blue:'#246bdb',violet:'#7951bd',teal:'#167c78',rose:'#b74669',orange:'#a96017'};
  let preferences;
  try { preferences = {...defaults,...JSON.parse(localStorage.getItem('methodatlas-preferences') || '{}')}; } catch { preferences = {...defaults}; }
  preferences.typeScale = Math.max(85,Math.min(150,Number(preferences.typeScale !== 100 ? preferences.typeScale : (preferences.chatSize ? preferences.chatSize / 15 * 100 : 100)) || 100));
  delete preferences.chatSize; delete preferences.readerSize;
  let data = null, tab = 'appearance', editing = '', busy = false, error = '';
  const dark = matchMedia('(prefers-color-scheme: dark)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => preferences.motion === 'reduce' || reduced.matches;
  const dialog = document.getElementById('settings-dialog');
  function apply() {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme === 'system' ? (dark.matches ? 'dark' : 'light') : preferences.theme;
    root.dataset.density = preferences.density;
    root.dataset.motion = reducedMotion() ? 'reduce' : 'system';
    root.style.setProperty('--accent',root.dataset.theme==='dark' ? ({blue:'#7eafff',violet:'#bf9aef',teal:'#6acbc5',rose:'#f595b4',orange:'#e6af70'}[preferences.accent] || '#7eafff') : (colors[preferences.accent] || colors.blue));
    root.style.setProperty('--ui-scale',Math.max(85,Math.min(150,Number(preferences.typeScale) || 100)) / 100);
    window.dispatchEvent(new Event('typographychange'));
    if(reducedMotion()) document.getAnimations().forEach(animation => animation.cancel());
  }
  function persist() { localStorage.setItem('methodatlas-preferences',JSON.stringify(preferences)); apply(); }
  dark.addEventListener('change',apply); reduced.addEventListener('change',apply);
  window.addEventListener('storage',event => {if(event.key==='methodatlas-preferences'){try {preferences={...defaults,...JSON.parse(event.newValue||'{}')};apply();}catch{}}});
  const select = (name, value, choices, attrs='') => `<select ${attrs} data-pref="${name}">${choices.map(([key,label])=>`<option value="${key}" ${key===value?'selected':''}>${label}</option>`).join('')}</select>`;
  const row = (title, note, control) => `<div class="setting-row"><div><strong>${title}</strong>${note?`<small>${note}</small>`:''}</div>${control}</div>`;
  function appearance() {
    return `<h3>外观与阅读</h3><p class="setting-intro">调整工作台，让长时间阅读更舒适。偏好自动保存在此浏览器。</p>
      ${row('主题','原 PDF 和导出文件保留原配色',select('theme',preferences.theme,[['system','跟随系统'],['light','浅色'],['dark','深色']],'aria-label="主题"'))}
      ${row('主题色','按钮、图标、选中态与焦点统一配色',`<div class="setting-colors" role="group" aria-label="主题色">${Object.entries(colors).map(([key,color])=>`<button type="button" data-color="${key}" aria-label="${({blue:'蓝色',violet:'紫色',teal:'青色',rose:'玫红',orange:'橙色'})[key]}" aria-pressed="${preferences.accent===key}" style="--swatch:${color}">${preferences.accent===key?'✓':''}</button>`).join('')}</div>`)}
      ${row('界面密度','调整列表和控件间距',select('density',preferences.density,[['comfortable','舒适'],['compact','紧凑']],'aria-label="界面密度"'))}
      ${row('全局字号',`当前 ${Math.round(preferences.typeScale)}% · 字体与布局同步缩放`,`<input type="range" min="85" max="150" step="5" value="${preferences.typeScale}" data-pref="typeScale" aria-label="全局字号">`)}
      ${row('动态效果','遵循系统的减少动态效果偏好',select('motion',preferences.motion,[['system','跟随系统'],['reduce','减少动效']],'aria-label="动态效果"'))}
      ${row('默认阅读方式','已读文献继续恢复原位置与模式',select('readerMode',preferences.readerMode,[['responsive','排版正文'],['original','原 PDF']],'aria-label="默认阅读方式"'))}
      <div class="setting-reading-preview"><small>阅读预览</small><p>先理解研究问题，再回到论文核对证据。</p></div>`;
  }
  function workspace() {
    return `<h3>研究与工作区</h3><p class="setting-intro">回答风格、思考强度和深度调研在聊天框调整。</p>
      ${row('默认回答语言','单次提问中的明确要求优先',select('language',preferences.language,[['auto','跟随提问'],['zh','中文'],['en','English']],'aria-label="默认回答语言"'))}
      ${row('项目视图','项目首页的展示方式',`<select id="settings-view" aria-label="项目视图"><option value="grid" ${projectView==='grid'?'selected':''}>网格</option><option value="list" ${projectView==='list'?'selected':''}>列表</option></select>`)}
      ${row('项目排序','项目首页的排列顺序',`<select id="settings-sort" aria-label="项目排序"><option value="recent" ${projectSort==='recent'?'selected':''}>最近</option><option value="name" ${projectSort==='name'?'selected':''}>名称</option></select>`)}
      ${row('工作区栏宽','恢复来源、对话和成果的默认比例','<button type="button" data-setting-action="layout">恢复栏宽</button>')}
      ${row('论文订阅','沿用当前项目的订阅设置',`<button type="button" data-setting-action="subscriptions" ${current && document.getElementById('chat-panel')?'':'disabled'}>管理订阅</button>`)}
      ${row('研究回顾','沿用当前项目的时间、范围与通知',`<button type="button" data-setting-action="progress" ${current && document.getElementById('chat-panel')?'':'disabled'}>任务设置</button>`)}
      ${!document.getElementById('chat-panel')?'<p class="setting-intro">进入研究项目后可管理其自动任务。</p>':''}`;
  }
  function models() {
    if(!data) return '<p role="status">正在读取模型连接…</p>';
    const item = data.connections.find(c=>c.id===editing);
    const value = item || {name:'',model:'',base_url:'https://api.openai.com/v1',protocol:'openai',reasoning:'none',context_window:128000,max_output:32768,token_field:'max_tokens'};
    const field = (name,label,type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value[name]||'')}" ${extra}></label>`;
    return `<h3>模型连接</h3><p class="setting-intro">聊天和后台任务优先使用自定义模型。没有自定义连接时使用应用默认模型：<strong>${esc(data.fallback.model)}</strong>。</p>
      <div class="connection-list">${data.connections.map(c=>`<article class="connection-card ${c.id===editing?'selected':''}"><div><strong>${esc(c.name)}</strong>${data.default_id===c.id?'<span class="badge">默认</span>':''}<small>${esc(c.model)} · ${c.protocol==='deepseek'?'DeepSeek':'OpenAI 兼容'}</small><small>${c.tested_at?`最近测试：${new Date(c.tested_at).toLocaleString()}`:'尚未测试'}</small></div><div class="connection-actions"><button type="button" data-model-action="edit" data-id="${c.id}">编辑</button><button type="button" data-model-action="test" data-id="${c.id}">测试能力</button>${data.default_id===c.id?'':`<button type="button" data-model-action="default" data-id="${c.id}">设为默认</button>`}<button type="button" class="danger" data-model-action="delete" data-id="${c.id}">删除</button></div>${c.checks && Object.keys(c.checks).length?`<ul class="connection-checks">${Object.entries(c.checks).map(([key,check])=>`<li>${check.ok?'✓':'!'} ${({chat:'对话',tools:'工具调用',vision:'图像',low:'低强度',medium:'中强度',high:'高强度'})[key]}：${esc(check.message)}</li>`).join('')}</ul>`:''}</article>`).join('') || '<p class="setting-empty">目前使用应用默认模型。添加自己的连接后可随时切换。</p>'}</div>
      <form id="model-connection-form" class="connection-form"><div class="row between"><h4>${item?'编辑连接':'添加连接'}</h4>${item?'<button type="button" data-model-action="new">新建连接</button>':''}</div>
      ${field('name','连接名称','text','required maxlength="80" placeholder="例如：我的研究模型"')}
      <label>接口类型<select name="protocol"><option value="openai" ${value.protocol==='openai'?'selected':''}>OpenAI / Chat Completions 兼容</option><option value="deepseek" ${value.protocol==='deepseek'?'selected':''}>DeepSeek</option></select></label>
      ${field('base_url','API 地址','url','required placeholder="https://…/v1"')}${field('model','模型 ID','text','required maxlength="200"')}
      <label>API Key<input name="api_key" type="password" autocomplete="new-password" spellcheck="false" placeholder="${item?.has_key?'已保存；留空保留原密钥':'输入密钥，仅保存在本机后台'}"></label>
      <details><summary>模型能力与兼容选项</summary><label>思考参数<select name="reasoning"><option value="none" ${value.reasoning==='none'?'selected':''}>不启用可调思考</option><option value="openai" ${value.reasoning==='openai'?'selected':''}>OpenAI reasoning_effort</option><option value="deepseek" ${value.reasoning==='deepseek'?'selected':''}>DeepSeek thinking</option></select></label><small>只有通过接口测试的档位才显示在聊天框中。参数被接受不代表能独立证明模型内部思考过程。</small>${field('context_window','模型上下文容量','number','min="4096" max="2000000"')}${field('max_output','单次输出上限（tokens）','number','min="256" max="131072"')}<small>填写供应商支持的上限，不是字数。长文建议 32768 或以上（须模型支持）；各研究步骤按需使用预算，不会每次都输出到上限。</small><label>输出上限参数<select name="token_field"><option value="max_tokens" ${value.token_field==='max_tokens'?'selected':''}>max_tokens</option><option value="max_completion_tokens" ${value.token_field==='max_completion_tokens'?'selected':''}>max_completion_tokens</option></select></label></details>
      <label class="connection-default"><input name="make_default" type="checkbox" ${!data.connections.length || data.default_id===editing?'checked':''}>设为默认，供新对话和后台任务使用</label><button class="primary" type="submit">保存连接</button><small>保存后点击“测试能力”会发起少量模型请求。</small></form>`;
  }
  function status() {
    return `<h3>数据与关于</h3><p class="setting-intro">MethodAtlas · 个人研究工作台</p>${row('后台服务',data?'本地后台正在运行':'尚未取得后台状态',`<button type="button" data-setting-action="refresh">刷新状态</button>`)}${row('数据保存位置','论文、对话和成果保存在本机',`<code class="settings-path">${esc(data?.data_directory || '正在读取…')}</code>`)}${row('自动任务','后台运行时执行；休眠或关闭后恢复补跑','')}<p class="setting-intro">${esc(data?.version || '')}</p>${row('恢复默认偏好','恢复外观、阅读、语言和布局；保留模型连接、项目、草稿及成果','<button type="button" data-setting-action="reset">恢复默认偏好</button>')}`;
  }
  function render() {
    dialog.innerHTML = `<header class="settings-heading"><div><h2 id="settings-title">设置</h2><p>让工作台适合你的研究习惯</p></div><button type="button" class="icon" data-setting-action="close" aria-label="关闭设置">×</button></header><div class="settings-layout"><nav aria-label="设置分类">${[['appearance','外观与阅读'],['workspace','研究与工作区'],['models','模型连接'],['status','数据与关于']].map(([key,label])=>`<button type="button" data-settings-tab="${key}" ${tab===key?'aria-current="page"':''}>${label}</button>`).join('')}</nav><section class="settings-content"><div id="settings-feedback" role="${error?'alert':'status'}">${esc(error || (busy?'正在检查模型接口，请稍候…':''))}</div><fieldset ${busy?'disabled':''}>${({appearance,workspace,models,status})[tab]()}</fieldset></section></div>`;
  }
  async function load() { data = await api('/api/settings'); preferences.language=data.language || 'auto'; return data; }
  async function open() { error='';render();dialog.showModal();try{await load();render();}catch(e){error=e.message;render();} }
  const options = () => ({connection_id:null,effort:'auto',style:'balanced',...conversation?.chat_options,language:preferences.language});
  function selectedConfig(opts=options()) {
    const id = opts.connection_id === null ? data?.default_id : opts.connection_id;
    return data?.connections.find(c=>c.id===id) || (id ? null : data?.fallback);
  }
  // Native selects keep nested choices outside the popover scroll clip.
  function controls() {
    const opts=options(), cfg=selectedConfig(opts), known = !!data;
    return `<div class="chat-preferences" id="chat-preferences"><button type="button" class="chat-model-trigger" popovertarget="chat-model-menu" aria-label="模型与思考强度" title="${esc(cfg?.model || '选择模型')} · ${({auto:'默认',off:'关闭',low:'低',medium:'中',high:'高'})[opts.effort]}"><span>${esc(cfg?.model || '选择模型')}</span><span>· ${({auto:'默认',off:'关闭',low:'低',medium:'中',high:'高'})[opts.effort]} ▾</span></button><div id="chat-model-menu" popover><label class="chat-model"><span class="sr-only">聊天模型</span><select data-enhanced="native" data-chat-pref="connection_id" aria-label="聊天模型" ${known?'':'disabled'}><option value="default" ${opts.connection_id===null?'selected':''}>${esc(selectedConfig({...opts,connection_id:null})?.model || '加载中')}</option>${data?.connections.map(c=>`<option value="${c.id}" ${opts.connection_id===c.id?'selected':''}>${esc(c.name)} · ${esc(c.model)}</option>`).join('') || ''}${opts.connection_id && !cfg?'<option selected disabled>连接已删除，请重新选择</option>':''}</select></label>
      <label><span class="sr-only">思考强度</span><select data-enhanced="native" data-chat-pref="effort" aria-label="思考强度" ${known?'':'disabled'}>${[['auto','思考：默认'],['off','思考：关闭'],['low','思考：低'],['medium','思考：中'],['high','思考：高']].map(([key,label])=>`<option value="${key}" ${opts.effort===key?'selected':''} ${key!=='auto' && !cfg?.efforts?.includes(key)?'disabled':''}>${label}</option>`).join('')}</select></label>
      </div><label class="chat-style"><span class="sr-only">回答风格</span><select data-chat-pref="style" aria-label="回答风格">${[['brief','简明结论'],['balanced','均衡解释'],['detailed','详细分析']].map(([key,label])=>`<option value="${key}" ${opts.style===key?'selected':''}>${label}</option>`).join('')}</select></label>
      </div>`;
  }
  function positionModelMenu() {
    const menu=document.getElementById('chat-model-menu'), trigger=document.querySelector('.chat-model-trigger');
    if(!menu || !trigger || !menu.matches(':popover-open'))return;
    const rect=trigger.getBoundingClientRect();
    Object.assign(menu.style,{left:`${Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))}px`,bottom:`${Math.max(8,innerHeight-rect.top+6)}px`,maxHeight:`${Math.max(80,rect.top-14)}px`});
  }
  document.addEventListener('toggle',event=>{if(event.target.id==='chat-model-menu')positionModelMenu();},true);
  window.addEventListener('resize',positionModelMenu);
  function refreshControls() {
    const target=document.getElementById('chat-preferences'), opened=document.getElementById('chat-model-menu')?.matches(':popover-open');
    const focus=document.activeElement?.dataset.chatPref;
    if(target){target.outerHTML=controls();if(opened){document.getElementById('chat-model-menu').showPopover();positionModelMenu();if(focus)document.querySelector(`[data-chat-pref="${focus}"]`)?.focus();}}
  }
  let saving = Promise.resolve();
  document.addEventListener('change',event=>{
    const pref=event.target.dataset.pref;
    if(pref){preferences[pref]=event.target.type==='range'?Number(event.target.value):event.target.value;try{persist();}catch(e){toast('无法保存浏览器偏好');}if(pref==='language')api('/api/settings/preferences',{method:'POST',body:JSON.stringify({language:preferences.language})}).catch(e=>toast(e.message));if(event.target.type!=='range'){render();dialog.querySelector(`[data-pref="${pref}"]`)?.focus();}refreshControls();}
    if(event.target.name==='protocol' && event.target.closest('#model-connection-form')){
      const form=event.target.form, ds=event.target.value==='deepseek';form.elements.reasoning.value=ds?'deepseek':'none';form.elements.base_url.value=ds?'https://api.deepseek.com':'https://api.openai.com/v1';form.elements.token_field.value='max_tokens';
    }
    const chatPref=event.target.dataset.chatPref;
    if(chatPref && conversation){
      const old={...options()}, cid=conversation.id, pid=current.id;
      const next={...old,[chatPref]:chatPref==='connection_id' && event.target.value==='default'?null:event.target.value};
      if(chatPref==='connection_id')next.effort='auto';
      conversation.chat_options=next;refreshControls();
      saving=saving.catch(()=>{}).then(()=>api(`/api/projects/${pid}/conversations/${cid}/preferences`,{method:'POST',body:JSON.stringify(next)})).catch(e=>{if(conversation?.id===cid){conversation.chat_options=old;refreshControls();}toast(e.message);});
    }
  });
  document.addEventListener('input',event=>{if(event.target.type==='range' && event.target.dataset.pref){preferences[event.target.dataset.pref]=Number(event.target.value);persist();event.target.previousElementSibling?.querySelector('small')?.replaceChildren(`当前 ${event.target.value}% · 字体与布局同步缩放`);}});
  document.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.settingsTab){tab=target.dataset.settingsTab;error='';render();dialog.querySelector(`[data-settings-tab="${tab}"]`)?.focus();}
    if(target.dataset.color){preferences.accent=target.dataset.color;persist();render();dialog.querySelector(`[data-color="${preferences.accent}"]`)?.focus();}
    const action=target.dataset.settingAction;
    if(action==='close')dialog.close();
    if(action==='layout'){localStorage.removeItem('panel-widths');if(document.querySelector('.panels')){['source','chat','studio'].forEach(name=>document.querySelector('.panels').style.removeProperty(`--${name}-width`));restorePanelSizes();}toast('已恢复默认栏宽');}
    if(action==='reset' && confirm('恢复外观、阅读、语言和布局偏好？模型连接及研究数据保留。')){preferences={...defaults};api('/api/settings/preferences',{method:'POST',body:JSON.stringify({language:'auto'})}).catch(e=>toast(e.message));projectView='grid';projectSort='recent';localStorage.setItem('project-view','grid');localStorage.setItem('project-sort','recent');localStorage.removeItem('panel-widths');if(document.querySelector('.panels')){['source','chat','studio'].forEach(name=>document.querySelector('.panels').style.removeProperty(`--${name}-width`));restorePanelSizes();}persist();render();refreshControls();if(document.getElementById('project-grid'))renderProjects();}
    if(action==='refresh'){try{await load();error='';}catch(e){error=e.message;}render();}
    if(['subscriptions','progress'].includes(action)){dialog.close();switchShellView(action);if(action==='progress')window.MethodAtlasProgress?.settings?.();}
    const modelAction=target.dataset.modelAction;
    if(modelAction==='edit'){editing=target.dataset.id;render();}
    if(modelAction==='new'){editing='';render();}
    if(['test','default','delete'].includes(modelAction)){
      if(modelAction==='delete' && !confirm('删除这个连接？已有任务仍使用启动时的配置；选用此连接的对话需要重新选择。'))return;
      busy=true;error='';render();try{data=await api('/api/settings/models/'+modelAction,{method:'POST',body:JSON.stringify({id:target.dataset.id})});if(modelAction==='delete')editing='';}catch(e){error=e.message;}finally{busy=false;render();refreshControls();}
    }
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='model-connection-form')return;event.preventDefault();
    if(busy)return;
    const fields=Object.fromEntries(new FormData(event.target));fields.context_window=Number(fields.context_window);fields.max_output=Number(fields.max_output);fields.make_default=fields.make_default==='on';if(editing)fields.id=editing;
    busy=true;error='';event.target.querySelector('[type=submit]').disabled=true;try{data=await api('/api/settings/models/save',{method:'POST',body:JSON.stringify(fields)});editing='';toast('模型连接已保存，请测试能力后使用研究工具。');}catch(e){error=e.message;}finally{busy=false;if(!error)render();else{const feedback=dialog.querySelector('#settings-feedback');feedback.textContent=error;feedback.setAttribute('role','alert');event.target.querySelector('[type=submit]').disabled=false;}refreshControls();}
  });
  window.MethodAtlasSettings={open,controls,options,preferences:()=>preferences,reducedMotion,request:()=>({chat_options:options(),deep_research:false}),sent:refreshControls};
  apply();load().then(refreshControls).catch(()=>{});
})();
