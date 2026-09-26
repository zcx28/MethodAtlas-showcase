// 远程实验以工作台视图呈现：左栏上=服务器、左栏下=最近任务、中栏=任务详情。
// 授权边界、日志读取与结果取回的逻辑与原来的对话框完全一致，只换了呈现宿主。
(() => {
  const labels = {awaiting_confirmation:'待授权',submitting:'提交中',queued:'排队',running:'运行中',succeeded:'执行成功',failed:'执行失败',unknown:'状态未知',cancelled:'已终止',interrupted:'已中断',repairing:'修复重试',active:'自动推进',paused:'已暂停',completed:'计划完成'};
  const statuses = {reachable:'可达',unreachable:'不可达',unknown:'未知',connected:'已连接',authentication_failed:'认证失败',error:'连接失败',available:'可用',none:'无 GPU',probe_error:'探测失败'};
  const post = (target, body = {}) => api(target, {method:'POST', body:JSON.stringify(body)});
  const url = (suffix = '') => `/api/projects/${current.id}/remote${suffix}`;
  const field = (name, title, value = '', extra = '') => `<label class="dialog-field">${title}<input name="${name}" value="${esc(value)}" ${extra}/></label>`;
  let data = null, selected = null, generation = 0, logOffset = 0, resultOffset = 0, resultPath = '', importPreview = '', importRows = null, serverFilter = '';

  // An unnamed task gets an explicit label rather than a wall of command text; the command itself is
  // one click away in the detail column.
  const taskName = item => item.name || '未命名任务';
  const gpuLine = probe => {
    const gpu = (probe?.gpus || [])[0];
    if (gpu) return `${gpu.name} · ${Math.round(gpu.memoryTotalMb / 1024)} GB`;
    if (!probe) return '尚未探测';
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
      const state = !probe ? 'unknown' : probe.state === 'online' ? 'online' : 'offline';
      const active = server.id === serverFilter;
      const count = data.experiments.filter(item => item.spec.server.id === server.id).length;
      return `<div class="server-row${active ? ' active' : ''}"><button type="button" class="server-pick" data-server-pick="${esc(server.id)}" aria-label="只看 ${esc(server.name)} 的任务"${active ? ' aria-current="true"' : ''}><span class="server-dot" data-state="${state}"></span><span class="server-body"><strong>${esc(server.name)}</strong><small>${esc(gpuLine(probe))}</small></span></button>${count ? `<span class="server-count" title="${count} 项任务">${count}</span>` : ''}<button type="button" class="icon server-more" data-server-menu="${esc(server.id)}" aria-label="${esc(server.name)} 的更多操作" title="更多操作">${icon('dots')}</button></div>`;
    }).join('');
    return `<section class="rail-block"><header class="rail-head"><h3>服务器</h3><div class="row"><button type="button" class="mini" data-add-server>${icon('plus')}添加服务器</button><button type="button" class="mini" data-probe-all>全部探测</button></div></header><div class="server-list">${rows || '<p class="empty-small">还没有服务器。先添加一台再发起任务。</p>'}</div></section>`;
  }

  function experimentsHTML() {
    const items = data.experiments.filter(item => !serverFilter || item.spec.server.id === serverFilter);
    const rows = items.map(item => `<button type="button" class="library-row${item.id === selected?.id ? ' active' : ''}" data-experiment="${esc(item.id)}"${item.id === selected?.id ? ' aria-current="true"' : ''}><span class="task-dot" data-state="${esc(item.status)}" title="${esc(labels[item.status] || item.status)}"></span><span class="library-row-body"><strong>${esc(taskName(item))}</strong><small>${esc(labels[item.status] || item.status)} · ${esc(item.created)}</small></span></button>`).join('');
    const empty = serverFilter ? '这台服务器还没有任务。' : '还没有任务。添加服务器后点「准备实验」发起第一项。';
    return `<section class="rail-block grow"><header class="rail-head"><h3>最近任务</h3><span class="badge">${items.length}</span></header><div class="library-list">${rows || `<p class="empty-small">${empty}</p>`}</div></section>`;
  }

  function groupsHTML() {
    const groups = (data.groups || []).filter(g => !serverFilter || g.spec.server.id === serverFilter);
    return `<section class="rail-block"><header class="rail-head"><h3>实验组</h3><button type="button" class="mini" data-prepare-group>新建计划</button></header>${groups.map(g => `<button type="button" class="library-row${selected?.id === g.id ? ' active' : ''}" data-experiment="${esc(g.id)}"><span class="library-row-body"><strong>${esc(g.spec.title)}</strong><small>${esc(labels[g.status])} · ${g.completed_steps.length}/${g.spec.steps.length}</small></span></button>`).join('') || '<p class="empty-small">在对话中提出实验目标，或新建计划。确认一次后，AI 按计划执行。</p>'}</section>`;
  }

  function groupDetail() {
    const g = selected, spec = g.spec;
    const metrics=[...new Set(g.runs.flatMap(r=>Object.keys(r.record?.metrics || {})))];
    return `<div class="task-detail"><h3>${esc(spec.title)}</h3><p role="status">${esc(labels[g.status])} · ${esc(g.message)}</p>
      <pre class="dialog-pre">${esc(spec.plan)}</pre><ol>${spec.steps.map((step,i) => `<li>${esc(step)}${g.completed_steps.includes(i) ? ' · 已完成' : ''}</li>`).join('')}</ol>
      <ul class="meta-list"><li><span>服务器</span><b>${esc(spec.server.name)} · ${esc(spec.connection.username)}@${esc(spec.connection.host)}:${esc(spec.connection.port)}</b></li><li><span>原目录（只读）</span><b>${esc(spec.directory)}</b></li><li><span>新建工作目录</span><b>${esc(spec.directory)}/.methodatlas-groups/${esc(g.id)}/work</b></li><li><span>网络访问</span><b>${spec.network ? '允许下载公开代码、依赖和数据' : '不允许'}</b></li><li><span>GPU 编号</span><b>${spec.gpu_devices.length ? esc(spec.gpu_devices.join(', ')) : '不使用 GPU'}</b></li><li><span>时长额度</span><b>${spec.max_seconds ? `${spec.max_seconds} 秒（首次授权起计时）` : '未设置'}</b></li><li><span>存储保护阈值</span><b>${spec.max_storage_mb ? `${spec.max_storage_mb} MiB（定期检测并停止，可能短时超出）` : '未设置'}</b></li><li><span>资源说明</span><b>${esc(spec.resources || '未填写')}</b></li></ul>
      <p class="dialog-note">确认后，AI 可在新建工作目录内编写代码、准备独立环境、运行并修复实验；原目录保持只读。系统变更及扩大计划须重新授权。${spec.server.host === 'methodatlas-local' ? '本机 Docker 须保持运行；关闭电脑会中断本机实验。' : '远端须已有可用的 bubblewrap 隔离工具。关闭本机后仅已提交任务继续，重新打开后 AI 再接着分析。'}</p>
      <div class="row">${g.status==='awaiting_confirmation' ? '<button class="primary" data-group-control="confirm">确认实验组并开始</button>' : g.status==='active' ? '<button data-group-control="pause">暂停 AI 后续操作</button>' : g.status==='paused' ? '<button class="primary" data-group-control="resume">恢复 AI 推进</button>' : ''}<button data-group-refresh>刷新实验组</button></div>
      ${g.status==='active' ? '<label class="dialog-field">上传选定文本代码（新文件，≤64 KiB）<input type="file" data-group-upload accept=".py,.sh,.json,.csv,.toml,.yaml,.yml,.txt"/></label>' : ''}
      <h4>指标对照</h4>${metrics.length ? `<div style="overflow-x:auto"><table><thead><tr><th scope="col">运行</th>${metrics.map(k=>`<th scope="col">${esc(k)}</th>`).join('')}</tr></thead><tbody>${g.runs.filter(r=>r.record).map(r=>`<tr><th scope="row">${esc(spec.steps[r.step])} · ${esc(r.kind)}</th>${metrics.map(k=>`<td>${esc(String(r.record.metrics[k] ?? '未记录'))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${metrics.filter(k=>g.runs.some(r=>typeof r.record?.metrics[k]==='number'&&r.record.metrics[k]>=0)).map(k=>`<details><summary>${esc(k)} 趋势图</summary><img loading="lazy" style="max-width:100%;height:auto" src="${url('/groups/'+g.id+'/chart')}?metric=${encodeURIComponent(k)}" alt="${esc(k)} 的实验运行对照图"/><p>图显示非负数值的趋势，精确数值及负值见表格；比较条件以计划和运行配置为准。</p></details>`).join('')}` : '<p>保存真实结果后显示对照。</p>'}
      <h4>实际运行与结果</h4>${g.runs.map(r => { const item=data.experiments.find(e=>e.id===r.id); return `<section class="memory-card"><button data-experiment="${esc(r.id)}">${esc(spec.steps[r.step])} · ${esc(r.kind)} · ${esc(labels[item?.status] || '未取得')}</button><p>${esc(r.summary || '')}</p>${r.record ? `<pre class="dialog-pre">${esc(JSON.stringify(r.record.metrics,null,2))}</pre>` : ''}</section>`; }).join('') || '<p>尚未提交运行。</p>'}
      <details><summary>代码修改记录（${g.changes.length}）</summary>${g.changes.map(c => `<h4>${esc(c.path)}</h4><pre class="dialog-pre">${esc(c.diff)}</pre>`).join('')}</details>
      <details><summary>步骤结论</summary><pre class="dialog-pre">${esc(JSON.stringify(g.conclusions || {},null,2))}</pre></details></div>`;
  }

  function listHTML() {
    return `<div class="rail remote-rail">${serversHTML()}${groupsHTML()}${experimentsHTML()}<div class="row rail-actions"><button type="button" class="primary" data-prepare>${icon('plus')}准备实验</button></div></div>`;
  }

  function detailHTML() {
    if (!selected) return `<div class="rail-empty"><p class="empty-small">从左侧选择一项任务，查看授权内容、运行状态、日志与结果。</p></div>`;
    if (selected.id.startsWith('group_')) return groupDetail();
    const job = selected.job, spec = selected.spec;
    const probe = data.probes?.[spec.server.id];
    const gpu = (probe?.gpus || [])[0];
    const spent = duration(job);
    const canConfirm = !spec.sandbox && ['awaiting_confirmation','unknown','submitting'].includes(selected.status);
    return `<div class="task-detail">
      <header class="task-head"><div class="row between"><h3>${esc(taskName(selected))}</h3><button type="button" class="icon" data-rename aria-label="重命名任务" title="重命名任务">${icon('edit')}</button></div><p class="dialog-status"><span class="state-chip" data-state="${esc(selected.status)}">${esc(labels[selected.status] || selected.status)}</span> · ${esc(selected.created)}</p></header>

      <section class="memory-card"><ul class="meta-list">
        <li><span>服务器</span><b>${esc(spec.server.name)} · ${esc(spec.connection.username)}@${esc(spec.connection.host)}:${esc(spec.connection.port)}</b></li>
        <li><span>目录</span><b>${esc(spec.directory)}</b></li>
        ${spent ? `<li><span>运行时间</span><b>${esc(spent)}</b></li>` : ''}
        ${gpu ? `<li><span>资源占用</span><b>${esc(gpu.name)} · 显存 ${(gpu.memoryUsedMb / 1024).toFixed(1)} / ${Math.round(gpu.memoryTotalMb / 1024)} GB · 利用率 ${gpu.utilizationPct}%</b></li>` : ''}
      </ul></section>

      <label class="dialog-field">实际执行命令<pre class="dialog-pre">${esc(spec.command)}</pre></label>
      <p class="dialog-note">授权仅绑定以上内容。确认会在实验目录保存运行身份、完整日志和退出结果。</p>
      ${canConfirm ? '<div class="row"><button class="primary" data-confirm>确认以上内容并执行 / 同身份重试</button></div>' : ''}
      ${selected.status !== 'awaiting_confirmation' ? '<div class="row memory-editor-actions"><button data-observe>重连 / 刷新状态</button><button data-cancel>明确终止此任务</button></div>' : ''}

      <details class="panel-help" open><summary>结果文件${selected.results.length ? `（${selected.results.length}）` : ''}</summary>
        ${selected.results.map(row => `<p class="dialog-status"><a href="${url('/results/' + row.id)}" download title="下载结果版本">${icon('download')} ${esc(row.remote_path)}</a> · ${esc(row.sha256.slice(0, 12))}${row.paper_id ? ' · 已加入研究材料' : ' · 二进制或大文本，未作为文字材料'}</p>`).join('') || '<p class="empty-small">还没有取回结果。</p>'}
        <form data-result-form>${field('path','读取 / 取回选定结果（授权目录内相对路径）')}<div class="row"><button>读取下一段结果</button><button type="button" data-fetch>取回完整文件并用于研究（≤2 MiB）</button></div></form>
      </details>

      <details class="panel-help"><summary>任务日志</summary>
        <div class="row"><button type="button" data-log>读取下一段日志</button></div>
        <pre data-remote-output class="dialog-pre dialog-output"></pre><p data-offset class="dialog-status"></p>
      </details>

      <div class="row"><button data-analyze>带回对话分析结果</button></div>

      ${spec.repair ? `<h4>第 ${spec.attempt} 次修复重试 · ${esc(spec.repair.path)}</h4><p class="dialog-note">${esc(spec.repair.reason)}</p><h5>修改前</h5><pre class="dialog-pre">${esc(spec.repair.before)}</pre><h5>确认后写入的完整内容</h5><pre class="dialog-pre">${esc(spec.repair.content)}</pre><p class="dialog-note">此次确认同时授权以上脚本修改及重试；原失败记录保留。</p>` : ''}

      <h4>技术细节</h4>
      <ul class="meta-list">
        <li><span>任务 ID</span><b>${esc(selected.id)}</b></li>
        <li><span>远端记录</span><b>${esc(spec.directory)}/.methodatlas-jobs/${esc(selected.id)}</b></li>
        <li><span>完整日志</span><b>${esc(job?.logPath || '尚未取得')}</b></li>
        <li><span>退出码</span><b>${job?.exitCode == null ? '尚未取得' : esc(job.exitCode)}</b></li>
        <li><span>观测信息</span><b>${esc(job?.observationError || '无异常')}</b></li>
        <li><span>资源声明</span><b>${esc(spec.resources || '未声明')}</b></li>
        <li><span>配置说明</span><b>${esc(spec.configuration || '未提供')}</b></li>
      </ul>
      <details><summary>实际取得的复现证据</summary><pre class="dialog-pre">${esc(JSON.stringify(job?.provenance || {missing:'尚未取得；未虚构代码版本或环境'},null,2))}</pre></details>
      <details class="panel-help"><summary>说明</summary><p>使用本机 OpenSSH 配置和密钥；主机须已通过身份验证。执行需要服务器已有 Linux 与 Python 3.9+。关闭工作台不会终止任务。</p><p>执行成功不代表科学主张成立。状态未知不代表任务失败。</p></details>
    </div>`;
  }

  function paint(showContent = true) {
    if (!data) return;
    if (shellView === 'remote') shellPaint({titles:['远程实验'],bodies:[listHTML()]});
    if (showContent) paintMiddle('remote',selected ? taskName(selected) : '实验详情',detailHTML());
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

  function serverFormHTML(server = null) {
    return `${dialogHead(server ? '编辑服务器' : '添加服务器', '只保存名称、主机/SSH 别名、端口和用户名；不保存密码与密钥。')}
      <form data-server-form>
        <div class="modal-body">
          ${server ? `<input type="hidden" name="id" value="${esc(server.id)}"/>` : ''}
          ${field('name','名称', server?.name || '')}${field('host','主机名或 OpenSSH Host 别名', server?.host || '')}${field('port','端口', server?.port ?? '', 'type="number" min="1" max="65535" placeholder="留空沿用 OpenSSH 配置"')}${field('username','用户名（留空沿用 OpenSSH 配置）', server?.username || '')}
          <label class="dialog-field">可选：导入已有服务器配置 JSON（servers 数组）<input type="file" accept=".json" data-import-file/></label><div data-import-preview>${importPreview}</div>
        </div>
        <div class="modal-foot"><small>主机须已通过本机 SSH 身份验证</small><button class="primary">保存服务器</button></div>
      </form>`;
  }

  function serverMenuHTML(server) {
    const probe = data.probes[server.id];
    const address = `${esc(server.host)}${server.username ? ` · ${esc(server.username)}` : ''}${server.port ? ` : ${esc(server.port)}` : ''}`;
    const reach = !probe ? '尚未探测' : probe.state === 'online' ? '可达' : '不可达';
    const state = !probe ? 'wait' : probe.state === 'online' ? 'on' : '';
    return `<div class="modal-head"><div class="row between"><h2>${esc(server.name)}</h2><button type="button" class="icon" data-dialog-close aria-label="关闭" title="关闭">${icon('close')}</button></div><p class="dialog-head-summary" data-state="${state}">${esc(reach)}</p></div>
      <div class="modal-body"><div class="dialog-facts"><p><strong>连接</strong><span>${address}</span></p><p><strong>GPU</strong><span>${esc(gpuLine(probe))}</span></p></div>
      <div class="dialog-actions"><button type="button" data-probe="${esc(server.id)}">只读检查</button><button type="button" data-server-edit="${esc(server.id)}">编辑</button></div>
      <div class="dialog-section"><p class="dialog-note">删除只移除这条连接记录；已提交的任务记录与日志仍在。</p><div class="dialog-actions"><button type="button" class="danger" data-server-delete="${esc(server.id)}">删除服务器</button></div></div></div>`;
  }

  function experimentFormHTML() {
    return `${dialogHead('准备实验', '确认后会在远端保存运行身份、完整日志和退出结果。任务名可留空。')}
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
      <label class="dialog-field">实验步骤（每行一项，含 baseline 和对照/消融）<textarea name="steps" required></textarea></label>
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
    const request = ++generation, project = current.id;
    const response = await api(url());
    if (request !== generation || current?.id !== project || middle && middle !== middleRequest) return;
    data = response;
    if (showContent) {
      // 没指定实验时（刚切到本视图）取列表第一项；一条实验都没有也要把中栏切过来，
      // detailHTML 会给出「从左侧选择一项任务」的空状态，而不是留着上一个视图的内容。
      const items = [...data.experiments,...(data.groups || [])];
      const target = id || items.find(item => item.id)?.id || null;
      if (!id) openMiddle('remote','实验详情',target);
      selected = items.find(item => item.id === target) || null;
      if (selected && serverFilter && selected.spec.server.id !== serverFilter) serverFilter = '';
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
    if (!event.target.closest('[data-remote-open]')) return;
    event.target.closest('details')?.removeAttribute('open');
    if (!current?.id) return;
    if (shellView !== 'remote') switchShellView('remote');
    else followMiddle('remote');
  });

  async function read(result) {
    const path = document.querySelector('[data-result-form] [name=path]')?.value || '';
    if (result && path !== resultPath) { resultOffset = 0; resultPath = path; }
    const chunk = await post(url(`/${selected.id}/${result ? 'result' : 'log'}`), {offset:result ? resultOffset : logOffset, ...(result ? {path} : {})});
    document.querySelector('[data-remote-output]').textContent = chunk.text;
    document.querySelector('[data-offset]').textContent = `字节 ${chunk.offset}–${chunk.next_offset} / ${chunk.size}；完整位置：${chunk.path}`;
    if (result) resultOffset = chunk.next_offset;
    else logOffset = chunk.next_offset;
  }

  document.addEventListener('change', async event => {
    const node = event.target;
    if (!node.closest('.panels') && !node.closest('dialog')) return;
    if (node.matches('[data-group-upload]')) {
      try {
        const file=node.files[0];
        if (!file || file.size>65536) throw new Error('请选择不超过64 KiB的文本代码文件');
        await post(url(`/groups/${selected.id}/upload`),{path:file.name,content:await file.text(),before_sha256:''});
        await show(selected.id);
      } catch(error) { toast(error.message); }
      return;
    }
    if (node.matches('[data-import-file]')) {
      try {
        const file = node.files[0];
        if (!file || file.size > 1000000) throw new Error('连接配置文件须小于 1 MB');
        const raw = JSON.parse(await file.text());
        // Drop secrets before sending even to the local backend.
        const rows = Array.isArray(raw) ? raw : raw.servers;
        if (!Array.isArray(rows)) throw new Error('需要 servers 数组');
        const response = await post('/api/remote/servers/preview-import', {servers:rows.map(row => Object.fromEntries(['name','host','port','username'].map(key => [key, row[key] ?? (key === 'username' ? '' : null)])))});
        importRows = response.preview;
        importPreview = `<p class="dialog-note">仅导入以下元数据；不复制密码、私钥或密钥文件。重复连接不导入。</p>` + response.preview.map((row, index) => `<p class="dialog-status">${esc(JSON.stringify(row.server))} ${row.duplicate ? '重复' : `<button type="button" data-import-row="${index}">确认导入此连接</button>`}</p>`).join('');
        node.closest('form').querySelector('[data-import-preview]').innerHTML = importPreview;
      } catch (error) { toast(error.message); }
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-server-form],[data-experiment-form],[data-result-form],[data-group-form]')) return;
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button:not([value])');
    if (button) button.disabled = true;
    try {
      if (form.hasAttribute('data-group-form')) {
        body.steps=body.steps.split('\n').map(x=>x.trim()).filter(Boolean);
        body.network=body.network==='on';
        body.gpu_devices=body.gpu_devices.trim() ? body.gpu_devices.split(',').map(x=>Number(x.trim())) : [];
        for (const key of ['max_seconds','max_storage_mb']) body[key]=body[key] ? Number(body[key]) : null;
        body.conversation_id=conversation.id;
        const item=await post(url('/groups/prepare'),body);
        closeDialogs(); await show(item.id);
      } else if (form.hasAttribute('data-server-form')) {
        body.port = body.port ? Number(body.port) : null;
        await post('/api/remote/servers/save', body);
        importPreview = '';
        closeDialogs();
        await show(selected?.id);
      } else if (form.hasAttribute('data-experiment-form')) {
        const item = await post(url('/prepare'), body);
        closeDialogs();
        await show(item.id);
      } else await read(true);
    } catch (error) { form.querySelector('[role=alert]')?.remove(); const notice=document.createElement('p'); notice.setAttribute('role','alert'); notice.textContent=error.message; form.append(notice); }
    finally { if (button) button.disabled = false; }
  });

  document.addEventListener('click', async event => {
    const node = event.target.closest('button');
    if (!node || !current?.id) return;
    // Buttons inside a form belong to its submit handler; only these two act on click instead.
    if (node.closest('form') && !node.hasAttribute('data-import-row') && !node.hasAttribute('data-fetch')) return;
    try {
      if (node.hasAttribute('data-dialog-close')) { closeDialogs(); return; }
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
        for (const server of data.servers) await post('/api/remote/servers/check', {id:server.id});
        await show(selected?.id);
        return;
      }
      if (node.hasAttribute('data-prepare-group')) {
        if (!data.servers.length) { toast('请先添加服务器'); return; }
        openDialog(groupFormHTML()); return;
      }
      if (node.dataset.groupControl) {
        node.disabled=true;
        await post(url(`/groups/${selected.id}/${node.dataset.groupControl}`),{digest:selected.digest});
        await show(selected.id); return;
      }
      if (node.hasAttribute('data-group-refresh')) { await show(selected.id); return; }
      if (node.hasAttribute('data-add-server')) { openDialog(serverFormHTML()); return; }
      if (node.hasAttribute('data-prepare')) {
        if (!data.servers.length) { toast('请先添加一台服务器'); return; }
        openDialog(experimentFormHTML()); return;
      }
      if (node.hasAttribute('data-rename') && selected) {
        const next = prompt('任务名（留空则显示命令首行）', selected.name || '');
        if (next === null) return;
        const item = await post(url(`/${selected.id}/rename`), {name:next});
        data.experiments = data.experiments.map(row => row.id === item.id ? item : row);
        selected = item;
        paint(); return;
      }
      if (!data) return;
      node.disabled = true;
      if (node.hasAttribute('data-import-row')) { await post('/api/remote/servers/save', importRows[Number(node.dataset.importRow)].server); importPreview = ''; closeDialogs(); await show(selected?.id); }
      if (node.dataset.probe) { closeDialogs(); await post('/api/remote/servers/check', {id:node.dataset.probe}); await show(selected?.id); }
      if (node.dataset.serverEdit) { closeDialogs(); openDialog(serverFormHTML(data.servers.find(item => item.id === node.dataset.serverEdit))); }
      if (node.dataset.serverDelete) {
        const target = data.servers.find(item => item.id === node.dataset.serverDelete);
        if (confirm(`删除服务器「${target.name}」？已提交的任务记录会保留。`)) {
          closeDialogs();
          await post('/api/remote/servers/delete', {id:target.id});
          if (serverFilter === target.id) serverFilter = '';
          await show(selected?.id);
        }
      }
      if (node.hasAttribute('data-confirm')) { await post(url(`/${selected.id}/confirm`), {digest:selected.digest}); await show(selected.id); }
      if (node.hasAttribute('data-observe')) { await post(url(`/${selected.id}/observe`)); await show(selected.id); }
      if (node.hasAttribute('data-cancel') && confirm(`终止 ${taskName(selected)} 在 ${selected.spec.server.host} 的任务？${selected.spec.sandbox ? " 同时暂停本组 AI 后续操作。" : ""}`)) { await post(url(`/${selected.id}/cancel`), {digest:selected.digest, confirm:true}); await show(selected.id); }
      if (node.hasAttribute('data-log')) await read(false);
      if (node.hasAttribute('data-fetch')) { await post(url(`/${selected.id}/fetch`), {path:document.querySelector('[data-result-form] [name=path]')?.value || ''}); await show(selected.id); }
      if (node.hasAttribute('data-analyze')) {
        const text = `请分析远程实验 ${selected.id} 的真实结果${resultPath ? '，结果文件 ' + resultPath : ''}，回读日志，区分执行状态与支持、否定、待验证主张。`;
        openMiddle('chat');
        const input = document.getElementById('chat-input');
        if (!input) throw new Error('请在对话中输入：分析远程实验 ' + selected.id);
        input.value = text;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.focus();
      }
    } catch (error) { toast(error.message); }
    finally { if (node.isConnected) node.disabled = false; }
  });
})();
