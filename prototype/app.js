const paths = {
  share:'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 10.5l6.8-4 M8.6 13.5l6.8 4',
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list:'M7 5h14 M7 12h14 M7 19h14 M3 5h.01 M3 12h.01 M3 19h.01',
  dots:'M12 5v.01 M12 12v.01 M12 19v.01', panel:'M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z M15.5 6.5v11', chevron:'m9 5 7 7-7 7',
  method:'M3 4h18v16H3z M3 9h18 M10 9v11 M16 9v11',
  evolution:'M5 3v18 M5 5h9 M5 12h13 M5 19h9 M14 3v4 M18 10v4 M14 17v4',
  bulb:'M9 18h6 M9 21h6 M8 14a6 6 0 1 1 8 0l-1 2H9z',
  book:'M12 5c-3-3-7-3-10-2v16c4-1 7 0 10 2 3-2 6-3 10-2V3c-3-1-7-1-10 2z M12 5v16',
  file:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h6',
  plus:'M12 5v14 M5 12h14', search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  back:'M19 12H5 M11 6l-6 6 6 6', arrow:'M12 19V5 M6 11l6-6 6 6', close:'M6 6l12 12 M6 18 18 6',
  history:'M3 10a9 9 0 1 1 2 8 M3 4v6h6 M12 7v5l3 2', chat:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z M8.5 10.5h.01 M12 10.5h.01 M15.5 10.5h.01', spark:'m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8z',
  output:'M4 3h16v18H4z M8 8h8 M8 12h8 M8 16h5', download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5', check:'m5 12 4 4L19 6',
  handle:'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  edit:'M4 20h4L20.6 7.4a2.4 2.4 0 0 0-3.4-3.4L4 16.6z M13.8 5.8l3.4 3.4',
  trash:'M4 7h16 M9 7V4h6v3 M6.5 7l1 13h9l1-13 M10 11v6 M14 11v6',
  stop:'M9 6.5h6a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5H9A2.5 2.5 0 0 1 6.5 15V9A2.5 2.5 0 0 1 9 6.5z',
  monitor:'M4 4h16v11H4z M9.5 20h5 M12 15v5',
  expand:'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
  compress:'M4 14h6v6 M14 4v6h6 M14 10l7-7 M3 21l7-7',
  copy:'M9 9h12v12H9z M15 9V3H3v12h6',
  minus:'M5 12h14'
};
// The stop glyph is a solid rounded square, so it carries its own fill instead of the shared stroke styling.
const solidIcons = new Set(['stop']);
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"${solidIcons.has(name) ? ' fill="currentColor" stroke="none"' : ''}></path></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = () => `browser-${crypto.randomUUID()}`;
let pollFailures = 0, connectionWarning = '';
let state = null, current = null, conversation = null, selected = new Set(), artifact = null, detail = null, pollTimer = null, pending = false, viewGeneration = 0, activeTaskId = null;
let versionId = null, paperRequest = 0, artifactRequest = 0, liveTask = null;
const autoLocatedTasks = new Set();
let historyOpen = false;
const viewPanels = new Map(), middlePanels = new Map();
// The item each view last opened in the middle, so the left navigation can bring that same item
// back when the view is entered again.
const middleItems = new Map();
let middleView = 'chat', middleItem = null, middleRequest = 0;
let workspaceProject = null;
let outputKey = null;
// Sidebar, middle content and right output have independent state.
const shellViews = [
  {key:'library', label:'文献库', icon:'book'},
  {key:'chat', label:'AI 对话', icon:'spark'},
  {key:'progress', label:'研究日报', icon:'history'},
  {key:'remote', label:'远程实验', icon:'monitor'},
  {key:'subscriptions', label:'论文订阅', icon:'list'}
];
let shellView = 'chat';
let personalSkills = [];
let projectView = localStorage.getItem('project-view') === 'list' ? 'list' : 'grid';
let projectSort = localStorage.getItem('project-sort') === 'name' ? 'name' : 'recent';
let lastProjectView = projectView;
let messageQueue = [], queueDispatch = false, queueEditing = null, queueDragId = null, queueDropTarget = null;
let lastStarted = null;
const taskInfo = {
  vision:{title:'图表解读',icon:'file',group:'读懂与核查',description:'看清图中结论，回到原图核对',input:'一篇论文 · 图号或问题',output:'原图 + 解读',prompt:'请解读勾选论文中与当前问题相关的原始图表，先回答这张图说明什么，再给出关键数值、单位、比较条件和原图引用。把图中观察与正文解释分开；没有图号且无法确定目标时再询问。只在对话中回答，不另写综述。'},
  review:{title:'论文体检',icon:'check',group:'读懂与核查',description:'审阅论证，也可专项查新或查引用',input:'当前文稿或唯一勾选论文',output:'问题与修改建议',prompt:'请独立审阅当前打开的论文版本（未打开时使用唯一勾选论文），按优先级给出影响结论的问题、原稿位置、证据及具体修改建议。先列最值得处理的问题，明确未核验项。只生成审阅报告，不改文。'},
  'lit-review':{title:'文献综述',icon:'book',group:'整理与比较',description:'围绕一个问题，综合共识、分歧与缺口',input:'同一研究问题下的文献',output:'综述文稿',prompt:'请基于当前项目材料，以勾选文献为重点生成文献综述。先给综合结论，再按研究问题组织共识、分歧、方法条件与局限。仅有一篇时交付单篇研究简报；不同主题分别讨论，不强行拼接。最后仅保留有依据的待验证研究机会，并说明最小验证方式。不逐篇重复摘要。'},
  map:{title:'方法对比',icon:'method',group:'整理与比较',description:'按任务选方法，比较条件与适用边界',input:'同一任务的候选方法',output:'对照表与选型依据',prompt:'请以勾选论文为重点，生成方法对比成果：先说明各方法适用什么任务，再比较实验条件、指标和局限，保留原文依据。仅有一项时明确这是单方法档案，不做排名；不同任务或条件不能直接比较。每个方法用简短名称，说明直接列在正文，不另产重复的比较文件。'},
  evolution:{title:'研究脉络',icon:'evolution',group:'整理与比较',description:'追踪问题如何变化，核对真实先后关系',input:'不同阶段的相关研究',output:'时间线与阶段说明',prompt:'请以勾选论文为重点生成技术演进成果，说明问题、方法与证据如何随真实年代变化，保留代表论文引用。只有一篇或没有跨时期依据时明确交付研究定位，不制造演进阶段；仅时间先后不等于技术继承。优先展示阶段变化，仅保留理解阶段变化所需的实验细节。'},
  graph:{title:'论文关系',icon:'share',group:'整理与比较',description:'找到论文间有依据的继承、比较与争议',input:'一组相关论文',output:'关系图与对读路线',prompt:'请生成论文关系图谱，以勾选论文为重点；默认精选至多15篇，只有原文明确支持的继承、比较和批评关系才连线，保留孤立论文和待核实导读，并提供同版原文和离线 HTML。先说明哪些论文值得一起读，关系不足时如实说明。'},
  'experiment-plan':{title:'实验设计',icon:'list',group:'验证与推进',description:'把一个主张变成可执行的验证计划',input:'研究主张与已有材料',output:'验证步骤与判定条件',prompt:'请基于当前项目材料和已有主张生成实验计划。先列要验证的主张及优先顺序，再分别写最小实验、baseline、公平条件、指标、支持或否定的判定方式和所需资源。假设与来源事实分开；资源未知标待确认。不要把全部内容塞进宽表，不启动实验。'},
  'result-to-claim':{title:'结果分析',icon:'output',group:'验证与推进',description:'判断真实结果支持什么，下一步补什么',input:'实验结果或运行记录',output:'主张判定与补充实验',prompt:'请依据当前项目真实结果与实验记录生成结果分析。先说明哪些主张受支持、被否定或仍待验证，再提供对应数值、单位、baseline和条件。缺少真实结果时只说明所需输入，不虚构分析报告。最后列出能解决不确定性的最小补充实验。'}
};
const auditModes = {
  review:{title:'独立审阅',description:'检查主张、方法与评价漏洞',prompt:taskInfo.review.prompt},
  novelty:{title:'查新',description:'核对最接近的工作和差异',prompt:'请对当前打开的论文版本（未打开时使用唯一勾选论文）查新，从机制、应用、结果三个方向检索，报告最近工作、实质差异与覆盖限制。只列与结论直接相关的检索依据。只生成报告，不改文。'},
  citation:{title:'引用核查',description:'核对引用句与原文是否相符',prompt:'请对当前打开的论文版本（未打开时使用唯一勾选论文）进行引用核查，逐项列出需修正的引用句、位置、元数据与原文支持关系，区分摘要支持、全文核验和未核验。先展示需处理的问题，只生成报告，不改文。'}
};
function renderSkillWorkbench(mode = '') {
  const panel = document.getElementById('skill-workbench');
  panel.dataset.pending = String(pending);
  const row = (key,task,attributes='') => `<button type="button" class="workbench-card" data-action="task" data-value="${key}" ${attributes} ${pending ? 'disabled' : ''}>${icon(task.icon || 'check')}<span class="workbench-copy"><strong>${esc(task.title)}</strong><span>${esc(task.description)}</span>${task.input ? `<small>${esc(task.input)} <span aria-hidden="true">→</span> ${esc(task.output)}</small>` : ''}</span>${icon('chevron')}</button>`;
  const builtins = mode === 'review' ? `<p class="workbench-intro">选择本次要解决的问题</p>${Object.entries(auditModes).map(([key,task])=>row('review',task,`data-audit-mode="${key}"`)).join('')}` : ['读懂与核查','整理与比较','验证与推进'].map(group => `<section class="workbench-group"><h3>${group}</h3>${Object.entries(taskInfo).filter(([,task])=>task.group===group).map(([key,task])=>row(key,task)).join('')}</section>`).join('');
  panel.innerHTML = `<header class="workbench-head"><h2 id="skill-workbench-title">${mode ? '论文体检' : '研究工具'}</h2>${mode ? '<button type="button" class="quiet" data-action="skill-workbench">返回全部</button>' : '<span>选择后可编辑，发送才开始</span>'}<button type="button" class="icon" popovertarget="skill-workbench" popovertargetaction="hide" aria-label="关闭 Skill 工作台">×</button></header><div class="workbench-body">${builtins}${!mode && personalSkills.some(s=>s.status==='active') ? `<section class="workbench-group"><h3>我的技能</h3>${personalSkills.filter(s=>s.status==='active').map(s=>`<button type="button" class="workbench-card" data-skill-use="${esc(s.id)}" ${pending?'disabled':''}>${icon('spark')}<span class="workbench-copy"><strong>${esc(s.fields.name)}</strong><span>${esc(s.fields.description || '个人研究方法')}</span></span></button>`).join('')}</section>` : ''}</div><button type="button" class="workbench-manage" data-skills-open>管理 / 保存个人技能</button>`;
  positionSkillWorkbench();
}
function positionSkillWorkbench() {
  const panel = document.getElementById('skill-workbench'), form = document.getElementById('chat-form');
  if (!panel || !form) return;
  const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const rect = form.getBoundingClientRect(), width = Math.min(27.5 * unit,innerWidth-24);
  const height = Math.min(37.5 * unit,innerHeight-32);
  const bottom = Math.max(12,Math.min(innerHeight-height-16,innerHeight-rect.top+8));
  Object.assign(panel.style,{width:`${width}px`,left:`${Math.max(12,Math.min(rect.left,innerWidth-width-12))}px`,bottom:`${bottom}px`,maxHeight:`${height}px`});
}
window.addEventListener('resize',positionSkillWorkbench);
window.addEventListener('typographychange',positionSkillWorkbench);
document.addEventListener('keydown', event => {
  if (['Escape','Enter',' '].includes(event.key)) {
    const panel = document.getElementById('skill-workbench');
    if (panel && (event.key === 'Escape' || panel.contains(event.target))) panel.dataset.pointerMotion = 'false';
  }
}, true);
const finished = status => ['succeeded','failed','interrupted','stopped','waiting'].includes(status);
const fileUrl = (a, v) => `/api/projects/${current.id}/artifacts/${a}/versions/${v}/download`;
const disclosureState = new Map();
const shortTitle = title => String(title || '原文').replace(/^\d+_/, '').replaceAll('_', ' ');
function citationLink(c, className = 'evidence-link') {
  const location = c.rect === null ? '文字材料' : `第 ${c.page} 页`;
  return `<button class="${className}" title="${esc(c.title)} · ${location}" ${c.id ? `data-action="citation" data-id="${esc(c.id)}"` : `data-action="legacy-citation" data-id="${esc(c.paper_id)}" data-version="${esc(c.paper_version_id)}" data-page="${Number(c.page)}" data-quote="${esc(c.quote)}"`}><span class="citation-title">${esc(shortTitle(c.title))}</span><span class="citation-location"> · ${location} ↗</span></button>`;
}
const citationButton = c => citationLink(c);
const disclosure = (key, defaultOpen = false) => `data-disclosure="${esc(key)}" ${(disclosureState.get(key) ?? defaultOpen) ? 'open' : ''}`;

function eventText(event) {
  const statuses = {queued:'请求已保存', harness:'正在准备任务', model:'正在处理请求', succeeded:'本轮任务已完成'};
  const names = {read_material:'读取材料', locate:'定位原文', set_scope:'确认材料范围', list_materials:'查看材料目录', read_file:'读取成果', write_file:'保存文件', list_files:'查看已有成果', research_paper:'分篇研究', verify_claims:'核对结论', search_papers:'论文调研', read_figure:'读取原图', list_figures:'查找图表', save_context:'保存研究交接', read_evidence:'回读依据', read_history:'回看对话', revise_paper_card:'修正研究卡', list_paper_cards:'查看研究卡', update_plan:'更新计划'};
  return statuses[event.status] || event.message.replace(/update_plan|read_material|list_materials|set_scope|list_files|read_file|write_file|locate|research_paper|verify_claims|search_papers|read_figure|list_figures|save_context|read_evidence|read_history|revise_paper_card|list_paper_cards/g, name => names[name]);
}
// One visible line per tool call: pair the 开始/完成 messages instead of replaying every raw event.
const toolBase = text => String(text).replace(/^(正在|已)/,'').replace(/，未成功$/,'').replace(/ · 第 [^·]*$/,'').trim();
const toolIcon = text => /调研|搜索|查找图表/.test(text) ? 'search' : /核对|验证|未通过/.test(text) ? 'check' : /范围|目录|研究卡|交接|回看/.test(text) ? 'list' : /保存|成果|文件/.test(text) ? 'output' : /阅读|定位|图/.test(text) ? 'book' : 'file';
function toolActions(events) {
  const actions = [], latest = new Map();
  for (const event of events) {
    const text = eventText(event);
    if (!['tool_start','tool_done','tool_failed'].includes(event.status)) { actions.push({text, state:'note'}); continue; }
    const key = toolBase(text), runningAction = latest.get(key);
    if (runningAction && runningAction.state === 'running') {
      runningAction.state = event.status === 'tool_failed' ? 'failed' : 'done';
      if (event.status !== 'tool_start') runningAction.text = text;
      continue;
    }
    const action = {key, text, state: event.status === 'tool_failed' ? 'failed' : event.status === 'tool_done' ? 'done' : 'running'};
    latest.set(key, action); actions.push(action);
  }
  return actions;
}
// While a step runs, keep only its most recent tool rows visible: enough to follow along, not enough to flood the log.
function toolFeed(events) {
  const items = toolActions(events), shown = items.slice(-4);
  return `${shown.length < items.length ? `<p class="tool-count">此前 ${items.length - shown.length} 项已完成</p>` : ''}${toolList(shown)}`;
}
// Rows that appear for the first time fade in one after another, so a batch of finished tool calls reads
// as a sequence instead of one block that popped into place. Rows already on screen are left alone.
const seenToolRows = new Set();
let enterBatch = 0;
function toolLine(action) {
  const [head, target] = String(action.text).split(' · ');
  const key = `${action.key}|${action.text}`;
  const fresh = !seenToolRows.has(key);
  if (fresh) {
    seenToolRows.add(key);
    if (seenToolRows.size > 400) seenToolRows.clear();
  }
  const attrs = fresh ? ` class="tool-line enter" style="animation-delay:${enterBatch++ * 45}ms"` : ' class="tool-line"';
  return `<li${attrs} data-state="${action.state}">${icon(toolIcon(action.text))}<span>${esc(head)}${target ? `<b class="tool-target"> · ${esc(target)}</b>` : ''}</span></li>`;
}
const toolList = actions => `<ul class="tool-list">${actions.map(toolLine).join('')}</ul>`;
const eventList = events => toolList(toolActions(events));

function renderProgress(task, running = false) {
  if (!task) return running ? '<div class="task-wait" role="status">请求已提交…</div>' : '';
  if (!task.plan?.length && !task.tools?.some(t => !['set_scope','list_materials'].includes(t.name))) return '';
  const plan = (task.plan || []).filter(step => step && typeof step.id === 'string' && typeof step.title === 'string');
  const events = task.events.filter(e => e.status !== 'plan');
  const completed = plan.filter(step => step.status === 'completed').length;
  const steps = plan.map(step => {
    const actions = events.filter(e => e.step_id === step.id);
    const active = step.status === 'in_progress' && running;
    const interrupted = step.status === 'in_progress' && !running;
    const state = active ? 'active' : interrupted ? 'interrupted' : step.status === 'completed' ? 'completed' : 'pending';
    const stateLabel = active ? '进行中' : interrupted ? (task.status === 'interrupted' ? '已中断' : task.status === 'failed' ? '已停止' : '未确认完成') : step.status === 'completed' ? '已完成' : '待开始';
    const detail = step.status === 'completed' ? step.summary : active ? (actions.length ? eventText(actions.at(-1)) : '正在进行此步骤…') : interrupted ? stateLabel : '';
    return `<li class="plan-step" data-state="${state}" ${active ? 'aria-current="step"' : ''}><span class="plan-dot" aria-hidden="true">${step.status === 'completed' ? '✓' : ''}</span><div class="plan-content"><div class="plan-title">${esc(step.title)}<span class="sr-only"> · ${stateLabel}</span></div>${detail ? `<p class="plan-summary ${active ? 'current-action' : ''}" ${active ? 'role="status"' : ''}>${esc(detail)}</p>` : ''}${active && actions.length ? toolFeed(actions) : ''}${actions.length ? `<details class="step-details" ${disclosure(`${task.id}:${step.id}`)}><summary>执行详情 · ${actions.length}</summary>${eventList(actions)}</details>` : ''}</div></li>`;
  }).join('');
  const ungrouped = plan.length ? events.filter(e => !plan.some(step => step.id === e.step_id)) : events;
  const contents = plan.length ? `<ol class="research-plan" aria-label="调研计划">${steps}</ol>${ungrouped.length ? `<details class="other-actions" ${disclosure(`${task.id}:other`)}><summary>其他执行记录</summary>${eventList(ungrouped)}</details>` : ''}` : eventList(events);
  const usage = task.refs?.usage || [];
  const sum = key => usage.reduce((n, u) => n + (u[key] || 0), 0);
  const tokenInfo = usage.length ? `<p class="tool-count">模型调用 ${sum('calls')} 次 · 非缓存输入 ${sum('inputTokens').toLocaleString()} · 缓存输入 ${sum('cacheReadTokens').toLocaleString()} · 输出 ${sum('outputTokens').toLocaleString()}（其中推理 ${sum('reasoningTokens').toLocaleString()}） · 压缩 ${usage.filter(u => u.role === 'compaction').reduce((n,u) => n + (u.calls || 0), 0)} 次</p>` : '';
  return `<details class="execution-record" ${disclosure(`${task.id}:progress`, running && plan.length > 0)}><summary>思考过程${plan.length ? ` · ${completed}/${plan.length} 步` : ''}</summary>${contents}${tokenInfo}</details>${running && !plan.length ? `<div class="task-wait" role="status">${esc(events.length ? eventText(events.at(-1)) : '正在处理请求…')}</div>` : ''}`;
}
function saveSelection() { localStorage.setItem(`focus:${current.id}`, JSON.stringify([...selected])); }

// Only display server-mapped errors. This guard also covers stale backends and browser exceptions.
function errorMessage(message) {
  const text = String(message || '本次操作未完成，请稍后再试。');
  return /HTTP\s*\d{3}|Traceback|\bat \w+.*:\d+|\b[A-Za-z]+(?:_[A-Za-z]+)+\b|\b\w+Error\b|Failed to fetch|NetworkError|\/Users\/|\/tmp\//i.test(text)
    ? '本次操作遇到问题，请稍后再试；已保存的内容仍可查看。' : text;
}

async function api(path, options = {}) {
  const headers = {...(options.headers || {})};
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {signal:options.method && options.method !== 'GET' ? undefined : AbortSignal.timeout(15000), ...options, headers});
  } catch (cause) {
    throw Object.assign(new Error('暂时无法连接工作台，请检查网络或后台服务后重试。', {cause}), {code:'connection', retryable:true});
  }
  let data;
  try { data = await response.json(); }
  catch (cause) { throw Object.assign(new Error('未能读取服务响应，请稍后重试。', {cause}), {code:'invalid_response', retryable:true}); }
  if (!response.ok) {
    const info = data.error_info;
    throw Object.assign(new Error(errorMessage(data.explanation || (info ? `${info.message} ${info.next_step}` : data.error))), {code:info?.code, retryable:info?.retryable ?? response.status >= 500, status:response.status});
  }
  return data;
}

window.MethodAtlasHttp = {api, errorMessage};

function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = errorMessage(message); node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.classList.remove('show'); }, 4200);
}

function projectIcon(index) { return ['book', 'method', 'evolution', 'bulb'][index % 4]; }

function invalidateView() {
  document.getElementById('skill-workbench')?.hidePopover();
  clearTimeout(pollTimer); pollTimer = null; pollFailures = 0; connectionWarning = ''; viewGeneration += 1; activeTaskId = null; pending = false; liveTask = null; autoLocatedTasks.clear(); historyOpen = false; paperRequest++; artifactRequest++;
}

function isCurrentView(generation, projectId, conversationId, taskId = null) {
  return generation === viewGeneration && current?.id === projectId && conversation?.id === conversationId && (!taskId || activeTaskId === taskId);
}

// Project sort keeps a real select for state and keyboard-free tooling, but shows an app-styled menu instead of the native popup.
const sortLabels = {recent:'最近', name:'名称'};
const sortControl = () => `<div class="sort-field"><select id="project-sort" class="project-sort" aria-label="项目排序" tabindex="-1">${Object.entries(sortLabels).map(([value,label]) => `<option value="${value}" ${projectSort === value ? 'selected' : ''}>${label}</option>`).join('')}</select><details class="sort-menu"><summary class="sort-display">${sortLabels[projectSort]}${icon('chevron')}</summary><div class="sort-options" role="listbox" aria-label="项目排序">${Object.entries(sortLabels).map(([value,label]) => `<button type="button" role="option" aria-selected="${projectSort === value}" data-sort="${value}">${label}${projectSort === value ? icon('check') : ''}</button>`).join('')}</div></details></div>`;

async function home() {
  try { await window.MethodAtlasWriting?.flush(); } catch (error) { toast(error.message); return; }
  saveWorkspaceState();
  window.MethodAtlasWriting?.unmount();
  viewPanels.clear(); middlePanels.clear(); middleItems.clear(); middleRequest++; workspaceProject = null;
  // 返回项目列表同样算离开笔记视图：先把未保存的改动写下去（见 skills.js 的自动保存）。
  window.MethodAtlasSkills?.flushPending?.();
  invalidateView();
  const generation = viewGeneration;
  current = conversation = artifact = detail = null; pending = false;
  localStorage.removeItem('methodatlas-view');
  document.title = 'MethodAtlas · 我的项目';
  document.getElementById('app').innerHTML = `<main class="home">
    <header class="app-header"><div class="brand"><span class="brandmark" aria-hidden="true"><img src="assets/methodatlas-mark.png" alt=""></span>MethodAtlas</div><div class="home-header-meta"><button data-action="settings" class="pill">设置</button><details class="home-menu"><summary class="icon" aria-label="应用面板">${icon('dots')}</summary><div><button data-action="new-project">${icon('plus')}新建项目</button><button data-action="view" data-value="grid">${icon('grid')}网格视图</button><button data-action="view" data-value="list">${icon('list')}列表视图</button></div></details><span class="avatar" aria-label="本机用户">M</span></div></header>
    <div class="home-content"><div class="toolbar"><div class="toolbar-left"><label class="search-field">${icon('search')}<input id="project-search" placeholder="搜索项目" aria-label="搜索项目"></label></div>
      <div class="toolbar-right"><div class="view-toggle" role="group" aria-label="项目视图" data-view="${projectView}"><span class="view-thumb" aria-hidden="true"></span><button data-action="view" data-value="grid" aria-label="网格视图" aria-pressed="${projectView === 'grid'}">${icon('grid')}</button><button data-action="view" data-value="list" aria-label="列表视图" aria-pressed="${projectView === 'list'}">${icon('list')}</button></div>${sortControl()}<button class="primary" data-action="new-project">${icon('plus')}新建</button></div></div>
      <div class="collection-head"><h1><span id="collection-title">最近打开过的项目</span> <span class="collection-count" id="project-count"></span></h1></div><div class="projects" id="project-grid"></div>
    </div></main>`;
  renderProjects();
  try {
    const latest = await api('/api/state');
    if (generation !== viewGeneration) return;
    state = latest; renderProjects();
  } catch (error) { if (generation === viewGeneration) toast(error.message); }
}

function syncSortControl() {
  const select = document.getElementById('project-sort');
  if (!select) return;
  select.value = projectSort;
  const display = document.querySelector('.sort-display');
  if (display?.firstChild) display.firstChild.nodeValue = sortLabels[projectSort];
  document.querySelectorAll('.sort-options [data-sort]').forEach(button => {
    const active = button.dataset.sort === projectSort;
    button.setAttribute('aria-selected',String(active));
    const mark = button.querySelector('svg');
    if (active && !mark) button.insertAdjacentHTML('beforeend',icon('check'));
    if (!active && mark) mark.remove();
  });
}

function renderProjects() {
  const query = document.getElementById('project-search')?.value.trim().toLowerCase() || '';
  const projects = state.projects.filter(project => project.name.toLowerCase().includes(query));
  const openedAt = project => Number(localStorage.getItem(`opened:${project.id}`)) || Date.parse(project.created);
  projects.sort(projectSort === 'name' ? (a,b) => a.name.localeCompare(b.name,'zh-CN') : (a,b) => openedAt(b) - openedAt(a));
  const grid = document.getElementById('project-grid');
  grid.classList.toggle('list-view',projectView === 'list');
  document.querySelectorAll('.view-toggle [data-action=view]').forEach(button => { const active = button.dataset.value === projectView; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
  const toggle = document.querySelector('.view-toggle');
  if (toggle) toggle.dataset.view = projectView;
  // Only a real layout switch replays the swap animation; search typing must not.
  if (lastProjectView !== projectView) {
    lastProjectView = projectView;
    grid.classList.remove('view-swap');
    void grid.offsetWidth;
    grid.classList.add('view-swap');
  }
  document.getElementById('collection-title').textContent = query ? '搜索结果' : '最近打开过的项目';
  syncSortControl();
  document.getElementById('project-count').textContent = query ? `${projects.length} / ${state.projects.length}` : `${projects.length} 个项目`;
  grid.innerHTML = `<button class="project-card nb-new" data-action="new-project"><span class="plus-circle">${icon('plus')}</span><span>新建项目</span></button>` + projects.map((project, index) => `<button class="project-card nb-card" data-action="open-project" data-id="${esc(project.id)}"><span class="nb-card-top"><span class="nb-thumb t-blue">${icon(projectIcon(index))}</span><span class="nb-menu" aria-hidden="true">${icon('dots')}</span></span><span class="nb-card-body"><span class="nb-state">${project.papers.length ? '研究项目' : '等待添加来源'}</span><h2>${esc(project.name)}</h2><small>${esc(new Date(project.updated).toLocaleDateString('zh-CN').replaceAll('/','.'))} 更新 · ${project.papers.length} 个来源</small></span></button>`).join('') + (projects.length ? '' : `<p class="no-project" role="status">${query ? '没有找到匹配的项目。' : '点击「新建」开始第一个研究主题。'}</p>`);
}

async function openProject(id, conversationId = null) {
  const sameProject = current?.id === id && Boolean(document.querySelector('.workspace'));
  if (!sameProject) {
    try { await window.MethodAtlasWriting?.flush(); } catch (error) { toast(error.message); return; }
    saveWorkspaceState();
  }
  invalidateView();
  const generation = viewGeneration, projectId = id;
  try {
    const loaded = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    personalSkills = await api('/api/skills');
    if (generation !== viewGeneration) return;
    current = loaded;
    conversation = current.conversations.find(c => c.id === conversationId) || current.conversations[0] || null;
    if (!conversation) conversation = await newConversation(true);
    if (generation !== viewGeneration || current?.id !== projectId || !conversation) return;
    conversation.messages.map(m => m.task).filter(t => t?.tools.some(tool => tool.name === 'locate' && tool.status === 'succeeded')).forEach(t => autoLocatedTasks.add(t.id));
    const saved = JSON.parse(localStorage.getItem(`focus:${id}`) || 'null');
    selected = new Set((saved || current.papers.filter(p => p.selected && p.current_version_id).map(p => p.id)).filter(pid => current.papers.some(p => p.id === pid && p.current_version_id)));
    let workspace = null;
    if (!sameProject) {
      try { workspace = JSON.parse(localStorage.getItem(`workspace:${id}`) || 'null'); } catch {}
      artifact = detail = null; versionId = null; shellView = 'chat';
    }
    localStorage.setItem(`opened:${id}`,String(Date.now()));
    document.title = `MethodAtlas · ${current.name}`; renderWorkspace();
    if (workspace) {
      if (workspace.view !== 'chat') switchShellView(workspace.view);
      if (workspace.middle && workspace.middle !== 'chat' && workspace.middleItem) Promise.resolve(shellModules()[workspace.middle]?.open?.(workspace.middleItem)).catch(error=>toast(error.message));
      if (workspace.artifact && current.artifacts.some(item => item.id === workspace.artifact)) await loadArtifact(workspace.artifact,workspace.version,false);
      if (workspace.view === 'library' && workspace.paper && current.papers.some(item => item.id === workspace.paper)) await showPaper(workspace.paper,workspace.page || 1,workspace.paperVersion);
    }
    const running = projectRunningTask();
    if (running || current.papers.some(p => p.availability?.fulltext === 'pending')) { activeTaskId = running?.id; refreshTask(running?.id, generation, projectId, conversation.id).catch(e => toast(e.message)); }
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (current?.id === projectId && conversation) renderWorkspace();
    else if (current?.id === projectId) home();
    toast(error.message);
  }
}

async function newConversation(silent = false) {
  if (!current?.id) return null;
  if (!silent) invalidateView();
  const generation = viewGeneration, projectId = current.id;
  try {
    const result = await api(`/api/projects/${projectId}/conversations`, {method:'POST', body:'{}'});
    if (generation !== viewGeneration || current?.id !== projectId) return null;
    const created = {id:result.conversation_id, title:'新对话', messages:[], reads:[]};
    current.conversations.unshift(created);
    if (!silent) { conversation = created; renderWorkspace(); refreshTask(null,generation,projectId,created.id).catch(error => toast(error.message)); }
    return created;
  } catch (error) {
    if (silent) throw error;
    if (generation === viewGeneration) { renderWorkspace(); toast(error.message); }
    return null;
  }
}

// Queued messages: while a task is busy the composer queues instead of interrupting, and the queue self-dispatches when the conversation goes idle.
const queueKey = () => `queue:${conversation?.id || ''}`;
function loadQueue() {
  try { messageQueue = JSON.parse(localStorage.getItem(queueKey()) || '[]'); } catch { messageQueue = []; }
  if (!Array.isArray(messageQueue)) messageQueue = [];
  queueEditing = null;
}
function saveQueue() { localStorage.setItem(queueKey(),JSON.stringify(messageQueue)); }
const waitingTask = () => conversation.messages.some(message => message.role === 'user' && message.task?.status === 'waiting');
// A task awaiting confirmation is still busy: the queue waits for the user just like the agent does.
const busyTask = () => pending || conversation.messages.some(message => message.role === 'user' && message.task && (!finished(message.task.status) || message.task.status === 'waiting'));
function queuePanel() {
  if (!conversation || !messageQueue.length) return '';
  const items = messageQueue.map((item, index) => `<li class="queue-item" data-queue="${esc(item.id)}" draggable="true">${queueEditing === item.id
    ? `<span class="queue-handle" aria-hidden="true">${icon('handle')}</span><form class="queue-edit" data-queue-form="${esc(item.id)}"><textarea aria-label="编辑排队消息" rows="2">${esc(item.text)}</textarea><button type="button" data-queue-action="save" aria-label="保存排队消息">${icon('check')}</button><button type="button" data-queue-action="cancel" aria-label="取消编辑">${icon('close')}</button></form>`
    : `<span class="queue-handle" aria-hidden="true">${icon('handle')}</span><span class="queue-text">${esc(item.text)}${item.fragments?.length ? `<small>${item.fragments.length} 个已选文本片段</small>` : ''}</span><span class="queue-actions">${item.failed?'<button type="button" data-queue-action="retry">重试</button>':''}<button type="button" data-queue-action="up" aria-label="上移排队消息" title="上移" ${index ? '' : 'disabled'}>${icon('arrow')}</button><button type="button" data-queue-action="edit" aria-label="编辑排队消息" title="编辑">${icon('edit')}</button><button type="button" data-queue-action="drop" aria-label="删除排队消息" title="删除">${icon('trash')}</button></span>`}</li>`).join('');
  return `<section class="queue-panel" aria-label="排队中的消息"><div class="queue-head"><span>排队中 · ${messageQueue.length}</span><small>${waitingTask() ? '当前任务等待确认，确认后自动发送' : busyTask() ? '当前任务结束后自动发送' : '正在按顺序发送…'}</small></div><ol class="queue-list">${items}</ol></section>`;
}
function enqueue(text) {
  const fragments=selectedFragments();
  messageQueue.push({id:uid(), text, fragments, settings:window.MethodAtlasSettings?.request()});
  window.MethodAtlasSettings?.sent(conversation.id);
  saveQueue();
  saveSelectedFragments([]);
  const input = document.getElementById('chat-input');
  if (input) input.value = '';
  localStorage.removeItem(`draft:${conversation.id}`);
  renderChat(true);
  toast('已加入排队，当前任务结束后自动发送。');
}
async function pumpQueue() {
  if (queueDispatch || !messageQueue.length || messageQueue[0].failed || !conversation || busyTask()) return;
  queueDispatch = true;
  try {
    const next = messageQueue.shift();
    saveQueue();
    renderChat();
    const conversationId=conversation.id;
    const sent=await dispatchMessage(next.text, next.fragments || [], true, next.settings);
    if(sent===false){
      next.failed=true;
      if(conversation?.id===conversationId){messageQueue.unshift(next);saveQueue();renderChat();}
      else {const queue=JSON.parse(localStorage.getItem(`queue:${conversationId}`)||'[]');queue.unshift(next);localStorage.setItem(`queue:${conversationId}`,JSON.stringify(queue));}
    }
  } finally { queueDispatch = false; }
}

function shellNav() {
  return shellViews.map(view => `<button type="button" data-action="shell" data-value="${view.key}" aria-label="${view.label}" title="${view.label}"${view.key === shellView ? ' class="active" aria-current="page"' : ''}>${icon(view.icon)}<span>${view.label}</span></button>`).join('');
}

function moveIndicator(host, target, vertical = false) {
  const indicator = host?.querySelector(vertical ? '.shell-nav-indicator' : '.panel-tabs-indicator');
  if (!indicator || !target) return;
  const hostRect = host.getBoundingClientRect(), targetRect = target.getBoundingClientRect();
  if (!targetRect.width) return;
  const start = vertical ? targetRect.top - hostRect.top + host.scrollTop + 9 : targetRect.left - hostRect.left + targetRect.width * .2;
  const span = vertical ? Math.max(1, targetRect.height - 18) : targetRect.width * .6;
  const transform = (position, size) => vertical
    ? `translate3d(0,${position}px,0) scaleY(${size})`
    : `translate3d(${position}px,0,0) scaleX(${size})`;
  const next = transform(start, span);
  if (indicator.style.transform === next) return;
  const previous = indicator.getBoundingClientRect();
  const wasReady = indicator.dataset.ready === 'true';
  indicator.getAnimations().forEach(animation => animation.cancel());
  indicator.style.transform = next;
  indicator.dataset.ready = 'true';
  if (!wasReady || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const from = vertical ? previous.top - hostRect.top + host.scrollTop : previous.left - hostRect.left;
  const fromSpan = vertical ? previous.height : previous.width;
  const frames = [{transform:transform(from, fromSpan)}];
  if (!vertical) frames.push({transform:transform(Math.min(from,start), Math.max(from + fromSpan,start + span) - Math.min(from,start)),offset:.45});
  frames.push({transform:next});
  indicator.animate(frames,{duration:vertical ? 260 : 460,easing:vertical ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.25,.1,.25,1)'});
}

const memoryView = () => middleView === 'progress';
const shellOwnsPanels = () => middleView !== 'chat';
const shellModules = () => ({
  library: window.MethodAtlasLibrary,
  progress: window.MethodAtlasProgress,
  remote: window.MethodAtlasRemote,
  subscriptions: window.MethodAtlasSubscriptions
});
function renderShellView() {
  if (shellView === 'chat') {
    renderChatList(); renderHistory();
  } else shellModules()[shellView]?.activate?.();
}

// A module's list renderer can only write the left column.
const shellHosts = ['source-body'];
const shellPanelIds = ['sources-panel'];
function shellPaint({titles = [], bodies = [], badges = []}) {
  shellPanelIds.forEach((id, index) => {
    const panel = document.getElementById(id);
    const heading = panel?.querySelector('.panel-head h2');
    if (heading && titles[index]) heading.textContent = titles[index];
    const badge = panel?.querySelector('.panel-head .badge');
    if (badge) badge.textContent = badges[index] ?? '';
    if (bodies[index] === null) return;
    const host = document.getElementById(shellHosts[index]);
    if (host) { host.className = 'memory-column'; host.innerHTML = bodies[index] ?? ''; }
  });
  syncPanelLayout();
}

// A native select paints its option list itself, so that list can never match the app. Every select
// keeps its value and its change event; only the visible control and its list become ordinary markup.
// The version picker deserves more than a native option list: a day-grouped timeline that keeps the
// short content hash, the minute it was saved and who saved it, so two writes a minute apart stay apart.
function versionDay(value) {
  const date = new Date(value), today = new Date();
  const midnight = input => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(date)) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日${date.getFullYear() === today.getFullYear() ? '' : ` ${date.getFullYear()} 年`}`;
}

function versionListHTML(selected) {
  const versions = [...(artifact?.versions || [])].reverse(), latest = versions[0]?.id;
  // Only manuscripts restore from here: HTML / DOCX / 图谱 keep the 恢复此版 button in the toolbar,
  // which talks to their own endpoint instead of the writing one.
  const restorable = artifact?.kind === 'manuscript';
  let day = null;
  const rows = versions.map(version => {
    const parts = [], label = versionDay(version.created);
    if (label !== day) { day = label; parts.push(`<p class="version-day">${esc(label)}</p>`); }
    const hash = String(version.payload?.sha256 || '').slice(0, 7);
    const author = version.payload?.author === 'human' ? '我' : version.payload?.author || 'AI';
    const time = new Date(version.created).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit',hour12:false});
    const restore = restorable && version.id !== latest ? `<button type="button" data-action="restore-document" data-id="${esc(version.id)}">恢复</button>` : '';
    parts.push(`<div class="version-row"${version.id === selected ? ' data-current="true"' : ''}><span class="version-node" aria-hidden="true"></span><div class="version-row-body"><p class="version-row-head"><button type="button" class="version-no" data-select-option="${esc(version.id)}" aria-selected="${version.id === selected}" title="${esc(version.title)}">V${version.version_no}</button>${hash ? `<code class="version-hash" title="内容指纹">${esc(hash)}</code>` : ''}</p><p class="version-row-meta">${esc(time)} · ${esc(author)}</p><div class="version-row-actions"><button type="button" data-select-option="${esc(version.id)}"${version.id === selected ? ' disabled' : ''}>对比当前</button>${restore}</div></div></div>`);
    return parts.join('');
  }).join('');
  return `<div class="version-list"><p class="version-list-head"><strong>版本</strong><span class="badge">${versions.length}</span></p>${rows}</div>`;
}

function syncSelectMenu(select) {
  const box = select.closest('.select-box');
  if (!box) return;
  const value = box.querySelector('.select-value'), list = box.querySelector('.select-options');
  if (value) value.textContent = select.selectedOptions[0]?.textContent?.trim() ?? '';
  if (list) list.innerHTML = select.id === 'version-select'
    ? versionListHTML(select.value)
    : [...select.options].map(option => `<button type="button" data-select-option="${esc(option.value)}" aria-selected="${option.selected}">${esc(option.textContent.trim())}</button>`).join('');
}

function enhanceSelects(root) {
  const scope = root || document;
  const found = scope instanceof HTMLSelectElement
    ? (scope.dataset.enhanced ? [] : [scope])
    : [...(scope.querySelectorAll?.('select:not([data-enhanced])') || [])];
  for (const select of found) {
    if (select.closest('.sort-field')) continue; // The project sort control already carries its own menu.
    select.dataset.enhanced = '1';
    const box = document.createElement('span');
    box.className = 'select-box';
    select.before(box);
    box.append(select);
    const menu = document.createElement('details');
    menu.className = 'select-menu';
    menu.innerHTML = `<summary class="select-display"><span class="select-value"></span>${icon('chevron')}</summary><div class="select-options"></div>`;
    box.append(menu);
    syncSelectMenu(select);
    select.addEventListener('change', () => syncSelectMenu(select));
    menu.addEventListener('toggle', () => {
      syncSelectMenu(select);
      if (menu.open) menu.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});
    });
    menu.addEventListener('click', event => {
      const option = event.target.closest('[data-select-option]');
      if (!option) return;
      menu.open = false;
      if (select.value === option.dataset.selectOption) return;
      select.value = option.dataset.selectOption;
      select.dispatchEvent(new Event('change', {bubbles:true}));
    });
  }
}

// Rendered markup arrives constantly, so the enhancement follows the DOM instead of every caller.
new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) enhanceSelects(node);
}).observe(document.body, {childList:true, subtree:true});
enhanceSelects(document.body);
// Opening or closing a paper repaints whichever view owns the reader column.
function renderPaperViews() { if (shellView === 'library') renderLibrary(); }

function renderLibrary() {
  window.dispatchEvent(new Event('methodatlas-papers-changed'));
  const panel = document.getElementById('sources-panel');
  shellPaint({titles:['文献库'],bodies:[sourcesBodyHTML()]});
  let reader = document.getElementById('paper-detail');
  if (!reader) { reader = Object.assign(document.createElement('div'),{id:'paper-detail'}); panel.append(reader); }
  document.getElementById('source-body').hidden = Boolean(detail?.paper);
  reader.hidden = !detail?.paper;
  panelHeading('sources-panel',detail?.paper ? shortTitle(detail.paper.title) : '文献库',detail?.paper ? '文献库' : null,'close-paper');
  syncSourceCounters();
  if (detail?.paper) renderDetail();
}
window.MethodAtlasLibrary = {activate: renderLibrary};

// Documents and generated outputs share the permanent right-hand list.
function artifactKindLabel(item) {
  let payload = item?.payload;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
  return ({methods:'方法对比',comparison:'方法对比',evolution:'研究脉络'}[payload?.research?.view])
    || ({manuscript:'文档',html:'研究报告',graph:'论文关系图谱',docx:'研究文档',png:'科研图表',pptx:'汇报演示',research:'研究文本'}[item?.kind] || '研究成果');
}

function studioListHTML(outputs) {
  const create = `<button type="button" class="primary studio-create" data-action="new-document" ${window.MethodAtlasWriting ? '' : 'disabled'}>${icon('plus')}新建文档</button>`;
  if (!outputs.length) return `${create}<p class="empty-small">还没有内容。可以在中间和 AI 讨论，或点「新建文档」开始写作。</p>`;
  const openId = artifact?.id;
  // The list borrows the 来源 panel's card styling so every left column reads the same.
  return `${create}<div class="library-list cards">${outputs.map(item => `<button type="button" class="library-row card${item.id === openId ? ' active' : ''}" data-action="file" data-id="${esc(item.id)}"${item.id === openId ? ' aria-current="true"' : ''}>${icon('output')}<span class="library-row-body"><strong>${esc(item.title)}</strong><small>${esc(artifactKindLabel(item))}</small></span></button>`).join('')}</div>`;
}

function saveWorkspaceState() {
  if (!current) return;
  localStorage.setItem(`workspace:${current.id}`, JSON.stringify({
    view:shellView, middle:middleView, middleItem, artifact:artifact?.id || null, version:versionId,
    paper:detail?.paper?.id || null, paperVersion:detail?.paper?.version_id, page:detail?.page
  }));
}

function capturePanel(id) {
  const panel = document.getElementById(id);
  return {nodes:[...panel.childNodes],scroll:[...panel.querySelectorAll('*')]
    .filter(node => node.scrollTop || node.scrollLeft).map(node => [node,node.scrollTop,node.scrollLeft])};
}
function restorePanel(id, saved) {
  document.getElementById(id).replaceChildren(...saved.nodes);
  saved.scroll.forEach(([node,top,left]) => { node.scrollTop=top; node.scrollLeft=left; });
}

function panelHeading(id, title, parent = null, action = null) {
  const heading = document.getElementById(id).querySelector('.panel-head h2');
  heading.innerHTML = parent ? `<button class="breadcrumb-back" data-action="${action}">${esc(parent)}</button><span aria-hidden="true">›</span><span class="breadcrumb-title" title="${esc(title)}">${esc(title)}</span>` : esc(title);
  syncPanelLayout();
}

const workspacePanelIds = ['sources-panel','chat-panel','output-panel'];
const narrowWorkspace = {get matches(){return document.body.clientWidth <= 67.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);}};
let activePanel = 'chat-panel';
const collapsedPanels = new Set();

function revealPanel(id) {
  const focused = document.activeElement?.closest('.panel');
  activePanel = id;
  // Tab selection must not overwrite the desktop's remembered collapsed columns.
  if (!narrowWorkspace.matches) collapsedPanels.delete(id);
  syncPanelLayout();
  if (narrowWorkspace.matches && focused && focused.id !== id) document.getElementById(`tab-${id}`)?.focus();
  if (id === 'chat-panel') { markConversationRead(); renderConversationRows(); }
}

function syncPanelLayout() {
  const panels = document.querySelector('.panels');
  if (!panels) return;
  const labels = [shellView === 'chat' ? '对话列表' : shellViews.find(v => v.key === shellView)?.label || '文献',
    ({chat:'对话',progress:'研究日报',remote:'实验详情',subscriptions:'订阅详情'})[middleView] || '内容','成果'];
  const tabs = document.querySelector('.panel-tabs');
  workspacePanelIds.forEach((id, index) => {
    const panel = document.getElementById(id), head = panel.querySelector(':scope > .panel-head');
    if (!head) return;
    let title = head.querySelector('.panel-title');
    if (!title) {
      const heading = head.querySelector('h2'), badge = head.querySelector('.badge');
      title = document.createElement('div'); title.className = 'panel-title';
      const previous = heading.parentElement;
      head.prepend(title); title.append(heading);
      if (badge) title.append(badge);
      if (previous !== head && !previous.children.length) previous.remove();
      head.querySelector(':scope > span[aria-hidden]')?.remove();
    }
    if (index === 2) {
      let badge = title.querySelector('.badge');
      if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; title.append(badge); }
      badge.textContent = current.artifacts.filter(item => item.kind !== 'progress').length;
    }
    const selected = id === activePanel, collapsed = !narrowWorkspace.matches && collapsedPanels.has(id);
    panel.classList.toggle('panel-collapsed',collapsed);
    panel.classList.toggle('panel-active',selected);
    panel.setAttribute('role',narrowWorkspace.matches ? 'tabpanel' : 'region');
    if (narrowWorkspace.matches) panel.setAttribute('aria-labelledby',`tab-${id}`);
    else panel.removeAttribute('aria-labelledby');
    const tab = tabs?.querySelector(`[data-panel="${id}"]`);
    if (tab) { tab.textContent = labels[index]; tab.setAttribute('aria-selected',String(selected)); tab.tabIndex = selected ? 0 : -1; }
    if (index === 1) return;
    let toggle = head.querySelector('[data-action=toggle-panel]');
    if (!toggle) {
      toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'icon panel-toggle';
      toggle.dataset.action = 'toggle-panel'; toggle.dataset.panel = id; toggle.innerHTML = icon('panel'); head.append(toggle);
    }
    const toggleLabel = `${collapsed ? '展开' : '收起'}${labels[index]}`;
    toggle.setAttribute('aria-label',toggleLabel); toggle.title = toggleLabel;
    toggle.setAttribute('aria-expanded',String(!collapsed));
    let rail = panel.querySelector(':scope > .panel-rail');
    if (!rail) { rail = document.createElement('div'); rail.className = 'panel-rail'; panel.append(rail); }
    if (collapsed) {
      const focusedKey = rail.contains(document.activeElement) ? document.activeElement.dataset.key : null;
      const scroll = rail.scrollTop;
      const items = index === 0
        ? [...panel.querySelectorAll('#source-body .conversation-row, #source-body .paper-link, #source-body .library-row, #source-body .day-row, #source-body .diary-card-content')]
        : current.artifacts.filter(item => item.kind !== 'progress');
      rail.replaceChildren(...items.map(item => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'icon';
        button.dataset.key = index === 0 ? JSON.stringify(item.dataset) : item.id;
        const label = index === 0 ? item.querySelector('strong,h3')?.textContent || item.textContent.trim() : item.title;
        button.title = label; button.setAttribute('aria-label',label);
        button.innerHTML = icon(index === 2 ? 'output' : shellViews.find(v => v.key === shellView)?.icon || 'file');
        button.onclick = () => { revealPanel(id); if (index === 0) item.click(); else loadArtifact(item.id); };
        return button;
      }));
      if (focusedKey) ([...rail.children].find(button => button.dataset.key === focusedKey) || toggle).focus({preventScroll:true});
      rail.scrollTop = scroll;
    }
  });
  panels.classList.toggle('sources-collapsed',!narrowWorkspace.matches && collapsedPanels.has('sources-panel'));
  panels.classList.toggle('output-collapsed',!narrowWorkspace.matches && collapsedPanels.has('output-panel'));
  panels.querySelectorAll('.panel-resizer').forEach(handle => { handle.inert = narrowWorkspace.matches || collapsedPanels.size > 0; });
  moveIndicator(tabs,tabs?.querySelector('[aria-selected="true"]'));
}
function reflowWorkspace() {
  syncPanelLayout();
  const nav = document.querySelector('.shell-nav');
  if (nav) moveIndicator(nav,nav.querySelector('.active'),true);
  const focused = document.activeElement?.closest('.panel');
  if (narrowWorkspace.matches && focused && focused.id !== activePanel) document.getElementById(`tab-${activePanel}`)?.focus();
}
window.addEventListener('resize',reflowWorkspace);
window.addEventListener('typographychange',reflowWorkspace);
document.addEventListener('keydown',event => {
  const tab = event.target.closest('.panel-tabs [role=tab]');
  if (!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const index = workspacePanelIds.indexOf(tab.dataset.panel);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
  revealPanel(workspacePanelIds[next]); document.getElementById(`tab-${workspacePanelIds[next]}`).focus();
});

// The left navigation swaps the list and the middle together. A view brings the middle it last had
// open back (or asks its module for the default one), and the views with no middle of their own fall
// back to the conversation. The right column is never touched. followMiddle re-enters: a module's
// open() may call switchShellView() on its way to the middle, so the same key is not followed twice.
let middleFollowing = null;
function followMiddle(key) {
  if (middleFollowing === key) return;
  if (key === 'chat' || key === 'library') { if (middleView !== 'chat') openMiddle('chat'); return; }
  if (middleView === key) return;
  const module = shellModules()[key];
  if (!module) return;
  middleFollowing = key;
  try {
    // A view we have already left brings its own middle back untouched, so whatever was typed in it
    // (a result path, a subscription name, a daily instruction) is still there. Only a view with no
    // cached middle asks its module for the default item.
    if (middlePanels.has(key)) { middleRequest++; showMiddlePanel(key); saveWorkspaceState(); return; }
    const item = middleItems.get(key);
    if (item && module.open) module.open(item);
    // 有的模块（如论文订阅）只往中栏里画、不会自己切换中栏，所以先替它切过去；
    // 否则进来时 middleView 还停在上一个视图，paintMiddle 里的 middleView !== key 会让它什么都不画。
    else { openMiddle(key); if (key === 'remote') module.open(); else module.activate?.(); }
  } finally { middleFollowing = null; }
}

function switchShellView(key) {
  if (!shellViews.some(view => view.key === key)) return;
  if (key === shellView) { followMiddle(key); return; }
  paperRequest++;
  document.body.classList.remove('reader-fullscreen');
  viewPanels.set(shellView,capturePanel('sources-panel'));
  document.getElementById('sources-panel').replaceChildren();
  shellView = key;
  const saved = viewPanels.get(key);
  if (saved) restorePanel('sources-panel',saved);
  else document.getElementById('sources-panel').innerHTML = '<div class="panel-head"><h2></h2><span class="badge"></span></div><div class="panel-body" id="source-body"></div><div id="history-area"></div>';
  if (key === 'library') { if (saved) renderSources(); else renderLibrary(); }
  else if (key === 'chat') { if (saved) renderConversationRows(); else renderChatList(); }
  else if (key === 'subscriptions' || !saved || !document.getElementById('source-body')?.textContent.trim()) renderShellView();
  const label = shellViews.find(view=>view.key===key).label;
  if (key !== 'library') panelHeading('sources-panel',label);
  document.querySelectorAll('.shell-nav [data-action=shell]').forEach(button => {
    const active = button.dataset.value === key;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  const nav = document.querySelector('.shell-nav');
  moveIndicator(nav,nav.querySelector('.active'),true);
  followMiddle(key);
  saveWorkspaceState();
}

// The middle column is swapped in whole: the panel the previous view was using is cached, and the one
// this view left behind is put back exactly as it was — draft text and scroll included.
function showMiddlePanel(key) {
  middlePanels.set(middleView,capturePanel('chat-panel'));
  middleView = key;
  const saved = middlePanels.get(key);
  if (saved) restorePanel('chat-panel',saved);
  else document.getElementById('chat-panel').innerHTML = '<div class="panel-head"><h2></h2><span id="chat-tools" class="row"></span></div><div id="chat-body"></div>';
}

function openMiddle(key, title = '', item = null) {
  middleRequest++;
  if (key !== middleView) showMiddlePanel(key);
  middleItem = item;
  if (item) middleItems.set(key,item);
  panelHeading('chat-panel',key === 'chat' ? 'AI 对话' : title,key === 'chat' ? null : 'AI 对话','back-chat');
  if (key === 'chat') { renderChat(); window.MethodAtlasProgress?.chatHeader(); pumpQueue(); }
  revealPanel('chat-panel');
  saveWorkspaceState();
  return middleRequest;
}

function paintMiddle(key, title, body, tools = '') {
  if (middleView !== key) return;
  panelHeading('chat-panel',title,'AI 对话','back-chat');
  const host = document.getElementById('chat-body');
  host.className = 'memory-column'; host.innerHTML = body;
  document.getElementById('chat-tools').innerHTML = tools;
}

async function closeArtifact() {
  const project = current?.id, id = artifact?.id;
  try {
    await window.MethodAtlasWriting?.flush();
    if (current?.id !== project || artifact?.id !== id) return;
    artifactRequest++; artifact = null; versionId = null;
    renderOutput();
    document.querySelector(`#output-body [data-action=file][data-id="${id}"]`)?.focus();
  } catch (error) { toast(error.message); }
}

function renderWorkspace() {
  if (workspaceProject === current.id && document.querySelector('.workspace')) {
    localStorage.setItem('methodatlas-view', JSON.stringify({projectId:current.id,conversationId:conversation.id}));
    viewPanels.delete('chat');
    lastStarted = null; loadQueue();
    if (shellView !== 'chat') switchShellView('chat');
    openMiddle('chat');
    document.getElementById('chat-body').replaceChildren();
    renderChatList(); renderChat();
    return;
  }
  window.MethodAtlasWriting?.unmount();
  outputKey = null;
  workspaceProject = current.id;
  viewPanels.clear(); middlePanels.clear(); middleItems.clear(); middleView = 'chat'; middleItem = null; middleRequest++;
  // Every view is rebuilt inside this function, so the reader goes with it — full screen cannot outlive
  // the page it was opened on, or the next view would render as a reading surface with no way out.
  document.body.classList.remove('reader-fullscreen');
  localStorage.setItem('methodatlas-view', JSON.stringify({projectId:current.id, conversationId:conversation.id}));
  lastStarted = null;
  loadQueue();
  document.getElementById('app').innerHTML = `<main class="workspace">
    <header class="app-header"><div class="row workspace-brand"><button class="icon" data-action="home" aria-label="返回项目列表">${icon('back')}</button><span class="brandmark" aria-hidden="true"><img src="assets/methodatlas-mark.png" alt=""></span><span class="project-title" title="${esc(current.name)}">${esc(current.name)}</span></div><div class="row workspace-actions" aria-label="工作区操作"><button type="button" data-action="settings" class="pill">设置</button><button class="primary workspace-create" data-action="new-project" aria-label="新建项目">${icon('plus')}<span>新建项目</span></button><button class="icon workspace-share" disabled aria-label="分享（暂未开放）" title="分享暂未开放">${icon('share')}</button><span class="avatar workspace-avatar" role="img" aria-label="用户头像（占位）" title="用户头像 · 暂未接入账号">M</span></div></header>
    <div class="shell"><nav class="shell-nav" aria-label="工作台导航">${shellNav()}<span class="shell-nav-indicator" aria-hidden="true"></span></nav><div class="workspace-content"><div class="panel-tabs" role="tablist" aria-label="工作区栏目">${workspacePanelIds.map(id => `<button type="button" role="tab" id="tab-${id}" data-action="panel-tab" data-panel="${id}" aria-controls="${id}"></button>`).join('')}<span class="panel-tabs-indicator" aria-hidden="true"></span></div><div class="panels"><section class="panel" id="sources-panel" aria-label="来源区域"><div class="panel-head"><div class="row"><h2>来源</h2><span class="badge"></span></div><span aria-hidden="true">${icon('panel')}</span></div><div class="panel-body" id="source-body"></div><div id="paper-detail"></div><div id="history-area"></div></section>
      <div class="panel-resizer" role="separator" aria-orientation="vertical" aria-label="调整来源与对话宽度" aria-controls="sources-panel chat-panel" tabindex="0" data-split="0"></div>
      <section class="panel" id="chat-panel" aria-label="主要功能区"><div class="panel-head"><h2>对话</h2><div class="row"><span id="chat-tools" class="row"></span></div></div><div id="chat-body"></div></section>
      <div class="panel-resizer" role="separator" aria-orientation="vertical" aria-label="调整主要功能与成果区宽度" aria-controls="chat-panel output-panel" tabindex="0" data-split="1"></div>
      <section class="panel" id="output-panel" aria-label="成果区"><div class="panel-head"><h2>成果</h2><div id="studio-tools" class="row"></div><button class="icon studio-back" data-action="artifact-list" aria-label="关闭成果，返回列表" title="关闭成果，返回列表" hidden>${icon('close')}</button></div><div id="output-body" class="output-body"></div><div id="studio-meta"></div></section></div></div></div><div class="workspace-foot" aria-hidden="true"></div></main>`;
  activePanel = 'chat-panel';
  restorePanelSizes();
  renderShellView(); renderChat();
  panelHeading('sources-panel','AI 对话');
  panelHeading('chat-panel','AI 对话');
  panelHeading('output-panel','成果');
  renderOutput();
  const nav = document.querySelector('.shell-nav');
  moveIndicator(nav,nav.querySelector('.active'),true);
}
function renderHistory() {
  document.querySelector('[data-action=history]')?.setAttribute('aria-expanded',String(historyOpen));
  const host = document.getElementById('history-area');
  if (!host || shellView !== 'chat') return;
  host.innerHTML = historyOpen ? `<section id="conversation-menu" class="history-panel" aria-label="对话历史"><div class="panel-head"><h2>历史记录</h2><button class="icon" data-action="close-history" aria-label="关闭历史记录">${icon('close')}</button></div><div class="panel-body">${current.conversations.map(c => `<button class="history-item ${c.id === conversation.id ? 'active' : ''}" data-action="conversation" data-id="${esc(c.id)}" ${c.id === conversation.id ? 'aria-current="true"' : ''}><strong>${esc(c.title)}</strong><small>${c.id === conversation.id ? '当前对话' : `${c.messages.length} 条消息`}</small></button>`).join('')}<details class="reading-history" ${disclosure(`${conversation.id}:reads`)}><summary>已读取 · ${new Set((conversation.reads || []).map(r => r.paper_id)).size} 篇</summary>${(conversation.reads || []).map(r => `<button data-action="read-paper" data-id="${r.paper_id}" data-version="${r.paper_version_id}">${esc(shortTitle(r.title))}</button>`).join('')}</details></div></section>` : '';
}

function restorePanelSizes() {
  let sizes;
  try { sizes = JSON.parse(localStorage.getItem('panel-widths')); } catch {}
  if (Array.isArray(sizes) && sizes.length === 3 && sizes.every(n => Number.isFinite(n) && n > 0)) {
    const panels = document.querySelector('.panels');
    ['source','chat','studio'].forEach((name,i) => panels.style.setProperty(`--${name}-width`,`${sizes[i]}fr`));
  }
  document.querySelectorAll('.panel-resizer').forEach(handle => {
    // A collapsed column measures 0px, so there is no ratio left to report on the divider in front of it.
    if (handle.inert) return;
    const widths = [...handle.parentElement.querySelectorAll(':scope > .panel')].map(p => p.getBoundingClientRect().width);
    const i = Number(handle.dataset.split), total = widths[i] + widths[i+1], mins = [180,280,220];
    handle.setAttribute('aria-valuemin',Math.ceil(mins[i] / total * 100));
    handle.setAttribute('aria-valuemax',Math.floor((total - mins[i+1]) / total * 100));
    handle.setAttribute('aria-valuenow',Math.round(widths[i] / total * 100));
  });
}

function resizePanels(handle, delta) {
  if (handle.inert) return;
  handle.parentElement.getAnimations().forEach(animation => animation.cancel());
  const widths = [...handle.parentElement.querySelectorAll(':scope > .panel')].map(p => p.getBoundingClientRect().width);
  const i = Number(handle.dataset.split), total = widths[i] + widths[i+1], mins = [180,280,220];
  widths[i] = Math.max(mins[i],Math.min(total - mins[i+1],widths[i] + delta));
  widths[i+1] = total - widths[i];
  // A collapsed third column measures 0px. Its remembered share has to be carried over, or dragging the
  // other divider would save a zero and throw away all three widths.

  localStorage.setItem('panel-widths',JSON.stringify(widths));
  restorePanelSizes();
}

document.addEventListener('pointerdown', event => {
  const handle = event.target.closest('.panel-resizer');
  if (!handle || event.button !== 0) return;
  event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
  let x = event.clientX;
  document.body.classList.add('resizing-panels');
  const move = e => { resizePanels(handle,e.clientX - x); x = e.clientX; };
  const end = () => {
    document.body.classList.remove('resizing-panels');
    handle.removeEventListener('pointermove',move);
    handle.removeEventListener('lostpointercapture',end);
  };
  handle.addEventListener('pointermove',move);
  handle.addEventListener('lostpointercapture',end);
});
document.addEventListener('keydown', event => {
  if (!event.target.matches('.panel-resizer') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  resizePanels(event.target, {ArrowLeft:-24,ArrowRight:24,Home:-10000,End:10000}[event.key]);
});
window.addEventListener('resize', () => { if (document.querySelector('.panels')) restorePanelSizes(); });

// The list of materials is shared: the workbench shows it in its own column, the library view reuses it verbatim.
function sourcesBodyHTML() {
  const papers = current.papers;
  const selectable = papers.filter(paper => paper.current_version_id);
  const selectedCount = selectable.filter(paper => selected.has(paper.id)).length;
  return `<div class="source-actions"><button class="primary" data-action="add-source">${icon('plus')}添加来源</button><small>上传 PDF、粘贴论文链接或保存原文文字。</small></div><div class="source-count"><span>已选 ${selectedCount} / ${selectable.length} 篇</span><label>全选<input id="select-all" type="checkbox" ${selectable.length && selectable.every(paper => selected.has(paper.id)) ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}></label></div><div id="paper-list">${papers.map(paper => `<div class="paper-row" data-source-id="${esc(paper.id)}">${icon('file')}<button class="paper-link" data-action="paper" data-id="${esc(paper.id)}" aria-label="查看论文：${esc(paper.title)}" title="${esc(shortTitle(paper.title))}"><strong>${esc(shortTitle(paper.title))}</strong><span class="paper-meta">${paper.source_kind === 'text' ? '文字资料' : `${paper.page_count || 0} 页`}</span></button><span class="paper-warning-slot"></span><input type="checkbox" data-paper="${esc(paper.id)}" aria-label="选择论文：${esc(paper.title)}" ${selected.has(paper.id) ? 'checked' : ''} ${paper.current_version_id ? '' : 'disabled'}></div>`).join('') || '<p class="empty-small">还没有资料，点击「添加来源」开始导入。</p>'}</div>`;
}

function syncSourceCounters() {
  const selectable = current.papers.filter(paper => paper.current_version_id);
  const selectedCount = selectable.filter(paper => selected.has(paper.id)).length;
  const all = document.getElementById('select-all');
  if (all) all.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
}

function renderSources() {
  window.dispatchEvent(new Event('methodatlas-papers-changed'));
  if (shellView === 'chat') { syncSourceCounters(); return; }
  if (shellView !== 'library') return;
  const host = document.getElementById('source-body'), top = host.scrollTop;
  host.innerHTML = sourcesBodyHTML(); host.scrollTop = top;
  syncSourceCounters();
}

// The conversation column: a search box, a new-chat button and the saved conversations, newest first.
const taskStateLabels = {queued:'准备中',routing:'正在回答',running:'正在处理',succeeded:'新回答未读',waiting:'等待确认',failed:'有一条说明',interrupted:'有一条说明',stopped:'已停止'};
const projectRunningTask = () => current?.conversations.flatMap(item => item.messages).map(message => message.task).find(task => task && !finished(task.status));
function taskMarker(status) {
  if (['failed','interrupted'].includes(status)) return '<span class="conversation-note">有一条说明</span>';
  const label = taskStateLabels[status];
  return `<span class="task-marker" data-state="${label ? status : 'idle'}"${label ? ` role="img" aria-label="${label}" title="${label}"` : ' aria-hidden="true"'}></span>`;
}

// A completed reply is unread until its conversation is shown; remember the task across reloads.
function markConversationRead() {
  if (!current || !conversation || shellOwnsPanels() || document.hidden) return;
  if (narrowWorkspace.matches && activePanel !== 'chat-panel') return;
  const task = conversation.messages.map(message => message.task).filter(Boolean).at(-1);
  const key = `chat-read:${current.id}:${conversation.id}`;
  if (task?.status === 'succeeded' && localStorage.getItem(key) !== task.id) localStorage.setItem(key,task.id);
}

function conversationRowsHTML() {
  const query = (document.getElementById('conversation-search')?.value || '').trim().toLowerCase();
  const list = current.conversations.filter(item => !query || String(item.title).toLowerCase().includes(query));
  return list.map(item => {
    const tasks = item.messages.map(message => message.task).filter(Boolean);
    const task = tasks.findLast(task => !finished(task.status)) || tasks.at(-1);
    const status = task?.status === 'succeeded' && localStorage.getItem(`chat-read:${current.id}:${item.id}`) === task.id ? null : task?.status;
    return `<button type="button" class="conversation-row${item.id === conversation?.id ? ' active' : ''}" data-action="conversation" data-id="${esc(item.id)}"${item.id === conversation?.id ? ' aria-current="true"' : ''}><span class="conversation-icon" aria-hidden="true">${icon('chat')}</span><span class="conversation-body"><strong>${esc(item.title || '新对话')}</strong></span>${taskMarker(item.id === conversation?.id && pending ? 'queued' : status)}</button>`;
  }).join('') || '<p class="empty-small">没有匹配的对话。</p>';
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { markConversationRead(); renderConversationRows(); }
});

function renderConversationRows() {
  const host = document.querySelector('.conversation-list');
  if (host) {
    const html = conversationRowsHTML();
    if (host.innerHTML !== html) {
      const focused = host.contains(document.activeElement) ? document.activeElement.dataset.id : null;
      host.innerHTML = html;
      if (focused) host.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    }
  }
  syncPanelLayout();
}

function renderChatList() {
  if (shellView !== 'chat') return;
  const host = document.getElementById('source-body');
  if (!host) return;
  host.innerHTML = `<label class="chat-search">${icon('search')}<input id="conversation-search" type="search" placeholder="搜索对话..." aria-label="搜索对话" autocomplete="off"></label><button class="primary chat-new" data-action="new-chat">${icon('plus')}新建对话</button><div class="conversation-list">${conversationRowsHTML()}</div>`;
  const heading = document.querySelector('#sources-panel .panel-head h2');
  if (heading) heading.textContent = '对话';
  const badge = document.querySelector('#sources-panel .panel-head .badge');
  if (badge) badge.textContent = current.conversations.length;
  syncSourceCounters();
  syncPanelLayout();
}

// Selecting papers repaints whichever view currently owns the list.
function renderSelectionViews() { renderSources(); }

async function showPaper(id, page = 1, version = null, focus = null, valid = () => true) {
  const generation = viewGeneration, projectId = current?.id;
  const request = ++paperRequest;
  try {
    const paper = await api(`/api/projects/${projectId}/papers/${id}${version ? `?version_id=${encodeURIComponent(version)}` : ''}`);
    if (generation !== viewGeneration || current?.id !== projectId || request !== paperRequest || !valid() || focus?.previewCurrent && !focus.previewCurrent()) return;
    if (historyOpen) { historyOpen = false; renderHistory(); }
    if (shellView !== 'library') switchShellView('library');
    const source = document.querySelector(`[data-source-id="${CSS.escape(id)}"]`);
    const origin = source?.getBoundingClientRect();
    detail = {paper, page, focus}; renderPaperViews(); saveWorkspaceState(); revealPanel('sources-panel');
    const reader = document.querySelector('.reader-shell');
    if ((!focus || focus.readingPosition) && origin?.width && reader && !(window.MethodAtlasSettings?.reducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      const destination = reader.getBoundingClientRect();
      reader.animate([
        {transform:`translate(${origin.left-destination.left}px,${origin.top-destination.top}px) scale(${origin.width/destination.width},${origin.height/destination.height})`,opacity:.35},
        {transform:'none',opacity:1}
      ], {duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
      reader.style.transformOrigin = 'top left';
    }
  } catch (error) { if (generation === viewGeneration && current?.id === projectId) toast(error.message); }
}

function renderDetail() {
  const host = document.getElementById('paper-detail');
  if (!host) return;
  if (!detail) { host.innerHTML = ''; return; }
  const p = detail.paper, page = p.pages.find(row => row.page === detail.page) || p.pages[0];
  const refs = [...conversation.messages.flatMap(m => m.task?.citations || []), ...(liveTask?.citations || []), ...(artifact?.versions.flatMap(v => v.citations) || []), ...(detail.focus ? [detail.focus] : [])];
  const citations = [...new Map(refs.filter(c => c.paper_version_id === p.version_id && c.page === page.page && c.rect).map(c => [c.id,c])).values()];
  const base = `/api/projects/${current.id}/papers/${p.id}`;
  const overlays = citations.map(c => `<button class="pdf-highlight ${detail.focus?.id === c.id ? 'focused' : ''}" title="${esc(c.quote)}" aria-label="引用原文：${esc(c.quote)}" style="left:${c.rect[0]/page.width*100}%;top:${c.rect[1]/page.height*100}%;width:${(c.rect[2]-c.rect[0])/page.width*100}%;height:${(c.rect[3]-c.rect[1])/page.height*100}%"></button>`).join('');
  host.innerHTML = `<section class="paper-drawer pdf-drawer" aria-label="论文详情"><div class="drawer-head row between"><strong title="${esc(shortTitle(p.title))}">${esc(shortTitle(p.title))}</strong><button class="icon" data-action="close-paper" aria-label="关闭论文详情">${icon('close')}</button></div><div class="pdf-controls"><button data-action="pdf-prev" ${page.page <= 1 ? 'disabled' : ''}>上一页</button><label>第 <input id="pdf-page" type="number" min="1" max="${p.page_count}" value="${page.page}" aria-label="PDF 页码"> / ${p.page_count} 页</label><button data-action="pdf-next" ${page.page >= p.page_count ? 'disabled' : ''}>下一页</button><a class="icon" href="${base}/pdf?version_id=${p.version_id}" aria-label="下载此版本原 PDF" title="下载此版本原 PDF">${icon('download')}</a></div><div class="drawer-body">${p.kind === 'pdf' ? `<div class="pdf-page"><img id="pdf-image" src="${base}/page?version_id=${p.version_id}&page=${page.page}" alt="${esc(p.title)} 原始 PDF 第 ${page.page} 页">${overlays}</div>` : `<p class="summary-text">${esc(page.text)}</p>`}</div></section>`;
  const image = document.getElementById('pdf-image');
  if (detail.focus?.legacy) { const quote = document.createElement('p'); quote.className = 'summary-text'; quote.textContent = '保存的旧版原文依据：' + detail.focus.quote; host.querySelector('.drawer-body').prepend(quote); }
  if (image) image.onload = () => host.querySelector('.focused')?.scrollIntoView({block:'center', behavior:'smooth'});
}

async function openCitation(id, previewCurrent = () => true) {
  const generation = viewGeneration, projectId = current?.id;
  try { const c = await api(`/api/projects/${projectId}/citations/${encodeURIComponent(id)}`); if (generation === viewGeneration && current?.id === projectId && previewCurrent()) await showPaper(c.paper_id,c.page,c.paper_version_id,{...c,previewCurrent}); }
  catch (error) { toast(error.message); }
}

// The composer owns one round button: it sends, and while the agent is thinking it stops instead.
// Typing a draft always turns it back into send, so the stop control never blocks the next message.
const runningTask = () => (conversation?.messages || []).map(message => message.task).filter(task => task && !finished(task.status)).at(-1) || null;
function syncComposer(form = document.getElementById('chat-form')) {
  if (!form) return;
  const workbench = document.getElementById('skill-workbench');
  if (workbench?.matches(':popover-open') && workbench.dataset.pending !== String(pending)) renderSkillWorkbench();
  form.setAttribute('aria-busy', String(!!pending));
  const button = form.querySelector('.send-button');
  if (!button) return;
  const input = form.querySelector('#chat-input');
  if (input) { input.style.height = '0px'; input.style.height = `${Math.min(11.25 * parseFloat(getComputedStyle(document.documentElement).fontSize), Math.max(2.5 * parseFloat(getComputedStyle(document.documentElement).fontSize), input.scrollHeight))}px`; }
  const task = runningTask(), draft = input?.value.trim();
  const mode = (pending || task) && !draft ? (task ? 'stop' : 'submitting') : 'send';
  const labels = {send:'发送任务', stop:'停止生成', submitting:'正在提交任务'};
  button.type = mode === 'send' ? 'submit' : 'button';
  button.disabled = mode === 'submitting';
  button.classList.toggle('stop', mode !== 'send');
  button.setAttribute('aria-label', labels[mode]);
  button.title = mode === 'send' ? '发送；有任务时自动调整方向' : labels[mode];
  button.innerHTML = icon(mode === 'send' ? 'arrow' : 'stop');
  if (mode === 'stop') { button.dataset.action = 'stop'; button.dataset.control = 'stop'; button.dataset.id = task.id; }
  else { delete button.dataset.action; delete button.dataset.control; delete button.dataset.id; }
}

function selectedFragments(conversationId = conversation?.id) {
  try { const value=JSON.parse(localStorage.getItem(`selected-fragments:${conversationId}`)||'[]');return Array.isArray(value)?value:[]; } catch {return [];}
}
function saveSelectedFragments(fragments, conversationId = conversation.id) {
  localStorage.setItem(`selected-fragments:${conversationId}`,JSON.stringify(fragments));
}
function fragmentCards(fragments, removable = false) {
  if(!fragments?.length)return '';
  return `<details class="selected-fragments"><summary><span>${fragments.length} 个已选文本片段</span>${removable?'<button type="button" class="selected-fragments-remove" data-remove-all-fragments aria-label="移除已选文本片段">×</button>':''}</summary><div class="selected-fragment-list">${fragments.map((f,i)=>`<div class="selected-fragment"><div><small>${esc(f.title || '文档')}${f.version_no ? ` · v${f.version_no}` : ''}</small>${removable?`<button type="button" data-remove-fragment="${esc(f.id)}" aria-label="移除文本片段 ${i+1}">×</button>`:''}</div><blockquote>${esc(f.text)}</blockquote></div>`).join('')}</div></details>`;
}
function addSelectedFragment(fragment) {
  const fragments=selectedFragments();
  if(fragments.length>=20||fragments.reduce((n,f)=>n+f.text.length,fragment.text.length)>20000)throw Error('最多添加20个片段，总计20000字符');
  saveSelectedFragments([...fragments,fragment]);
  renderChat();
  document.getElementById('chat-input')?.focus({preventScroll:true});
}

function composer() {
  return `<form class="composer" id="chat-form" aria-busy="false"><div id="selected-fragment-draft">${fragmentCards(selectedFragments(),true)}</div><label class="sr-only" for="chat-input">给 Agent 的问题</label><textarea id="chat-input" placeholder="提问或发送新的要求">${esc(localStorage.getItem(`draft:${conversation.id}`) || '')}</textarea><div class="composer-bottom"><div class="composer-tools"><button type="button" class="workbench-trigger" aria-label="Skill 工作台" title="Skill 工作台" data-action="skill-workbench" popovertarget="skill-workbench">${icon('spark')}<span>Skill 工作台</span></button></div>${window.MethodAtlasSettings?.controls() || ''}<div class="row"><button class="send-button" type="submit" aria-label="发送任务" title="发送；有任务时自动调整方向">${icon('arrow')}</button></div></div></form>`;
}

// Keep complete backend answers readable immediately; only new message containers fade in.
const copiedAnswers = new Set();
function copyAnswerButton(id) {
  const copied = copiedAnswers.has(id);
  return `<button type="button" class="answer-copy" data-action="copy-answer" data-id="${esc(id)}" aria-label="${copied ? '已复制' : '复制回答'}">${icon(copied ? 'check' : 'copy')}<span>${copied ? '已复制' : '复制'}</span></button>`;
}
async function copyAnswer(target) {
  const id = target.dataset.id;
  const node = document.querySelector(`[data-answer="${CSS.escape(id)}"]`);
  if (!node || copiedAnswers.has(id)) return;
  try {
    await navigator.clipboard.writeText(node.innerText);
    copiedAnswers.add(id);
    if (target.isConnected) { target.innerHTML = icon('check') + '<span>已复制</span>'; target.setAttribute('aria-label','已复制'); }
    toast('回答已复制');
    setTimeout(() => {
      copiedAnswers.delete(id);
      const button = document.querySelector(`[data-action="copy-answer"][data-id="${CSS.escape(id)}"]`);
      if (button) { button.innerHTML = icon('copy') + '<span>复制</span>'; button.setAttribute('aria-label','复制回答'); }
    },1800);
  } catch { toast('复制失败，请选择回答文字后复制。'); }
}

function renderAnswerText(raw, task) {
  return esc(raw).replace(/^#{1,6}\s+(.+)$/gm,'<strong>$1</strong>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\[cite:([^\]]+)\]/g, (match,id) => { const c = task?.citations.find(c => c.id === id); return c ? citationLink(c,'citation-inline') : match; }).replace(/\[([^\]]+)\]\((\/api\/projects\/[^)]+\/download)\)/g,(match,label,url) => task?.files.some(f => fileUrl(f.artifact_id,f.version_id) === url) ? '' : match);
}

function hasPaperResults(task) {
  return task?.waits?.some(w => w.payload.kind === 'papers' && !w.payload.draft);
}

function renderChat(forceBottom = false) {
  if (shellOwnsPanels()) return;
  markConversationRead();
  enterBatch = 0;
  const previousForm = document.getElementById('chat-form');
  const inputFocus = document.activeElement?.id === 'chat-input';
  const caret = inputFocus ? [document.activeElement.selectionStart,document.activeElement.selectionEnd] : null;
  const previousLog = document.getElementById('chat-log');
  const scrollTop = previousLog?.scrollTop || 0;
  const followBottom = forceBottom || !previousLog || previousLog.scrollHeight - previousLog.clientHeight - scrollTop < 4;
  // Preserve open blocks being read; default-open progress is not a user preference.
  previousLog?.querySelectorAll('details[open][data-disclosure]').forEach(node => {
    const rect = node.getBoundingClientRect(), viewport = previousLog.getBoundingClientRect();
    if (node.contains(document.activeElement) || (!followBottom && rect.bottom > viewport.top && rect.top < viewport.bottom)) disclosureState.set(node.dataset.disclosure,true);
  });
  const focusedKey = document.activeElement?.tagName === 'SUMMARY' ? document.activeElement.parentElement.dataset.disclosure : null;
  const started = conversation.messages.length > 0;
  const previousIds = new Set([...previousLog?.querySelectorAll('[data-message-id]') || []].map(node => node.dataset.messageId));
  const messages = conversation.messages.map(message => {
    const task = message.task;
    const fresh = previousForm && message.id && !previousIds.has(message.id) ? ' message-enter' : '';
    if (message.role === 'user') return `<div class="message user${fresh}" data-message-id="${esc(message.id || 'pending')}">${fragmentCards(task?.refs?.selected_fragments || message.selected_fragments)}${esc(message.text)}</div>${task ? taskControls(task) : ''}`;
    const answer = task?.refs?.index_search || hasPaperResults(task)
      ? message.text.replace(/来源查询失败[：:][\s\S]*?(?:不代表没有相关论文。|$)/g,'') : message.text;
    return `<div class="message agent${fresh}" data-message-id="${esc(message.id)}">${hasPaperResults(task) ? '' : `<div class="agent-name">${icon('spark')}MethodAtlas</div>`}${['failed','interrupted','stopped'].includes(task?.status) ? '' : renderProgress(task)}<p class="answer-text" data-answer="${esc(message.id)}">${renderAnswerText(answer, task)}</p>${answer ? copyAnswerButton(message.id) : ''}${(task?.status === 'succeeded' ? task.citations || [] : []).filter(c => c.kind === 'figure').map(renderFigureInsight).join('')}${task?.status === 'succeeded' && task?.files?.length ? `<div class="file-list">${task.files.map(f => `<button class="file-card" data-action="file" data-id="${esc(f.artifact_id)}" data-version="${esc(f.version_id)}">${icon('output')}<span class="file-title">${esc(f.title)}</span><span class="file-version">${esc(artifactKindLabel(f))} · v${f.version_no}</span></button>`).join('')}</div>` : ''}</div>`;
  }).join('');
  const working = pending ? `<div class="message agent working"><div class="agent-name">${icon('spark')}MethodAtlas</div>${renderProgress(liveTask, true)}</div>` : '';
  // The composer dock starts centred like a welcome screen and drops to the bottom once the conversation begins.
  const dropIn = started && lastStarted === false ? ' dock-enter' : '';
  lastStarted = started;
  const dock = `<div class="composer-dock${dropIn}">${queuePanel()}${composer()}</div>`;
  document.getElementById('chat-body').innerHTML = started ? `<div class="chat-body started"><div class="chat-log" id="chat-log">${messages}${working}${connectionNotice()}</div>${dock}</div>` : `<div class="chat-body"><div class="welcome"><div class="welcome-intro"><div class="welcome-emoji" aria-hidden="true">${icon('spark')}</div><h1>让我们开始梳理这个项目…</h1><p class="welcome-ask">您希望此项目帮助您做什么？</p></div>${dock}</div></div>`;
  if (previousForm) document.getElementById('chat-form').replaceWith(previousForm);
  const fragmentHost=document.getElementById('selected-fragment-draft'), fragments=selectedFragments(), fragmentSignature=JSON.stringify(fragments);
  if(fragmentHost && fragmentHost.dataset.signature!==fragmentSignature){
    const open=fragmentHost.querySelector('details')?.open;
    fragmentHost.innerHTML=fragmentCards(fragments,true);fragmentHost.dataset.signature=fragmentSignature;
    if(open && fragmentHost.firstElementChild)fragmentHost.firstElementChild.open=true;
  }
  syncComposer(document.getElementById('chat-form'));
  renderConversationRows();
  const log = document.getElementById('chat-log'); if (log) log.scrollTop = followBottom ? log.scrollHeight : scrollTop;
  if (focusedKey) [...document.querySelectorAll('[data-disclosure]')].find(node => node.dataset.disclosure === focusedKey)?.querySelector('summary')?.focus({preventScroll:true});
  if (inputFocus) { const input = document.getElementById('chat-input'); input?.focus({preventScroll:true}); input?.setSelectionRange(...caret); }
}

function pendingCandidates(w, task) {
  if (w.payload.draft) return [];
  const recommendations = w.payload.recommendation?.papers;
  const accepted = new Set(w.response?.candidate_ids || []);
  return w.payload.candidates.filter(c => {
    const receipt = task.refs?.paper_imports?.[`${w.id}:${c.id}`];
    const alreadyInLibrary = c.paper_id || current.papers.some(p => c.versions.some(v =>
      v.external_id === p.external_id || (p.metadata?.discovery_sources || []).some(source => source.external_id === v.external_id)));
    return !alreadyInLibrary && c.state !== 'rejected' && !receipt?.paper_id && !accepted.has(c.id) &&
      (!recommendations || recommendations.some(p => p.candidate_id === c.id));
  });
}

function paperWait(w, task, button) {
  if (w.payload.draft) return '';
  const recommendations = w.payload.recommendation?.papers;
  const accepted = new Set(w.response?.candidate_ids || []);
  const candidates = pendingCandidates(w, task);
  const lists = task.waits.filter(w => w.payload.kind === 'papers' && !w.payload.draft);
  const collectAll = lists.at(-1).id === w.id && lists.some(w => pendingCandidates(w,task).length);
  if (recommendations) candidates.sort((a,b) => recommendations.findIndex(p => p.candidate_id === a.id) - recommendations.findIndex(p => p.candidate_id === b.id));
  const entries = candidates.map(c => {
    const p = c.preferred;
    const reason = recommendations?.find(p => p.candidate_id === c.id)?.reason || c.reasons?.[0]?.text || '检索命中；尚无推荐理由，请打开论文核对。';
    const title = /^https?:\/\//i.test(p.url || '')
      ? `<a class="candidate-title" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.title)}">${esc(p.title)}</a>`
      : `<span class="candidate-title" title="${esc(p.title)}">${esc(p.title)}</span>`;
    return `<li class="candidate-item"><div class="candidate-row">${title}${button('collect-papers','收录',`data-wait="${esc(w.id)}" data-candidate="${esc(c.id)}" aria-label="收录：${esc(p.title)}"`)}</div><p class="candidate-reason">${esc(reason)}</p></li>`;
  }).join('');
  return `<section class="paper-recommendations" data-paper-wait="${esc(w.id)}" aria-label="推荐论文">
    <p class="search-summary">${esc(w.payload.recommendation?.summary || `围绕「${w.payload.query}」检索了相关论文，可打开标题查看来源。`)}</p>
    <ul class="candidate-list">${entries}</ul>
    ${collectAll ? button('collect-papers','全部收录',`data-wait="${esc(w.id)}" data-all="true" class="collect-all"`) : ''}${!candidates.length ? `<p class="candidate-reason" role="status">${accepted.size ? '已收录到左侧来源。' : '暂无新的待收录论文。'}</p>` : ''}</section>`;
}

function connectionNotice() {
  return connectionWarning ? `<div class="message agent" role="status"><div class="agent-name">${icon('spark')}MethodAtlas</div><p class="answer-text">${esc(connectionWarning)}</p></div>` : '';
}

function taskControls(task) {
  if (['failed','interrupted','stopped'].includes(task.status)) return '';
  const waits = (task.waits || []).filter(w => !w.response || w.payload.kind === 'papers');
  if (task.status === 'succeeded' && !waits.length) return '';
  const button = (action,label,extra='') => `<button type="button" data-action="control" data-control="${action}" data-id="${esc(task.id)}" ${extra}>${label}</button>`;
  const labels = {queued:'正在准备回答…',routing:'正在回答…',running:'正在处理…',waiting:'等待确认'};
  return `<div class="message agent">${task.status !== 'succeeded' && !waits.some(w => w.payload.kind === 'papers') ? `<p role="status">${labels[task.status] || ''}</p>` : ''}${waits.map(w => w.payload.kind === 'papers' ? paperWait(w,task,button) : `<div><p>${esc(w.payload.title || '')}：${esc(w.payload.description || '')}</p>${button('confirm','确认',`data-wait="${esc(w.id)}" data-accepted="true"`)}${button('confirm','不采纳',`data-wait="${esc(w.id)}" data-accepted="false"`)}</div>`).join('')}</div>`;
}

async function controlTask(target) {
  const generation = viewGeneration, projectId = current.id, conversationId = conversation.id;
  const action = target.dataset.control;
  const body = {};
  if (action === 'retry') body.call_id = target.dataset.call;
  if (action === 'paper-retry') body.import_key = target.dataset.importKey;
  if (action === 'confirm') Object.assign(body,{wait_id:target.dataset.wait,response:{accepted:target.dataset.accepted === 'true'}});
  if (action === 'collect-papers') Object.assign(body,{wait_id:target.dataset.wait,...(target.dataset.all ? {all:true} : {candidate_ids:[target.dataset.candidate]})});
  target.disabled = true;
  try {
    await api(`/api/projects/${projectId}/conversations/${conversationId}/tasks/${target.dataset.id}/${action}`,{method:'POST',body:JSON.stringify(body)});
    await refreshTask(target.dataset.id,generation,projectId,conversationId);
  } catch (error) { toast(error.message); }
  finally { if (target.isConnected) target.disabled = false; }
}

// The composer stop button: same endpoint the message-stream control used, now reachable without scrolling the log.
async function stopTask(taskId) {
  if (!taskId || !current || !conversation) return;
  const generation = viewGeneration, projectId = current.id, conversationId = conversation.id;
  const button = document.querySelector('.send-button[data-action="stop"]');
  if (button) button.disabled = true;
  try {
    await api(`/api/projects/${projectId}/conversations/${conversationId}/tasks/${taskId}/stop`,{method:'POST',body:'{}'});
    await refreshTask(taskId,generation,projectId,conversationId);
  } catch (error) { toast(error.message); }
  finally { syncComposer(); }
}

function renderOutput() {
  const host = document.getElementById('output-body');
  if (!host) return;
  const version = artifact && (artifact.versions.find(v => v.id === versionId) || artifact.versions.at(-1));
  syncPanelLayout();
  const nextKey = version ? `${artifact.id}:${version.id}` : null;
  if (nextKey && nextKey === outputKey) return;
  window.MethodAtlasWriting?.unmount();
  outputKey = nextKey;
  if (version) versionId = version.id;
  saveWorkspaceState();
  document.querySelector('.studio-back').hidden = !version;
  panelHeading('output-panel',version ? artifactKindLabel(version) : '成果',version ? '成果' : null,'artifact-list');
  host.classList.toggle('html-output', ['html','graph','docx','research'].includes(version?.kind));
  // One download control: the menu lists whatever this version can actually be saved as.
  const downloads = [];
  if (version?.payload?.filename) downloads.push(`<a href="${fileUrl(artifact.id,version.id)}" download>${esc(version.kind === 'graph' ? 'HTML' : String(version.kind).toUpperCase())} 原文件</a>`);
  if (version && ['html','docx','research','graph'].includes(version.kind)) {
    downloads.push('<button data-action="export" data-format="markdown">Markdown</button>');
    downloads.push('<button data-action="export" data-format="pdf">PDF</button>');
  }
  const downloadMenu = downloads.length ? `<details class="download-menu"><summary class="icon" aria-label="下载" title="下载">${icon('download')}</summary><div>${downloads.join('')}</div></details>` : '';
  document.getElementById('studio-tools').innerHTML = version ? `<label class="version-picker"><span class="sr-only">历史版本</span><select id="version-select" title="${esc(version.title)}">${artifact.versions.map(v => `<option value="${v.id}" ${v.id === version.id ? 'selected' : ''}>v${v.version_no}</option>`).join('')}</select></label>${downloadMenu}` : '';
  if (version?.kind === 'graph' && version.id !== artifact.versions.at(-1).id) document.getElementById('studio-tools').insertAdjacentHTML('beforeend','<button data-action=restore-graph>恢复此版</button>');
  if (version && ['html','docx'].includes(version.kind) && version.id !== artifact.versions.at(-1).id) document.getElementById('studio-tools').insertAdjacentHTML('beforeend', '<button data-action="restore-artifact" title="追加恢复版本，保留当前及历史内容">恢复此版</button>');
  if (version?.kind === 'manuscript') {
    host.innerHTML = '';
    if (!window.MethodAtlasWriting) { outputKey = null; host.innerHTML = '<p role="status">编辑器正在加载，请稍候…</p>'; return; }
    document.querySelector('#studio-tools .download-menu')?.remove();
    window.MethodAtlasWriting.mount(host, {project:current.id,artifact:artifact.id,selectedVersion:version.id === artifact.versions.at(-1).id ? null : versionId,
      context:()=>({conversation:conversation.id,selected:[...selected],papers:current.papers}),onCitation:openCitation,onAddFragment:addSelectedFragment,
      // 历史版本只读，得让编辑区自己能一键回到最新版（否则用户只会觉得「打不进去字」）。
      onOpenLatest:()=>{versionId=null;renderOutput();},
        onSaved:(loaded,restoreVersion)=>{if(current?.id!==loaded.project_id)return;artifact=loaded;versionId=restoreVersion||loaded.versions.at(-1).id;if(!restoreVersion)outputKey=`${loaded.id}:${versionId}`;saveWorkspaceState(); const index=current.artifacts.findIndex(a=>a.id===loaded.id);if(index>=0)current.artifacts[index]={...current.artifacts[index],title:loaded.title,updated:loaded.updated};const picker=document.getElementById('version-select');if(picker)picker.innerHTML=loaded.versions.map(v=>`<option value="${esc(v.id)}" ${v.id===versionId?'selected':''}>v${v.version_no} · ${esc(v.payload.author||'')}</option>`).join('');if(restoreVersion){renderOutput();}}});
    return;
  }
  const outputs = current.artifacts.filter(item => item.kind !== 'progress');
  host.innerHTML = artifact ? renderArtifact(artifact) : studioListHTML(outputs);
  if (!version) return;
  const frame = document.getElementById('html-preview');
  if (frame && version.kind === 'graph') {
    const context = {project_id:current.id,artifact_id:artifact.id,version_id:version.id,nonce:uid()};
    frame.dataset.context = JSON.stringify(context);
    const url = fileUrl(artifact.id,version.id).replace(/download$/, 'preview');
    api(url).then(data=>{if(frame.isConnected && document.getElementById('html-preview')===frame) frame.srcdoc=data.content.replace('const HOST = null; // METHODATLAS_PREVIEW_CONTEXT', 'const HOST = '+JSON.stringify(context)+';');}).catch(error=>{if(frame.isConnected)toast(error.message);});
  } else if (frame) frame.srcdoc = researchPreview(version);
}

// Figure results stay with their answer: opening them never replaces the current document.
function renderFigureInsight(citation) {
  const observations = Array.isArray(citation.observations) ? citation.observations.filter(item => item && typeof item.text === 'string') : [];
  const rect = citation.image?.rect || citation.rect;
  const crop = Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] > rect[0] && rect[3] > rect[1];
  const params = crop ? new URLSearchParams({version_id:citation.paper_version_id,page:String(citation.page),x0:String(rect[0]),y0:String(rect[1]),x1:String(rect[2]),y1:String(rect[3])}) : null;
  const imageUrl = crop ? `/api/projects/${encodeURIComponent(current.id)}/papers/${encodeURIComponent(citation.paper_id)}/fragment?${params}` : '';
  const section = (basis, title) => {
    const items = observations.filter(item => item.basis === basis);
    if (!items.length) return '';
    return `<section><h4>${title}</h4><ul>${items.map(item => `<li><p>${esc(item.text)}</p></li>`).join('')}</ul></section>`;
  };
  return `<section class="figure-insight"><h3>图表解读 · ${esc(shortTitle(citation.title))} · 第 ${Number(citation.page)} 页</h3><div class="figure-insight-body">
    ${imageUrl ? `<img loading="lazy" src="${esc(imageUrl)}" alt="${esc(shortTitle(citation.title))}第 ${Number(citation.page)} 页的原始图表裁剪">` : '<p class="muted">未取得图表裁剪，请打开原文核对。</p>'}
    <div>回到原图：${citationLink(citation)} · <a href="/api/projects/${encodeURIComponent(current.id)}/citations/${encodeURIComponent(citation.id)}/export" download>下载 PDF</a></div>
    ${section('image','图中可见')}
    ${section('context','正文说明')}
    ${!observations.length ? '<p class="muted">未取得可靠观察，请重新读取清晰的原图。</p>' : ''}
  </div></section>`;
}

function artifactSources(version) {
  return version.citations.length ? `<details class="artifact-sources" ${disclosure(`${version.id}:sources`)}><summary>引用的来源 · ${version.citations.length}</summary><div class="evidence-list">${version.citations.map(citationButton).join('')}</div></details>` : '';
}

// Presentation only: saved artifact bytes and citation identities remain immutable.
function researchPreview(version) {
  const doc = new DOMParser().parseFromString(version.kind === 'html' ? version.body : '<!doctype html><html><head></head><body></body></html>', 'text/html');
  const citations = version.citations.filter(c => version.materials.some(m => m.paper_id === c.paper_id && m.paper_version_id === c.paper_version_id));
  const papers = [...new Map(citations.map(c => [c.paper_version_id,c])).values()];
  const numbers = new Map(papers.map((c,i) => [c.paper_version_id,i+1]));
  const byId = new Map(citations.map(c => [c.id,c]));
  const element = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  if (version.kind !== 'html') {
    const article = element('article',null,'research-view');
    article.append(element('h1',version.title));
    // Saved DOCX bodies already use evidence-order [n]; resolve before display renumbering.
    const inline = text => esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\[cite:([^\]]+)\]|\[(\d+)\]/g,(match,id,n) => {
      const c = id ? byId.get(id) : version.citations[Number(n)-1];
      return c && byId.has(c.id) ? `<button data-citation="${esc(c.id)}">${match}</button>` : match;
    });
    const lines = version.body.split('\n');
    for (let i=0;i<lines.length;i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('|') && /^\|[\s:|\-]+\|$/.test(lines[i+1]?.trim() || '')) {
        const wrap = element('div',null,'research-table'), table = element('table');
        let header = true;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i++].trim();
          if (/^\|[\s:|\-]+\|$/.test(row)) continue;
          const tr = element('tr');
          row.slice(1,-1).split('|').forEach(value => { const cell = element(header ? 'th':'td'); cell.innerHTML=inline(value.trim()); tr.append(cell); });
          table.append(tr); header=false;
        }
        i--; wrap.append(table); article.append(wrap); continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)/);
      if (heading?.[1] === '#' && heading[2].trim() === version.title.trim()) continue;
      const list = line.match(/^([-*]|\d+\.)\s+(.+)/);
      if (list) { const tag=list[1].match(/\d/) ? 'ol' : 'ul'; let parent=article.lastElementChild; if(parent?.tagName !== tag.toUpperCase()){parent=element(tag);article.append(parent);} const item=element('li');item.innerHTML=inline(list[2]);parent.append(item);continue; }
      const p = element(heading ? `h${Math.min(3,heading[1].length+1)}` : 'p');
      p.innerHTML=inline(heading ? heading[2] : line); article.append(p);
    }
    doc.body.append(article);
  }
  doc.body.classList.add('reading-view');
  doc.querySelectorAll('.methodatlas-sources').forEach(n=>n.remove());
  const article = doc.querySelector('.research-view') || doc.body;
  if (!article.querySelector('h1')) article.prepend(element('h1',version.title));
  // Older saved reports also read as one document; their saved bytes stay unchanged.
  if (doc.querySelector('.research-detail')) {
    doc.querySelectorAll('.research-detail').forEach((detail,i)=>{
      const source=version.payload?.research?.nodes?.[Number(detail.dataset.detail ?? i)];
      if(source?.period && !detail.querySelector('.reading-period'))detail.querySelector('h2')?.after(element('p',source.period,'reading-period'));
    });
    doc.querySelectorAll('.research-map,.research-timeline,.reading-comparison:has(table),.research-table,[data-close-detail]').forEach(n=>n.remove());
    doc.querySelectorAll('.research-detail').forEach(n=>n.removeAttribute('hidden'));
  }
  doc.querySelectorAll('details').forEach(n=>{
    const section=element('section');
    const summary=n.querySelector(':scope > summary');
    if(summary)summary.replaceWith(element('h2',summary.textContent));
    section.className=n.className;section.append(...n.childNodes);n.replaceWith(section);
  });
  doc.querySelectorAll('table').forEach(table=>{
    const rows=[...table.rows], headers=rows[0]?[...rows[0].cells].map(c=>c.textContent.trim()):[];
    if(!table.closest('.research-table')){const wrap=element('div',null,'research-table');table.before(wrap);wrap.append(table);}
    rows[0]?.classList.add('reading-table-head');
    rows.slice(1).forEach(row=>[...row.cells].forEach((cell,i)=>{if(cell.tagName==='TD')cell.dataset.label=headers[i]||'';}));
  });
  const nonce = doc.querySelector('script[nonce]')?.getAttribute('nonce') || uid();
  if (!doc.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
    const policy = element('meta'); policy.httpEquiv='Content-Security-Policy';
    policy.content=`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`; doc.head.append(policy);
  }
  const quotes = new Map();
  doc.querySelectorAll('[data-citation]').forEach(original => {
    let button=original;
    const c = byId.get(original.dataset.citation);
    // Legacy HTML may bind evidence to an entire paragraph/table cell, not a marker.
    if (original.tagName !== 'BUTTON') {
      button=element('button'); button.dataset.citation=original.dataset.citation; button.type='button';
      original.removeAttribute('data-citation'); original.removeAttribute('role'); original.removeAttribute('tabindex');
      (original.closest('svg') || original).after(button);
    }
    if (!c) { button.replaceWith(element('span','[引用不可用]')); return; }
    const label=button.textContent.trim(), number=`[${numbers.get(c.paper_version_id)}]`;
    const marker=!label || button.classList.contains('research-paper') || /^(原文|查看原文|\[\d+\]|\[cite:[^\]]+\])$/.test(label);
    if (button.closest('.research-papers')) button.textContent=`${number} ${c.title}`;
    else if (marker) button.textContent=number;
    else button.append(element('span',` ${number}`));
    button.classList.add('reading-citation'); button.setAttribute('aria-label',`引用 ${numbers.get(c.paper_version_id)}：查看原文`);
    button.removeAttribute('title');
    let quote=quotes.get(c.id);
    if (!quote) {
      quote=element('div',c.quote || '此历史引用未保存原文片段。','reading-quote');
      quote.id=`reading-quote-${nonce}-${quotes.size}`; quote.setAttribute('popover','auto'); quote.setAttribute('role','region'); quote.setAttribute('tabindex','0'); quote.setAttribute('aria-label','引用原文');
      doc.body.append(quote); quotes.set(c.id,quote);
    }
    button.setAttribute('popovertarget',quote.id);
  });
  if (papers.length) {
    const refs = element('section',null,'reading-references'); refs.append(element('h2',`参考文献（${papers.length}）`));
    papers.forEach(c => {
      const row = element('button',null,'reading-reference'); row.type='button'; row.dataset.sourceOpen=c.id;
      row.append(element('span',`[${numbers.get(c.paper_version_id)}]`),element('span',c.title),element('span','↗'));
      row.setAttribute('aria-label',`打开论文：${c.title}`); refs.append(row);
    });
    article.append(refs);
  }
  doc.querySelectorAll('style').forEach(style=>doc.head.append(style));
  const style=element('style');
  const theme = document.getElementById('report-theme')?.sheet;
  style.textContent = theme ? [...theme.cssRules].map(rule=>rule.cssText).join('\n') : ''; doc.head.append(style);
  const script=element('script'); script.setAttribute('nonce',nonce);
  script.textContent=`function readingCitation(e){
    if(e.type==='keydown' && (!['Enter',' '].includes(e.key)||['BUTTON','A'].includes(e.target.tagName)))return;
    const source=e.target.closest('[data-source-open]');
    if(source){parent.postMessage({type:'methodatlas-citation',id:source.dataset.sourceOpen},'*');return;}
    const button=e.target.closest('[data-citation]');if(!button)return;
    e.preventDefault();e.stopImmediatePropagation();
    const quote=document.getElementById(button.getAttribute('popovertarget'));if(!quote)return;
    const wasOpen=quote.matches(':popover-open');document.querySelectorAll(':popover-open').forEach(n=>n.hidePopover());if(wasOpen)return;
    quote.showPopover({source:button});const r=button.getBoundingClientRect(),q=quote.getBoundingClientRect();
    quote.style.left=Math.max(12,Math.min(r.right-q.width,innerWidth-q.width-12))+'px';
    quote.style.top=Math.max(12,Math.min(r.bottom+8,innerHeight-q.height-12))+'px';
  }document.addEventListener('click',readingCitation,true);document.addEventListener('keydown',readingCitation,true);`;
  doc.body.append(script);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}

function renderArtifact(item) {
  const version = item.versions.find(v => v.id === versionId) || item.versions.at(-1);
  versionId = version.id;
  if (['html','graph','docx','research'].includes(version.kind)) return '<iframe id="html-preview" sandbox="allow-scripts" title="HTML 文档预览" referrerpolicy="no-referrer"></iframe>';
  if (['png','pptx'].includes(version.kind)) {
    const report = version.payload.report || {}, base = fileUrl(item.id,version.id).replace(/download$/, '');
    return `<div class="output-detail"><h3>${esc(version.title)}</h3><a href="${base}sources">下载数据、参数与来源</a>${version.kind === 'png' ? `<img style="width:100%;height:auto" src="${base}preview" alt="${esc(version.title)}；${esc(report.summary)}"><p>${esc(report.summary)}</p>` : `<p>${esc(report.summary)} · 完整版式请打开 PPTX 查看</p>${(report.slides || []).map(s => `<details><summary>${esc(s.title)}</summary><p class="summary-text">${esc(s.text)}</p></details>`).join('')}`}${(report.warnings || []).map(w => `<p role="status">缺口：${esc(w)}</p>`).join('')}<details><summary>实际材料与版本</summary>${version.materials.map(m => `<p>${esc(m.title)} · ${esc(m.paper_version_id)}</p>`).join('')}</details>${artifactSources(version)}</div>`;
  }
  return `<div class="output-detail"><h3 class="artifact-title">${esc(version.title)}</h3>${!version.payload?.filename ? '<span class="badge">旧版文本成果</span>' : ''}<p class="summary-text">${esc(version.body)}</p>${artifactSources(version)}</div>`;
}

async function loadArtifact(id, version = null, focus = true) {
  try { await window.MethodAtlasWriting?.flush(); } catch (error) { toast(error.message); return; }
  const generation = viewGeneration, projectId = current?.id;
  const request = ++artifactRequest;
  try {
    const loaded = await api(`/api/projects/${projectId}/artifacts/${id}`);
    if (generation !== viewGeneration || current?.id !== projectId || request !== artifactRequest) return;
    if (loaded.kind === 'progress') {
      document.dispatchEvent(new CustomEvent('open-project-memory', {detail:{day:loaded.versions.at(-1)?.payload.day}}));
      return;
    }
    artifact = loaded; versionId = version || loaded.default_version_id; renderOutput();
    if (focus) { revealPanel('output-panel'); document.querySelector('[data-action=artifact-list]')?.focus(); }
  } catch (error) { if (generation === viewGeneration && current?.id === projectId) toast(error.message); }
}

async function exportArtifact(target) {
  const version = artifact?.versions.find(v => v.id === versionId);
  if (!version || target.disabled) return;
  const format = target.dataset.format;
  const url = fileUrl(artifact.id, version.id).replace(/download$/, `export?format=${format}`);
  target.disabled = true;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error((await response.json()).error);
    const link = document.createElement('a'), blob = URL.createObjectURL(await response.blob());
    link.href = blob;
    link.download = `${version.title}-v${version.version_no}.${format === 'markdown' ? 'md' : 'pdf'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blob), 60000);
  } catch (error) { toast(error.message); }
  finally { target.disabled = false; }
}

async function restoreArtifact(target) {
  const generation = viewGeneration, request = artifactRequest;
  const projectId = current.id, id = artifact.id, version = versionId, base = artifact.versions.at(-1).id;
  const requestKey = `restore:${id}:${version}:${base}`;
  const requestId = localStorage.getItem(requestKey) || uid();
  localStorage.setItem(requestKey,requestId);
  target.disabled = true;
  try {
    const result = await api(`/api/projects/${projectId}/artifacts/${id}/restore`,{method:'POST',body:JSON.stringify({version_id:version,base_version_id:base,request_id:requestId})});
    if (generation === viewGeneration && request === artifactRequest && current?.id === projectId && artifact?.id === id && versionId === version) await loadArtifact(id,result.version_id);
  } catch (error) { toast(error.message); }
  finally { if (target.isConnected) target.disabled = false; }
}

// Restoring from the version menu appends a new version and keeps every older one; it shares the
// writing endpoint the editor's own 恢复此版为新版本 button uses, so both entrances behave alike.
async function restoreDocument(target) {
  const generation = viewGeneration, request = artifactRequest;
  const projectId = current.id, id = artifact.id, version = target.dataset.id, base = artifact.versions.at(-1).id;
  if (!version || version === base) return toast('这已经是最新版。');
  const requestKey = `restore:${id}:${version}:${base}`;
  const requestId = localStorage.getItem(requestKey) || uid();
  localStorage.setItem(requestKey, requestId);
  target.disabled = true;
  try {
    await window.MethodAtlasWriting?.flush();
    if (generation !== viewGeneration || request !== artifactRequest || current?.id !== projectId || artifact?.id !== id) return;
    const result = await api(`/api/projects/${projectId}/documents/${id}/restore`, {method:'POST', body:JSON.stringify({request_id:requestId, version_id:version, base_version_id:base})});
    if (generation === viewGeneration && current?.id === projectId && artifact?.id === id) await loadArtifact(id, result.version_id, false);
  } catch (error) { toast(error.message); }
  finally { if (target.isConnected) target.disabled = false; }
}

async function submit() {
  const input = document.getElementById('chat-input'), text = input.value.trim();
  if (!text) { if (!pending) toast('请先输入问题。'); return; }
  const writingConversation = conversation.id, writingProject = current.id, writingInput = input.value;
  const isAudit = /查新|引用(?:核查|审计|核验)|独立.{0,4}(?:审阅|审稿)|novelty check|citation audit|independent (?:paper )?review/i.test(text) && !/^\s*(?:请)?\s*(?:解释|介绍|什么是|如何|怎么)/.test(text) && !/(?:请|帮我)\s*(?:(?:根据|按照|按).{0,25}?(?:报告|意见|建议|结果))?\s*(?:修复|修改|修正)/.test(text);
  const writingResult = isAudit || window.MethodAtlasSettings?.request().deep_research ? null : await window.MethodAtlasWriting?.submit(text);
  if (writingResult?.handled) { if(writingResult.submitted && current?.id === writingProject && conversation?.id === writingConversation && input.isConnected && input.value === writingInput) { input.value = ''; localStorage.removeItem(`draft:${writingConversation}`); } return; }
  try { await window.MethodAtlasWriting?.flush(); } catch(error) { return toast(error.message); }
  if(current?.id !== writingProject || conversation?.id !== writingConversation || !input.isConnected || input.value !== writingInput) return;
  if (busyTask()) return enqueue(text);
  await dispatchMessage(text);
}

async function dispatchMessage(text, fragments = selectedFragments(), fromQueue = false, settings = window.MethodAtlasSettings?.request()) {
  try { if (!settings?.deep_research && await window.MethodAtlasProgress?.revise(text)) return true; } catch(error) {toast(error.message);return false;}
  const generation = viewGeneration, projectId = current.id, conversationId = conversation.id;
  const requestKey = `request:${conversationId}`;
  const prior = JSON.parse(localStorage.getItem(requestKey) || 'null');
  const referenceVersion = artifact && (artifact.versions.find(v => v.id === versionId) || artifact.versions.at(-1));
  const payload = {text, ...settings, replace_active:true, selected_paper_ids:[...selected], reference: referenceVersion && (referenceVersion.kind === 'manuscript' || conversation.messages.some(m => m.task_id === referenceVersion.task_id)) ? {artifact_id:artifact.id, version_id:referenceVersion.id} : null};
  if(referenceVersion && !payload.reference) payload.report_sources = [{artifact_id:artifact.id,version_id:referenceVersion.id}];
  const progressContext = window.MethodAtlasProgress?.context();
  if(progressContext?.reference) {payload.progress_reference = progressContext.reference;payload.reference=null;delete payload.report_sources;}
  if(fragments.length)payload.selected_fragments=fragments.map(({artifact_id,version_id,selection,text})=>({artifact_id,version_id,selection,text}));
  const signature = JSON.stringify(payload);
  payload.client_message_id = prior?.signature === signature ? prior.id : uid();
  try {
    localStorage.setItem(requestKey, JSON.stringify({signature,id:payload.client_message_id}));
    saveSelectedFragments(selectedFragments().filter(f=>!fragments.some(sent=>sent.id===f.id)));
  } catch(error) {toast('无法保存发送草稿，请释放浏览器存储后重试。');return false;}
  pending = true;
  conversation.messages.push({role:'user', text, selected_fragments:fragments});
  const input = document.getElementById('chat-input');
  if (input && !fromQueue) input.value = '';
  renderChat(true);
  let result;
  try {
    result = await api(`/api/projects/${projectId}/conversations/${conversationId}/messages`, {method:'POST', body:JSON.stringify(payload)});
  } catch (error) {
    const sameView=isCurrentView(generation,projectId,conversationId), box=sameView?document.getElementById('chat-input'):null;
    if(sameView){pending=false;connectionWarning=error.status ? error.message : '暂时无法确认这条请求是否送达。输入已保留，请检查连接后刷新确认，再调整并发送。';if(conversation.messages.at(-1)?.role==='user' && conversation.messages.at(-1).text===text)conversation.messages.pop();}
    try {
      if(!fromQueue && box && !box.value && !selectedFragments().length && JSON.stringify(settings)===JSON.stringify(window.MethodAtlasSettings?.request())){
        box.value=text;localStorage.setItem(`draft:${conversationId}`,text);saveSelectedFragments(fragments,conversationId);
      } else if (!fromQueue) {
        const queue=sameView?messageQueue:JSON.parse(localStorage.getItem(`queue:${conversationId}`)||'[]');
        queue.unshift({id:uid(),text,fragments,settings,failed:true});
        localStorage.setItem(`queue:${conversationId}`,JSON.stringify(queue));
      }
    } catch(storageError) {toast('发送失败且无法保存草稿，请保留当前页面并复制原问题：'+text);}
    if(sameView)renderChat();
    return false;
  }
  window.MethodAtlasSettings?.sent(conversationId);
  // An accepted POST must never become a new draft just because refreshing failed.
  try {
    if (!input?.value) localStorage.removeItem(`draft:${conversationId}`);
    localStorage.removeItem(`graph-prepared:${conversationId}`);
    localStorage.removeItem(`report-sources:${conversationId}`);
    localStorage.removeItem(requestKey);
  } catch {}
  if (!isCurrentView(generation, projectId, conversationId)) return;
  pending = false;
  renderChat();
  activeTaskId = result.task_id;
  if (result.duplicate) toast('这条请求已处理，继续读取原任务状态。');
  try {await refreshTask(result.task_id, generation, projectId, conversationId);}
  catch(error){connectionWarning='消息已发送，暂时无法读取回复。请恢复连接后刷新查看。';renderChat();}

}

async function refreshTask(taskId, generation, projectId, conversationId) {
  if (!isCurrentView(generation, projectId, conversationId)) return;
  clearTimeout(pollTimer);
  let latest;
  try {
    latest = await api(`/api/projects/${projectId}`);
  } catch (error) {
    if (!isCurrentView(generation, projectId, conversationId)) return;
    pollFailures += 1;
    const retry = error.retryable && pollFailures <= 5;
    connectionWarning = '暂时连接不上工作台，无法确认最新处理结果。已有内容和输入已保留；连接恢复后请刷新页面查看。';
    renderChat();
    if (retry) pollTimer = setTimeout(() => refreshTask(taskId,generation,projectId,conversationId), Math.min(30000,1000 * 2 ** (pollFailures - 1)));
    return;
  }
  if (!isCurrentView(generation, projectId, conversationId)) return;
  const wasDisconnected = !!connectionWarning;
  pollFailures = 0; connectionWarning = '';
  const before = JSON.stringify(conversation);
  const sourcesChanged = JSON.stringify(current.papers) !== JSON.stringify(latest.papers);
  const outputsChanged = JSON.stringify(current.artifacts) !== JSON.stringify(latest.artifacts);
  const newOutputs = latest.artifacts.filter(item => !current.artifacts.some(old => old.id === item.id));
  current = latest;
  conversation = current.conversations.find(item => item.id === conversationId) || current.conversations[0];
  const tasks = conversation.messages.filter(m => m.role === 'user').map(m => m.task).filter(Boolean);
  const located = tasks.find(t => !autoLocatedTasks.has(t.id) && t.tools.some(tool => tool.name === 'locate' && tool.status === 'succeeded') && t.citations.length);
  if (located) { autoLocatedTasks.add(located.id); toast('原文位置已找到，可点击回答中的引用查看。'); }
  liveTask = null;
  if (before !== JSON.stringify(conversation) || pending || wasDisconnected) { renderChat(); renderHistory(); }
  renderConversationRows();
  if (sourcesChanged) renderSources();
  if (outputsChanged) {
    if (!artifact) {
      renderOutput();
      for (const item of newOutputs) document.querySelector(`#output-body [data-action=file][data-id="${CSS.escape(item.id)}"]`)?.classList.add('artifact-fresh');
    }
    syncPanelLayout();
    if (newOutputs.length) toast('新成果已生成，可切换到成果查看。');
  }
  if (projectRunningTask() || current.papers.some(p => p.availability?.fulltext === 'pending')) pollTimer = setTimeout(() => refreshTask(taskId,generation,projectId,conversationId).catch(error => toast(error.message)),400);
  pumpQueue();
}

async function createProject(form) {
  const name = form.elements.name.value.trim();
  if (!name) { document.getElementById('project-error').textContent = '请输入项目名称。'; return; }
  const generation = viewGeneration, button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const result = await api('/api/projects', {method:'POST', body:JSON.stringify({name})});
    form.closest('dialog').close();
    if (generation === viewGeneration) await openProject(result.project_id);
  } catch (error) { document.getElementById('project-error').textContent = error.message; }
  finally { button.disabled = false; }
}

document.addEventListener('click', event => {
  if (event.target.closest('#skill-workbench [data-skill-use], #skill-workbench [data-skills-open]')) document.getElementById('skill-workbench').hidePopover();
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'skill-workbench') { document.getElementById('skill-workbench').dataset.pointerMotion = String(event.detail > 0); renderSkillWorkbench(); }
  if (action === 'shell') { switchShellView(target.dataset.value); revealPanel('chat-panel'); }
  if (action === 'panel-tab') revealPanel(target.dataset.panel);
  if (action === 'toggle-panel') {
    const id = target.dataset.panel;
    if (collapsedPanels.has(id)) collapsedPanels.delete(id); else collapsedPanels.add(id);
    syncPanelLayout();
  }
  if (action === 'back-chat') openMiddle('chat');
  if (action === 'control') controlTask(target);
  if (action === 'stop') stopTask(target.dataset.id);
  if (action === 'new-project') { document.getElementById('new-project-form').reset(); document.getElementById('project-error').textContent = ''; document.getElementById('project-dialog').showModal(); }
  if (action === 'refresh-status') { pollFailures = 0; refreshTask(activeTaskId,viewGeneration,current.id,conversation.id).catch(error => toast(error.message)); }
  if (action === 'settings') window.MethodAtlasSettings?.open();
  if (action === 'close-project') document.getElementById('project-dialog').close();
  if (action === 'view') { projectView = target.dataset.value; localStorage.setItem('project-view',projectView); renderProjects(); target.closest('details')?.removeAttribute('open'); }
  if (action === 'task' && !pending && taskInfo[target.dataset.value]) {
    if (target.dataset.value === 'review' && !target.dataset.auditMode) { renderSkillWorkbench('review'); document.getElementById('skill-workbench').showPopover(); return; }
    document.getElementById('skill-workbench').hidePopover();
    localStorage.removeItem(`report-sources:${conversation.id}`);
    const input = document.getElementById('chat-input'), preparedKey = `graph-prepared:${conversation.id}`;
    if (target.dataset.value === 'graph') {
      if (!input.value.trim() || !localStorage.getItem(preparedKey)) input.value = [input.value.trim(),taskInfo.graph.prompt].filter(Boolean).join('\n\n');
      localStorage.setItem(preparedKey,'true');
    } else { input.value = auditModes[target.dataset.auditMode]?.prompt || taskInfo[target.dataset.value].prompt; localStorage.removeItem(preparedKey); }
    localStorage.setItem(`draft:${conversation.id}`,input.value); input.focus(); input.setSelectionRange(input.value.length,input.value.length);
    syncComposer();
  }
  if (action === 'copy-answer') copyAnswer(target);
  if (action === 'home') home();
  if (action === 'open-project') openProject(target.dataset.id);
  if (action === 'new-chat') newConversation();
  if (action === 'paper') showPaper(target.dataset.id);
  if (action === 'citation') openCitation(target.dataset.id);
  if (action === 'legacy-citation') showPaper(target.dataset.id,Number(target.dataset.page),target.dataset.version,{legacy:true,quote:target.dataset.quote});
  if (action === 'read-paper') showPaper(target.dataset.id,1,target.dataset.version);
  if (action === 'file') loadArtifact(target.dataset.id,target.dataset.version);
  if (action === 'export') exportArtifact(target);
  if (action === 'restore-artifact') restoreArtifact(target);
  if (action === 'restore-document') restoreDocument(target);
  if (action === 'new-document') {
    if (!window.MethodAtlasWriting) return toast('写作组件尚未加载，请构建后刷新。');
    if (artifact) return toast('请先关闭当前内容，再新建文档。');
    const project = current.id;
    target.disabled = true;
    window.MethodAtlasWriting.create(project).then(async result=>{
      if (current?.id !== project) return;
      const loaded = await api(`/api/projects/${project}`);
      if (current?.id !== project) return;
      current = loaded; await loadArtifact(result.artifact_id);
    }).catch(error=>toast(error.message)).finally(()=>{target.disabled=false;});
  }
  if (action === 'artifact-list') {
    closeArtifact();
  }
  if (action === 'close-paper') { paperRequest++; detail = null; renderPaperViews(); saveWorkspaceState(); }
  if (action === 'pdf-prev' || action === 'pdf-next') { detail.page += action === 'pdf-prev' ? -1 : 1; renderDetail(); }
  if (action === 'history' || action === 'close-history') { historyOpen = action === 'history' && !historyOpen; renderHistory(); document.querySelector(`[data-action=${historyOpen ? 'close-history' : 'history'}]`)?.focus(); }
  if (action === 'conversation') openProject(current.id,target.dataset.id);
});
document.addEventListener('click', event => {
  const removeAllFragments=event.target.closest('[data-remove-all-fragments]');
  if(removeAllFragments){
    event.preventDefault();
    event.stopPropagation();
    saveSelectedFragments([]);
    renderChat();
    document.getElementById('chat-input')?.focus({preventScroll:true});
    return;
  }
  const removeFragment=event.target.closest('[data-remove-fragment]');
  if(removeFragment){saveSelectedFragments(selectedFragments().filter(f=>f.id!==removeFragment.dataset.removeFragment));renderChat();document.querySelector('.selected-fragments summary')?.focus();return;}
  const queueAction = event.target.closest('[data-queue-action]');
  if (queueAction && !queueAction.disabled) {
    const row = queueAction.closest('[data-queue]'), id = row?.dataset.queue;
    const index = messageQueue.findIndex(item => item.id === id);
    if (index < 0) return;
    const action = queueAction.dataset.queueAction;
    if (action === 'up' && index) [messageQueue[index - 1], messageQueue[index]] = [messageQueue[index], messageQueue[index - 1]];
    if (action === 'retry') messageQueue[index].failed=false;
    if (action === 'edit') queueEditing = id;
    if (action === 'cancel') queueEditing = null;
    if (action === 'save') {
      const textarea = row.querySelector('textarea'), text = textarea.value.trim();
      if (!text) return toast('排队内容不能为空。');
      messageQueue[index].text = text;
      queueEditing = null;
    }
    if (action === 'drop') messageQueue.splice(index,1);
    saveQueue();
    renderChat();
    pumpQueue();
    return;
  }
  const summary = event.target.closest('summary'), node = summary?.parentElement;
  if (node?.dataset.disclosure && !event.defaultPrevented) {
    disclosureState.set(node.dataset.disclosure,!node.open);
    const record = node.parentElement.closest('.execution-record');
    if (!node.open && record) disclosureState.set(record.dataset.disclosure,true);
  }
  document.querySelectorAll('details.sort-menu[open],details.download-menu[open],details.home-menu[open],details.select-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  // Choosing a row closes the menu; the summary itself still toggles it.
  for (const kind of ['download-menu','select-menu']) {
    const opened = event.target.closest('.' + kind);
    if (opened && !event.target.closest('summary')) opened.removeAttribute('open');
  }
  const sortOption = event.target.closest('[data-sort]');
  if (sortOption) {
    projectSort = sortOption.dataset.sort;
    localStorage.setItem('project-sort',projectSort);
    const menu = sortOption.closest('details');
    if (menu) menu.open = false;
    renderProjects();
  }
});
document.addEventListener('input', event => { if (event.target.id === 'project-search') renderProjects(); if (event.target.id === 'conversation-search') renderConversationRows(); if (event.target.id === 'chat-input') { localStorage.setItem(`draft:${conversation.id}`,event.target.value); syncComposer(); } });
// Drag to reorder the queue: the list is only rebuilt on drop, so the drag itself is never cancelled.
const moveQueueItem = (id, beforeId) => {
  const from = messageQueue.findIndex(item => item.id === id), to = messageQueue.findIndex(item => item.id === beforeId);
  if (from < 0 || to < 0 || from === to) return false;
  messageQueue.splice(to, 0, ...messageQueue.splice(from,1));
  saveQueue(); renderChat();
  return true;
};
document.addEventListener('dragstart', event => {
  const row = event.target.closest?.('[data-queue]');
  if (!row) return;
  queueDragId = row.dataset.queue; queueDropTarget = null;
  event.dataTransfer?.setData('text/plain',queueDragId);
  event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
  row.classList.add('dragging');
});
document.addEventListener('dragover', event => {
  if (!queueDragId) return;
  const row = event.target.closest?.('[data-queue]');
  if (!row || row.dataset.queue === queueDragId) return;
  event.preventDefault();
  if (queueDropTarget !== row.dataset.queue) {
    queueDropTarget = row.dataset.queue;
    document.querySelectorAll('.queue-item.drop-before').forEach(node => node.classList.remove('drop-before'));
    row.classList.add('drop-before');
  }
});
document.addEventListener('drop', event => {
  if (!queueDragId) return;
  event.preventDefault();
  moveQueueItem(queueDragId,queueDropTarget || queueDragId);
  queueDragId = null; queueDropTarget = null;
});
document.addEventListener('dragend', () => {
  queueDragId = null; queueDropTarget = null;
  document.querySelectorAll('.queue-item.dragging,.queue-item.drop-before').forEach(node => node.classList.remove('dragging','drop-before'));
});
document.addEventListener('change', event => {

  if (event.target.id === 'project-sort') { projectSort = event.target.value; localStorage.setItem('project-sort',projectSort); renderProjects(); }
  if (event.target.id === 'select-all') { current.papers.filter(paper => paper.current_version_id).forEach(paper => event.target.checked ? selected.add(paper.id) : selected.delete(paper.id)); saveSelection(); renderSelectionViews(); }
  if (event.target.dataset.paper) { event.target.checked ? selected.add(event.target.dataset.paper) : selected.delete(event.target.dataset.paper); saveSelection(); renderSelectionViews(); }
  if (event.target.id === 'settings-view') { projectView = event.target.value; localStorage.setItem('project-view',projectView); if(document.getElementById('project-grid'))renderProjects(); }
  if (event.target.id === 'settings-sort') { projectSort = event.target.value; localStorage.setItem('project-sort',projectSort); if(document.getElementById('project-sort')) document.getElementById('project-sort').value = projectSort; if(document.getElementById('project-grid'))renderProjects(); }
  if (event.target.id === 'version-select') {
    const next = event.target.value, previous = versionId, id = artifact?.id;
    Promise.resolve(window.MethodAtlasWriting?.flush()).then(() => {
      if (artifact?.id !== id) return;
      versionId = next; renderOutput();
    }).catch(error => { event.target.value = previous; syncSelectMenu(event.target); toast(error.message); });
  }
  if (event.target.id === 'pdf-page') { detail.page = Math.max(1,Math.min(detail.paper.page_count,Number(event.target.value) || 1)); renderDetail(); }
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'new-project-form') { event.preventDefault(); createProject(event.target); }
  if (event.target.id === 'chat-form') { event.preventDefault(); submit(); }
});
window.addEventListener('message', event => {
  const frame = document.getElementById('html-preview');
  if (frame?.dataset.context) return; // Graph previews use the version/nonce-bound bridge below.
  if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'methodatlas-citation') return;
  const version = artifact?.versions.find(v => v.id === versionId);
  const projectId = current?.id, artifactId = artifact?.id, selectedVersion = versionId;
  if (version?.citations.some(c => c.id === event.data.id && version.materials.some(m => m.paper_id === c.paper_id && m.paper_version_id === c.paper_version_id))) openCitation(event.data.id, () => frame.isConnected && document.getElementById('html-preview') === frame && current?.id === projectId && artifact?.id === artifactId && versionId === selectedVersion);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && historyOpen && !document.querySelector('dialog[open]')) { historyOpen = false; renderHistory(); document.querySelector('[data-action=history]')?.focus(); }
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); event.target.form?.requestSubmit();
  }
});

window.addEventListener('writing-ready', () => { if (current) renderOutput(); });
api('/api/state').then(data => { state = data; const saved = JSON.parse(localStorage.getItem('methodatlas-view') || 'null'); if (saved && data.projects.some(p => p.id === saved.projectId)) openProject(saved.projectId,saved.conversationId); else home(); }).catch(error => { document.getElementById('app').innerHTML = `<main class="home"><div class="home-content"><h1>MethodAtlas 后端未启动</h1><p class="summary-text">${esc(error.message)}<br>请按 README 启动 Python 服务后刷新。</p></div></main>`; });

window.addEventListener('message', event => {
  const frame=document.getElementById('html-preview');
  if(!frame || event.source!==frame.contentWindow || event.origin!=='null' || !frame.dataset.context)return;
  const context=JSON.parse(frame.dataset.context), data=event.data;
  if(!data || Object.entries(context).some(([key,value])=>data[key]!==value) || current?.id!==context.project_id || artifact?.id!==context.artifact_id || versionId!==context.version_id)return;
  const version=artifact.versions.find(v=>v.id===versionId);
  const valid=()=>document.getElementById('html-preview')===frame && current?.id===context.project_id && artifact?.id===context.artifact_id && versionId===context.version_id;
  if(data.type==='methodatlas-graph-paper' && version.materials.some(m=>m.paper_id===data.paper_id && m.paper_version_id===data.paper_version_id))showPaper(data.paper_id,null,data.paper_version_id,null,valid);
  if(data.type==='methodatlas-graph-citation'){const c=version.citations.find(c=>c.id===data.id);if(c)showPaper(c.paper_id,c.page,c.paper_version_id,c,valid);}
});
document.addEventListener('click', async event=>{
  const target=event.target.closest('[data-action=restore-graph]');if(!target || target.disabled)return;
  const project=current.id, id=artifact.id, version=versionId, base=artifact.versions.at(-1).id;target.disabled=true;
  try {const result=await api(`/api/projects/${project}/artifacts/${id}/restore`,{method:'POST',body:JSON.stringify({version_id:version,base_version_id:base})});if(current?.id===project && artifact?.id===id && versionId===version)await loadArtifact(id,result.version_id);}
  catch(error){toast(error.message);}finally{if(target.isConnected)target.disabled=false;}
});

window.addEventListener('methodatlas-open-reference', event => {
  const ref=event.detail;
  if(current?.papers.some(p=>p.id===ref?.paper_id))showPaper(ref.paper_id,1,ref.paper_version_id);
});
