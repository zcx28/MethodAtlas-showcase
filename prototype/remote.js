// 远程实验以计划为入口；运行、日志与结果归入所属计划，独立命令保留次级入口。
// 授权边界、日志读取与结果取回的逻辑与原来的对话框完全一致，只换了呈现宿主。
(() => {
  const labels = {recorded:'外部实验',planned:'计划中',awaiting_confirmation:'待授权',submitting:'提交中',queued:'排队',running:'运行中',succeeded:'执行成功',failed:'执行失败',unknown:'状态未知',cancelled:'已终止',interrupted:'已中断',repairing:'修复重试',active:'自动推进',paused:'已暂停',completed:'计划完成'};
  const statuses = {reachable:'可达',unreachable:'不可达',unknown:'未知',connected:'已连接',authentication_failed:'认证失败',error:'连接失败',available:'可用',none:'无 GPU',probe_error:'探测失败'};
  const post = (target, body = {}) => api(target, {method:'POST', body:JSON.stringify(body)});
  const url = (suffix = '') => `/api/projects/${current.id}/remote${suffix}`;
  const online = () => !!state?.collaboration;
  const team = () => state?.workspaces?.find(item => item.id === current?.workspace_id);
  const manageTeam = () => !online() || team()?.role === 'owner';
  const manageProject = () => online() && current?.role === 'owner';
  const resourceURL = (suffix = '') => `/api/workspaces/${current.workspace_id}/server-settings${suffix}`;
  const projectResourceURL = (suffix = '') => `/api/projects/${current.id}/server-settings${suffix}`;
  const canExecute = id => !online() || !!data?.servers.find(server => server.id === id)?.can_execute;
  const probeURL = () => online() ? projectResourceURL('/check') : '/api/remote/servers/check';
  let teamServers = [];
  const field = (name, title, value = '', extra = '') => `<label class="dialog-field">${title}<input name="${name}" value="${esc(value)}" ${extra}/></label>`;
  let data = null, selected = null, generation = 0, readGeneration = 0, importGeneration = 0, logOffset = 0, resultOffset = 0, resultPath = '', importPreview = '', importRows = null, serverFilter = '';

  // An unnamed task gets an explicit label rather than a wall of command text; the command itself is
  // one click away in the detail column.
  const taskName = item => item.name || item.spec?.title || '未命名任务';
  const attentionStatus = item => {
    if (['awaiting_confirmation','paused','failed','unknown','interrupted'].includes(item.status)) return item.status;
    const latest = item.runs?.filter(r => !item.completed_steps.includes(r.step)).at(-1);
    const status = latest && data.experiments.find(e => e.id === latest.id)?.status;
    return ['failed','unknown','interrupted'].includes(status) ? status : '';
  };
  const needsAttention = item => Boolean(attentionStatus(item));
  const byAttention = (a,b) => Number(needsAttention(b)) - Number(needsAttention(a));
  const parentGroup = item => (data.groups || []).find(g => g.id === item.spec?.sandbox?.group_id || g.runs.some(r => r.id === item.id));
  function jobNotice(item) {
    if (item?.authorization_revoked) return '此执行授权已撤销。已有记录保留；如需重新执行，请准备新的实验。';
    if (item?.status === 'unknown') return '暂时无法确认远端状态。请重连 / 刷新状态；不要重复创建任务。';
    if (item?.status === 'interrupted') return '运行观察已中断，远端程序状态尚未确认。请重连 / 刷新状态，不要重复提交。';
    if (item?.status === 'cancelled') return '已按终止请求停止。已有日志和结果仍可读取。';
    if (item?.status !== 'failed') return '';
    if (item.job?.limitReason === 'experiment group deadline reached') return '已达到实验组时长额度，任务已停止。请查看日志与已有结果；继续实验需要重新确认额度。';
    if (item.job?.limitReason === 'sampled storage guard reached (not a hard filesystem quota)') return '已达到实验组存储保护阈值，任务已停止。请查看日志与已有结果，释放空间或重新确认额度。';
    return `任务${item.job?.exitCode == null ? '未成功完成' : `以退出码 ${item.job.exitCode} 结束`}。请读取任务日志定位原因，原运行记录保留。`;
  }
  const connected = probe => probe?.state === 'online' && ['connected','not_used'].includes(probe.ssh);
  const gpuLine = probe => {
    const gpu = (probe?.gpus || [])[0];
    if (gpu) return `${gpu.name} · ${Math.round(gpu.memoryTotalMb / 1024)} GB`;
    if (!probe) return '尚未探测';
    if (probe.tcp === 'unreachable') return '网络不可达';
    if (['authentication_failed','error'].includes(probe.ssh)) return `SSH ${statuses[probe.ssh]}`;
    return statuses[probe.gpu] || '未探测到 GPU';
  };
  const duration = job => {
    if (!job?.startedAt) return '';
    const from = Date.parse(job.startedAt), to = job.finishedAt ? Date.parse(job.finishedAt) : Date.now();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return '';
    const seconds = Math.max(0, Math.round((to - from) / 1000));
    const text = seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
    return job.finishedAt ? text : `${text}（进行中）`;
  };

  function serversHTML() {
    const rows = data.servers.map(server => {
      const probe = data.probes[server.id];
      const state = !probe ? 'unknown' : connected(probe) ? 'online' : 'offline';
      const active = server.id === serverFilter;
      const count = data.experiments.filter(item => item.spec.server.id === server.id).length;
      return `<div class="server-row${active ? ' active' : ''}"><button type="button" class="server-pick" data-server-pick="${esc(server.id)}" aria-label="只看 ${esc(server.name)} 的任务"${active ? ' aria-current="true"' : ''}><span class="server-dot" data-state="${state}"></span><span class="server-body"><strong>${esc(server.name)}</strong><small>${esc(gpuLine(probe))}</small></span></button>${count ? `<span class="server-count" title="${count} 项任务">${count}</span>` : ''}<button type="button" class="icon server-more" data-server-menu="${esc(server.id)}" aria-label="${esc(server.name)} 的更多操作" title="更多操作">${icon('dots')}</button></div>`;
    }).join('');
    return `<details class="remote-servers" data-remote-section="servers" open><summary>服务器 · ${data.servers.length}${serverFilter ? ' · 已筛选' : ''}</summary><section class="rail-block"><header class="rail-head"><h3>连接管理</h3><div class="row">${online() ? (manageTeam() || manageProject() ? '<button type="button" class="mini" data-resources>资源与权限</button>' : '') : `<button type="button" class="mini" data-add-server>${icon('plus')}添加服务器</button>`}<button type="button" class="mini" data-probe-all ${data.servers.some(server => canExecute(server.id)) ? '' : 'disabled'}>全部探测</button></div></header><div class="server-list">${rows || '<p class="empty-small">本项目还没有可用服务器。请添加或申请项目授权。</p>'}</div></section></details>`;
  }

  function experimentsHTML() {
    const items = data.experiments.filter(item => !parentGroup(item) && (!serverFilter || item.spec.server.id === serverFilter)).sort(byAttention);
    const rows = items.map(item => `<button type="button" class="library-row${item.id === selected?.id ? ' active' : ''}" data-experiment="${esc(item.id)}"${item.id === selected?.id ? ' aria-current="true"' : ''}><span class="task-dot" data-state="${esc(item.status)}" title="${esc(labels[item.status] || item.status)}"></span><span class="library-row-body"><strong>${esc(taskName(item))}</strong><small>${esc(labels[item.status] || item.status)} · ${esc(item.created)}</small></span></button>`).join('');
    if (!items.length) return '';
    return `<section class="rail-block grow"><header class="rail-head"><h3>独立运行</h3><span class="badge">${items.length}</span></header><div class="library-list">${rows}</div></section>`;
  }

  function groupsHTML() {
    const groups = (data.groups || []).filter(g => !serverFilter || g.spec.server?.id === serverFilter).sort(byAttention);
    const attention = groups.filter(needsAttention).length;
    return `<section class="rail-block"><header class="rail-head"><h3>实验计划 · ${groups.length}</h3><button type="button" class="mini" data-external-create>记录外部实验</button>${attention ? `<span class="badge">待处理 ${attention}</span>` : ''}</header>${groups.map(g => `<button type="button" class="library-row${selected?.id === g.id ? ' active' : ''}" data-experiment="${esc(g.id)}"${selected?.id === g.id ? ' aria-current="true"' : ''}><span class="task-dot" data-state="${esc(attentionStatus(g) || g.status)}" aria-hidden="true"></span><span class="library-row-body"><strong>${esc(g.spec.title)}</strong><small>${esc(labels[g.status] || g.status)}${attentionStatus(g) && attentionStatus(g) !== g.status ? ` · ${esc(labels[attentionStatus(g)])}` : ''} · 已完成 ${g.mode === 'external' ? `${g.observations?.length || 0} 次记录` : `${g.completed_steps.length}/${g.spec.steps.length} 步`}</small></span></button>`).join('') || '<p class="empty-small">在对话中提出实验目标，或新建计划。确认一次后，AI 按计划执行。</p>'}</section>`;
  }

  function groupDetail() {
    const g = selected, spec = g.spec;
    if (g.mode === 'external') return `<div class="task-detail remote-detail"><h3>${esc(spec.title)}</h3><p>外部实验 · 由成员录入结果</p><div class="row"><button data-group-refresh>刷新实验组</button>${window.MethodAtlasCollaboration?.relatedButton('experiment',g.id) || ''}</div>${recordsHTML(g)}</div>`;
    const metrics=[...new Set(g.runs.flatMap(r=>Object.keys(r.record?.metrics || {})))];
    const controls = `${g.status==='awaiting_confirmation' ? '<button class="primary" data-group-control="confirm">确认实验组并开始</button>' : g.status==='active' ? '<button data-group-control="pause">暂停 AI 后续操作</button>' : g.status==='paused' ? '<button class="primary" data-group-control="resume">恢复 AI 推进</button>' : ''}<button data-group-refresh>刷新实验组</button>`;
    return `<div class="task-detail remote-detail"><header class="task-head"><div class="remote-title"><h3>${esc(spec.title)}</h3><span class="state-chip" data-state="${esc(g.status)}">${esc(labels[g.status] || g.status)}</span></div><p role="status">${esc(g.message || (g.status === 'awaiting_confirmation' ? '等待确认计划与执行范围' : '按已确认的计划推进'))}</p></header>
      <div class="row remote-controls">${g.status === 'awaiting_confirmation' ? '<span class="dialog-note">请先核对下方计划与授权范围。</span>' : controls}</div>
      ${data.automation_ready === false && g.status !== 'completed' ? '<p class="dialog-note" role="status">AI 执行器尚未配置，当前不会自动提交实验。请先在设置中配置可用模型，再回到计划继续。</p>' : ''}
      ${['active','paused'].includes(g.status) ? '<p class="dialog-note">暂停 AI 只停止后续操作，已有远程程序继续运行；需要停止程序时，请进入对应运行并明确终止。</p>' : ''}
      <nav class="remote-sections" aria-label="实验计划章节"><a href="#remote-overview">概览</a><a href="#remote-runs">运行记录</a><a href="#remote-results">结果比较</a></nav>
      <section class="remote-block" id="remote-overview"><div class="remote-section-head"><h4>实验执行清单</h4><span>已归档 ${g.completed_steps.length}/${spec.steps.length} 项</span></div><p class="dialog-note">逐项查看实际运行、固定结果与结论。执行成功后仍需保存证据并归档。</p><ol class="remote-steps">${spec.steps.map((step,i) => {
        const attempts = g.runs.filter(r => r.step === i), latest = attempts.at(-1);
        const run = latest && data.experiments.find(e => e.id === latest.id);
        const archived = g.completed_steps.includes(i), state = run?.status || (latest ? 'unknown' : 'pending');
        const setup = latest && (latest.purpose || latest.kind) === 'setup';
        const evidence = attempts.filter(r => r.evidence?.id);
        const outcome = !latest ? '尚未提交运行' : `${setup ? '环境准备 · ' : ''}${labels[state] || state}${state === 'succeeded' ? setup ? '，待提交实验' : latest.evidence?.id ? '，证据已固定' : '，待固定结果' : ''}`;
        return `<li data-step-state="${esc(state)}"><div class="remote-step-heading"><strong>${esc(step)}</strong><span class="remote-step-status">${archived ? '已归档' : '未归档'}</span></div><p>${esc(outcome)}</p><p class="dialog-note">运行 ${attempts.length} 次 · 固定证据 ${evidence.length} 份${run?.job?.exitCode != null ? ` · 最近退出码 ${esc(run.job.exitCode)}` : ''}${duration(run?.job) ? ` · ${esc(duration(run.job))}` : ''}</p>${latest ? `<button type="button" data-experiment="${esc(latest.id)}">查看最近运行与日志</button>` : ''}${g.conclusions?.[i] ? `<p class="remote-step-conclusion">${esc(g.conclusions[i])}</p>` : ''}</li>`;
      }).join('')}</ol><div class="remote-plan-copy"><h4>实验方案</h4><p>${esc(spec.plan)}</p></div></section>
      <details class="panel-help" data-remote-section="authorization-${esc(g.id)}"${g.status === 'awaiting_confirmation' ? ' open' : ''}><summary>执行与授权范围</summary>
      <ul class="meta-list"><li><span>服务器</span><b>${esc(spec.server.name)} · ${esc(spec.connection.username)}@${esc(spec.connection.host)}:${esc(spec.connection.port)}</b></li><li><span>原目录（只读）</span><b>${esc(spec.directory)}</b></li><li><span>新建工作目录</span><b>${esc(spec.directory)}/.methodatlas-groups/${esc(g.id)}/work</b></li><li><span>网络访问</span><b>${spec.network ? '允许下载公开代码、依赖和数据' : '不允许'}</b></li><li><span>GPU 编号</span><b>${spec.gpu_devices.length ? esc(spec.gpu_devices.join(', ')) : '不使用 GPU'}</b></li><li><span>时长额度</span><b>${spec.max_seconds ? `${spec.max_seconds} 秒（首次授权起计时）` : '未设置'}</b></li><li><span>存储保护阈值</span><b>${spec.max_storage_mb ? `${spec.max_storage_mb} MiB（定期检测并停止，可能短时超出）` : '未设置'}</b></li><li><span>资源说明</span><b>${esc(spec.resources || '未填写')}</b></li></ul>
      <p class="dialog-note">确认后，AI 可在新建工作目录内编写代码、准备独立环境、运行并修复实验；原目录保持只读。系统变更及扩大计划须重新授权。${spec.server.host === 'methodatlas-local' ? '本机 Docker 须保持运行；关闭电脑会中断本机实验。' : '远端须已有可用的 bubblewrap 隔离工具。关闭本机后仅已提交任务继续，重新打开后 AI 再接着分析。'}</p>
      </details>
      ${g.status === 'awaiting_confirmation' ? `<div class="row">${canExecute(spec.server.id) ? controls : '<span>执行实验需项目负责人授权</span>'}</div>` : ''}
      ${g.status==='active' && canExecute(spec.server.id) ? '<label class="dialog-field">上传选定文本代码（新文件，≤64 KiB）<input type="file" data-group-upload accept=".py,.sh,.json,.csv,.toml,.yaml,.yml,.txt"/></label>' : ''}
      ${recordsHTML(g)}${current.conversations.find(c=>c.id===g.conversation_id)?.visibility !== 'private' ? window.MethodAtlasCollaboration?.relatedButton('experiment',g.id) || '' : ''}<section class="remote-block" id="remote-results"><h4>结果比较</h4><p class="dialog-note">保留全部尝试与负结果。数值需结合数据、配置及原始证据判断，执行成功不代表研究主张成立。</p>${metrics.length ? `<div style="overflow-x:auto"><table><thead><tr><th scope="col">运行</th>${metrics.map(k=>`<th scope="col">${esc(k)}</th>`).join('')}</tr></thead><tbody>${g.runs.filter(r=>r.record).map(r=>`<tr><th scope="row">第 ${g.runs.indexOf(r)+1} 次 · ${esc(spec.steps[r.step])} · ${esc(r.kind)}</th>${metrics.map(k=>`<td>${esc(String(r.record.metrics[k] ?? '未记录'))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${metrics.filter(k=>g.runs.some(r=>typeof r.record?.metrics[k]==='number'&&r.record.metrics[k]>=0)).map(k=>`<details><summary>${esc(k)} 趋势图</summary><img loading="lazy" style="max-width:100%;height:auto" src="${url('/groups/'+g.id+'/chart')}?metric=${encodeURIComponent(k)}" alt="${esc(k)} 的实验运行对照图"/><p>图显示非负数值的趋势，精确数值及负值见表格；比较条件以计划和运行配置为准。</p></details>`).join('')}` : '<p>保存真实结果后显示对照。</p>'}
      </section><section class="remote-block" id="remote-runs"><h4>运行记录 <span>${g.runs.length}</span></h4>${g.runs.map((r,index) => { const item=data.experiments.find(e=>e.id===r.id), notice=jobNotice(item); return `<article class="remote-run"><button data-experiment="${esc(r.id)}">第 ${index+1} 次 · ${esc(spec.steps[r.step])} · ${esc(r.kind)} · ${esc(labels[item?.status] || '未取得')}</button>${notice ? `<p class="dialog-note" role="status" data-job-notice>${esc(notice)}</p>` : ''}<p>${esc(r.summary || '尚未记录分析结论')}</p>${r.evidence?.id ? `<a href="${url('/results/'+r.evidence.id)}" download>下载本次结果证据</a>` : ''}</article>`; }).join('') || '<p>尚未提交运行。</p>'}
      </section><details><summary>代码修改记录（${g.changes.length}）</summary>${g.changes.map(c => `<h4>${esc(c.path)}</h4><pre class="dialog-pre">${esc(c.diff)}</pre>`).join('')}</details>
      <details><summary>步骤结论</summary>${Object.entries(g.conclusions || {}).map(([step,summary]) => `<h4>${esc(spec.steps[Number(step)] || step)}</h4><p>${esc(summary)}</p>`).join('') || '<p>尚未记录结论。</p>'}</details></div>`;
  }


  const recordTitles = {objective:'实验目标',hypothesis:'研究假设',notes:'研究说明',title:'运行名称',status:'状态',dataset:'数据集',dataset_version:'数据版本',split:'评估划分',evaluation:'评估方法',model:'模型',configuration:'配置说明',parameters:'参数',code:'代码地址',commit:'代码版本',metrics:'指标',metric_units:'指标单位',metric_directions:'指标方向',result:'结果说明',conclusion:'研究结论',sources:'固定依据'};
  const runFields = ['title','dataset','dataset_version','split','evaluation','model','configuration','code','commit','result','conclusion'];
  const recordText = record => Object.entries(recordTitles).filter(([key]) => record[key] !== undefined && record[key] !== '').map(([key,label]) => `${label}：${typeof record[key] === 'object' ? JSON.stringify(record[key],null,2) : key === 'status' ? labels[record[key]] || record[key] : record[key]}`).join('\n');
  function recordsHTML(g) {
    return `<section class="memory-card"><h4>研究记录</h4><p>最后修改：${esc(g.research?.edited_by_email || '历史作者未记录')} · ${esc(g.research?.updated || '')}</p><pre class="dialog-pre">${esc(recordText(g.research || {}))}</pre><div class="row"><button data-record-edit="plan">编辑研究说明</button><button data-record-history="plan">说明历史</button>${g.mode === 'external' ? '<button data-record-edit="new">添加运行记录</button>' : ''}<button data-record-compare>比较运行</button></div>
      ${(g.observations || []).map(r => `<details class="panel-help"><summary>${esc(r.title || '运行记录')} · ${esc(r.origin === 'member_reported' ? '成员录入' : '平台采集')} · ${esc(labels[r.status] || r.status || '')}</summary>${r.unavailable ? '<p>依据当前不可访问，记录内容已隐藏。</p>' : `<pre class="dialog-pre">${esc(recordText(r))}</pre><p>创建：${esc(r.created_by_email || '历史作者未记录')} · 修订 ${r.revision}：${esc(r.edited_by_email || '历史作者未记录')} · ${esc(r.updated || '尚无成员补充')}</p><button data-record-edit="${esc(r.id)}">补充记录</button><button data-record-history="${esc(r.id)}">修改历史</button>`}</details>`).join('')}</section>`;
  }
  function metricRow(name='', value='', unit='', direction='unspecified', captured=false) {
    return `<fieldset data-metric-row><legend>${captured ? '平台指标（数值只读）' : '实验指标'}</legend>${field('metric_name','名称',name,captured ? 'readonly' : '')}${field('metric_value','数值',String(value),`type="number" step="any" ${captured ? 'readonly' : ''}`)}${field('metric_unit','单位（无量纲填 1）',unit)}<label class="dialog-field">数值方向<select name="metric_direction">${[['unspecified','未说明'],['higher','越高越好'],['lower','越低越好']].map(([v,t])=>`<option value="${v}" ${v===direction ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${captured ? '' : '<button type="button" data-metric-remove>移除指标</button>'}</fieldset>`;
  }
  function recordKey(group, entity) { return `methodatlas:experiment:${state.user?.id || 'local'}:${current.id}:${group || 'new'}:${entity}`; }
  function formValues(form) {
    const value = {};
    for (const name of [...runFields,'objective','hypothesis','notes','status','parameters']) {
      if (form.elements[name]) value[name] = form.elements[name].value;
    }
    value.metricRows = [...form.querySelectorAll('[data-metric-row]')].map(row => Object.fromEntries([...row.querySelectorAll('input,select')].map(el => [el.name,el.value])));
    return value;
  }
  function cacheRecord(form) {
    try { (globalThis.MethodAtlasStorage?.local || localStorage).setItem(form._key,JSON.stringify({revision:form._revision,values:formValues(form),sources:form._sources,request_id:form._request})); } catch { /* Editing remains possible if browser storage is full. */ }
  }
  function recordDialog(entity, group=selected) {
    const fresh = !group, plan = entity === 'plan', external = fresh || group.mode === 'external';
    const record = fresh ? {} : plan ? group.research : group.observations.find(r => r.id === entity) || {};
    if (record?.unavailable) throw new Error('记录依据当前不可访问');
    const key = recordKey(group?.id,entity);
    let draft; try { draft=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(key)); } catch {}
    const v=draft?.values || {...record,parameters:Object.entries(record.parameters || {}).map(([k,v]) => `${k}=${typeof v==='string' ? v : JSON.stringify(v)}`).join('\n')};
    const area = (name, title) => `<label class="dialog-field">${title}<textarea name="${name}" rows="3" maxlength="20000">${esc(v[name] || '')}</textarea></label>`;
    const fields = plan ? ['objective','hypothesis','notes'] : runFields;
    const metricRows = draft?.values?.metricRows || Object.entries(record.metrics || {}).map(([k,v]) => ({metric_name:k,metric_value:v,metric_unit:record.metric_units?.[k] || '',metric_direction:record.metric_directions?.[k] || 'unspecified'}));
    const dialog=openDialog(`${dialogHead(fresh ? '记录外部实验' : plan ? '编辑研究说明' : entity==='new' ? '添加运行记录' : '补充运行记录', external ? '记录成员在本机或其他平台完成的实验；结果由录入成员负责。' : '补充研究条件和结论；平台采集的原始指标及状态保留。')}
      <form data-record-form><div class="modal-body">${draft ? '<p role="status">已恢复本账号未保存的输入。保存时会检查版本。</p>' : ''}${fresh ? field('title','实验名称',v.title || '','required maxlength="200"') : ''}
      ${fields.map(name => ['objective','hypothesis','notes','configuration','result','conclusion'].includes(name) ? area(name,recordTitles[name]) : field(name,recordTitles[name],v[name] || '',name==='title' && external ? 'required maxlength="200"' : '')).join('')}
      ${!plan ? `${external ? `<label class="dialog-field">状态<select name="status">${['planned','running','completed','failed','cancelled','unknown'].map(k=>`<option value="${k}" ${(v.status || 'planned')===k?'selected':''}>${labels[k] || k}</option>`).join('')}</select></label>` : ''}${area('parameters','参数（每行 名称=值）')}
      <div data-metrics>${metricRows.map(r=>metricRow(r.metric_name,r.metric_value,r.metric_unit,r.metric_direction,!external)).join('')}</div>${external ? '<button type="button" data-metric-add>添加指标</button>' : ''}
      <details><summary>固定研究依据</summary><p>选择文献、成果或 Agent Run，保存时固定版本。</p><div data-record-sources></div></details>` : ''}<div data-record-conflict></div><p role="alert" data-record-error></p></div>
      <div class="modal-foot"><small>关闭后未保存的输入保留在本机本账号</small><button class="primary">保存记录</button></div></form>`);
    const form=dialog.querySelector('form');
    Object.assign(form,{_key:key,_revision:draft?.revision ?? record.revision ?? 0,_request:draft?.request_id || crypto.randomUUID(),_group:group?.id,_entity:entity,_external:external,_sources:draft?.sources || record.sources || [],_project:current.id});
    form.addEventListener('input',()=>{form._request=crypto.randomUUID();cacheRecord(form);});
    if (!plan && online()) {
      void api(`/api/projects/${form._project}/work-items/candidates`).then(catalog=>{
        if(!form.isConnected || current?.id!==form._project) return;
        const choices=catalog.candidates.filter(c=>['paper','artifact','run'].includes(c.kind));
        for (const source of form._sources) if(!choices.some(c=>c.kind===source.kind && c.id===source.id && c.version_id===source.version_id)) choices.push({...source,title:'已选历史依据（固定版本）'});
        form.querySelector('[data-record-sources]').innerHTML=choices.map((c,i)=>`<label class="dialog-field"><span><input type="checkbox" data-record-source="${i}" ${form._sources.some(v=>v.kind===c.kind && v.id===c.id && v.version_id===c.version_id)?'checked':''}/> ${esc(c.title)}</span></label>`).join('') || '<p>暂无共享依据。</p>';
        if(form.dataset.saving) form.querySelectorAll('[data-record-source]').forEach(node=>node.disabled=true);
        form.querySelector('[data-record-sources]').addEventListener('change',()=>{
          form._sources=[...form.querySelectorAll('[data-record-source]:checked')].map(el=>{const c=choices[Number(el.dataset.recordSource)];return {kind:c.kind,id:c.id,...(c.version_id?{version_id:c.version_id}:{})};});
          form._request=crypto.randomUUID();cacheRecord(form);
        });
      }).catch(error=>{if(form.isConnected) form.querySelector('[data-record-error]').textContent=error.message;});
    }

  }
  async function compareDialog() {
    const dialog=openDialog(`${dialogHead('比较实验运行','选择 2–10 次运行；评估条件不一致时只并列展示，不判定优劣。')}<form data-record-comparison><div class="modal-body">${(data.groups || []).flatMap(g=>(g.observations || []).filter(r=>!r.unavailable).map(r=>`<label class="dialog-field"><span><input type="checkbox" name="selection" value="${esc(g.id+'|'+r.id)}"/> ${esc(g.spec.title)} / ${esc(r.title || r.id)} · ${r.origin==='member_reported'?'成员录入':'平台采集'}</span></label>`)).join('') || '<p>尚无运行记录。</p>'}<p role="alert"></p><div data-comparison-result></div></div><div class="modal-foot"><button class="primary">比较选定运行</button></div></form>`);
    dialog.style.width='min(92vw, 900px)';
    dialog.style.maxWidth='none';
    dialog.querySelector('form')._project=current.id;
  }
  document.addEventListener('submit', async event => {
    const form=event.target;
    if (!form.matches('[data-record-form],[data-record-comparison]')) return;
    event.preventDefault();
    if (form.dataset.saving) return;
    const project=form._project, dialog=form.closest('dialog'), valid=()=>form.isConnected && dialog.open && current?.id===project;
    const errorNode=form.querySelector('[role=alert]'); errorNode.textContent='';
    form.dataset.saving='true'; const button=form.querySelector('button.primary'); const controls=[...form.querySelectorAll('input,textarea,select,button')].map(node=>[node,node.disabled]); button.disabled=true;
    try {
      if (form.matches('[data-record-comparison]')) {
        const selections=new FormData(form).getAll('selection').map(v=>{const [group_id,run_id]=v.split('|');return {group_id,run_id};});
        const result=await post(`/api/projects/${project}/remote/groups/compare`,{selections});
        if (!valid()) return;
        form.querySelector('[data-comparison-result]').innerHTML=`<h3>比较结果</h3><p>成员填写的评估条件未经平台独立核验。数值差异不代表统计显著。</p><div style="overflow-x:auto"><table style="width:100%;border-spacing:12px 8px;text-align:left"><thead><tr><th scope="col">条件</th>${result.runs.map(r=>`<th scope="col" style="min-width:130px">${esc(r.title)}</th>`).join('')}</tr></thead><tbody>${['dataset','dataset_version','split','evaluation','model','parameters','configuration','commit'].map(k=>`<tr><th>${recordTitles[k]}</th>${result.runs.map(r=>`<td>${esc(typeof r[k]==='object'?JSON.stringify(r[k]):r[k] || '未记录')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${result.metrics.map(m=>`<section><h4>${esc(m.metric)}</h4><p>${m.values.map((v,i)=>`${esc(result.runs[i].title)}：${esc(v ?? '未记录')} ${esc(m.units[i] || '')}`).join('；')}</p><p>${m.comparable ? `数值较优：${m.best_runs.map(b=>esc(result.runs.find(r=>r.group_id===b.group_id && r.id===b.run_id).title)).join('、')}` : `不可直接比较：${esc(m.reasons.join('；'))}`}</p></section>`).join('') || '<p>尚无数值指标。</p>'}`;
        return;
      }
      const values=formValues(form), fields={...values}; delete fields.metricRows;
      if (form._entity!=='plan') {
        fields.parameters={};
        for (const line of (values.parameters || '').split('\n').filter(v=>v.trim())) {
          const eq=line.indexOf('='); if (eq<1) throw new Error('参数格式为每行 名称=值');
          const key=line.slice(0,eq).trim(), val=line.slice(eq+1).trim();
          if (Object.hasOwn(fields.parameters,key)) throw new Error('参数名称重复');
          try { fields.parameters[key]=JSON.parse(val); } catch { fields.parameters[key]=val; }
        }
        fields.metric_units={}; fields.metric_directions={}; if(form._external) fields.metrics={};
        for (const row of values.metricRows) {
          const name=row.metric_name.trim(); if (!name || row.metric_value.trim()==='' || !Number.isFinite(Number(row.metric_value))) throw new Error('请填写指标名称和有效数值');
          if (Object.hasOwn(fields.metric_units,name)) throw new Error('指标名称重复');
          fields.metric_units[name]=row.metric_unit.trim(); fields.metric_directions[name]=row.metric_direction;
          if(form._external) fields.metrics[name]=Number(row.metric_value);
        }
        fields.sources=form._sources;
      }
      cacheRecord(form);
      controls.forEach(([node])=>node.disabled=true);
      const body=form._group ? {request_id:form._request,revision:form._revision,fields} : {request_id:form._request,...fields};
      let result;
      try { result=await post(`/api/projects/${project}/remote/groups/${form._group ? `${form._group}/records/${form._entity}` : 'external'}`,body); }
      catch(error) {
        if (valid() && form._group && error.status===409) {
          const latest=await api(`/api/projects/${project}/remote/groups/${form._group}`);
          if (!valid()) return;
          const record=form._entity==='plan'?latest.research:latest.observations.find(r=>r.id===form._entity);
          if (record && !record.unavailable) {
            form._latest=record.revision;
            form.querySelector('[data-record-conflict]').innerHTML=`<h4>其他成员已保存的最新内容</h4><pre class="dialog-pre">${esc(recordText(record))}</pre><p>上方保留你的输入。请逐项合并后，再确认使用这一版作为保存基础。</p><button type="button" data-record-rebase>已对照合并，使用修订 ${record.revision}</button>`;
          }
        }
        throw error;
      }
      try { (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(form._key); } catch {}
      if (!valid()) return;
      dialog.close(); await show(result.experiment?.id || result.id);
    } catch(error) { if(valid()) errorNode.textContent=error.message; }
    finally { delete form.dataset.saving; controls.forEach(([node,disabled])=>node.disabled=disabled); }
  });
  document.addEventListener('click',async event=>{
    const node=event.target.closest('button');
    if(!node || node.disabled) return;
    if (!node.matches('[data-external-create],[data-record-edit],[data-record-history],[data-record-compare],[data-metric-add],[data-metric-remove],[data-record-rebase]')) return;
    try {
      if(node.hasAttribute('data-external-create')) recordDialog('plan',null);
      if(node.dataset.recordEdit) recordDialog(node.dataset.recordEdit);
      if(node.hasAttribute('data-record-compare')) await compareDialog();
      if(node.dataset.recordHistory) {
        const project=current.id, group=selected.id;
        const value=await api(url(`/groups/${group}/records/${node.dataset.recordHistory}/history`));
        if(current?.id!==project || selected?.id!==group) return;
        openDialog(`${dialogHead('实验修改历史','每次保存保留一版，历史内容不覆盖当前记录。')}<div class="modal-body">${value.history.map(r=>`<details><summary>修订 ${r.revision} · ${esc(r.edited_by_email || '历史作者未记录')} · ${esc(r.updated || '')}</summary><pre class="dialog-pre">${esc(r.unavailable?'依据当前不可访问':recordText(r))}</pre></details>`).join('') || '<p>尚无成员修改。</p>'}</div>`);
      }
      const form=node.closest('[data-record-form]');
      if(form) {
        if(node.hasAttribute('data-metric-add')) form.querySelector('[data-metrics]').insertAdjacentHTML('beforeend',metricRow());
        if(node.hasAttribute('data-metric-remove')) node.closest('fieldset').remove();
        if(node.hasAttribute('data-record-rebase')) {form._revision=form._latest;form.querySelector('[data-record-conflict]').innerHTML='<p>已更新保存基础；上方合并内容尚未保存。</p>';}
        form._request=crypto.randomUUID();cacheRecord(form);
      }
    } catch(error) {toast(error.message);}
  });


  let recordsPolling=false, recordsNeedsPaint=false;
  async function pollRecords(event) {
    if(recordsPolling || document.hidden || !current?.id || event.detail.project!==current.id || shellView!=='remote' && middleView!=='remote') return;
    const project=current.id, request=generation, target=selected?.id;
    recordsPolling=true;
    try {
      const next=await api(`/api/projects/${project}/remote`);
      if(current?.id!==project || request!==generation || selected?.id!==target) return;
      const changed=JSON.stringify(next.groups)!==JSON.stringify(data?.groups);
      data=next;
      if(changed) {
        recordsNeedsPaint=true;
        selected=[...data.experiments,...data.groups].find(r=>r.id===target) || null;
        const form=document.querySelector('[data-record-form]');
        if(form && form._group) {
          const group=data.groups.find(g=>g.id===form._group);
          const record=form._entity==='plan'?group?.research:group?.observations.find(r=>r.id===form._entity);
          if(record && record.revision!==form._revision) form.querySelector('[data-record-error]').textContent='此记录已有新修改。你的输入已保留；保存时可查看最新内容并合并。';
        }
        paint(false);
      }
      if(recordsNeedsPaint && middleView==='remote' && !document.querySelector('dialog[open]')) {paint(true);recordsNeedsPaint=false;}
    } catch { /* The next project sync retries; the current editor remains intact. */ }
    finally {recordsPolling=false;}
  }
  window.addEventListener('methodatlas-project-sync',pollRecords);

  function listHTML() {
    return `<div class="rail remote-rail">${serversHTML()}${groupsHTML()}${experimentsHTML()}<div class="rail-block remote-create"><button type="button" class="primary" data-plan-chat>${icon('plus')}与 AI 规划实验</button><button type="button" data-prepare-group>新建计划</button></div><div class="row rail-actions"><button type="button" class="mini" data-prepare>运行单次命令</button></div></div>`;
  }

  function detailHTML() {
    if (!selected) return `<div class="rail-empty remote-detail"><p class="empty-small">在对话中提出研究目标，让 AI 拟定实验计划。确认范围后自动执行，在这里查看每次运行与结果。</p></div>`;
    if (selected.id.startsWith('group_')) return groupDetail();
    const job = selected.job, spec = selected.spec;
    const group = parentGroup(selected);
    const spent = duration(job);
    const notice = jobNotice(selected);
    const available = !online() || data.servers.some(server => server.id === spec.server.id);
    const canCancel = canExecute(spec.server.id) && (!online() || manageProject() || (selected.executed_by || spec.initiated_by) === state.user.id);
    const canConfirm = canExecute(spec.server.id) && !selected.authorization_revoked && !spec.sandbox && ['awaiting_confirmation','unknown','submitting'].includes(selected.status);
    return `<div class="task-detail remote-detail">
      ${group ? `<button type="button" class="remote-back" data-experiment="${esc(group.id)}">${icon('back')} 返回计划：${esc(group.spec.title)}</button>` : '<p class="dialog-note">独立运行 · 不属于实验计划</p>'}
      <header class="task-head"><div class="row between"><h3>${esc(taskName(selected))}</h3><button type="button" class="icon" data-rename aria-label="重命名任务" title="重命名任务">${icon('edit')}</button></div><p class="dialog-status"><span class="state-chip" data-state="${esc(selected.status)}">${esc(labels[selected.status] || selected.status)}</span> · ${esc(selected.created)}</p></header>
      ${notice ? `<p class="dialog-note" role="status" data-job-notice>${esc(notice)}</p>` : ''}

      <nav class="remote-sections" aria-label="运行章节"><a href="#remote-execution">概览</a><a href="#remote-log">日志</a><a href="#remote-results">结果</a></nav>
      <section class="remote-block" id="remote-execution"><ul class="meta-list remote-facts">
        <li><span>服务器</span><b>${esc(spec.server.name)} · ${esc(spec.connection.username)}@${esc(spec.connection.host)}:${esc(spec.connection.port)}</b></li>
        <li><span>目录</span><b>${esc(spec.directory)}</b></li>
        ${spent ? `<li><span>运行时间</span><b>${esc(spent)}</b></li>` : ''}
      </ul></section>

      <label class="dialog-field">实际执行命令<pre class="dialog-pre">${esc(spec.command)}</pre></label>
      <p class="dialog-note">授权仅绑定以上内容。确认会在实验目录保存运行身份、完整日志和退出结果。</p>
      ${canConfirm ? '<div class="row"><button class="primary" data-confirm>确认以上内容并执行 / 同身份重试</button></div>' : ''}
      ${selected.status !== 'awaiting_confirmation' ? `<div class="row memory-editor-actions"><button data-observe ${available ? "" : "disabled"}>重连 / 刷新状态</button>${canCancel && ['running','queued','submitting','unknown','interrupted'].includes(selected.status) ? '<button data-cancel>明确终止此任务</button>' : ''}</div>` : ''}

      <details class="panel-help" id="remote-results" open><summary>结果文件${selected.results.length ? `（${selected.results.length}）` : ''}</summary>
        ${selected.results.map(row => `<p class="dialog-status"><a href="${url('/results/' + row.id)}" download title="下载结果版本">${icon('download')} ${esc(row.remote_path)}</a> · ${esc(row.sha256.slice(0, 12))}${row.paper_id ? ' · 已加入研究材料' : ' · 二进制或大文本，未作为文字材料'}</p>`).join('') || '<p class="empty-small">还没有取回结果。</p>'}
        <form data-result-form>${field('path','读取 / 取回选定结果（授权目录内相对路径）')}<div class="row"><button ${available ? "" : "disabled"}>读取下一段结果</button><button type="button" data-fetch ${available ? "" : "disabled"}>取回完整文件并用于研究（≤2 MiB）</button></div></form>
      </details>

      <details class="panel-help" id="remote-log"><summary>任务日志</summary>
        <div class="row"><button type="button" data-log ${available ? "" : "disabled"}>读取下一段日志</button></div>
        <pre data-remote-output class="dialog-pre dialog-output"></pre><p data-offset class="dialog-status"></p>
      </details>

      <div class="row"><button data-analyze>带回对话分析结果</button></div>

      ${spec.repair ? `<h4>第 ${spec.attempt} 次修复重试 · ${esc(spec.repair.path)}</h4><p class="dialog-note">${esc(spec.repair.reason)}</p><h5>修改前</h5><pre class="dialog-pre">${esc(spec.repair.before)}</pre><h5>确认后写入的完整内容</h5><pre class="dialog-pre">${esc(spec.repair.content)}</pre><p class="dialog-note">此次确认同时授权以上脚本修改及重试；原失败记录保留。</p>` : ''}

      <details class="panel-help"><summary>执行配置与技术细节</summary>
      <ul class="meta-list">
        <li><span>任务 ID</span><b>${esc(selected.id)}</b></li>
        <li><span>远端记录</span><b>${esc(spec.directory)}/.methodatlas-jobs/${esc(selected.id)}</b></li>
        <li><span>完整日志</span><b>${esc(job?.logPath || '尚未取得')}</b></li>
        <li><span>退出码</span><b>${job?.exitCode == null ? '尚未取得' : esc(job.exitCode)}</b></li>
        <li><span>观测信息</span><b>${esc(job?.observationError || '无异常')}</b></li>
        <li><span>资源声明</span><b>${esc(spec.resources || '未声明')}</b></li>
        <li><span>配置说明</span><b>${esc(spec.configuration || '未提供')}</b></li>
      </ul>
      </details>      <details><summary>实际取得的复现证据</summary><pre class="dialog-pre">${esc(JSON.stringify(job?.provenance || {missing:'尚未取得；未虚构代码版本或环境'},null,2))}</pre></details>
      <details class="panel-help"><summary>说明</summary><p>${online() ? "使用团队配置的独立 SSH 密钥与固定主机公钥，执行需要项目及成员授权。" : "使用本机 OpenSSH 配置和密钥；主机须已通过身份验证。"}执行需要服务器已有 Linux 与 Python 3.9+。关闭工作台不会终止任务。</p><p>执行成功不代表科学主张成立。状态未知不代表任务失败。</p></details>
    </div>`;
  }

  function paint(showContent = true) {
    if (!data) return;
    const sections = [...document.querySelectorAll('[data-remote-section]')].map(node => [node.dataset.remoteSection,node.open]);
    if (shellView === 'remote') shellPaint({titles:['远程实验'],bodies:[listHTML()]});
    if (showContent) {
      paintMiddle('remote',selected ? taskName(selected) : '实验详情',detailHTML(),'<button type="button" data-action="toggle-panel" data-panel="output-panel" data-remote-toggle-output aria-controls="output-panel">展开成果</button>');
      panelHeading('chat-panel',selected ? taskName(selected) : '实验详情','远程实验','remote-home');
    }
    for (const [key,open] of sections) {
      const section = [...document.querySelectorAll('[data-remote-section]')].find(node => node.dataset.remoteSection === key);
      if (section) section.open = open;
    }
  }

  // Dialogs keep the middle column for reading only: both forms are triggered from the left rail.
  function openDialog(html) {
    const dialog = document.createElement('dialog');
    dialog.className = 'compact-dialog';
    dialog.innerHTML = html;
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    return dialog;
  }

  // Dialogs follow the shell's dialog anatomy: a title with the close cross pinned to its top-right
  // corner, one quiet line of context, then the body — facts above, actions below, destructive work
  // behind its own hairline.
  const dialogHead = (title, note) => `<div class="modal-head"><div class="row between"><h2>${title}</h2><button type="button" class="icon" data-dialog-close aria-label="关闭" title="关闭">${icon('close')}</button></div>${note ? `<p>${note}</p>` : ''}</div>`;

  async function resourcesDialog() {
    const project = current.id;
    const [catalog, access, people] = await Promise.all([
      manageTeam() ? api(resourceURL()) : Promise.resolve({servers: []}),
      api(projectResourceURL()),
      manageProject() ? api(`/api/projects/${project}/members`) : Promise.resolve({members: []})
    ]);
    if (current?.id !== project || shellView !== 'remote') return;
    teamServers = catalog.servers;
    const ownsProject = people.members.some(person => person.user_id === state.user.id && person.role === 'owner');
    const servers = manageTeam() ? teamServers : access.servers;
    openDialog(`${dialogHead('服务器资源与权限', '团队负责人配置连接和项目使用权；项目负责人单独授予成员执行权。')}
      <div class="modal-body">${manageTeam() ? '<button type="button" data-add-server>添加团队服务器</button>' : ''}
      ${servers.map(server => {
        const grant = access.servers.find(item => item.id === server.id);
        return `<section class="dialog-section"><h3>${esc(server.name)}</h3><p>${esc(server.username)}@${esc(server.host)}:${server.port}</p>
          ${manageTeam() ? `<p class="dialog-note">主机指纹：${esc(server.host_fingerprint)}</p><div class="dialog-actions"><button type="button" data-server-edit="${esc(server.id)}">编辑连接</button><button type="button" data-resource-grant="${esc(server.id)}" data-enabled="${!grant}">${grant ? '撤销本项目使用' : '允许本项目使用'}</button><button type="button" class="danger" data-resource-delete="${esc(server.id)}">删除连接</button></div>` : ''}
          ${grant && ownsProject ? `<h4>成员执行权限</h4>${people.members.map(person => {
            const enabled = (grant.executors || []).includes(person.user_id);
            return `<div class="row between"><span>${esc(person.email)}</span><button type="button" data-executor="${esc(server.id)}" data-user="${esc(person.user_id)}" data-enabled="${!enabled}" aria-label="${enabled ? '撤销' : '允许'} ${esc(person.email)} 执行">${enabled ? '撤销执行权' : '允许执行'}</button></div>`;
          }).join('')}` : `<p class="dialog-note">${grant ? '执行权限由项目负责人管理。' : '授权给本项目后，由项目负责人选择可执行的成员。'}</p>`}</section>`;
      }).join('') || '<p>暂无服务器连接。</p>'}<p data-resource-error role="alert"></p></div>`);
  }

  function serverFormHTML(server = null) {
    return `${dialogHead(server ? '编辑服务器' : '添加服务器', online() ? '连接归团队所有。保存后需授权给项目，再授予成员执行权。' : '只保存名称、主机/SSH 别名、端口和用户名；不保存密码与密钥。')}
      <form data-server-form>
        <div class="modal-body">
          ${server ? `<input type="hidden" name="id" value="${esc(server.id)}"/>` : ''}
          ${field('name','名称', server?.name || '', 'required')}${field('host',online() ? '公网 IP 或域名' : '主机名或 OpenSSH Host 别名', server?.host || '', 'required')}${field('port','端口', server?.port ?? (online() ? 22 : ''), 'type="number" min="1" max="65535"')}${field('username',online() ? 'SSH 用户名' : '用户名（留空沿用 OpenSSH 配置）', server?.username || '', online() ? 'required' : '')}
          ${online() ? `<label class="dialog-field">SSH 私钥${server ? '（留空保留原密钥）' : ''}<textarea name="private_key" rows="3" spellcheck="false" autocomplete="off" ${server ? '' : 'required'}></textarea></label><label class="dialog-field">服务器 SSH 公钥<textarea name="host_key" rows="2" spellcheck="false" required>${esc(server?.host_key || '')}</textarea></label><p class="dialog-note">在服务器上运行 <code>cat /etc/ssh/ssh_host_ed25519_key.pub</code> 取得主机公钥。SSH 私钥仅保存在服务端，保存后不会回显。更换连接目标或密钥后，旧实验计划须重新确认。</p>` : '<label class="dialog-field">可选：导入已有服务器配置 JSON（servers 数组）<input type="file" accept=".json" data-import-file/></label><div data-import-preview>' + importPreview + '</div>'}
        </div>
        <div class="modal-foot"><small>${online() ? "私钥需无密码保护，并对应服务器允许登录的公钥" : "主机须已通过本机 SSH 身份验证"}</small><button class="primary">保存服务器</button></div>
      </form>`;
  }

  function serverMenuHTML(server) {
    const probe = data.probes[server.id];
    const address = `${esc(server.host)}${server.username ? ` · ${esc(server.username)}` : ''}${server.port ? ` : ${esc(server.port)}` : ''}`;
    const reach = !probe ? '尚未探测' : probe.ssh === 'not_used' ? (connected(probe) ? '本机 Docker 已连接' : '本机 Docker 不可用') : `网络${statuses[probe.tcp] || '未知'} · SSH ${statuses[probe.ssh] || '未知'}`;
    const state = !probe ? 'wait' : connected(probe) ? 'on' : '';
    const gpu = probe?.gpus?.[0];
    return `<div class="modal-head"><div class="row between"><h2>${esc(server.name)}</h2><button type="button" class="icon" data-dialog-close aria-label="关闭" title="关闭">${icon('close')}</button></div><p class="dialog-head-summary" data-state="${state}">${esc(reach)}</p></div>
      <div class="modal-body"><div class="dialog-facts"><p><strong>连接</strong><span>${address}</span></p><p><strong>GPU</strong><span>${esc(connected(probe) ? gpuLine(probe) : '尚未检查')}</span></p></div>
      ${gpu ? `<p>显存 ${(gpu.memoryUsedMb / 1024).toFixed(1)} / ${Math.round(gpu.memoryTotalMb / 1024)} GB · 利用率 ${gpu.utilizationPct}%</p>` : ''}<p class="dialog-note">最近检查：${esc(probe?.checkedAt || '尚未检查')}。服务器检查快照，非本次任务实时占用。</p>
      ${!online() && probe && !connected(probe) && probe.ssh !== 'not_used' ? '<p class="dialog-note">网页不会弹出 SSH 密码框。请检查本机 OpenSSH 主机身份信任，并配置可用的密钥或 SSH 代理，使连接无需交互输入密码后重试。</p>' : ''}
      <div class="dialog-actions"><button type="button" data-probe="${esc(server.id)}" ${canExecute(server.id) ? "" : "disabled"}>只读检查</button>${online() ? (manageTeam() || manageProject() ? '<button type="button" data-resources>管理资源与权限</button>' : "") : `<button type="button" data-server-edit="${esc(server.id)}">编辑</button>`}</div>
      ${online() ? `<p class="dialog-note">${server.can_execute ? "你已获授权执行实验。" : "你可以查看共享记录；执行实验需项目负责人授权。"}</p>` : `<div class="dialog-section"><p class="dialog-note">删除只移除这条连接记录；已提交的任务记录与日志仍在。</p><div class="dialog-actions"><button type="button" class="danger" data-server-delete="${esc(server.id)}">删除服务器</button></div></div>`}</div>`;
  }

  function experimentFormHTML() {
    return `${dialogHead('运行单次命令', '确认后会在远端保存运行身份、完整日志和退出结果。任务名可留空。')}
      <form data-experiment-form>
        <div class="modal-body">
          ${field('name','任务名（可留空，便于在列表里认出它）')}
          <label class="dialog-field">服务器<select name="server_id" required>${data.servers.map(server => `<option value="${esc(server.id)}" ${server.id === (serverFilter || data.settings?.server_id) ? 'selected' : ''}>${esc(server.name)} · ${esc(server.host)}</option>`).join('')}</select></label>
          ${field('directory','已有实验目录（Linux 绝对路径）', data.settings?.directory || '', 'required')}
          <label class="dialog-field">实际执行命令<textarea name="command" maxlength="4000" required></textarea></label>
          ${field('resources','资源要求（说明，不自动预订或设置配额）')}${field('configuration','配置说明（未知可留空；勿填凭据）')}
        </div>
        <div class="modal-foot"><small>执行成功不代表科学主张成立</small><button class="primary">预览授权内容</button></div>
      </form>`;
  }

  function groupFormHTML() {
    return `${dialogHead('新建实验组计划','确认计划后，AI 在选定范围内连续准备、执行和分析。')}
      <form data-group-form><div class="modal-body">
      ${field('title','实验目标','','required')}
      <label class="dialog-field">服务器<select name="server_id" required>${data.servers.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
      ${field('directory','已有原目录（只读，Linux 绝对路径）',data.settings?.directory || '','required')}
      <label class="dialog-field">实验方案、数据集、指标和判定条件<textarea name="plan" required maxlength="12000"></textarea></label>
      <label class="dialog-field">实验步骤（每行一项，含 baseline 和对照/消融）<textarea name="steps" required placeholder="baseline：固定数据与参数，输出 accuracy\n对照：更改一个条件，输出同一指标"></textarea></label><p class="dialog-note">每项应对应可运行、有结果指标的实验。环境准备、结果分析与报告由 AI 在执行中处理。</p>
      ${field('resources','资源要求')}${field('gpu_devices','允许的 GPU 编号（逗号分隔，留空不使用）')}
      ${field('max_seconds','实验组时长额度（秒，留空不限制）','','type="number" min="1"')}
      ${field('max_storage_mb','存储保护阈值（MiB，留空不限制）','','type="number" min="1"')}
      <label><input type="checkbox" name="network"/>允许联网获取公开代码、依赖和数据</label>
      <p class="dialog-note">已有文件保持只读；代码和结果写入独立实验组目录。存储阈值是定期检查，不是磁盘硬配额。</p>
      </div><div class="modal-foot"><button class="primary">预览实验组授权</button></div></form>`;
  }

  function closeDialogs() {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  }

  async function show(id, showContent = true) {
    const middle = showContent ? openMiddle('remote','实验详情',id) : null;
    if (showContent) {
      selected = null;
      paintMiddle('remote','实验详情','<p role="status">正在读取实验详情…</p>');
    }
    const request = ++generation, project = current.id;
    let response;
    try { response = await api(url()); }
    catch (error) {
      if (showContent && request === generation && current?.id === project && middle === middleRequest) paintMiddle('remote','实验详情',`<p role="alert">${esc(error.message)}</p>`);
      throw error;
    }
    if (request !== generation || current?.id !== project || middle && middle !== middleRequest) return;
    data = response;
    if (showContent) {
      // Fill the default detail without taking focus back from the list after loading.
      const items = [...(data.groups || []).sort(byAttention),...data.experiments];
      const target = id || items.find(item => item.id)?.id || null;
      if (!id) openMiddle('remote','实验详情',target,false);
      selected = items.find(item => item.id === target) || null;
      if (selected && serverFilter && selected.spec.server?.id !== serverFilter) serverFilter = '';
      logOffset = 0; resultOffset = 0; resultPath = '';
    }
    paint(showContent);
  }

  async function activate() {
    if (!document.getElementById('source-body')) return;
    try { await show(selected?.id,false); } catch (error) { toast(error.message); }
  }
  window.MethodAtlasRemote = {activate,open:show};

  document.addEventListener('click', event => {
    const link = event.target.closest('.remote-sections a');
    if (link) {
      const section = document.getElementById(link.hash.slice(1));
      if (section) { event.preventDefault(); if (section.tagName === 'DETAILS') section.open = true; section.scrollIntoView({block:'start'}); }
      return;
    }
    if (event.target.closest('[data-action=remote-home]')) { show().catch(error => toast(error.message)); return; }
    if (!event.target.closest('[data-remote-open]')) return;
    event.target.closest('details')?.removeAttribute('open');
    if (!current?.id) return;
    if (shellView !== 'remote') switchShellView('remote');
    else followMiddle('remote');
  });

  async function read(result) {
    const request = ++readGeneration, target = selected, project = current.id;
    const output = document.querySelector('[data-remote-output]');
    const path = document.querySelector('[data-result-form] [name=path]')?.value || '';
    if (result && path !== resultPath) { resultOffset = 0; resultPath = path; }
    const chunk = await post(url(`/${selected.id}/${result ? 'result' : 'log'}`), {offset:result ? resultOffset : logOffset, ...(result ? {path} : {})});
    if (request !== readGeneration || !output?.isConnected || current?.id !== project || selected !== target || middleView !== 'remote') return;
    if (result && document.querySelector('[data-result-form] [name=path]')?.value !== path) return;
    const stream = result ? `result:${path}` : 'log';
    const empty = chunk.next_offset === chunk.offset;
    const retained = empty && output.dataset.stream === stream && output.textContent;
    if (!retained) {
      output.textContent = chunk.text;
      output.dataset.range = `${chunk.offset}–${chunk.next_offset}`;
    }
    output.dataset.stream = stream;
    output.closest('details').open = true;
    output.closest('details').querySelector('summary').textContent = result ? '读取结果' : '任务日志';
    document.querySelector('[data-offset]').textContent = `${empty ? retained ? '暂无新增内容，保留上一段；' : '暂无内容；' : ''}字节 ${output.dataset.range} / ${chunk.size}；完整位置：${chunk.path}`;
    if (result) resultOffset = chunk.next_offset;
    else logOffset = chunk.next_offset;
  }

  document.addEventListener('change', async event => {
    const node = event.target;
    if (!node.closest('.panels') && !node.closest('dialog')) return;
    if (node.matches('[data-group-upload]')) {
      const file = node.files[0];
      node.value = '';
      if (!file) return;
      const target = selected, project = current.id, middle = middleRequest;
      const active = () => node.isConnected && current?.id === project && selected === target && middleRequest === middle;
      node.disabled = true;
      try {
        if (file.size>65536) throw new Error('请选择不超过64 KiB的文本代码文件');
        let content;
        try { content = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(await file.arrayBuffer()); }
        catch { throw new Error('请选择 UTF-8 编码的文本代码文件'); }
        if (content.includes('\0')) throw new Error('请选择文本代码文件，不能包含二进制内容');
        if (!active()) return;
        await post(url(`/groups/${target.id}/upload`),{path:file.name,content,before_sha256:''});
        if (active()) await show(target.id);
      } catch(error) { if (active()) toast(error.message); }
      finally { if (node.isConnected) node.disabled = false; }
      return;
    }
    if (node.matches('[data-import-file]')) {
      const file = node.files[0];
      node.value = '';
      if (!file) return;
      const request = ++importGeneration, preview = node.closest('form').querySelector('[data-import-preview]');
      importRows = null; importPreview = '';
      preview.textContent = '正在检查连接配置…';
      try {
        if (file.size > 1000000) throw new Error('连接配置文件须小于 1 MB');
        const raw = JSON.parse(await file.text());
        if (!node.isConnected || request !== importGeneration) return;
        // Drop secrets before sending even to the local backend.
        const rows = Array.isArray(raw) ? raw : raw?.servers;
        if (!Array.isArray(rows)) throw new Error('需要 servers 数组');
        if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('服务器条目必须是对象');
        const response = await post('/api/remote/servers/preview-import', {servers:rows.map(row => Object.fromEntries(['name','host','port','username'].map(key => [key, row[key] ?? (key === 'username' ? '' : null)])))});
        if (!node.isConnected || request !== importGeneration) return;
        importRows = response.preview;
        importPreview = `<p class="dialog-note">仅导入以下元数据；不复制密码、私钥或密钥文件。重复连接不导入。</p>` + response.preview.map((row, index) => `<p class="dialog-status">${esc(JSON.stringify(row.server))} ${row.duplicate ? '重复' : `<button type="button" data-import-row="${index}">确认导入此连接</button>`}</p>`).join('');
        preview.innerHTML = importPreview;
      } catch (error) { if (node.isConnected && request === importGeneration) preview.textContent = error.message; }
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-server-form],[data-experiment-form],[data-result-form],[data-group-form]')) return;
    event.preventDefault();
    if (form.dataset.submitting) return;
    const body = Object.fromEntries(new FormData(form));
    const dialog = form.closest('dialog'), project = current.id, middle = middleRequest;
    const active = () => form.isConnected && (!dialog || dialog.open) && current?.id === project && middleRequest === middle;
    const controls = [...form.querySelectorAll('input,textarea,select,button')].map(node => [node,node.disabled]);
    form.dataset.submitting = 'true';
    controls.forEach(([node]) => node.disabled = true);
    try {
      if (form.hasAttribute('data-group-form')) {
        body.steps=body.steps.split('\n').map(x=>x.trim()).filter(Boolean);
        body.network=body.network==='on';
        body.gpu_devices=body.gpu_devices.trim() ? body.gpu_devices.split(',').map(x=>Number(x.trim())) : [];
        for (const key of ['max_seconds','max_storage_mb']) body[key]=body[key] ? Number(body[key]) : null;
        body.conversation_id=conversation.id;
        const item=await post(url('/groups/prepare'),body);
        if (!active()) return;
        dialog.close(); await show(item.id);
      } else if (form.hasAttribute('data-server-form')) {
        body.port = body.port ? Number(body.port) : null;
        await post(online() ? resourceURL('/save') : '/api/remote/servers/save', body);
        if (!active()) return;
        importPreview = '';
        dialog.close();
        await show(selected?.id);
        if (online()) await resourcesDialog();
      } else if (form.hasAttribute('data-experiment-form')) {
        if (online()) body.conversation_id = conversation.id;
        const item = await post(url('/prepare'), body);
        if (!active()) return;
        dialog.close();
        await show(item.id);
      } else await read(true);
    } catch (error) { if (active()) { form.querySelector('[role=alert]')?.remove(); const notice=document.createElement('p'); notice.setAttribute('role','alert'); notice.textContent=error.message; form.append(notice); } }
    finally { delete form.dataset.submitting; controls.forEach(([node,disabled]) => node.disabled = disabled); }
  });

  document.addEventListener('click', async event => {
    const node = event.target.closest('button');
    if (!node || node.disabled || !current?.id) return;
    // This delegated listener must never reset another module's disabled state.
    if (!node.matches('[data-plan-chat],[data-resources],[data-resource-grant],[data-resource-delete],[data-executor],[data-dialog-close],[data-experiment],[data-server-pick],[data-server-menu],[data-probe-all],[data-prepare-group],[data-group-control],[data-group-refresh],[data-add-server],[data-prepare],[data-rename],[data-import-row],[data-probe],[data-server-edit],[data-server-delete],[data-confirm],[data-observe],[data-cancel],[data-log],[data-fetch],[data-analyze]')) return;
    // Buttons inside a form belong to its submit handler; only these two act on click instead.
    if (node.closest('form') && !node.hasAttribute('data-import-row') && !node.hasAttribute('data-fetch')) return;
    const actionTarget = selected, actionProject = current.id, actionMiddle = middleRequest;
    const active = () => current?.id === actionProject && selected === actionTarget && middleRequest === actionMiddle;
    const refresh = async () => { if (active()) await show(actionTarget?.id); };
    try {
      if (node.hasAttribute('data-dialog-close')) { closeDialogs(); return; }
      if (node.hasAttribute('data-resources')) { node.disabled = true; closeDialogs(); await resourcesDialog(); return; }
      if (node.dataset.resourceGrant || node.dataset.resourceDelete || node.dataset.executor) {
        node.disabled = true;
        if (node.dataset.resourceGrant) await post(resourceURL('/grant'), {project_id: current.id, server_id: node.dataset.resourceGrant, enabled: node.dataset.enabled === 'true'});
        if (node.dataset.executor) await post(projectResourceURL('/execute-grant'), {server_id: node.dataset.executor, user_id: node.dataset.user, enabled: node.dataset.enabled === 'true'});
        if (node.dataset.resourceDelete && confirm('删除这条团队连接？所有项目授权及后续执行将撤销。已启动的远程程序不会被终止，历史记录保留。')) await post(resourceURL('/delete'), {id: node.dataset.resourceDelete});
        if (current?.id !== actionProject) return;
        closeDialogs(); await refresh(); await resourcesDialog(); return;
      }
      if (node.dataset.experiment) {
        if (selected?.id === node.dataset.experiment && middleView === 'remote' && document.querySelector('#chat-body .task-detail')) revealPanel('chat-panel');
        else await show(node.dataset.experiment);
        return;
      }
      if (node.dataset.serverPick) {
        serverFilter = serverFilter === node.dataset.serverPick ? '' : node.dataset.serverPick;
        paint(false); return;
      }
      if (node.dataset.serverMenu) {
        const server = data.servers.find(item => item.id === node.dataset.serverMenu);
        openDialog(serverMenuHTML(server));
        return;
      }
      if (node.hasAttribute('data-probe-all')) {
        node.disabled = true;
        for (const server of data.servers.filter(item => canExecute(item.id))) await post(probeURL(), {id:server.id});
        await refresh();
        return;
      }
      if (node.hasAttribute('data-plan-chat')) {
        await window.MethodAtlasAI.open(null,'请帮我制定实验计划，先明确研究目标、baseline、对照或消融、数据、指标和判定条件，再展示服务器、目录和资源授权范围供我确认。');
        return;
      }
      if (node.hasAttribute('data-prepare-group')) {
        if (!data.servers.length) { toast('请先添加服务器'); return; }
        openDialog(groupFormHTML()); return;
      }
      if (node.dataset.groupControl) {
        node.disabled=true;
        await post(url(`/groups/${selected.id}/${node.dataset.groupControl}`),{digest:selected.digest});
        await refresh(); return;
      }
      if (node.hasAttribute('data-group-refresh')) { await show(selected.id); return; }
      if (node.hasAttribute('data-add-server')) { closeDialogs(); openDialog(serverFormHTML()); return; }
      if (node.hasAttribute('data-prepare')) {
        if (!data.servers.length) { toast('请先添加一台服务器'); return; }
        openDialog(experimentFormHTML()); return;
      }
      if (node.hasAttribute('data-rename') && selected) {
        const target = selected;
        const next = await window.MethodAtlasTextInput('重命名实验','任务名（留空则显示未命名任务）', target.name || '');
        if (next === null || !active()) return;
        const item = await post(url(`/${target.id}/rename`), {name:next});
        if (!active()) return;
        data.experiments = data.experiments.map(row => row.id === item.id ? item : row);
        selected = item;
        paint(); return;
      }
      if (!data) return;
      node.disabled = true;
      if (node.hasAttribute('data-import-row')) { await post('/api/remote/servers/save', importRows[Number(node.dataset.importRow)].server); if (!active() || !node.isConnected || !node.closest('dialog')?.open) return; importPreview = ''; closeDialogs(); await refresh(); }
      if (node.dataset.probe) { closeDialogs(); await post(probeURL(), {id:node.dataset.probe}); await refresh(); }
      if (node.dataset.serverEdit) { closeDialogs(); openDialog(serverFormHTML((online() ? teamServers : data.servers).find(item => item.id === node.dataset.serverEdit))); }
      if (node.dataset.serverDelete) {
        const target = data.servers.find(item => item.id === node.dataset.serverDelete);
        if (confirm(`删除服务器「${target.name}」？已提交的任务记录会保留。`)) {
          closeDialogs();
          await post('/api/remote/servers/delete', {id:target.id});
          if (!active()) return;
          if (serverFilter === target.id) serverFilter = '';
          await refresh();
        }
      }
      if (node.hasAttribute('data-confirm')) { await post(url(`/${selected.id}/confirm`), {digest:selected.digest}); await refresh(); }
      if (node.hasAttribute('data-observe')) { await post(url(`/${selected.id}/observe`)); await refresh(); }
      if (node.hasAttribute('data-cancel') && confirm(`终止 ${taskName(selected)} 在 ${selected.spec.server.host} 的任务？${selected.spec.sandbox ? " 同时暂停本组 AI 后续操作。" : ""}`)) { await post(url(`/${selected.id}/cancel`), {digest:selected.digest, confirm:true}); await refresh(); }
      if (node.hasAttribute('data-log')) await read(false);
      if (node.hasAttribute('data-fetch')) { await post(url(`/${selected.id}/fetch`), {path:document.querySelector('[data-result-form] [name=path]')?.value || ''}); await refresh(); }
      if (node.hasAttribute('data-analyze')) {
        const text = `请分析远程实验 ${selected.id} 的真实结果${resultPath ? '，结果文件 ' + resultPath : ''}，回读日志，区分执行状态与支持、否定、待验证主张。`;
        await window.MethodAtlasAI.open({id:uid(),kind:'remote',experiment_id:selected.id,path:resultPath||'',title:taskName(selected),text},'请分析所引用实验的真实结果，回读日志，区分执行状态与支持、否定、待验证主张。');
      }
    } catch (error) {
      if (active()) {
        const notice = node.closest('dialog')?.querySelector('[data-resource-error]');
        if (notice) notice.textContent = error.message;
        else toast(error.message);
      }
    }
    finally { if (node.isConnected) node.disabled = false; }
  });
})();
