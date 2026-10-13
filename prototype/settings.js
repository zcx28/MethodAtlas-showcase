(() => {
  const defaults = {theme:'system',accent:'blue',density:'comfortable',typeScale:100,motion:'system',readerMode:'original',language:'auto'};
  const colors = {blue:'#246bdb',violet:'#7951bd',teal:'#167c78',rose:'#b74669',orange:'#a96017'};
  let preferences;
  try { preferences = {...defaults,...JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem('methodatlas-preferences') || '{}')}; } catch { preferences = {...defaults}; }
  preferences.typeScale = Math.max(85,Math.min(150,Number(preferences.typeScale !== 100 ? preferences.typeScale : (preferences.chatSize ? preferences.chatSize / 15 * 100 : 100)) || 100));
  delete preferences.chatSize; delete preferences.readerSize;
  let data = null, tab = 'appearance', editing = '', busy = false, error = '';
  let projectData = null, loadedScope = '', loading = 0;
  let resourceData = [];
  const online = () => !!state?.collaboration;
  const team = () => state?.workspaces?.find(w => w.id === (current?.workspace_id || window.MethodAtlasCollaboration?.selectedWorkspace())) || state?.workspaces?.[0];
  const canManage = () => !online() || team()?.role === 'owner';
  const modelPath = () => online() ? `/api/workspaces/${team()?.id}/model-settings` : '/api/settings/models';
  const saveLanguage = language => online() ? Promise.resolve() : api('/api/settings/preferences',{method:'POST',body:JSON.stringify({language})});
  function modelActions(c) {
    if (!canManage()) return '';
    let html = `<button type="button" data-model-action="edit" data-id="${c.id}">编辑</button><button type="button" data-model-action="test" data-id="${c.id}">测试能力</button>${data.default_id===c.id?'':`<button type="button" data-model-action="default" data-id="${c.id}">${online()?'设为团队默认':'设为默认'}</button>`}<button type="button" class="danger" data-model-action="delete" data-id="${c.id}">删除</button>`;
    if (online() && current) {
      const granted = projectData?.connections.some(value => value.id === c.id);
      html += `<button type="button" data-model-action="${granted?'revoke':'grant'}" data-id="${c.id}">${granted?'撤销项目使用':'允许本项目使用'}</button>`;
      if (granted && projectData.default_id !== c.id) html += `<button type="button" data-model-action="grant" data-id="${c.id}">设为项目默认</button>`;
      if (projectData?.default_id === c.id) html += '<span class="badge">项目默认</span>';
    }
    return html;
  }
  const modelDrafts = new Map(); // In-memory only: API keys must not enter browser storage.
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
  function persist() { (globalThis.MethodAtlasStorage?.local || localStorage).setItem('methodatlas-preferences',JSON.stringify(preferences)); apply(); }
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
  function resources() {
    const number = value => Number(value || 0).toLocaleString();
    return `<h3>并发与用量</h3><p class="setting-intro">全站最多同时执行 ${resourceData[0]?.global_parallel_runs || 5} 个 AI 运行；团队和项目限制同时生效。同一对话依次执行，超出容量自动等待。降低限制不打断已经开始的调用。</p>${resourceData.map(item => `<section><h4>${item.scope==='workspace'?'团队':'当前项目'}</h4><form data-resource-scope="${item.scope}" data-resource-id="${esc(item.scope_id)}"><label>最多并发运行数 <input name="parallel_runs" aria-label="${item.scope==='workspace'?'团队':'项目'}并发运行数" type="number" min="1" max="5" step="1" required value="${item.parallel_runs}" ${item.can_manage?'':'disabled'}></label><label>本月 Token 额度（留空不限制）<input name="monthly_tokens" type="number" min="1" max="1000000000000" step="1" value="${item.monthly_tokens ?? ''}" ${item.can_manage?'':'disabled'}></label><label>本月费用额度（元，留空不限制）<input name="monthly_yuan" type="number" min="0.01" max="1000000000" step="0.01" value="${item.monthly_yuan ?? ''}" ${item.can_manage?'':'disabled'}></label>${item.can_manage?'<button type="submit">保存限制</button>':''}</form><p>本月已结算及预留 ${number(item.token_budget_usage?.tokens)} Token；已有单价的请求估算 ${number((item.cost_budget_usage?.cost || 0)/1000000)} 元。未设置单价的调用无法估算费用。${item.token_budget_usage?.uncertain ? '部分请求结果不确定，暂保留其预留额度。' : ''}</p><p>每月按 UTC 重置。首次开启或关闭后重新开启，从保存时开始累计。费用按模型连接填写的单价估算；请求前预留输入及最大输出，完成后按返回用量结算。</p><p>当前最多 ${item.effective_parallel_runs} 项。${item.usage_scope==='self'?'以下仅显示你的用量。':'以下按使用人和模型汇总，不展示私人对话内容。'}</p>${item.usage.length?`<div style="overflow-x:auto"><table><thead><tr><th>使用人 / 模型</th><th>调用</th><th>输入</th><th>缓存读取</th><th>输出</th><th>其中推理</th></tr></thead><tbody>${item.usage.map(value => `<tr><td>${esc(value.email || '迁移前记录')}<br>${esc(value.model)}</td>${['calls','inputTokens','cacheReadTokens','outputTokens','reasoningTokens'].map(key=>`<td>${number(value[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p>尚无模型用量记录。</p>'}</section>`).join('') || '<p>进入项目后查看并发限制与用量。</p>'}<p class="setting-intro">用量为模型返回的累计 token 记录，未返回用量的请求不计入。推理属于输出的子集；各字段不直接相加，也不换算为账单金额。</p><button type="button" data-setting-action="refresh">刷新用量</button>`;
  }
  function models() {
    if(!data) return '<p role="status">正在读取模型连接…</p>';
    if (online() && !team()) return '<p>先创建或加入团队，再配置研究模型。</p>';
    const item = data.connections.find(c=>c.id===editing);
    const value = item || {name:'',model:'',base_url:'https://api.openai.com/v1',protocol:'openai',reasoning:'none',context_window:128000,max_output:32768,token_field:'max_tokens'};
    const field = (name,label,type='text',extra='') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value[name]||'')}" ${extra}></label>`;
    return `<h3>模型连接</h3><p class="setting-intro">${online() ? `团队：${esc(team()?.name || "")}。${canManage() ? "连接由团队管理；进入项目后授权，成员才能使用。" : "仅显示本项目获授权的模型，连接由团队负责人管理。"}` : `聊天和后台任务优先使用自定义模型。没有自定义连接时使用应用默认模型：<strong>${esc(data.fallback.model)}</strong>。`}</p>
      <div class="connection-list">${data.connections.map(c=>`<article class="connection-card ${c.id===editing?'selected':''}"><div><strong>${esc(c.name)}</strong>${data.default_id===c.id?'<span class="badge">默认</span>':''}<small>${esc(c.model)} · ${c.protocol==='deepseek'?'DeepSeek':'OpenAI 兼容'}</small><small>${c.tested_at?`最近测试：${new Date(c.tested_at).toLocaleString()}`:'尚未测试'}</small></div><div class="connection-actions">${modelActions(c)}</div>${c.checks && Object.keys(c.checks).length?`<ul class="connection-checks">${Object.entries(c.checks).map(([key,check])=>`<li>${check.ok?'✓':'!'} ${({chat:'对话',tools:'工具调用',vision:'图像',low:'低强度',medium:'中强度',high:'高强度'})[key]}：${esc(check.message)}</li>`).join('')}</ul>`:''}</article>`).join('') || `<p class="setting-empty">${online() ? '尚无可用连接，请由团队负责人添加并授权给项目。' : '目前使用应用默认模型。添加自己的连接后可随时切换。'}</p>`}</div>
      ${canManage() ? `<form id="model-connection-form" class="connection-form" data-connection="${esc(editing)}"><div class="row between"><h4>${item?'编辑连接':'添加连接'}</h4>${item?'<button type="button" data-model-action="new">新建连接</button>':''}</div>
      ${field('name','连接名称','text','required maxlength="80" placeholder="例如：我的研究模型"')}
      <label>接口类型<select name="protocol"><option value="openai" ${value.protocol==='openai'?'selected':''}>OpenAI / Chat Completions 兼容</option><option value="deepseek" ${value.protocol==='deepseek'?'selected':''}>DeepSeek</option></select></label>
      ${field('base_url','API 地址','url','required placeholder="https://…/v1"')}${field('model','模型 ID','text','required maxlength="200"')}
      <label>API Key<input name="api_key" type="password" autocomplete="new-password" spellcheck="false" placeholder="${item?.has_key?'已保存；留空保留原密钥':'输入密钥，仅保存在服务端'}"></label>
      <details><summary>模型能力与兼容选项</summary><label>思考参数<select name="reasoning"><option value="none" ${value.reasoning==='none'?'selected':''}>不启用可调思考</option><option value="openai" ${value.reasoning==='openai'?'selected':''}>OpenAI reasoning_effort</option><option value="deepseek" ${value.reasoning==='deepseek'?'selected':''}>DeepSeek thinking</option></select></label><small>只有通过接口测试的档位才显示在聊天框中。参数被接受不代表能独立证明模型内部思考过程。</small>${field('context_window','模型上下文容量','number','min="4096" max="2000000"')}${field('max_output','单次输出上限（tokens）','number','min="256" max="131072"')}<small>填写供应商支持的上限，不是字数。长文建议 32768 或以上（须模型支持）；各研究步骤按需使用预算，不会每次都输出到上限。</small><label>输出上限参数<select name="token_field"><option value="max_tokens" ${value.token_field==='max_tokens'?'selected':''}>max_tokens</option><option value="max_completion_tokens" ${value.token_field==='max_completion_tokens'?'selected':''}>max_completion_tokens</option></select></label></details>
      <details><summary>费用估算单价（元／百万 Token）</summary>${[ ['input','输入（未命中缓存）'],['cached','缓存输入'],['output','输出（含推理）'] ].map(([key,label])=>`<label>${label}<input name="rate_${key}" type="number" min="0" max="1000000" step="any" value="${esc(value.rates?.[key] ?? '')}" placeholder="填写供应商单价"></label>`).join('')}<small>启用费用额度前须填写全部三项；留空保留已保存单价。单价用于预算估算，实际账单由供应商确定。</small></details><label class="connection-default"><input name="make_default" type="checkbox" ${!data.connections.length || data.default_id===editing?'checked':''}>${online()?'设为团队默认；项目仍需单独授权':'设为默认，供新对话和后台任务使用'}</label><button class="primary" type="submit">保存连接</button><small>保存后点击“测试能力”会发起少量模型请求。</small></form>` : ""}`;
  }
  function status() {
    return `<h3>数据与关于</h3><p class="setting-intro">MethodAtlas · ${online()?"团队研究工作台":"个人研究工作台"}</p>${row('后台服务',data?'后台服务正在运行':'尚未取得后台状态',`<button type="button" data-setting-action="refresh">刷新状态</button>`)}${row('数据保存位置',online()?'论文、对话和成果按项目权限保存在服务器':'论文、对话和成果保存在本机',`<code class="settings-path">${esc(online()?'团队服务器':data?.data_directory || '正在读取…')}</code>`)}${row('自动任务','后台运行时执行；休眠或关闭后恢复补跑','')}<p class="setting-intro">${esc(data?.version || '')}</p>${row('恢复默认偏好','恢复外观、阅读、语言和布局；保留模型连接、项目、草稿及成果','<button type="button" data-setting-action="reset">恢复默认偏好</button>')}`;
  }
  function render(keepForm = true) {
    const previous = dialog.querySelector('#model-connection-form');
    if (keepForm && previous && !previous.closest('fieldset').disabled) modelDrafts.set(previous.dataset.connection,Object.fromEntries(new FormData(previous)));
    dialog.innerHTML = `<header class="settings-heading"><div><h2 id="settings-title">设置</h2><p>让工作台适合你的研究习惯</p></div><button type="button" class="icon" data-setting-action="close" aria-label="关闭设置">×</button></header><div class="settings-layout"><nav aria-label="设置分类">${[['appearance','外观与阅读'],['workspace','研究与工作区'],['models','模型连接'],...(online()?[['resources','并发与用量']]:[]),['status','数据与关于']].map(([key,label])=>`<button type="button" data-settings-tab="${key}" ${tab===key?'aria-current="page"':''}>${label}</button>`).join('')}</nav><section class="settings-content"><div id="settings-feedback" role="${error?'alert':'status'}">${esc(error || (busy?'正在处理，请稍候…':''))}</div><fieldset ${busy?'disabled':''}>${({appearance,workspace,models,resources,status})[tab]()}</fieldset></section></div>`;
    const form = dialog.querySelector('#model-connection-form'), draft = modelDrafts.get(editing);
    if (form && draft) for (const input of form.elements) {
      if (!input.name) continue;
      if (input.type === 'checkbox') input.checked = draft[input.name] === 'on';
      else if (input.name in draft) input.value = draft[input.name];
    }
  }
  async function load() {
    if (!state) return;
    const context = `${state.user?.id || 'local'}:${current?.id || ''}:${team()?.id || ''}`, version = ++loading;
    if (context !== loadedScope) { data=projectData=null;resourceData=[];modelDrafts.clear();editing='';loadedScope=context;refreshControls(); }
    if (!online()) {
      const result = await api('/api/settings');
      if (version !== loading) return;
      data=result;preferences.language=data.language || 'auto';return data;
    }
    const empty = {connections:[],default_id:'',fallback:{model:''},version:'团队研究工作台'};
    const project = current ? api(`/api/projects/${current.id}/model-settings`) : Promise.resolve(empty);
    const catalog = team() && canManage() ? api(modelPath()) : project;
    const [models, granted, limits] = await Promise.all([catalog, project, Promise.all([
      ...(team() && canManage() ? [api(`/api/workspaces/${team().id}/resource-limits`)] : []),
      ...(current ? [api(`/api/projects/${current.id}/resource-limits`)] : [])
    ])]);
    if (version !== loading) return;
    data=models;projectData=granted;resourceData=limits;return data;
  }
  async function open(section) { if(section==='models')tab=section;error='';const pending=load();render();dialog.showModal();try{await pending;refreshControls();render();}catch(e){error=e.message;render();} }
  const options = () => ({connection_id:null,effort:'auto',style:'balanced',...conversation?.chat_options,language:preferences.language});
  function selectedConfig(opts=options()) {
    const available = projectData || data;
    const id = opts.connection_id === null ? available?.default_id : opts.connection_id;
    return available?.connections.find(c=>c.id===id) || (id ? null : available?.fallback);
  }
  const effortLabel = key => ({auto:'自动',off:'关闭',low:'低',medium:'中',high:'高'})[key] || key;
  // 消耗速度：优先展示输出单价（元 / 百万 Token），没有单价则返回空
  const rateText = c => c?.rates && (c.rates.output ?? c.rates.input) ? `¥${c.rates.output ?? c.rates.input} / 百万` : '';
  function controls() {
    const opts=options(), cfg=selectedConfig(opts), known=!!data;
    const connections=(projectData || data)?.connections || [];
    const defaultConfig=selectedConfig({...opts,connection_id:null});
    // 当前选中的连接（connection_id 为 null 表示跟随默认模型）
    const currentId=opts.connection_id===null?(projectData || data)?.default_id:opts.connection_id;
    const current=connections.find(c=>c.id===currentId);
    const triggerName=current?.name || cfg?.model || (known?'未授权模型':'加载中');
    const effortOptions=[['auto','自动'],['off','关闭'],['low','低'],['medium','中'],['high','高']];
    const effortActive=key=>opts.effort===key;
    return `<div class="chat-preferences" id="chat-preferences">
      <button type="button" class="chat-model-trigger" popovertarget="chat-model-menu" aria-label="聊天模型" aria-describedby="chat-model-current" ${known?'':'disabled'}><span class="chat-model-name" id="chat-model-current">${esc(triggerName)}</span>${icon('chevron')}</button>
      <div class="chat-model-menu" id="chat-model-menu" popover="auto" role="listbox" aria-label="选择聊天模型">
        <div class="chat-model-list">
          ${defaultConfig?.model || opts.connection_id===null ? `<button type="button" class="chat-model-row" role="option" data-model-pick="default" aria-selected="${opts.connection_id===null}"><span class="chat-model-row-main"><strong>应用默认</strong>${defaultConfig?.model?`<small>${esc(defaultConfig.model)}</small>`:''}</span>${opts.connection_id===null?icon('check'):''}</button>` : ''}
          ${connections.map(c=>`<button type="button" class="chat-model-row" role="option" data-model-pick="${esc(c.id)}" aria-selected="${opts.connection_id===c.id}"><span class="chat-model-row-main"><strong>${esc(c.name)}</strong>${(projectData||data)?.default_id===c.id?'<span class="badge">默认</span>':''}<small>${esc(c.model)}</small></span><span class="chat-model-rate">${esc(rateText(c))}</span>${opts.connection_id===c.id?icon('check'):''}</button>`).join('') || `<p class="chat-model-empty">尚无可用模型连接。</p>`}
        </div>
        <div class="chat-model-detail">
          <details class="chat-effort-box">
            <summary>思考强度<span class="chat-effort-current">${esc(effortLabel(opts.effort))}</span>${icon('chevron')}</summary>
            <div class="chat-effort-options">${effortOptions.map(([key,label])=>`<button type="button" data-effort-pick="${key}" ${key !== 'auto' && !cfg?.efforts?.includes(key)?'disabled':''} aria-pressed="${effortActive(key)}">${esc(label)}</button>`).join('')}</div>
          </details>
          ${known && online() && !cfg?.model ? `<button type="button" class="chat-model-manage" data-setting-action="models">${canManage()?'配置模型':'查看模型设置'}</button>` : ''}
        </div>
      </div>
      <label class="chat-style" title="回答风格"><span class="sr-only">回答风格</span><select data-chat-pref="style" aria-label="回答风格">${[['brief','简明结论'],['balanced','回答风格'],['detailed','详细分析']].map(([key,label])=>`<option value="${key}" ${opts.style===key?'selected':''}>${label}</option>`).join('')}</select></label>
      <select data-chat-pref="connection_id" data-enhanced="1" hidden aria-hidden="true" tabindex="-1"><option value="default" ${opts.connection_id===null?'selected':''}>${esc(defaultConfig?.model || (known?'未授权模型':'加载中'))}</option>${connections.map(c=>`<option value="${esc(c.id)}" ${opts.connection_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}${opts.connection_id && !cfg ? `<option value="${esc(opts.connection_id)}" selected disabled>连接已删除，请重新选择</option>` : ''}</select>
      <select data-chat-pref="effort" data-enhanced="1" hidden aria-hidden="true" tabindex="-1">${effortOptions.map(([key,label])=>`<option value="${key}" ${opts.effort===key?'selected':''}>${label}</option>`).join('')}</select>
    </div>`;
  }
  function refreshControls() {
    const target=document.getElementById('chat-preferences');
    const focus=target?.contains(document.activeElement) && (document.activeElement.dataset.chatPref || document.activeElement.closest('.select-box')?.querySelector('select')?.dataset.chatPref || (document.activeElement.matches('.chat-model-trigger,[data-model-pick],[data-effort-pick]') ? 'connection_id' : ''));
    if(target){target.outerHTML=controls();enhanceSelects(document.getElementById('chat-preferences'));if(focus)(focus === 'connection_id' || focus === 'effort' ? document.querySelector('.chat-model-trigger') : document.querySelector(`[data-chat-pref="${focus}"]`)?.closest('.select-box')?.querySelector('summary'))?.focus({preventScroll:true});}
  }
  let saving = Promise.resolve();
  function positionModelMenu() {
    const menu=document.getElementById('chat-model-menu'), trigger=document.querySelector('.chat-model-trigger');
    if(!menu?.matches(':popover-open') || !trigger)return;
    menu.style.maxHeight=Math.max(80,innerHeight-16)+'px';
    const rect=trigger.getBoundingClientRect(), size=menu.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-size.width-8))+'px';
    menu.style.top=Math.max(8,Math.min(rect.top-size.height-8,innerHeight-size.height-8))+'px';
  }
  window.addEventListener('resize',positionModelMenu);
  // Pixel geometry follows font scaling and the expanded effort choices.
  document.addEventListener('toggle', event => {
    const menu=event.target;
    if(menu?.classList?.contains('chat-model-menu') && event.newState==='open' || menu?.classList?.contains('chat-effort-box'))requestAnimationFrame(positionModelMenu);
  }, true);
  // 模型 / 思考强度的选择：写入隐藏的 select 并触发 change，完整复用既有的保存与回滚逻辑
  document.addEventListener('click', event => {
    const modelPick=event.target.closest('[data-model-pick]');
    if(modelPick){
      const select=document.querySelector('#chat-preferences select[data-chat-pref="connection_id"]');
      if(select && select.value!==modelPick.dataset.modelPick){select.value=modelPick.dataset.modelPick;select.dispatchEvent(new Event('change',{bubbles:true}));}
      document.getElementById('chat-model-menu')?.hidePopover();
      return;
    }
    const effortPick=event.target.closest('[data-effort-pick]');
    if(effortPick && !effortPick.disabled){
      const select=document.querySelector('#chat-preferences select[data-chat-pref="effort"]');
      if(select && select.value!==effortPick.dataset.effortPick){select.value=effortPick.dataset.effortPick;select.dispatchEvent(new Event('change',{bubbles:true}));}
    }
  });
  const pendingPreferences = new Map();
  function stageDraft(pid,cid,next){
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`chat-options:${cid}`,JSON.stringify(next));
    const entry=pendingPreferences.get(cid) || {confirmed:next};
    Object.assign(entry,{project:pid,next,staged:true});pendingPreferences.set(cid,entry);
  }
  function saveOptions(pid,cid,next,confirmed=options()){
    const entry=pendingPreferences.get(cid) || {confirmed};
    entry.next=next;pendingPreferences.set(cid,entry);
    if(conversation?.id===cid){conversation.chat_options=next;refreshControls();}
    const storage=globalThis.MethodAtlasStorage?.local || localStorage;
    if(entry.staged || storage.getItem(`chat-options:${cid}`)!==null)storage.setItem(`chat-options:${cid}`,JSON.stringify(next));
    if(entry.staged)return;
    saving=saving.catch(()=>{}).then(()=>api(`/api/projects/${pid}/conversations/${cid}/preferences`,{method:'POST',body:JSON.stringify(next)}))
      .then(saved=>{entry.confirmed=saved;if(entry.next===next)(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`chat-options:${cid}`);finish();})
      .catch(e=>{finish();toast(e.message);});
    function finish(){if(entry.next===next){pendingPreferences.delete(cid);if(conversation?.id===cid){conversation.chat_options=entry.confirmed;refreshControls();}}}
  }
  function sent(cid){
    const entry=pendingPreferences.get(cid);
    if(entry?.staged){entry.staged=false;saveOptions(entry.project,cid,entry.next,entry.confirmed);}
    refreshControls();
  }
  document.addEventListener('change',event=>{
    const pref=event.target.dataset.pref;
    if(pref){preferences[pref]=event.target.type==='range'?Number(event.target.value):event.target.value;try{persist();}catch(e){toast('无法保存浏览器偏好');}if(pref==='language')saveLanguage(preferences.language).catch(e=>toast(e.message));if(event.target.type!=='range'){render();dialog.querySelector(`[data-pref="${pref}"]`)?.focus();}refreshControls();}
    if(event.target.name==='protocol' && event.target.closest('#model-connection-form')){
      const form=event.target.form, ds=event.target.value==='deepseek';form.elements.reasoning.value=ds?'deepseek':'none';form.elements.base_url.value=ds?'https://api.deepseek.com':'https://api.openai.com/v1';form.elements.token_field.value='max_tokens';
    }
    const chatPref=event.target.dataset.chatPref;
    if(chatPref && conversation){
      const old={...options()}, cid=conversation.id, pid=current.id;
      const next={...old,[chatPref]:chatPref==='connection_id' && event.target.value==='default'?null:event.target.value};
      if(chatPref==='connection_id')next.effort='auto';
      if(conversation.local){conversation.chat_options=next;window.MethodAtlasAI.sync();refreshControls();return;}
      saveOptions(pid,cid,next,old);
    }
  });
  document.addEventListener('input',event=>{if(event.target.type==='range' && event.target.dataset.pref){preferences[event.target.dataset.pref]=Number(event.target.value);persist();event.target.previousElementSibling?.querySelector('small')?.replaceChildren(`当前 ${event.target.value}% · 字体与布局同步缩放`);}});
  document.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.dataset.settingsTab){tab=target.dataset.settingsTab;error='';render();dialog.querySelector(`[data-settings-tab="${tab}"]`)?.focus();}
    if(target.dataset.color){preferences.accent=target.dataset.color;persist();render();dialog.querySelector(`[data-color="${preferences.accent}"]`)?.focus();}
    const action=target.dataset.settingAction;
    if(action==='close')dialog.close();
    if(action==='models'){document.getElementById('chat-model-menu')?.hidePopover();dialog.addEventListener('close',()=> (document.querySelector('[data-setting-action=models]') ? document.querySelector('.chat-model-trigger') : document.getElementById('chat-input'))?.focus(),{once:true});await open('models');}
    if(action==='layout'){(globalThis.MethodAtlasStorage?.local || localStorage).removeItem('panel-widths');if(document.querySelector('.panels')){['source','chat','studio'].forEach(name=>document.querySelector('.panels').style.removeProperty(`--${name}-width`));restorePanelSizes();}toast('已恢复默认栏宽');}
    if(action==='reset' && confirm('恢复外观、阅读、语言和布局偏好？模型连接及研究数据保留。')){preferences={...defaults};saveLanguage('auto').catch(e=>toast(e.message));projectView='grid';projectSort='recent';(globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-view','grid');(globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-sort','recent');(globalThis.MethodAtlasStorage?.local || localStorage).removeItem('panel-widths');if(document.querySelector('.panels')){['source','chat','studio'].forEach(name=>document.querySelector('.panels').style.removeProperty(`--${name}-width`));restorePanelSizes();}persist();render();refreshControls();if(document.getElementById('project-grid'))renderProjects();}
    if(action==='refresh'){try{await load();error='';}catch(e){error=e.message;}render();}
    if(['subscriptions','progress'].includes(action)){dialog.close();switchShellView(action);if(action==='progress')window.MethodAtlasProgress?.settings?.();}
    const modelAction=target.dataset.modelAction;
    if(modelAction==='edit'){editing=target.dataset.id;render();}
    if(modelAction==='new'){editing='';render();}
    if(['test','default','delete','grant','revoke'].includes(modelAction)){
      if(['delete','revoke'].includes(modelAction) && !confirm(online()?'撤销后，使用此连接的相关运行会停止。是否继续？':'删除这个连接？已有任务仍使用启动时的配置；选用此连接的对话需要重新选择。'))return;
      busy=true;error='';render();try{const grant=['grant','revoke'].includes(modelAction);await api(modelPath()+'/'+(grant?'grant':modelAction),{method:'POST',body:JSON.stringify(grant?{project_id:current.id,connection_id:target.dataset.id,enabled:modelAction==='grant',default:true}:{id:target.dataset.id})});await load();if(modelAction==='delete'){modelDrafts.delete(target.dataset.id);editing='';}}catch(e){error=e.message;}finally{busy=false;render();refreshControls();}
    }
  });
  document.addEventListener('submit',async event=>{
    if(event.target.dataset.resourceScope){
      event.preventDefault();if(busy)return;
      const form=event.target, scope=form.dataset.resourceScope, id=form.dataset.resourceId, values=new FormData(form), count=Number(values.get('parallel_runs'));
      busy=true;error='';form.closest('fieldset').disabled=true;
      try{await api(`/api/${scope==='workspace'?'workspaces':'projects'}/${id}/resource-limits`,{method:'POST',body:JSON.stringify({parallel_runs:count, monthly_tokens:values.get('monthly_tokens') ? Number(values.get('monthly_tokens')) : null, monthly_yuan:values.get('monthly_yuan') || null})});await load();toast('资源限制已保存');render();}
      catch(e){error=e.message;dialog.querySelector('#settings-feedback').textContent=error;dialog.querySelector('#settings-feedback').setAttribute('role','alert');}
      finally{busy=false;dialog.querySelector('fieldset').disabled=false;if(!error)dialog.querySelector('#settings-feedback').textContent='';}
      return;
    }
    if(event.target.id!=='model-connection-form')return;event.preventDefault();
    if(busy)return;
    const key=editing, fields=Object.fromEntries(new FormData(event.target));modelDrafts.set(key,{...fields});fields.context_window=Number(fields.context_window);fields.max_output=Number(fields.max_output);fields.make_default=fields.make_default==='on';const rates=Object.fromEntries(['input','cached','output'].map(name=>[name,fields['rate_'+name]]));for(const name of Object.keys(rates))delete fields['rate_'+name];if(Object.values(rates).some(value=>value!==''))fields.rates=rates;if(key)fields.id=key;
    busy=true;error='';event.target.closest('fieldset').disabled=true;try{await api(modelPath()+'/save',{method:'POST',body:JSON.stringify(fields)});await load();modelDrafts.delete(key);editing='';toast('模型连接已保存，请测试能力后使用研究工具。');}catch(e){error=e.message;}finally{busy=false;render(false);refreshControls();}
  });
  window.MethodAtlasSettings={open,controls,options,reload:()=>load().then(refreshControls).catch(e=>toast(e.message)),reset:()=>{loading++;data=projectData=null;resourceData=[];loadedScope='';modelDrafts.clear();editing='';dialog.innerHTML='';},preferences:()=>preferences,pending:cid=>pendingPreferences.get(cid)?.next,reducedMotion,request:()=>({chat_options:options(),deep_research:false}),stageDraft,sent};
  apply();load().then(refreshControls).catch(()=>{});
})();
