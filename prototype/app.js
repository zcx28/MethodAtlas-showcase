const paths = {
  home:'M3 10 12 3l9 7 M5 9v12h5v-7h4v7h5V9',
  sidebarLeft:'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M9 4v16',
  sidebarRight:'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M15 4v16 M18 9v6',
  settings:'M21 12l-4.5 7.8h-9L3 12l4.5-7.8h9z M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7',
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
  minus:'M5 12h14', sort:'M4 6h16 M4 12h10 M4 18h4',
  label:'M12 3h7l3 7-10 11L3 12z M17 7h.01',
  globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  pin:'M9 3h6 M10 3v6l-3 4v2h10v-2l-3-4V3 M12 15v6',
  brain:'M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 3 10a4 4 0 0 0 1 7.5A4 4 0 0 0 12 18a4 4 0 0 0 8-.5 4 4 0 0 0 1-7.5 4 4 0 0 0-3.2-6A3 3 0 0 0 12 5 M7 8c0 2 1 3 3 3 M17 8c0 2-1 3-3 3 M7 16c0-2 1-3 3-3 M17 16c0-2-1-3-3-3',
  terminal:'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z m2 4 4 4-4 4 M14 16h3',
  archive:'M4 3h16v5H4z M5 8v12h14V8 M9 12h6',
  alert:'M12 8v5 M12 16h.01 M10.3 3.8 2.4 17.5A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.5L13.7 3.8a2 2 0 0 0-3.4 0',
  previous:'m15 5-7 7 7 7',
  translate:'M3 5h12 M9 3v2 M12 5c-1 6-4 9-9 12 M5 9c2 4 5 6 8 8 M14 21l4-10 4 10 M15.5 17h5',
  highlight:'m9 11 7-8 5 5-8 7z M9 11l-3 6 2 2 5-4 M3 21h7',
  crop:'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8z',
  columns:'M3 4h18v16H3z M9 4v16 M15 4v16',
  image:'M3 4h18v16H3z M3 16l5-5 4 4 3-3 6 6 M16 8h.01'
};
// The stop glyph is a solid rounded square, so it carries its own fill instead of the shared stroke styling.
const solidIcons = new Set(['stop']);
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"${solidIcons.has(name) ? ' fill="currentColor" stroke="none"' : ''}></path></svg>`;
// Layered shortcut glyphs keep motion local to the research launcher.
const researchIcon = key => {
  const glyphs = {
    'lit-review': '<path d="M14 2H5v20h14V7l-5-5v6h5"/><g class="shortcut-ink"><path d="M8 12h8"/><path d="M8 16h6"/><path d="M8 19h4"/></g>',
    map: '<path d="M12 3v18M8 21h8"/><g class="shortcut-balance"><path d="m3 7 18-2M5 7l-3 7h6L5 7zm14-2-3 7h6l-3-7zM2 14c0 4 6 4 6 0m8-2c0 4 6 4 6 0"/></g>',
    evolution: '<path d="m11 8-5 8m7-8 5 8"/><g class="shortcut-nodes"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/></g>',
    graph: '<path class="shortcut-link" pathLength="24" d="M12 8v5m0 0-7 4m7-4 7 4"/><g class="shortcut-nodes"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/></g>',
    'experiment-plan': '<path d="M9 2h6M10 2v8L4 20q0 2 2 2h12q2 0 2-2l-6-10V2M7 16h10"/><g class="shortcut-bubbles"><circle cx="10" cy="18" r=".7"/><circle cx="14" cy="19" r=".7"/></g>',
    'result-to-claim': '<g class="shortcut-bars"><path d="M3 14h4v7H3z"/><path d="M10 9h4v12h-4z"/><path d="M17 3h4v18h-4z"/></g>',
    skills: '<circle class="shortcut-head" cx="12" cy="6" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2H4z"/><path class="shortcut-spark" d="M20 3v4m-2-2h4"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${glyphs[key]}</svg>`;
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = () => `browser-${crypto.randomUUID()}`;
window.MethodAtlasTextInput = (title, label, value = '') => new Promise(resolve => {
  const dialog = document.createElement('dialog'), heading = uid();
  dialog.className = 'compact-dialog';
  dialog.setAttribute('aria-labelledby', heading);
  dialog.innerHTML = `<form method="dialog"><header class="modal-head"><h2 id="${heading}">${esc(title)}</h2></header><div class="modal-body"><label class="dialog-field">${esc(label)}<input type="text" autofocus></label></div><footer class="modal-foot"><button value="cancel">取消</button><button class="primary" value="save">保存</button></footer></form>`;
  const input = dialog.querySelector('input');
  input.value = value;
  // Enter submits the input, while Escape and Cancel leave the original value untouched.
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    dialog.close(event.submitter?.value === 'cancel' ? 'cancel' : 'save');
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); dialog.close('save'); }
  });
  dialog.addEventListener('close', () => {
    const result = dialog.returnValue === 'save' ? input.value : null;
    dialog.remove(); resolve(result);
  }, {once:true});
  document.body.append(dialog); dialog.showModal(); input.select();
});
let pollFailures = 0, connectionWarning = '';
let state = null, current = null, conversation = null, selected = new Set(), artifact = null, detail = null, pollTimer = null, pending = false, viewGeneration = 0, activeTaskId = null;
// Keep existing offline records intact; authenticated users get a separate namespace.
window.MethodAtlasStorage = Object.fromEntries(['local','session'].map(kind => {
  const native = kind === 'local' ? window.localStorage : window.sessionStorage;
  const key = value => state?.collaboration ? `account:${state.user.id}:${value}` : value;
  return [kind, {getItem: value => native.getItem(key(value)), setItem: (value, data) => native.setItem(key(value),data), removeItem: value => native.removeItem(key(value))}];
}));
let versionId = null, paperRequest = 0, artifactRequest = 0, liveTask = null;
const autoLocatedTasks = new Set();
const draftEdits = new Map();
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
  {key:'remote', label:'远程实验', icon:'monitor'}
];
let shellView = 'chat';
let personalSkills = [];
let projectView = (globalThis.MethodAtlasStorage?.local || localStorage).getItem('project-view') === 'list' ? 'list' : 'grid';
let projectSort = (globalThis.MethodAtlasStorage?.local || localStorage).getItem('project-sort') === 'name' ? 'name' : 'recent';
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
function citationLink(c, className = 'evidence-link', number = null) {
  const location = c.rect === null ? '文字材料' : `第 ${c.page} 页`;
  return `<button class="${className}${number === null ? '' : ' citation-number'}" ${number === null ? '' : `aria-label="引用 ${number}：${esc(c.title)}"`} title="${esc(c.title)} · ${location}" ${c.id ? `data-action="citation" aria-haspopup="dialog" data-id="${esc(c.id)}"` : `data-action="legacy-citation" data-id="${esc(c.paper_id)}" data-version="${esc(c.paper_version_id)}" data-page="${Number(c.page)}" data-quote="${esc(c.quote)}"`}>${number === null ? `<span class="citation-title">${esc(shortTitle(c.title))}</span><span class="citation-location"> · ${location} ↗</span>` : number}</button>`;
}
const citationButton = c => citationLink(c);
const disclosure = (key, defaultOpen = false) => `data-disclosure="${esc(key)}" ${(disclosureState.get(key) ?? defaultOpen) ? 'open' : ''}`;

function eventText(event) {
  const statuses = {queued:'请求已保存', harness:'正在准备任务', model:'正在处理请求', succeeded:'本轮任务已完成'};
  const names = {read_material:'读取材料', locate:'定位原文', set_scope:'确认材料范围', list_materials:'查看材料目录', read_file:'读取成果', write_file:'保存文件', list_files:'查看已有成果', research_paper:'分篇研究', verify_claims:'核对结论', search_papers:'论文调研', read_figure:'读取原图', list_figures:'查找图表', save_context:'保存研究交接', read_evidence:'回读依据', read_history:'回看对话', revise_paper_card:'修正研究卡', list_paper_cards:'查看研究卡', update_plan:'更新计划'};
  return statuses[event.status] || String(event.message || '').replace(/update_plan|read_material|list_materials|set_scope|list_files|read_file|write_file|locate|research_paper|verify_claims|search_papers|read_figure|list_figures|save_context|read_evidence|read_history|revise_paper_card|list_paper_cards/g, name => names[name]);
}
// One visible line per tool call: pair the 开始/完成 messages instead of replaying every raw event.
const toolBase = text => String(text).replace(/^(正在|已)/,'').replace(/，未成功$/,'').replace(/ · 第 [^·]*$/,'').trim();
const toolIcon = text => /搜索|检索|论文调研|查找/.test(text) ? 'search' : /保存|写入|归档/.test(text) ? 'archive' : /计划|思考|分析/.test(text) ? 'brain' : /阅读|读取|定位|回读|回看|图/.test(text) ? 'file' : /生成|整理|撰写/.test(text) ? 'edit' : 'terminal';
function toolActions(events) {
  const actions = [], latest = new Map();
  for (const [index,event] of events.entries()) {
    const text = eventText(event);
    const base = {id:`event:${event.seq ?? index}`,stepId:event.step_id,text};
    if (event.status === 'search_progress' && /^(正在并行检索论文摘要|论文检索已进行)/.test(text)) {
      const search = actions.findLast(action => action.state === 'running' && action.stepId === event.step_id && toolIcon(action.text) === 'search');
      if (search) search.detail = text;
      continue;
    }
    if (['queued','succeeded','failed','interrupted','stopped'].includes(event.status)) latest.clear();
    if (!['tool_start','tool_done','tool_failed'].includes(event.status)) { actions.push({...base, state:'note'}); continue; }
    const key = `${event.step_id || ''}:${toolBase(text)}`;
    let runningAction = latest.get(key);
    // MCP calls are serialized by ProjectTools.worker_lock. Result labels may change completely
    // (recommendations, subscriptions, file titles); only pair an unambiguous open call.
    if (event.status !== 'tool_start' && runningAction?.state !== 'running') {
      const open = [...latest.values()].filter(action => action.state === 'running' && action.stepId === event.step_id);
      if (open.length === 1) runningAction = open[0];
    }
    if (event.status !== 'tool_start' && runningAction?.state === 'running') {
      runningAction.state = event.status === 'tool_failed' ? 'failed' : 'done';
      runningAction.text = text;
      delete runningAction.detail;
      continue;
    }
    const action = {...base, state: event.status === 'tool_failed' ? 'failed' : event.status === 'tool_done' ? 'done' : 'running'};
    latest.set(key, action); actions.push(action);
  }
  return actions;
}

function renderProgress(task, running = false) {
  if (!task) return running ? `<div class="task-wait" role="status">${icon('brain')}请求已提交…</div>` : '';
  const plan = (task.plan || []).filter(step => step && typeof step.id === 'string' && typeof step.title === 'string');
  const events = task.events || [], actions = toolActions(events.filter(e => e.status !== 'plan'));
  const rows = [], inserted = new Set();
  const addThought = step => {
    if (!step || inserted.has(step.id)) return;
    inserted.add(step.id);
    rows.push({id:`thought:${step.id}`,kind:'thought',text:step.title,detail:step.summary,
      state:step.status === 'completed' ? 'done' : step.status === 'in_progress' ? (running ? 'running' : 'interrupted') : 'pending'});
  };
  // Old tasks only retain the latest plan: anchor its summary at the first related action,
  // preserving tool order without inventing timestamps or private reasoning text.
  for (const action of actions) {
    addThought(plan.find(step => step.id === action.stepId));
    if (!['请求已保存','正在准备任务','正在处理请求','本轮任务已完成'].includes(action.text)) rows.push({...action,kind:'tool',state:!running && action.state === 'running' ? 'interrupted' : action.state});
  }
  plan.forEach(addThought);
  if (!running && !rows.length) return '';
  const last = events.at(-1), active = plan.find(step => step.status === 'in_progress');
  const currentText = last && ['tool_start','connection_retry','tool_failed'].includes(last.status) ? eventText(last) : active?.title || '正在处理请求';
  const statusText = running ? currentText : ({failed:'执行未完成',interrupted:'执行已中断',stopped:'执行已停止',waiting:'等待你的回复'}[task.status] || '思考过程');
  const statusIcon = running ? (last?.status === 'tool_start' ? toolIcon(currentText) : last?.status === 'tool_failed' ? 'alert' : 'brain') : ['failed','interrupted'].includes(task.status) ? 'alert' : 'brain';
  const labels = {running:'进行中',done:'已完成',failed:'未成功',interrupted:'未完成',pending:'待开始',note:'记录'};
  const contents = `<ol class="process-timeline" aria-label="思考与执行记录">${rows.map(row => `<li class="process-row" data-process-row="${esc(`${task.id}:${row.id}`)}" data-kind="${row.kind}" data-state="${row.state}">${icon(row.state === 'failed' ? 'alert' : row.kind === 'thought' ? 'brain' : toolIcon(row.text))}<div class="process-copy"><div class="process-title"><span class="sr-only">${row.kind === 'thought' ? '思考摘要' : '执行'} · </span>${esc(row.text)}${['pending','interrupted','failed'].includes(row.state) ? `<span class="process-state">${labels[row.state]}</span>` : `<span class="sr-only"> · ${labels[row.state]}</span>`}</div>${row.detail ? `<p class="process-detail">${esc(row.detail)}</p>` : ''}</div></li>`).join('')}</ol>`;
  const usage = task.refs?.usage || [];
  const sum = key => usage.reduce((n, u) => n + (u[key] || 0), 0);
  const tokenInfo = usage.length ? `<p class="tool-count">模型调用 ${sum('calls')} 次 · 非缓存输入 ${sum('inputTokens').toLocaleString()} · 缓存输入 ${sum('cacheReadTokens').toLocaleString()} · 输出 ${sum('outputTokens').toLocaleString()}（其中推理 ${sum('reasoningTokens').toLocaleString()}） · 压缩 ${usage.filter(u => u.role === 'compaction').reduce((n,u) => n + (u.calls || 0), 0)} 次</p>` : '';
  return `<details class="execution-record" data-running="${running}" ${disclosure(`${task.id}:progress`)}><summary><span class="process-indicator" data-motion="${running ? statusIcon : 'idle'}">${icon(statusIcon)}</span><span class="process-current" ${running ? 'role="status"' : ''}>${esc(statusText)}</span><span class="process-chevron">${icon('chevron')}</span></summary>${contents}${tokenInfo}</details>`;
}
function saveSelection() { (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`focus:${current.id}`, JSON.stringify([...selected])); }

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
    if (response.status === 401 && !path.startsWith('/api/auth/')) window.MethodAtlasCollaboration?.expired();
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


function invalidateView() {
  hideTextSelection();
  closeSelectionTranslate();
  document.getElementById('source-menu')?.hidePopover();
  document.getElementById('skill-workbench')?.hidePopover();
  clearTimeout(pollTimer); pollTimer = null; pollFailures = 0; connectionWarning = ''; viewGeneration += 1; activeTaskId = null; pending = false; liveTask = null; autoLocatedTasks.clear(); historyOpen = false; paperRequest++; artifactRequest++;
}

function isCurrentView(generation, projectId, conversationId, taskId = null) {
  return generation === viewGeneration && current?.id === projectId && conversation?.id === conversationId && (!taskId || activeTaskId === taskId);
}

function serverConversationId(){return conversation.local?conversation.context_conversation_id:conversation.id;}

// Project sort keeps a real select for state and keyboard-free tooling, but shows an app-styled menu instead of the native popup.
const sortLabels = {recent:'最近', name:'名称'};
const sortControl = () => `<div class="sort-field"><select id="project-sort" class="project-sort" aria-label="项目排序" tabindex="-1">${Object.entries(sortLabels).map(([value,label]) => `<option value="${value}" ${projectSort === value ? 'selected' : ''}>${label}</option>`).join('')}</select><details class="sort-menu"><summary class="sort-display">${sortLabels[projectSort]}${icon('chevron')}</summary><div class="sort-options" role="listbox" aria-label="项目排序">${Object.entries(sortLabels).map(([value,label]) => `<button type="button" role="option" aria-selected="${projectSort === value}" data-sort="${value}">${label}${projectSort === value ? icon('check') : ''}</button>`).join('')}</div></details></div>`;

async function home(revoked = false) {
  window.MethodAtlasAI?.suspend();
  if (!revoked) try { await window.MethodAtlasWriting?.flush(); } catch (error) { toast(error.message); return; }
  saveWorkspaceState();
  window.MethodAtlasWriting?.unmount();
  remoteOutputOpen = false; viewPanels.clear(); middlePanels.clear(); middleItems.clear(); middleRequest++; workspaceProject = null;
  // 返回项目列表同样算离开笔记视图：先把未保存的改动写下去（见 skills.js 的自动保存）。
  window.MethodAtlasSkills?.flushPending?.();
  invalidateView();
  const generation = viewGeneration;
  current = conversation = artifact = detail = null; pending = false;
  (globalThis.MethodAtlasStorage?.local || localStorage).removeItem('methodatlas-view');
  document.title = 'MethodAtlas · 我的项目';
  document.getElementById('app').innerHTML = `<main class="home"><nav class="shell-nav home-nav" aria-label="应用导航">${globalNav(true)}<button data-action="new-project" aria-label="新建项目" title="新建项目">${icon('plus')}</button><div class="shell-nav-bottom"><button data-action="settings" aria-label="设置" title="设置">${icon('settings')}</button></div></nav>
    <header class="app-header"><div class="brand"><span class="brandmark" aria-hidden="true"><img src="assets/methodatlas-mark.png?v=poster-20261013" alt=""></span><span class="brand-name">MethodAtlas</span></div><div class="home-header-meta">${window.MethodAtlasCollaboration?.header() || '<span class="avatar" aria-label="本机用户">M</span>'}</div></header>
    <div class="home-content"><div class="toolbar"><div class="toolbar-left">${window.MethodAtlasSearch?.compact('project') || ''}</div>
      <div class="toolbar-right"><div class="view-toggle" role="group" aria-label="项目视图" data-view="${projectView}"><span class="view-thumb" aria-hidden="true"></span><button data-action="view" data-value="grid" aria-label="网格视图" aria-pressed="${projectView === 'grid'}">${icon('grid')}</button><button data-action="view" data-value="list" aria-label="列表视图" aria-pressed="${projectView === 'list'}">${icon('list')}</button></div>${sortControl()}<button class="primary" data-action="new-project">${icon('plus')}新建</button></div></div>
      <div class="collection-head"><h1><span id="collection-title">最近打开过的项目</span> <span class="collection-count" id="project-count"></span></h1></div><div class="projects" id="project-grid"></div>
    </div></main>`;
  renderProjects();
  try {
    const latest = await api('/api/state?summary=1');
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
  const query = (window.MethodAtlasSearch?.listQuery('project') || '').trim().toLowerCase();
  const workspaceId = window.MethodAtlasCollaboration?.selectedWorkspace();
  const projects = state.projects.filter(project => (!workspaceId || project.workspace_id === workspaceId) && project.name.toLowerCase().includes(query));
  const openedAt = project => Number((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`opened:${project.id}`)) || Date.parse(project.created);
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
  grid.innerHTML = projects.map(project => `<button class="project-card nb-card" data-action="open-project" data-id="${esc(project.id)}"><span class="nb-card-top"><span class="nb-thumb">${icon('book')}</span></span><span class="nb-card-body"><h2>${esc(project.name)}</h2><small>${esc(new Date(project.updated).toLocaleDateString('zh-CN').replaceAll('/','.'))} 更新 · ${(project.paper_count ?? project.papers?.length ?? 0)} 个来源</small></span></button>`).join('') + `<button class="project-card nb-new" data-action="new-project"><span class="plus-circle">${icon('plus')}</span><span>新建项目</span></button>` + (projects.length ? '' : `<p class="no-project" role="status">${query ? '没有找到匹配的项目。' : '点击「新建」开始第一个研究主题。'}</p>`);
}

async function openProject(id, conversationId = null) {
  const sameProject = current?.id === id && Boolean(document.querySelector('.workspace'));
  if(sameProject && conversationId && window.MethodAtlasAI?.isOpen())return window.MethodAtlasAI.select(conversationId).catch(error=>toast(error.message));
  if (!sameProject) {
    window.MethodAtlasAI?.suspend();
    try { await window.MethodAtlasWriting?.flush(); } catch (error) { toast(error.message); return; }
    saveWorkspaceState();
  }
  invalidateView();
  const generation = viewGeneration, projectId = id;
  try {
    const loaded = await api(`/api/projects/${encodeURIComponent(projectId)}?compact=1${conversationId ? '&conversation='+encodeURIComponent(conversationId) : ''}`);
    personalSkills = await api('/api/skills');
    if (generation !== viewGeneration) return;
    current = loaded;
    window.MethodAtlasSettings?.reload();
    conversation = current.conversations.find(c => c.id === conversationId) || current.conversations[0] || null;
    if (!conversation) conversation = await newConversation(true);
    if (generation !== viewGeneration || current?.id !== projectId || !conversation) return;
    conversation.messages.map(m => m.task).filter(t => t?.tools.some(tool => tool.name === 'locate' && tool.status === 'succeeded')).forEach(t => autoLocatedTasks.add(t.id));
    const saved = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`focus:${id}`) || 'null');
    selected = new Set((saved || current.papers.filter(p => p.selected && p.current_version_id).map(p => p.id)).filter(pid => current.papers.some(p => p.id === pid && p.current_version_id)));
    let workspace = null;
    if (!sameProject) {
      try { workspace = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`workspace:${id}`) || 'null'); } catch {}
      artifact = detail = null; versionId = null; shellView = 'chat';
    }
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`opened:${id}`,String(Date.now()));
    document.title = `MethodAtlas · ${current.name}`; renderWorkspace();
    if (workspace) {
      if (workspace.view !== 'chat') switchShellView(workspace.view);
      if (workspace.middle && workspace.middle !== 'chat' && workspace.middleItem) Promise.resolve(shellModules()[workspace.middle]?.open?.(workspace.middleItem)).catch(error=>toast(error.message));
      if (workspace.artifact && current.artifacts.some(item => item.id === workspace.artifact)) await loadArtifact(workspace.artifact,workspace.version,false);
      if (workspace.view === 'library' && workspace.paper && current.papers.some(item => item.id === workspace.paper)) await showPaper(workspace.paper,workspace.page || 1,workspace.paperVersion);
    }
    await window.MethodAtlasAI?.restore();
    const running = projectRunningTask();
    if (state?.collaboration || running || current.papers.some(p => p.availability?.fulltext === 'pending')) { activeTaskId = running?.id; refreshTask(running?.id, generation, projectId, conversation.id).catch(e => toast(e.message)); }
  } catch (error) {
    if (generation !== viewGeneration) return;
    if (current?.id === projectId && conversation) renderWorkspace();
    else if (current?.id === projectId) home();
    toast(error.message);
  }
}

const conversationRequests = new Map();
async function newConversation(silent = false, visibility = 'shared') {
  if (!current?.id) return null;
  if (!silent) invalidateView();
  const generation = viewGeneration, projectId = current.id;
  const requestKey = `${projectId}:${visibility}`;
  const request = conversationRequests.get(requestKey) || api(`/api/projects/${projectId}/conversations`, {method:'POST', body:JSON.stringify({visibility})});
  conversationRequests.set(requestKey,request);
  try {
    const result = await request;
    if (generation !== viewGeneration || current?.id !== projectId) return null;
    const created = current.conversations.find(item=>item.id===result.conversation_id) || {id:result.conversation_id, title:'新对话', visibility:result.visibility || 'shared', owner_id:result.owner_id, messages:[], reads:[]};
    if(!current.conversations.includes(created))current.conversations.unshift(created);
    if (!silent) {
      if(window.MethodAtlasAI?.isOpen()){await window.MethodAtlasAI.select(created.id);return created;}
      conversation = created; renderWorkspace(); refreshTask(null,generation,projectId,created.id).catch(error => toast(error.message));
    }
    return created;
  } catch (error) {
    if (silent) throw error;
    if (generation === viewGeneration) { renderWorkspace(); toast(error.message); }
    return null;
  } finally {if(conversationRequests.get(requestKey)===request)conversationRequests.delete(requestKey);}
}

// Queued messages: while a task is busy the composer queues instead of interrupting, and the queue self-dispatches when the conversation goes idle.
const queueKey = () => `queue:${conversation?.id || ''}`;
function loadQueue() {
  try { messageQueue = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(queueKey()) || '[]'); } catch { messageQueue = []; }
  if (!Array.isArray(messageQueue)) messageQueue = [];
  messageQueue = messageQueue.filter(item => !conversation.messages.some(message => message.client_message_id === item.id));
  // An unacknowledged attempt is recovered for explicit retry, never replayed on reload.
  messageQueue.forEach(item => { if (item.sending && !queueDispatch) {item.sending=false;item.failed=true;} });
  saveQueue();
  queueEditing = null;
}
function saveQueue() { (globalThis.MethodAtlasStorage?.local || localStorage).setItem(queueKey(),JSON.stringify(messageQueue)); }
function updateQueued(conversationId, id, change) {
  const same = conversation?.id === conversationId;
  const items = same ? messageQueue : JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`queue:${conversationId}`) || '[]');
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return;
  if (change === null) items.splice(index, 1); else Object.assign(items[index], change);
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`queue:${conversationId}`, JSON.stringify(items));
  if (same) renderChat();
}
const waitingTask = () => conversation.messages.some(message => message.role === 'user' && message.task?.status === 'waiting');
// A task awaiting confirmation is still busy: the queue waits for the user just like the agent does.
const busyTask = () => pending || conversation.messages.some(message => message.role === 'user' && message.task && (!finished(message.task.status) || message.task.status === 'waiting'));
function queuePanel() {
  if (!conversation || !messageQueue.length) return '';
  const items = messageQueue.map((item, index) => `<li class="queue-item" data-queue="${esc(item.id)}" draggable="true">${queueEditing === item.id
    ? `<span class="queue-handle" aria-hidden="true">${icon('handle')}</span><form class="queue-edit" data-queue-form="${esc(item.id)}"><textarea aria-label="编辑排队消息" rows="2">${esc(item.text)}</textarea><button type="button" data-queue-action="save" aria-label="保存排队消息">${icon('check')}</button><button type="button" data-queue-action="cancel" aria-label="取消编辑">${icon('close')}</button></form>`
    : `<span class="queue-handle" aria-hidden="true">${icon('handle')}</span><span class="queue-text">${esc(item.text)}${item.fragments?.length ? `<small>${item.fragments.length} 个已选文本片段</small>` : ''}</span><span class="queue-actions">${item.sending?'<small>发送中…</small>':item.failed?'<button type="button" data-queue-action="retry">重试</button>':''}<button type="button" data-queue-action="up" aria-label="上移排队消息" title="上移" ${index ? '' : 'disabled'}>${icon('arrow')}</button><button type="button" data-queue-action="edit" aria-label="编辑排队消息" title="编辑">${icon('edit')}</button><button type="button" data-queue-action="drop" aria-label="删除排队消息" title="删除">${icon('trash')}</button></span>`}</li>`).join('');
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
  (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`draft:${conversation.id}`);
  renderChat(true);
  toast('已加入排队，当前任务结束后自动发送。');
}
async function pumpQueue() {
  if (queueDispatch || !messageQueue.length || messageQueue[0].failed || !conversation || busyTask()) return;
  queueDispatch = true;
  const next = messageQueue[0], conversationId = conversation.id;
  try {
    updateQueued(conversationId, next.id, {sending:true,failed:true});
    const sent=await dispatchMessage(next.text, next.fragments || [], true, next.settings, next);
    updateQueued(conversationId, next.id, sent===true ? null : {sending:false,failed:true});
  } catch(error) {
    updateQueued(conversationId, next.id, {sending:false,failed:true});
    toast(error.message);
  } finally { queueDispatch = false; }
  if (conversation?.id === conversationId) pumpQueue();
}

function globalNav(homePage = false) {
  return `<button data-action="home" aria-label="项目首页" title="项目首页"${homePage ? ' class="active" aria-current="page"' : ''}>${icon('home')}</button>`;
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
  const extent = String(vertical ? hostRect.height : hostRect.width);
  const resized = indicator.dataset.extent !== extent;
  indicator.getAnimations().forEach(animation => animation.cancel());
  indicator.style.transform = next;
  indicator.dataset.ready = 'true';
  indicator.dataset.extent = extent;
  if (!wasReady || resized || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
    : [...select.options].map(option => `<button type="button" data-select-option="${esc(option.value)}" ${option.disabled ? 'disabled' : ''} aria-selected="${option.selected}">${esc(option.textContent.trim())}</button>`).join('');
  if (list && ['weekly_day','monthly_day'].includes(select.name)) {
    list.classList.add('recurring-picker');
    list.classList.toggle('recurring-week',select.name === 'weekly_day');
    list.insertAdjacentHTML('afterbegin',`<strong class="recurring-heading">${select.name === 'weekly_day' ? '每周' : '每月'}</strong>`);
  }
}

function positionSelectMenu(menu) {
  const list = menu.querySelector('.select-options'), rect = menu.querySelector('summary').getBoundingClientRect();
  const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
  const upwards = below < Math.min(list.scrollHeight, 280) && above > below;
  Object.assign(list.style, {minWidth:rect.width+'px', maxHeight:Math.max(0,Math.min(280,upwards ? above : below))+'px'});
  const size = list.getBoundingClientRect();
  list.style.left = Math.max(8,Math.min(rect.left,innerWidth-size.width-8))+'px';
  list.style.top = (upwards ? rect.top-size.height-4 : rect.bottom+4)+'px';
}
window.addEventListener('resize', () => document.querySelectorAll('.select-menu[open]').forEach(positionSelectMenu));

function enhanceSelects(root) {
  const scope = root || document;
  const found = scope instanceof HTMLSelectElement
    ? (scope.dataset.enhanced ? [] : [scope])
    : [...(scope.querySelectorAll?.('select:not([data-enhanced])') || [])];
  for (const select of found) {
    if (select.closest('.sort-field')) continue; // The project sort control already carries its own menu.
    select.dataset.enhanced = '1';
    select.tabIndex = -1;
    select.setAttribute('aria-hidden','true');
    const box = document.createElement('span');
    box.className = 'select-box';
    select.before(box);
    box.append(select);
    const menu = document.createElement('details');
    menu.className = 'select-menu';
    menu.innerHTML = `<summary class="select-display"><span class="select-value"></span>${icon('chevron')}</summary><div class="select-options" popover="auto"></div>`;
    box.append(menu);
    const trigger = menu.querySelector('summary');
    trigger.setAttribute('aria-label',select.getAttribute('aria-label') || select.closest('label')?.textContent.trim() || '选择选项');
    trigger.setAttribute('aria-disabled',String(select.disabled));
    if (select.disabled) trigger.tabIndex = -1;
    syncSelectMenu(select);
    select.addEventListener('change', () => syncSelectMenu(select));
    const list = menu.querySelector('.select-options');
    menu.addEventListener('keydown',event => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.preventDefault(); event.stopPropagation();
      menu.open = false; list.hidePopover(); trigger.focus({preventScroll:true});
    });
    list.addEventListener('beforetoggle', event => { if (event.newState === 'closed') menu.open = false; });
    menu.addEventListener('toggle', () => {
      if (!menu.open) { list.hidePopover(); return; }
      syncSelectMenu(select);
      list.showPopover();
      requestAnimationFrame(() => {
        if (!menu.open) return;
        positionSelectMenu(menu);
        const selected = list.querySelector('[aria-selected=true]');
        if (selected) list.scrollTop = selected.offsetTop;
      });
    });
    menu.addEventListener('click', event => {
      if (select.disabled) { event.preventDefault(); return; }
      const option = event.target.closest('[data-select-option]');
      if (!option || option.disabled) return;
      menu.open = false;
      trigger.focus({preventScroll:true});
      if (select.value === option.dataset.selectOption) return;
      select.value = option.dataset.selectOption;
      select.dispatchEvent(new Event('change', {bubbles:true}));
    });
  }
}

// Preserve native values, constraints and form submission; the visible picker uses the diary's UI.
const temporalSelector = 'input:is([type=date],[type=time],[type=datetime-local],[type=month]):not([data-temporal])';
let temporalId = 0;
const temporalFields = new Set();
window.addEventListener('resize',() => temporalFields.forEach(field => field.position()));
window.addEventListener('scroll',event => temporalFields.forEach(field => field.scroll(event)),true);
const temporalPad = value => String(value).padStart(2,'0');
function temporalDate(date) {
  return `${String(date.getFullYear()).padStart(4,'0')}-${temporalPad(date.getMonth()+1)}-${temporalPad(date.getDate())}`;
}
function temporalLocal(value) {
  const [year,month,day] = value.slice(0,10).split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year,month-1,day || 1);
  date.setHours(12,0,0,0);
  return date;
}
function enhanceDateTimes(root) {
  const inputs = root.matches?.(temporalSelector) ? [root] : [...(root.querySelectorAll?.(temporalSelector) || [])];
  for (const input of inputs) {
    input.dataset.temporal = '1';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden','true');
    const type = input.type, hasDate = type !== 'time', hasTime = type === 'time' || type === 'datetime-local';
    const label = input.getAttribute('aria-label') || [...(input.labels || [])].map(l => [...l.childNodes].filter(n => n.nodeType === 3 || !n.matches?.('input,small')).map(n => n.textContent).join('').trim()).join(' ') || '选择时间';
    const box = document.createElement('span');
    box.className = `temporal-box temporal-${type}`;
    input.before(box);
    box.append(input);
    box.insertAdjacentHTML('beforeend',`<button type="button" class="temporal-display" aria-label="${esc(label)}" aria-haspopup="dialog" aria-expanded="false" aria-controls="temporal-${++temporalId}" aria-describedby="temporal-value-${temporalId}"><span id="temporal-value-${temporalId}"></span>${icon('chevron')}</button><span class="temporal-panel" id="temporal-${temporalId}" popover="auto" role="dialog" aria-label="${esc(label)}"></span>`);
    const trigger = box.querySelector('button'), panel = box.querySelector('.temporal-panel');
    let draft, view, cursor;
    const valid = value => { const probe = input.cloneNode(); probe.value = value; return probe.validity.valid; };
    const display = value => {
      if (!value) return type === 'time' ? '选择时间' : type === 'month' ? '选择月份' : type === 'date' ? '选择日期' : '选择日期和时间';
      if (type === 'time') return value;
      const [year,month,day] = value.slice(0,10).split('-');
      return `${year}年${Number(month)}月${day ? Number(day)+'日' : ''}${hasTime ? ' '+value.slice(11) : ''}`;
    };
    const sync = () => {
      trigger.querySelector('span').textContent = display(input.value);
      trigger.classList.toggle('is-empty',!input.value);
      trigger.disabled = input.disabled || input.readOnly;
      trigger.setAttribute('aria-required',String(input.required));
      if (trigger.disabled && panel.matches(':popover-open')) panel.hidePopover();
    };
    const position = () => {
      if (!panel.matches(':popover-open')) return;
      const rect = trigger.getBoundingClientRect();
      const below = innerHeight-rect.bottom-8, above = rect.top-8;
      const up = below < Math.min(panel.scrollHeight,440) && above > below;
      panel.style.maxHeight = Math.max(80,up ? above : below)+'px';
      const size = panel.getBoundingClientRect();
      panel.style.left = Math.max(8,Math.min(rect.left,innerWidth-size.width-8))+'px';
      panel.style.top = Math.max(8,up ? rect.top-size.height-4 : rect.bottom+4)+'px';
    };
    const close = () => { panel.hidePopover(); trigger.focus({preventScroll:true}); };
    const commit = value => {
      if (!valid(value)) return;
      input.value = value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      trigger.removeAttribute('aria-invalid');
      sync(); close();
    };
    const datePart = () => draft.slice(0,type === 'month' ? 7 : 10);
    const timePart = () => type === 'time' ? draft : draft.slice(11);
    const chooseDate = value => {
      draft = value + (hasTime ? 'T'+timePart() : '');
      cursor = temporalLocal(value);
      if (hasTime) {
        view = 'hours'; render();
        (panel.querySelector('[aria-current=true]:not(:disabled)') || panel.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
      } else commit(draft);
    };
    const button = (text,attrs = '',selected = false,disabled = false) => `<button type="button" ${attrs} ${selected ? 'aria-current="true"' : ''} ${disabled ? 'disabled' : ''}>${text}</button>`;
    const dayAllowed = value => {
      if (!hasTime) return valid(value);
      // A partial first/last day still offers every valid time within that day.
      return (!input.min || value >= input.min.slice(0,10)) && (!input.max || value <= input.max.slice(0,10));
    };
    const render = () => {
      const year = cursor.getFullYear(), month = cursor.getMonth();
      let content = '';
      if (['days','months','years'].includes(view)) {
        const decade = Math.floor(year/12)*12;
        const heading = view === 'days' ? `${year}年${month+1}月` : view === 'months' ? `${year}年` : `${decade}–${decade+11}`;
        content = `<span class="temporal-head">${button(icon('previous'),'data-shift="-1" aria-label="上一'+(view === 'days' ? '月' : view === 'months' ? '年' : '组年份')+'"')}<button type="button" data-view="${view === 'days' ? 'months' : 'years'}" class="temporal-heading">${heading}</button>${button(icon('chevron'),'data-shift="1" aria-label="下一'+(view === 'days' ? '月' : view === 'months' ? '年' : '组年份')+'"')}</span>`;
        if (view === 'years') content += `<span class="temporal-grid temporal-months">${Array.from({length:12},(_,i)=>button(decade+i+'年',`data-year="${decade+i}"`,decade+i === Number(datePart().slice(0,4)),decade+i<1 || decade+i>9999)).join('')}</span>`;
        else if (view === 'months') content += `<span class="temporal-grid temporal-months">${Array.from({length:12},(_,i)=>button(i+1+'月',`data-month="${i}"`,`${String(year).padStart(4,'0')}-${temporalPad(i+1)}` === datePart().slice(0,7),type === 'month' && !valid(`${String(year).padStart(4,'0')}-${temporalPad(i+1)}`))).join('')}</span>`;
        else {
          const first = temporalLocal(`${year}-${temporalPad(month+1)}-01`), offset = (first.getDay()+6)%7;
          const next = new Date(first); next.setMonth(month+1,0);
          content += `<span class="temporal-weekdays" aria-hidden="true">${['一','二','三','四','五','六','日'].map(d=>`<span>${d}</span>`).join('')}</span><span class="temporal-grid temporal-days">${'<span></span>'.repeat(offset)}${Array.from({length:next.getDate()},(_,i)=>{
            const key = `${String(year).padStart(4,'0')}-${temporalPad(month+1)}-${temporalPad(i+1)}`;
            return button(i+1,`data-date="${key}" aria-label="${year}年${month+1}月${i+1}日" ${key === temporalDate(new Date()) ? 'data-today' : ''}`,key === datePart(),!dayAllowed(key));
          }).join('')}</span>`;
        }
      } else {
        const [hour,minute] = timePart().split(':');
        const isHour = view === 'hours';
        content = `${hasDate ? `<button type="button" class="temporal-date-back" data-view="days">${display(datePart())}</button>` : ''}<span class="temporal-time-head"><button type="button" data-view="hours" aria-pressed="${isHour}">${hour} 时</button><button type="button" data-view="minutes" aria-pressed="${!isHour}">${minute} 分</button></span><span class="temporal-grid temporal-times">${Array.from({length:isHour ? 24 : 60},(_,i)=>{
          const time = isHour ? `${temporalPad(i)}:${minute}` : `${hour}:${temporalPad(i)}`;
          const value = (hasDate ? datePart()+'T' : '')+time;
          // Hours remain navigable even when the current minute does not satisfy a constraint.
          const allowed = isHour ? Array.from({length:60},(_,m)=>valid((hasDate ? datePart()+'T' : '')+temporalPad(i)+':'+temporalPad(m))).some(Boolean) : valid(value);
          return button(temporalPad(i),`data-time="${i}" aria-label="${i}${isHour ? '时' : '分'}"`,i === Number(isHour ? hour : minute),!allowed);
        }).join('')}</span>`;
      }
      const today = type === 'month' ? temporalDate(new Date()).slice(0,7) : temporalDate(new Date());
      const error = trigger.getAttribute('aria-invalid') === 'true' ? `<span class="temporal-error" role="alert">${esc(input.validationMessage)}</span>` : '';
      panel.innerHTML = `${content}${error}<span class="temporal-foot">${!input.required ? button('清空','data-clear') : ''}${hasDate && ['days','months','years'].includes(view) ? button(type === 'month' ? '回到本月' : '今天',`data-date="${today}"`,false,!dayAllowed(today)) : ''}${hasTime ? button('确定','data-confirm',false,!valid(draft)) : ''}</span>`;
      position();
    };
    const open = () => {
      if (trigger.disabled) return;
      const now = new Date(), defaultDate = temporalDate(now);
      draft = input.value || (hasDate ? (type === 'month' ? defaultDate.slice(0,7) : defaultDate) : '') + (hasTime ? (hasDate ? 'T' : '')+temporalPad(now.getHours())+':'+temporalPad(now.getMinutes()) : '');
      cursor = temporalLocal(hasDate ? datePart() : defaultDate);
      view = type === 'month' ? 'months' : hasDate ? 'days' : 'hours';
      render(); panel.showPopover(); position();
      (panel.querySelector('[aria-current=true]:not(:disabled)') || panel.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
    };
    trigger.addEventListener('click',event => { event.preventDefault(); panel.matches(':popover-open') ? close() : open(); });
    input.addEventListener('click',event => { event.preventDefault(); open(); });
    panel.addEventListener('beforetoggle',event => trigger.setAttribute('aria-expanded',String(event.newState === 'open')));
    panel.addEventListener('click',event => {
      // Rendering a new grid removes the clicked node. Cancel the wrapping label's default
      // activation so it cannot focus the hidden native field and reopen the system picker.
      event.preventDefault();
      const target = event.target.closest('button');
      if (!target || target.disabled || trigger.disabled) return;
      if (target.hasAttribute('data-clear')) { commit(''); return; }
      if (target.hasAttribute('data-confirm')) { commit(draft); return; }
      if (target.dataset.date) { chooseDate(target.dataset.date); return; }
      if (target.dataset.view) view = target.dataset.view;
      else if (target.dataset.shift) {
        const step = Number(target.dataset.shift);
        cursor.setDate(1);
        if (view === 'days') cursor.setMonth(cursor.getMonth()+step);
        else cursor.setFullYear(yearBound(cursor.getFullYear()+step*(view === 'years' ? 12 : 1)));
        if (cursor.getFullYear()<1 || cursor.getFullYear()>9999) cursor.setFullYear(yearBound(cursor.getFullYear()));
      } else if (target.dataset.year) { cursor.setFullYear(Number(target.dataset.year)); view = 'months'; }
      else if (target.dataset.month !== undefined) {
        cursor.setDate(1); cursor.setMonth(Number(target.dataset.month));
        if (type === 'month') { chooseDate(temporalDate(cursor).slice(0,7)); return; }
        view = 'days';
      } else if (target.dataset.time !== undefined) {
        const [hour,minute] = timePart().split(':');
        draft = (hasDate ? datePart()+'T' : '') + (view === 'hours' ? `${temporalPad(target.dataset.time)}:${minute}` : `${hour}:${temporalPad(target.dataset.time)}`);
        if (view === 'hours') view = 'minutes';
      }
      render();
      (panel.querySelector('[aria-current=true]:not(:disabled)') || panel.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
    });
    panel.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      const cells = [...(event.target.closest('.temporal-grid')?.querySelectorAll('button:not(:disabled)') || [])];
      const index = cells.indexOf(event.target);
      if (index<0) return;
      const columns = view === 'days' ? 7 : view === 'hours' || view === 'minutes' ? 6 : 3;
      const moves = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns,Home:-index,End:cells.length-1-index};
      if (event.key in moves) { event.preventDefault(); cells[Math.max(0,Math.min(cells.length-1,index+moves[event.key]))].focus(); }
    });
    // Browser form validation opens the corresponding visible control, including required fields.
    input.addEventListener('invalid',event => { event.preventDefault(); trigger.setAttribute('aria-invalid','true'); open(); });
    input.addEventListener('input',sync); input.addEventListener('change',sync);
    input.form?.addEventListener('reset',() => setTimeout(sync,0));
    const observer = new MutationObserver(sync);
    observer.observe(input,{attributes:true,attributeFilter:['disabled','readonly','required','value','min','max','step']});
    temporalFields.add({input,position,scroll:event => { if (!panel.contains(event.target)) position(); },dispose:() => observer.disconnect()});
    panel.addEventListener('toggle',event => { if (event.newState === 'open') panel.querySelector('[aria-current=true]')?.scrollIntoView({block:'nearest'}); });
    sync();
  }
}
function yearBound(year) { return Math.max(1,Math.min(9999,year)); }

// Rendered markup arrives constantly, so the enhancement follows the DOM instead of every caller.
new MutationObserver(records => {
  for (const field of temporalFields) if (!field.input.isConnected) { field.dispose(); temporalFields.delete(field); }
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) { enhanceSelects(node); enhanceDateTimes(node); }
}).observe(document.body, {childList:true, subtree:true});
enhanceSelects(document.body);
enhanceDateTimes(document.body);
// Opening or closing a paper repaints whichever view owns the reader column.
function renderPaperViews() { if (shellView === 'library') { renderLibrary(); followMiddle('library'); } }

function renderLibrary() {
  window.dispatchEvent(new Event('methodatlas-papers-changed'));
  const panel = document.getElementById('sources-panel');
  shellPaint({titles:['文献库'],bodies:[sourcesBodyHTML()]});
  renderSources();
  panel.querySelector('#paper-detail')?.remove();
  document.getElementById('source-body').hidden = false;
  panelHeading('sources-panel','文献库');
  panel.querySelector('.library-add')?.remove();
  panel.querySelector('.panel-head').insertAdjacentHTML('beforeend','<button type="button" class="library-add" data-action="add-source" aria-label="添加来源">' + icon('plus') + '添加</button>');
  syncSourceCounters();
  if (!previewingShell) renderDetail();
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
  return `${create}<div class="library-list cards">${outputs.map(item => `<button type="button" class="library-row card${item.id === openId ? ' active' : ''}" data-action="file" data-id="${esc(item.id)}"${item.id === openId ? ' aria-current="true"' : ''}>${icon('output')}<span class="library-row-body"><strong>${esc(item.title)}</strong><small>${esc(artifactKindLabel(item))}${state?.collaboration ? (item.visibility === 'private' ? ' · 私人' : ' · 共享') : ''}</small></span></button>`).join('')}</div>`;
}

function saveWorkspaceState() {
  if (!current) return;
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`workspace:${current.id}`, JSON.stringify({
    view:committedShellView, middle:middleView, middleItem, artifact:artifact?.id || null, version:versionId,
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
let activePanel = 'chat-panel', remoteOutputOpen = false;
const collapsedPanels = new Set(['output-panel']);
let committedShellView = 'chat', previewingShell = false, previewTimer = null, closePreviewTimer = null;
let seenOutputs = '';
const layoutKey = () => `panel-layout:${current.id}`;
function savePanelLayout() {
  if (!current) return;
  const sizes = ['source','chat','studio'].map((name,index) => document.querySelector('.panels')?.style.getPropertyValue(`--${name}-width`) || `${[280,700,308][index]}fr`);
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(layoutKey(),JSON.stringify({left:!collapsedPanels.has('sources-panel'),leftDefaultExpanded:true,right:!collapsedPanels.has('output-panel'),sizes}));
}
function endShellPreview(restore = true) {
  clearTimeout(previewTimer); clearTimeout(closePreviewTimer);
  if (!previewingShell) return;
  previewingShell = false;
  document.getElementById('source-menu')?.hidePopover();
  if (restore && shellView !== committedShellView) switchShellView(committedShellView,true);
  syncPanelLayout();
}
function previewShell(key) {
  if (!current || !document.querySelector('.workspace') || narrowWorkspace.matches || !collapsedPanels.has('sources-panel')) return;
  clearTimeout(closePreviewTimer);
  previewingShell = true;
  switchShellView(key,true);
  syncPanelLayout();
}
function revealPanel(id) {
  activePanel = id;
  if (id === 'output-panel' && middleView === 'remote') remoteOutputOpen = true;
  if (id === 'chat-panel') {
    endShellPreview(false);
    markConversationRead(); renderConversationRows();
  } else if (!narrowWorkspace.matches) {
    collapsedPanels.delete(id); savePanelLayout();
  }
  if (id === 'output-panel') {
    seenOutputs = outputSignature();
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`seen-outputs:${current.id}`,seenOutputs);
  }
  syncPanelLayout();
}
const outputSignature = () => current?.artifacts.filter(item => item.kind !== 'progress').map(item => `${item.id}:${item.current_version_id || item.updated || ''}`).join('|') || '';
function togglePanel(id) {
  if (id === 'sources-panel') endShellPreview(false);
  const remoteOutput = id === 'output-panel' && middleView === 'remote' && !artifact;
  if (narrowWorkspace.matches) activePanel = activePanel === id ? 'chat-panel' : id;
  else if (remoteOutput) remoteOutputOpen = !remoteOutputOpen;
  else if (collapsedPanels.has(id)) collapsedPanels.delete(id); else collapsedPanels.add(id);
  if (id === 'output-panel' && (narrowWorkspace.matches ? activePanel === id : remoteOutput ? remoteOutputOpen : !collapsedPanels.has(id))) {
    seenOutputs = outputSignature(); (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`seen-outputs:${current.id}`,seenOutputs);
  }
  if (!remoteOutput) savePanelLayout();
  syncPanelLayout();
  if (narrowWorkspace.matches && activePanel !== 'chat-panel') document.querySelector(`#${activePanel} .panel-toggle`)?.focus();
  else document.querySelector(`.app-header [data-panel="${id}"]`)?.focus();
}
function syncPanelLayout() {
  const panels = document.querySelector('.panels');
  if (!panels) return;
  const narrow = narrowWorkspace.matches;
  const left = narrow ? activePanel === 'sources-panel' : !collapsedPanels.has('sources-panel');
  const right = narrow ? activePanel === 'output-panel' : middleView === 'remote' && !artifact ? remoteOutputOpen : !collapsedPanels.has('output-panel');
  panels.classList.toggle('sources-collapsed',!left);
  panels.classList.toggle('output-collapsed',!right);
  panels.classList.toggle('sources-preview',!narrow && previewingShell);
  panels.classList.toggle('drawer-open',narrow && (left || right));
  workspacePanelIds.forEach((id,index) => {
    const panel = document.getElementById(id), head = panel?.querySelector(':scope > .panel-head');
    if (!head) return;
    const visible = index === 1 || (index === 0 ? left || (!narrow && previewingShell) : right);
    panel.classList.toggle('panel-active',visible);
    panel.classList.remove('panel-collapsed');
    panel.setAttribute('role','region'); panel.removeAttribute('aria-labelledby');
    panel.inert = !visible || (narrow && index === 1 && (left || right));
    if (index === 1) return;
    let toggle = head.querySelector('[data-action=toggle-panel]');
    if (!toggle) {
      head.querySelector(':scope > span[aria-hidden]')?.remove();
      toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'icon panel-toggle';
      toggle.dataset.action = 'toggle-panel'; toggle.dataset.panel = id; head.append(toggle);
    }
    const open = index === 0 ? left : right;
    const label = index === 0 ? (narrow ? '关闭列表' : open ? '取消固定左栏' : '固定左栏') : '收起成果区';
    toggle.innerHTML = icon(index === 0 ? 'sidebarLeft' : 'sidebarRight');
    toggle.setAttribute('aria-label',label); toggle.title = label;
    toggle.setAttribute('aria-expanded',String(open));
    panel.querySelector('.panel-rail')?.remove();
    const trigger = document.querySelector(`.app-header [data-panel="${id}"]`);
    if (trigger) {
      const text = index === 0 ? (open ? '收起左栏' : narrow ? '打开列表' : '固定左栏') : (open ? '收起成果区' : '打开成果区');
      trigger.setAttribute('aria-label',text); trigger.title = text;
      trigger.setAttribute('aria-expanded',String(open));
      trigger.classList.toggle('has-unread',index === 2 && !open && seenOutputs !== outputSignature());
    }
  });
  panels.querySelectorAll('.panel-resizer').forEach(handle => { handle.inert = narrow || (Number(handle.dataset.split) === 0 ? !left : !right); });
  const remoteToggle = document.querySelector('[data-remote-toggle-output]');
  if (remoteToggle) {
    const expanded = !panels.classList.contains('output-collapsed');
    remoteToggle.innerHTML = `${icon('output')}${expanded ? '收起成果' : '展开成果'}`;
    remoteToggle.setAttribute('aria-expanded',String(expanded));
  }
  const backdrop = panels.querySelector('.panel-backdrop');
  if (backdrop) backdrop.hidden = !narrow || (!left && !right);
  restorePanelSizes();
}
document.addEventListener('pointerover', event => {
  if (event.pointerType === 'touch') return;
  const nav = event.target.closest('.shell-nav [data-action=shell]');
  if (event.target.closest('#sources-panel,.shell-nav,#source-menu')) clearTimeout(closePreviewTimer);
  if (!nav || nav.contains(event.relatedTarget)) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => previewShell(nav.dataset.value),160);
});
document.addEventListener('pointerout',event => {
  if (!event.target.closest('.shell-nav,#sources-panel,#source-menu')) return;
  if (event.relatedTarget?.closest?.('.shell-nav,#sources-panel,#source-menu')) return;
  clearTimeout(previewTimer);
  closePreviewTimer = setTimeout(() => {
    if (!document.activeElement?.closest('#sources-panel')) endShellPreview();
  },220);
});
document.addEventListener('focusout',event => {
  if (previewingShell && event.relatedTarget && event.target.closest('#sources-panel,#source-menu') && !event.relatedTarget.closest('#sources-panel,.shell-nav,#source-menu')) endShellPreview();
});
document.addEventListener('keydown',event => {
  if (event.key === 'ArrowRight' && event.target.matches('.shell-nav [data-action=shell]')) {
    event.preventDefault(); previewShell(event.target.dataset.value);
    document.querySelector('#sources-panel button')?.focus();
  }
  if (event.key === 'Escape' && (previewingShell || narrowWorkspace.matches && activePanel !== 'chat-panel')) {
    const id = activePanel; endShellPreview(); activePanel = 'chat-panel'; syncPanelLayout();
    (document.querySelector(`.app-header [data-panel="${id}"]`) || document.querySelector('.shell-nav [aria-current=page]'))?.focus();
  }
  if (event.key === 'Tab' && narrowWorkspace.matches && activePanel !== 'chat-panel') {
    const controls = [...document.querySelectorAll(`#${activePanel} button, #${activePanel} input, #${activePanel} textarea, #${activePanel} a[href], #${activePanel} summary, #${activePanel} [tabindex="0"]`)].filter(el=>!el.disabled && el.checkVisibility());
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (event.target === edge) {event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();}
  }
});

function reflowWorkspace() {
  syncPanelLayout();
  const nav = document.querySelector('.shell-nav');
  if (nav) moveIndicator(nav,nav.querySelector('.active'),true);
}
window.addEventListener('resize',reflowWorkspace);
window.addEventListener('typographychange',reflowWorkspace);
// The left navigation swaps the list and the middle together. A view brings the middle it last had
// open back (or asks its module for the default one), and the views with no middle of their own fall
// back to the conversation. The right column is never touched. followMiddle re-enters: a module's
// open() may call switchShellView() on its way to the middle, so the same key is not followed twice.
let middleFollowing = null;
function followMiddle(key) {
  if (middleFollowing === key) return;
  if (key === 'library') {
    if (detail?.paper) {
      if (middleView !== 'reader') openMiddle('reader','',null,false);
      panelHeading('chat-panel',shortTitle(detail.paper.title),'文献库','close-paper');
      const body = document.getElementById('chat-body');
      if (!body.querySelector('#paper-detail')) body.innerHTML = '<div id="paper-detail"></div>';
      if (!body.querySelector('.reader-shell')) renderDetail();
    }
    else { if (middleView !== 'library') openMiddle('library','论文推荐'); window.MethodAtlasSubscriptions?.activate(); }
    return;
  }
  if (key === 'chat') { if (middleView !== 'chat') openMiddle('chat'); return; }
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

function switchShellView(key, preview = false) {
  if (key === 'subscriptions') key = 'library';
  if (!shellViews.some(view => view.key === key)) return;
  if (!preview) { clearTimeout(previewTimer); clearTimeout(closePreviewTimer); previewingShell = false; committedShellView = key; document.getElementById('source-menu')?.hidePopover(); }
  if (key === shellView) { if (!preview) followMiddle(key); syncPanelLayout(); return; }
  if (!preview) { paperRequest++; document.body.classList.remove('reader-fullscreen'); }
  viewPanels.set(shellView,capturePanel('sources-panel'));
  document.getElementById('sources-panel').replaceChildren();
  shellView = key;
  const saved = viewPanels.get(key);
  if (saved) restorePanel('sources-panel',saved);
  else document.getElementById('sources-panel').innerHTML = '<div class="panel-head"><h2></h2><span class="badge"></span></div><div class="panel-body" id="source-body"></div><div id="history-area"></div>';
  if (key === 'library') { if (saved) renderSources(); else renderLibrary(); }
  else if (key === 'chat') { if (saved) renderConversationRows(); else renderChatList(); }
  else if (key === 'subscriptions' || !saved || !document.getElementById('source-body')?.textContent.trim()) {
    if (preview && key === 'progress') window.MethodAtlasProgress.preview(); else renderShellView();
  }
  const label = shellViews.find(view=>view.key===key).label;
  if (key !== 'library') panelHeading('sources-panel',key === 'chat' ? '历史对话' : label);
  document.querySelectorAll('.shell-nav [data-action=shell]').forEach(button => {
    const active = button.dataset.value === committedShellView;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  const nav = document.querySelector('.shell-nav');
  moveIndicator(nav,nav.querySelector('.active'),true);
  if (!preview) { followMiddle(key); saveWorkspaceState(); }
  syncPanelLayout();
}

// The middle column is swapped in whole: the panel the previous view was using is cached, and the one
// this view left behind is put back exactly as it was — draft text and scroll included.
function showMiddlePanel(key) {
  middlePanels.set(middleView,capturePanel('chat-panel'));
  middleView = key;
  const saved = middlePanels.get(key);
  if (saved) restorePanel('chat-panel',saved);
  else document.getElementById('chat-panel').innerHTML = '<div class="panel-head"><h2></h2><span id="chat-tools" class="row"></span></div><div id="chat-body"></div>';
  window.MethodAtlasAI?.mainPlaceholder();
}

function openMiddle(key, title = '', item = null, focus = true) {
  middleRequest++;
  if (shellViews.some(view => view.key === key)) {
    committedShellView = key; previewingShell = false;
    document.querySelectorAll('.shell-nav [data-action=shell]').forEach(button => {const active = button.dataset.value === key; button.classList.toggle('active',active); if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  }
  if (key !== middleView) showMiddlePanel(key);
  middleItem = item;
  if (item) middleItems.set(key,item);
  panelHeading('chat-panel',key === 'chat' ? 'AI 对话' : title,key === 'chat' ? null : 'AI 对话','back-chat');
  if (key === 'chat') { renderChat(); window.MethodAtlasProgress?.chatHeader(); pumpQueue(); }
  if (focus) revealPanel('chat-panel');
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
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem('methodatlas-view', JSON.stringify({projectId:current.id,conversationId:serverConversationId()}));
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
  remoteOutputOpen = false;
  committedShellView = shellView; previewingShell = false; clearTimeout(previewTimer); clearTimeout(closePreviewTimer);
  seenOutputs = (globalThis.MethodAtlasStorage?.local || localStorage).getItem(`seen-outputs:${current.id}`) ?? outputSignature();
  collapsedPanels.clear();
  let layout; try { layout=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(layoutKey())); } catch {}
  if (layout?.leftDefaultExpanded && layout.left === false) collapsedPanels.add('sources-panel');
  if (!layout?.right) collapsedPanels.add('output-panel');
  viewPanels.clear(); middlePanels.clear(); middleItems.clear(); middleView = 'chat'; middleItem = null; middleRequest++;
  // Every view is rebuilt inside this function, so the reader goes with it — full screen cannot outlive
  // the page it was opened on, or the next view would render as a reading surface with no way out.
  document.body.classList.remove('reader-fullscreen');
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem('methodatlas-view', JSON.stringify({projectId:current.id, conversationId:serverConversationId()}));
  lastStarted = null;
  loadQueue();
  document.getElementById('app').innerHTML = `<main class="workspace">
    <header class="app-header"><div class="row workspace-brand"><button class="icon" data-action="toggle-panel" data-panel="sources-panel" aria-controls="sources-panel" aria-label="固定左栏">${icon('sidebarLeft')}</button><button class="icon workspace-back" data-action="home" aria-label="返回项目列表">${icon('back')}</button><span class="brandmark" aria-hidden="true"><img src="assets/methodatlas-mark.png?v=poster-20261013" alt=""></span><span class="project-title" title="${esc(current.name)}">${esc(current.name)}</span></div><div class="row workspace-actions" aria-label="工作区操作"><button class="icon" type="button" data-ai="open" aria-label="打开 AI 对话" title="打开 AI 对话">${icon('spark')}</button>${window.MethodAtlasSearch?.header() || ''}<button class="icon" data-action="toggle-panel" data-panel="output-panel" aria-controls="output-panel" aria-label="打开成果区">${icon('sidebarRight')}</button><button type="button" data-action="settings" class="pill">设置</button>${window.MethodAtlasCollaboration?.header() || ''}</div></header>
    <div class="shell"><nav class="shell-nav" aria-label="工作台导航">${globalNav()}${shellNav()}<div class="shell-nav-bottom"><button data-action="settings" aria-label="设置" title="设置">${icon('settings')}</button></div><span class="shell-nav-indicator" aria-hidden="true"></span></nav><div class="workspace-content"><div class="panels"><button class="panel-backdrop" data-action="close-panels" aria-label="关闭侧栏" hidden></button><section class="panel" id="sources-panel" aria-label="来源区域"><div class="panel-head"><div class="row"><h2>来源</h2><span class="badge"></span></div><span aria-hidden="true">${icon('panel')}</span></div><div class="panel-body" id="source-body"></div><div id="history-area"></div></section>
      <div class="panel-resizer" role="separator" aria-orientation="vertical" aria-label="调整来源与对话宽度" aria-controls="sources-panel chat-panel" tabindex="0" data-split="0"></div>
      <section class="panel" id="chat-panel" aria-label="主要功能区"><div class="panel-head"><h2>对话</h2><div class="row"><span id="chat-tools" class="row"></span></div></div><div id="chat-body"></div></section>
      <div class="panel-resizer" role="separator" aria-orientation="vertical" aria-label="调整主要功能与成果区宽度" aria-controls="chat-panel output-panel" tabindex="0" data-split="1"></div>
      <section class="panel" id="output-panel" aria-label="成果区"><div class="panel-head"><h2>成果</h2><div id="studio-tools" class="row"></div><button class="icon studio-back" data-action="artifact-list" aria-label="关闭成果，返回列表" title="关闭成果，返回列表" hidden>${icon('close')}</button></div><div id="output-body" class="output-body"></div><div id="studio-meta"></div></section></div></div></div><div class="workspace-foot" aria-hidden="true"></div></main>`;
  activePanel = 'chat-panel';
  restorePanelSizes();
  renderShellView(); renderChat();
  panelHeading('sources-panel','历史对话');
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
  host.innerHTML = historyOpen ? `<section id="conversation-menu" class="history-panel" aria-label="对话历史"><div class="panel-head"><h2>历史记录</h2><button class="icon" data-action="close-history" aria-label="关闭历史记录">${icon('close')}</button></div><div class="panel-body">${current.conversations.map(c => `<button class="history-item ${c.id === conversation.id ? 'active' : ''}" data-action="conversation" data-id="${esc(c.id)}" ${c.id === conversation.id ? 'aria-current="true"' : ''}><strong>${esc(c.title)}</strong><small>${c.id === conversation.id ? '当前对话' : `${c.message_count ?? c.messages.length} 条消息`}</small></button>`).join('')}<details class="reading-history" ${disclosure(`${conversation.id}:reads`)}><summary>已读取 · ${new Set((conversation.reads || []).map(r => r.paper_id)).size} 篇</summary>${(conversation.reads || []).map(r => `<button data-action="read-paper" data-id="${r.paper_id}" data-version="${r.paper_version_id}">${esc(shortTitle(r.title))}</button>`).join('')}</details></div></section>` : '';
}

function restorePanelSizes() {
  let sizes;
  try { const layout=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(layoutKey())); sizes=layout?.sizes?.map(value=>parseFloat(value)); } catch {}
  if (Array.isArray(sizes) && sizes.length === 3 && sizes.every(n => Number.isFinite(n) && n > 0)) {
    const panels = document.querySelector('.panels');
    ['source','chat','studio'].forEach((name,i) => panels.style.setProperty(`--${name}-width`,`${sizes[i]}fr`));
  }
  document.querySelectorAll('.panel-resizer').forEach(handle => {
    // A collapsed column measures 0px, so there is no ratio left to report on the divider in front of it.
    if (handle.inert) return;
    const widths = [...handle.parentElement.querySelectorAll(':scope > .panel')].map(p => p.getBoundingClientRect().width);
    const i = Number(handle.dataset.split), total = widths[i] + widths[i+1], mins = [14,20,16].map(rem => rem * parseFloat(getComputedStyle(document.documentElement).fontSize));
    handle.setAttribute('aria-valuemin',Math.round(mins[i] / total * 100));
    handle.setAttribute('aria-valuemax',Math.round((total - mins[i+1]) / total * 100));
    handle.setAttribute('aria-valuenow',Math.round(widths[i] / total * 100));
  });
}

function resetPanelSizes() {
  if (!current || !document.querySelector('.panels')) return;
  ['source','chat','studio'].forEach(name=>document.querySelector('.panels').style.removeProperty(`--${name}-width`));
  savePanelLayout(); restorePanelSizes();
}

function resizePanels(handle, delta) {
  if (handle.inert) return;
  handle.parentElement.getAnimations().forEach(animation => animation.cancel());
  const widths = [...handle.parentElement.querySelectorAll(':scope > .panel')].map(p => p.getBoundingClientRect().width);
  const i = Number(handle.dataset.split), total = widths[i] + widths[i+1], mins = [14,20,16].map(rem => rem * parseFloat(getComputedStyle(document.documentElement).fontSize));
  widths[i] = Math.max(mins[i],Math.min(total - mins[i+1],widths[i] + delta));
  widths[i+1] = total - widths[i];
  // Freeze every visible share to the measured pixels; retain the remembered share of a closed panel.
  ['source','chat','studio'].forEach((name,index) => {
    if (index === 0 && handle.parentElement.classList.contains('sources-collapsed') || index === 2 && handle.parentElement.classList.contains('output-collapsed')) return;
    handle.parentElement.style.setProperty(`--${name}-width`,`${widths[index]}fr`);
  });
  savePanelLayout(); restorePanelSizes();
}

document.addEventListener('pointerdown', event => {
  const handle = event.target.closest('.panel-resizer');
  if (!handle || event.button !== 0) return;
  event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
  let x = event.clientX, target = x, frame = 0, previousTime = 0;
  const reduced = () => window.MethodAtlasSettings?.reducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.add('resizing-panels');
  const follow = time => {
    frame = 0;
    const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
    previousTime = time;
    // A 55ms response adds a little weight without delaying the pointer itself.
    const delta = reduced() || Math.abs(target - x) < .25 ? target - x : (target - x) * (1 - Math.exp(-elapsed / 55));
    resizePanels(handle,delta); x += delta;
    if (Math.abs(target - x) > .01) frame = requestAnimationFrame(follow);
    else previousTime = 0;
  };
  const move = e => {
    target = e.clientX;
    if (reduced()) { resizePanels(handle,target - x); x = target; }
    else if (!frame) frame = requestAnimationFrame(follow);
  };
  const end = () => {
    cancelAnimationFrame(frame);
    resizePanels(handle,target - x);
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
function paperSource(paper) {
  const metadata = paper.metadata || {}, version = paper.version_id || paper.current_version_id;
  // A user's supplemental PDF must not inherit the provenance of a previous download.
  return metadata.discovery_accepted?.[version] || metadata.discovery_versions?.[version]
    || (metadata.supplement_filename ? {filename:metadata.supplement_filename} : metadata);
}
function paperSourceLabel(paper) {
  const source = paperSource(paper);
  return [String(source.published || '').match(/^\d{4}/)?.[0],
    ({'conference-paper':'会议版',article:'期刊版',preprint:'预印本'})[source.publication_type]
    || ({submittedVersion:'投稿版',acceptedVersion:'接收版'})[source.source_version],
    source.filename ? '上传的 PDF' : ''].filter(Boolean).join(' · ');
}
function paperMeta(paper) {
  const a = paper.availability || {}, year = paperSourceLabel(paper);
  const status = paper.source_kind === 'text' ? '文字资料'
    : a.fulltext === 'pending' ? '获取全文中'
    : a.parse === 'abstract' || a.abstract === 'available' && !['downloaded','provided'].includes(a.fulltext) ? '仅摘要'
    : a.parse === 'metadata_only' || ['failed','unavailable','not_fetched'].includes(a.fulltext) ? '仅元数据'
    : a.parse === 'partial' ? '部分内容需核对原图'
    : a.parse && a.parse !== 'parsed' ? '解析未完成'
    : ['downloaded','provided'].includes(a.fulltext) ? `全文可用 · ${paper.page_count || 0} 页` : `${paper.page_count || 0} 页`;
  return [year,status].filter(Boolean).join(' · ');
}
const sourceStates = new Map();
function sourceState() {
  if (!sourceStates.has(current.id)) sourceStates.set(current.id, {busy:false, error:'', editor:null});
  return sourceStates.get(current.id);
}
function sourceOrganization() {
  return current.source_organization || {revision:0, labels:[], assignments:{}, view:'list', sort:'recent', collapsed:[], can_undo:false};
}
const sourceSortNames = {recent:'最近添加', title:'标题', type:'文件类型'};
function sourceType(paper) {
  return paper.source_kind === 'text' ? 'text' : /pdf/.test(paper.source_kind) ? 'pdf' : 'link';
}
function sortedSources() {
  const sort = sourceOrganization().sort, collator = new Intl.Collator('zh-CN', {numeric:true});
  return [...(window.MethodAtlasSearch?.filter(current.papers) || current.papers)].sort((a,b) => (sort === 'recent' ? String(b.added_at || '').localeCompare(a.added_at || '') : sort === 'type' ? sourceType(a).localeCompare(sourceType(b)) : 0) || collator.compare(a.title,b.title) || a.id.localeCompare(b.id));
}
function sourceRow(paper) {
  const type = sourceType(paper), busy = sourceState().busy;
  return `<div class="paper-row" data-source-id="${esc(paper.id)}"><span class="source-file-icon" data-type="${type}" title="${{pdf:'PDF',text:'文字资料',link:'论文链接'}[type]}">${icon(type === 'link' ? 'globe' : type === 'text' ? 'output' : 'file')}</span><button class="paper-link" data-action="paper" data-id="${esc(paper.id)}" aria-label="查看论文：${esc(paper.title)}" title="${esc(paper.title)}"><strong>${window.MethodAtlasSearch?.highlight(shortTitle(paper.title)) || esc(shortTitle(paper.title))}</strong><span class="paper-meta sr-only">${esc(paperMeta(paper))}</span></button><span class="paper-warning-slot"></span><button class="icon source-more" data-source-command="paper-menu" data-id="${esc(paper.id)}" aria-label="管理资料：${esc(paper.title)}" aria-haspopup="menu" ${busy ? 'disabled' : ''}>${icon('dots')}</button><input type="checkbox" data-paper="${esc(paper.id)}" aria-label="选择论文：${esc(paper.title)}" ${selected.has(paper.id) ? 'checked' : ''} ${paper.current_version_id ? '' : 'disabled'}></div>`;
}
function sourceGroup(label, papers) {
  const closed = window.MethodAtlasSearch?.collapsed(label.id,sourceOrganization().collapsed.includes(label.id)) ?? sourceOrganization().collapsed.includes(label.id), selectable = papers.filter(p => p.current_version_id);
  return `<section class="source-group ${closed ? 'is-collapsed' : ''}" data-label-id="${esc(label.id)}"><div class="source-group-head"><button class="source-group-toggle" data-source-command="toggle" data-id="${esc(label.id)}" aria-expanded="${!closed}" aria-controls="source-group-${esc(label.id)}" ${sourceState().busy ? 'disabled' : ''}>${icon('chevron')}<span>${window.MethodAtlasSearch?.highlight(label.name) || esc(label.name)}</span><small>${papers.length}</small></button>${label.id !== 'unclassified' ? `<button class="icon source-more" data-source-command="label-menu" data-id="${esc(label.id)}" aria-label="管理分类：${esc(label.name)}" aria-haspopup="menu" ${sourceState().busy ? 'disabled' : ''}>${icon('dots')}</button>` : ''}<input type="checkbox" data-source-group="${esc(label.id)}" aria-label="选择分类：${esc(label.name)}" ${selectable.length && selectable.every(p => selected.has(p.id)) ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}></div><div class="source-group-content" id="source-group-${esc(label.id)}" ${closed ? 'inert' : ''}><div>${papers.map(sourceRow).join('') || '<p class="source-group-empty">从资料菜单移入论文</p>'}</div></div></section>`;
}
function sourcesBodyHTML() {
  const papers = sortedSources(), organization = sourceOrganization(), state = sourceState();
  const selectable = papers.filter(paper => paper.current_version_id), selectedCount = selectable.filter(p => selected.has(p.id)).length;
  const searchOpen = window.MethodAtlasSearch?.listOpen('source');
  const aiLabel = organization.view === 'labels' ? '管理分类' : organization.labels.length ? '返回分类视图' : 'AI 智能分类';
  const groups = [...organization.labels];
  if (papers.some(p => !organization.assignments[p.id])) groups.push({id:'unclassified',name:'未分类'});
  const content = organization.view === 'labels' ? groups.filter(label => !window.MethodAtlasSearch?.query() || papers.some(p => (organization.assignments[p.id] || 'unclassified') === label.id)).map(label => sourceGroup(label,papers.filter(p => (organization.assignments[p.id] || 'unclassified') === label.id))).join('') : papers.map(sourceRow).join('');
  return `
    <div class="source-count"><div class="source-tools"><button class="icon source-ai ${state.busy === 'classify' ? 'is-organizing' : ''}" data-source-command="ai" data-search-background="source" ${searchOpen?'inert':''} aria-label="${aiLabel}" title="${aiLabel}" ${state.busy || !papers.length && !organization.labels.length ? 'disabled' : ''}>${icon('spark')}</button><button class="icon" data-source-command="sort-menu" data-search-background="source" ${searchOpen?'inert':''} aria-label="排序：${sourceSortNames[organization.sort]}" title="排序：${sourceSortNames[organization.sort]}" aria-haspopup="menu" ${state.busy ? 'disabled' : ''}>${icon('sort')}</button>${window.MethodAtlasSearch?.toggle() || ''}</div><span class="source-selection-count" data-search-background="source" ${searchOpen?'inert':''} aria-label="已选 ${selectedCount} / ${selectable.length} 篇">${selectedCount} / ${selectable.length}</span><label data-search-background="source" ${searchOpen?'inert':''}>${window.MethodAtlasSearch?.query() ? '选择结果' : '全选'}<input id="select-all" type="checkbox" ${selectable.length && selectable.every(paper => selected.has(paper.id)) ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}></label></div>
    ${state.busy === 'classify' ? '<div class="source-feedback source-working" role="status"><span class="source-pulse"></span>正在按研究主题整理…<small>完成后自动分组，可撤销</small></div>' : ''}
    ${state.error ? `<div class="source-feedback source-error" role="alert">${esc(state.error)}<button class="quiet" data-source-command="dismiss">知道了</button></div>` : ''}
    ${organization.can_undo && !state.busy ? '<div class="source-feedback source-undo" role="status">AI 分类已完成<button class="quiet" data-source-command="undo">撤销</button></div>' : ''}
    ${state.editor ? `<form id="source-label-form" class="source-label-editor"><label for="source-label-name">${state.editor.id ? '重命名分类' : '新增分类'}</label><input id="source-label-name" name="name" maxlength="80" required value="${esc(state.editor.name)}" placeholder="输入分类名称" ${state.busy ? 'disabled' : ''}><div><button class="quiet" type="button" data-source-command="cancel-edit" ${state.busy ? 'disabled' : ''}>取消</button><button class="primary" type="submit" ${state.busy ? 'disabled' : ''}>保存</button></div></form>` : ''}
    <div id="paper-list" aria-busy="${state.busy === 'classify'}">${content || (window.MethodAtlasSearch?.query() ? '<p class="empty-small">没有匹配的资料，试试其他关键词。</p>' : '<p class="empty-small">还没有资料，点击「添加来源」开始导入。</p>')}</div>${window.MethodAtlasSearch?.footer() || ''}`;
}

async function changeSources(action, fields = {}) {
  const project = current.id, state = sourceState();
  if (state.busy) return;
  state.busy = action; state.error = '';
  const request = {revision:sourceOrganization().revision, ...fields};
  if (action !== 'preferences') renderSources();
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project)}/source-organization/${action}`, {method:'POST',body:JSON.stringify(request)});
    if (current?.id === project) current.source_organization = result;
    if (action === 'create' || action === 'rename') state.editor = null;
    return result;
  } catch (error) {
    state.error = error.message;
  } finally {
    state.busy = false;
    if (current?.id === project && (!fields.collapsed || state.error)) renderSources();
  }
}

function sourceMenu(trigger, kind, id = '') {
  let menu = document.getElementById('source-menu');
  if (!menu) {
    menu = document.createElement('div'); menu.id = 'source-menu'; menu.className = 'source-menu';
    menu.setAttribute('popover','auto'); menu.setAttribute('role','menu'); document.body.append(menu);
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); menu.hidePopover();
        menu.sourceTrigger?.focus({preventScroll:true});
        return;
      }
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        const i = buttons.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    });
    menu.addEventListener('toggle', event => {
      if (event.newState === 'closed') menu.sourceTrigger?.setAttribute('aria-expanded','false');
    });
  }
  const organization = sourceOrganization();
  const item = (command, text, glyph, value = '', checked = null) => `<button type="button" role="${checked === null ? 'menuitem' : 'menuitemradio'}" ${checked === null ? '' : `aria-checked="${checked}"`} data-source-command="${command}" data-id="${esc(id)}" data-value="${esc(value)}">${icon(glyph)}<span>${esc(text)}</span>${checked ? icon('check') : ''}</button>`;
  let content;
  if (kind === 'sort') content = Object.entries(sourceSortNames).map(([value,name]) => item('sort',name,'sort',value,organization.sort === value)).join('');
  if (kind === 'manage') content = item('create','新增分类','plus') + item('reorganize','重新 AI 整理','spark') + '<hr>' + item('list','返回列表视图','list');
  if (kind === 'label') content = item('rename','重命名','edit') + item('delete','删除分类','trash');
  if (kind === 'reorganize') content = item('manage','返回','back') + item('classify','仅整理未分类资料','label','unclassified') + item('classify','全部重新分类','spark','all');
  if (kind === 'paper') content = '<p class="source-menu-title">移动到分类</p>' + organization.labels.map(label => item('move',label.name,'label',label.id,organization.assignments[id] === label.id)).join('') + item('move','未分类','file','',!organization.assignments[id]) + '<hr>' + item('create','新增分类','plus');
  if (trigger !== menu && !menu.contains(trigger)) menu.sourceTrigger = trigger;
  menu.innerHTML = content;
  menu.setAttribute('aria-label', {sort:'资料排序',manage:'管理分类',label:'分类操作',reorganize:'重新 AI 整理',paper:'移动到分类'}[kind]);
  const anchor = menu.sourceTrigger;
  if (!anchor?.isConnected) return;
  anchor.setAttribute('aria-expanded','true');
  if (!menu.matches(':popover-open')) menu.showPopover({source:anchor});
  const rect = anchor.getBoundingClientRect(), size = menu.getBoundingClientRect();
  menu.style.left = Math.max(8,Math.min(rect.left,innerWidth-size.width-8))+'px';
  menu.style.top = Math.max(8,Math.min(rect.bottom+6,innerHeight-size.height-8))+'px';
  menu.querySelector('[aria-checked="true"],button')?.focus();
}
window.addEventListener('resize', () => document.getElementById('source-menu')?.hidePopover());

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-source-command]');
  if (!target || target.disabled || !current) return;
  const {sourceCommand:command,id,value} = target.dataset, state = sourceState(), organization = sourceOrganization();
  const menu = document.getElementById('source-menu');
  if (command.endsWith('-menu')) { sourceMenu(target,command.replace('-menu',''),id); return; }
  if (command === 'reorganize' || command === 'manage') { sourceMenu(target,command); return; }
  menu?.hidePopover();
  if (state.busy) return;
  if (command === 'ai') {
    if (organization.view === 'labels') sourceMenu(target,'manage');
    else if (organization.labels.length) await changeSources('preferences',{view:'labels'});
    else await changeSources('classify',{mode:'all'});
  }
  if (command === 'classify') {
    if (value === 'all' && !confirm('全部重新分类将覆盖现有分类和手动整理。完成后可撤销。继续吗？')) return;
    await changeSources('classify',{mode:value});
  }
  if (command === 'sort') await changeSources('preferences',{sort:value});
  if (command === 'list') await changeSources('preferences',{view:'list'});
  if (command === 'undo') await changeSources('undo');
  if (command === 'move') await changeSources('move',{paper_id:id,label_id:value || null});
  if (command === 'delete' && confirm('删除这个分类？论文会移入“未分类”，不会删除论文。')) await changeSources('delete',{id});
  if (command === 'create' || command === 'rename') {
    state.editor = {id:command === 'rename' ? id : '',name:organization.labels.find(label => command === 'rename' && label.id === id)?.name || ''};
    renderSources(); document.getElementById('source-label-name')?.focus();
  }
  if (command === 'cancel-edit') { state.editor = null; renderSources(); }
  if (command === 'dismiss') { state.error = ''; renderSources(); }
  if (command === 'toggle') {
    if (window.MethodAtlasSearch?.query()) { window.MethodAtlasSearch.toggleGroup(id); return; }
    const collapsed = new Set(organization.collapsed);
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    const group = target.closest('.source-group');
    group.classList.toggle('is-collapsed',collapsed.has(id));
    group.querySelector('.source-group-content').inert = collapsed.has(id);
    target.setAttribute('aria-expanded',String(!collapsed.has(id)));
    await changeSources('preferences',{collapsed:[...collapsed]});
  }
  if (menu?.contains(target) && !state.editor) document.querySelector('[data-source-command="ai"]')?.focus({preventScroll:true});
});
document.addEventListener('input', event => {
  if (event.target.id === 'source-label-name' && sourceState().editor) sourceState().editor.name = event.target.value;
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'source-label-form') return;
  event.preventDefault();
  const editor = sourceState().editor;
  if (editor) changeSources(editor.id ? 'rename' : 'create',{id:editor.id,name:event.target.elements.name.value});
});
document.addEventListener('change', event => {
  const id = event.target.dataset.sourceGroup;
  if (!id) return;
  const assignments = sourceOrganization().assignments;
  sortedSources().filter(p => p.current_version_id && (assignments[p.id] || 'unclassified') === id).forEach(p => event.target.checked ? selected.add(p.id) : selected.delete(p.id));
  saveSelection(); renderSelectionViews();
});

function syncSourceCounters() {
  const selectable = sortedSources().filter(paper => paper.current_version_id);
  const selectedCount = selectable.filter(paper => selected.has(paper.id)).length;
  const all = document.getElementById('select-all');
  if (all) all.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
  document.querySelectorAll('[data-source-group]').forEach(input => {
    const group = selectable.filter(p => (sourceOrganization().assignments[p.id] || 'unclassified') === input.dataset.sourceGroup);
    const count = group.filter(p => selected.has(p.id)).length;
    input.indeterminate = count > 0 && count < group.length;
  });
}

function renderSources() {
  window.dispatchEvent(new Event('methodatlas-papers-changed'));
  if (shellView === 'chat') { syncSourceCounters(); return; }
  if (shellView !== 'library') return;
  const host = document.getElementById('source-body'), top = host.scrollTop;
  const positions = new Map([...host.querySelectorAll('[data-source-id]')].filter(node => node.getBoundingClientRect().height && !node.closest('.is-collapsed')).map(node => [node.dataset.sourceId,node.getBoundingClientRect()]));
  const focused = document.activeElement, focusSelector = focused?.id ? `#${CSS.escape(focused.id)}` : focused?.dataset.paper ? `[data-paper="${CSS.escape(focused.dataset.paper)}"]` : focused?.dataset.sourceGroup ? `[data-source-group="${CSS.escape(focused.dataset.sourceGroup)}"]` : focused?.dataset.sourceCommand ? `[data-source-command="${CSS.escape(focused.dataset.sourceCommand)}"]${focused.dataset.id ? `[data-id="${CSS.escape(focused.dataset.id)}"]` : ''}` : null;
  const restoreFocus = host.contains(focused);
  host.innerHTML = sourcesBodyHTML(); host.scrollTop = top;
  syncSourceCounters();
  if (restoreFocus && focusSelector) host.querySelector(focusSelector)?.focus({preventScroll:true});
  if (!(window.MethodAtlasSettings?.reducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    host.querySelectorAll('[data-source-id]').forEach(node => {
      if (node.closest('.is-collapsed')) return;
      const before = positions.get(node.dataset.sourceId), after = node.getBoundingClientRect();
      if (before && (Math.abs(before.top-after.top)>1 || Math.abs(before.left-after.left)>1)) node.animate([{transform:`translate(${before.left-after.left}px,${before.top-after.top}px)`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
    });
  }
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
  const task = conversation.latest_task || conversation.messages.map(message => message.task).filter(Boolean).at(-1);
  const key = `chat-read:${current.id}:${conversation.id}`;
  if (task?.status === 'succeeded' && (globalThis.MethodAtlasStorage?.local || localStorage).getItem(key) !== task.id) (globalThis.MethodAtlasStorage?.local || localStorage).setItem(key,task.id);
}

function conversationRowsHTML() {
  const query = (window.MethodAtlasSearch?.listQuery('conversation') || '').trim().toLowerCase();
  const list = current.conversations.filter(item => !query || String(item.title).toLowerCase().includes(query));
  return list.map(item => {
    const tasks = item.messages.map(message => message.task).filter(Boolean);
    const task = tasks.findLast(task => !finished(task.status)) || item.latest_task || tasks.at(-1);
    const status = task?.status === 'succeeded' && (globalThis.MethodAtlasStorage?.local || localStorage).getItem(`chat-read:${current.id}:${item.id}`) === task.id ? null : task?.status;
    return `<button type="button" class="conversation-row${item.id === conversation?.id ? ' active' : ''}" data-action="conversation" data-id="${esc(item.id)}"${item.id === conversation?.id ? ' aria-current="true"' : ''}><span class="conversation-icon" aria-hidden="true">${icon('chat')}</span><span class="conversation-body"><strong>${esc(item.title || '新对话')}</strong>${item.visibility === 'private' ? '<small>私人 · 仅自己可见</small>' : ''}</span>${taskMarker(item.id === conversation?.id && pending ? 'queued' : status)}</button>`;
  }).join('') || '<p class="empty-small">没有匹配的对话。</p>';
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { markConversationRead(); renderConversationRows(); }
  if (!document.hidden && state?.collaboration && current && conversation && !pending) void refreshTask(activeTaskId,viewGeneration,current.id,conversation.id);
});
window.addEventListener('online', () => { if (state?.collaboration && current && conversation && !pending) void refreshTask(activeTaskId,viewGeneration,current.id,conversation.id); });

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
  host.innerHTML = `<div class="chat-list-tools"><button class="primary chat-new" data-action="new-chat" data-search-background="conversation" ${window.MethodAtlasSearch?.listOpen('conversation')?'inert':''}>${icon('plus')}新建对话</button>${window.MethodAtlasSearch?.compact('conversation') || ''}</div>${state?.collaboration ? '<button type="button" class="pill chat-new" data-action="new-private-chat">新建私人探索</button>' : ''}<div class="conversation-list">${conversationRowsHTML()}</div>`;
  const heading = document.querySelector('#sources-panel .panel-head h2');
  if (heading) heading.textContent = '历史对话';
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
    committedShellView = 'library'; previewingShell = false;
    detail = {paper, page, focus}; renderPaperViews(); saveWorkspaceState(); revealPanel('chat-panel');
    const reader = document.querySelector('.reader-stage');
    if ((!focus || focus.readingPosition) && reader && !(window.MethodAtlasSettings?.reducedMotion() || matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      // Keep the tools stationary while the selected document replaces the library.
      reader.animate([{opacity:.55},{opacity:1}], {duration:180,easing:'cubic-bezier(.16,1,.3,1)'});
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


// One evidence preview for the workspace; the citation ID retains its source version.
let citationPreview = null, citationHoverTimer, citationLeaveTimer;
function closeCitationPreview() {
  clearTimeout(citationHoverTimer); clearTimeout(citationLeaveTimer);
  if (!citationPreview) return;
  citationPreview.anchor.setAttribute('aria-expanded','false');
  citationPreview.box.remove(); citationPreview = null;
}
async function previewCitation(anchor, pinned = false) {
  clearTimeout(citationHoverTimer); clearTimeout(citationLeaveTimer);
  if (citationPreview?.anchor === anchor && citationPreview.box.matches(':popover-open')) {
    citationPreview.pinned ||= pinned;
    if(pinned)citationPreview.box.focus();
    return;
  }
  closeCitationPreview();
  const project = current?.id, generation = viewGeneration;
  const box = document.createElement('section');
  box.className = 'citation-preview'; box.id = 'citation-preview';
  box.setAttribute('popover','auto'); box.setAttribute('role','dialog'); box.setAttribute('aria-label','引用原文'); box.tabIndex = -1;
  const preview = {anchor,box,pinned,project,generation,request:uid()}; citationPreview = preview;
  anchor.setAttribute('aria-expanded','true'); anchor.setAttribute('aria-controls',box.id);
  box.innerHTML = '<p role="status">正在读取引用…</p>';
  document.body.append(box); box.showPopover();
  const position = () => {
    if(!anchor.isConnected)return closeCitationPreview();
    const r=anchor.getBoundingClientRect(), q=box.getBoundingClientRect();
    box.style.left=Math.max(12,Math.min(r.left,innerWidth-q.width-12))+'px';
    box.style.top=Math.max(12,Math.min(r.bottom+8,innerHeight-q.height-12))+'px';
  };
  const leave = () => {clearTimeout(citationLeaveTimer);citationLeaveTimer=setTimeout(()=>{if(citationPreview===preview && !preview.pinned)closeCitationPreview();},180);};
  box.addEventListener('pointerenter',()=>clearTimeout(citationLeaveTimer));box.addEventListener('pointerleave',leave);
  box.addEventListener('toggle',()=>{if(!box.matches(':popover-open') && citationPreview===preview)closeCitationPreview();});
  box.addEventListener('focusin',()=>{preview.pinned=true;});
  position();if(pinned)box.focus();
  try {
    const c=await api(`/api/projects/${project}/citations/${encodeURIComponent(anchor.dataset.id)}`);
    if(citationPreview!==preview || current?.id!==project || viewGeneration!==generation)return;
    box.innerHTML=`<header><h3>${esc(c.title)}</h3><button type="button" class="icon" aria-label="关闭引用预览">${icon('close')}</button></header><blockquote>${esc(c.quote || '此引用未保存原文片段。')}</blockquote><footer><button type="button" data-citation-open>查看原文 ${icon('chevron')}</button><button type="button" data-citation-note ${c.quote?'':'disabled'}>保存为笔记</button></footer><p class="citation-preview-status" role="status"></p>`;
    box.querySelector('header button').onclick=()=>{closeCitationPreview();anchor.focus();};
    box.querySelector('[data-citation-open]').onclick=()=>{closeCitationPreview();openCitation(c.id);};
    box.querySelector('[data-citation-note]').onclick=async event=>{
      const button=event.currentTarget,status=box.querySelector('[role=status]');
      if(button.disabled)return;button.disabled=true;preview.pinned=true;status.textContent='正在保存…';
      const document=[{id:'quote',type:'quote',children:[{text:c.quote}]},{id:'source',type:'p',children:[{text:`来源：${c.title} · 第 ${c.page} 页 `},{type:'citation',citation_id:c.id,children:[{text:''}]},{text:''}]}];
      try {
        const saved=await api(`/api/projects/${project}/documents`,{method:'POST',body:JSON.stringify({request_id:preview.request,title:('引用笔记 · '+c.title).slice(0,300),document})});
        status.textContent='已保存到右侧成果区。';button.textContent='已保存';
        if(current?.id===project && viewGeneration===generation){const loaded=await api(`/api/projects/${project}`);if(current?.id===project && viewGeneration===generation){current=loaded;if(citationPreview===preview)await loadArtifact(saved.artifact_id);else renderOutput();}}
      } catch(error) {status.textContent=error.message;button.disabled=false;}
    };
    position();
  } catch(error) {if(citationPreview===preview){box.innerHTML=`<p role="status">${esc(error.message)}</p>`;position();}}
}
document.addEventListener('pointerover',event=>{
  const anchor=event.target.closest('[data-action="citation"]');
  if(!anchor || anchor.contains(event.relatedTarget) || event.pointerType==='touch' || citationPreview?.pinned)return;
  clearTimeout(citationLeaveTimer);clearTimeout(citationHoverTimer);
  citationHoverTimer=setTimeout(()=>previewCitation(anchor),250);
});
document.addEventListener('pointerout',event=>{
  const anchor=event.target.closest('[data-action="citation"]');
  if(!anchor || anchor.contains(event.relatedTarget))return;
  clearTimeout(citationHoverTimer);clearTimeout(citationLeaveTimer);
  citationLeaveTimer=setTimeout(()=>{if(citationPreview?.anchor===anchor && !citationPreview.pinned && !citationPreview.box.matches(':hover'))closeCitationPreview();},180);
});
window.addEventListener('resize',closeCitationPreview);
document.addEventListener('scroll',event=>{if(citationPreview && !citationPreview.box.contains(event.target))closeCitationPreview();},true);
document.addEventListener('click',event=>{if(!event.target.closest('[data-action="citation"],.citation-preview'))closeCitationPreview();},true);

async function openCitation(id, previewCurrent = () => true) {
  const generation = viewGeneration, projectId = current?.id;
  try { const c = await api(`/api/projects/${projectId}/citations/${encodeURIComponent(id)}`); if (generation === viewGeneration && current?.id === projectId && previewCurrent()) await showPaper(c.paper_id,c.page,c.paper_version_id,{...c,previewCurrent}); }
  catch (error) { toast(error.message); }
}

// The composer owns one round button: it sends, and while the agent is thinking it stops instead.
// Typing a draft always turns it back into send, so the stop control never blocks the next message.
const runningTask = () => (conversation?.messages || []).map(message => message.task).filter(task => task && !finished(task.status)).at(-1) || null;
const stoppingTasks = new Set();
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
  button.disabled = mode === 'submitting' || (mode === 'stop' && stoppingTasks.has(task.id));
  button.classList.toggle('stop', mode !== 'send');
  button.setAttribute('aria-label', labels[mode]);
  button.title = mode === 'send' ? '发送；有任务时自动调整方向' : labels[mode];
  // 参考稿样式：发送按钮只保留图形，不放文字；语义由 aria-label / title 承担
  button.innerHTML = icon(mode === 'send' ? 'arrow' : 'stop');
  if (mode === 'stop') { button.dataset.action = 'stop'; button.dataset.control = 'stop'; button.dataset.id = task.id; }
  else { delete button.dataset.action; delete button.dataset.control; delete button.dataset.id; }
}

function appendChatPrompt(text) {
  const input = document.getElementById('chat-input');
  if (!input) return;
  if (!input.value.includes(text)) input.value = [input.value, text].filter(Boolean).join('\n\n');
  input.dispatchEvent(new Event('input', {bubbles:true}));
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function selectedFragments(conversationId = conversation?.id) {
  try { const value=JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`selected-fragments:${conversationId}`)||'[]');return Array.isArray(value)?value:[]; } catch {return [];}
}
function saveSelectedFragments(fragments, conversationId = conversation.id) {
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`selected-fragments:${conversationId}`,JSON.stringify(fragments));
}
function fragmentCards(fragments, removable = false) {
  if(!fragments?.length)return '';
  return `<details class="selected-fragments"><summary><span>${fragments.length} 个已选文本片段</span>${removable?'<button type="button" class="selected-fragments-remove" data-remove-all-fragments aria-label="移除已选文本片段">×</button>':''}</summary><div class="selected-fragment-list">${fragments.map((f,i)=>`<div class="selected-fragment"><div><small>${esc(f.title || '文档')}${f.version_no ? ` · v${f.version_no}` : ''}</small>${removable?`<button type="button" data-remove-fragment="${esc(f.id)}" aria-label="移除文本片段 ${i+1}">×</button>`:''}</div><blockquote>${esc(f.text)}</blockquote>${f.truncated?'<small>已附内容摘录，可按来源版本回读全文。</small>':''}${f.notes?.length ? `<div class="selected-fragment-notes"><small>个人批注</small>${f.notes.map(note=>`<p>第 ${note.page} 页：${esc(note.comment)}</p>`).join('')}</div>` : ''}</div>`).join('')}</div></details>`;
}
function addSelectedFragment(fragment) {
  const fragments=selectedFragments();
  if(fragments.length>=20||[...fragments,fragment].reduce((n,f)=>n+f.text.length+(f.notes||[]).reduce((sum,note)=>sum+note.comment.length,0),0)>20000)throw Error('最多添加20个片段，总计20000字符');
  saveSelectedFragments([...fragments,fragment]);
  renderChat();
  document.getElementById('chat-input')?.focus({preventScroll:true});
}

function composer() {
  return `<form class="composer" id="chat-form" aria-busy="false"><div id="selected-fragment-draft">${fragmentCards(selectedFragments(),true)}</div><label class="sr-only" for="chat-input">给 Agent 的问题</label><textarea id="chat-input" placeholder="你想研究什么？">${esc((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`draft:${conversation.id}`) || '')}</textarea><div class="composer-bottom"><div class="composer-tools"><button type="button" class="workbench-trigger" aria-label="Skill 工作台" title="Skill 工作台" data-action="skill-workbench" popovertarget="skill-workbench">${icon('plus')}<span class="sr-only">Skill 工作台</span></button></div>${window.MethodAtlasSettings?.controls() || ''}<div class="row"><button class="send-button" type="submit" aria-label="发送任务" title="发送；有任务时自动调整方向">${icon('arrow')}</button></div></div></form>`;
}

// Keep complete backend answers readable immediately; only new message containers fade in.
const copiedAnswers = new Set();
const savingAnswers = new Set(), savedAnswers = new Map();
const answerNoteKey = id => `answer-note:${current.id}:${id}`;
function savedAnswer(id) {
  const key = answerNoteKey(id);
  try { return savedAnswers.get(key) || (globalThis.MethodAtlasStorage?.local || localStorage).getItem(key); } catch { return savedAnswers.get(key); }
}
function answerActions(id) {
  const saving = savingAnswers.has(answerNoteKey(id)), saved = savedAnswer(id);
  const label = saving ? '正在保存…' : saved ? '打开笔记' : '保存为笔记';
  return `<div class="answer-actions" role="group" aria-label="回答操作"><button type="button" class="answer-save" data-action="save-answer" data-id="${esc(id)}" aria-label="${label}" ${saving ? 'disabled aria-busy="true"' : ''}>${icon(saved ? 'check' : 'pin')}<span>${label}</span></button>${copyAnswerButton(id)}</div>`;
}
function copyAnswerButton(id) {
  const copied = copiedAnswers.has(id);
  return `<button type="button" class="answer-copy" data-action="copy-answer" data-id="${esc(id)}" aria-label="${copied ? '已复制' : '复制回答'}">${icon(copied ? 'check' : 'copy')}</button>`;
}
function answerNoteDocument(message) {
  const nodes = message.text.split(/\n+/).filter(line => line.trim()).map((line,index) => {
    const heading = line.match(/^(#{1,3})\s+(.*)/), template = document.createElement('template');
    template.innerHTML = renderAnswerInlineText(heading ? heading[2] : line,message.task);
    template.content.querySelector('.answer-sources')?.remove();
    const read = (node,bold=false) => node.nodeType === Node.TEXT_NODE ? [{text:node.textContent,...(bold ? {bold:true} : {})}]
      : node.dataset?.action === 'citation' ? [{type:'citation',citation_id:node.dataset.id,children:[{text:''}]}]
      : [...node.childNodes].flatMap(child => read(child,bold || node.tagName === 'STRONG'));
    const children = [...template.content.childNodes].flatMap(node => read(node));
    return {id:`answer-${index}`,type:heading ? `h${heading[1].length}` : 'p',children:children.length ? children : [{text:''}]};
  });
  const sources = document.createElement('template');
  sources.innerHTML = renderAnswerInlineText(message.text,message.task);
  const citations = [...sources.content.querySelectorAll('.answer-sources [data-action=citation]')];
  if (citations.length) nodes.push({id:'answer-sources',type:'p',children:[{text:'本次读取的原文（未标注到具体句子）：'},...citations.map(node=>({type:'citation',citation_id:node.dataset.id,children:[{text:''}]}))]});
  return nodes;
}
async function saveAnswer(target) {
  const id = target.dataset.id, key = answerNoteKey(id), saved = savedAnswer(id);
  if (savingAnswers.has(key)) return;
  if (saved) { await loadArtifact(saved); return; }
  const message = conversation.messages.find(message => message.id === id && message.role !== 'user');
  if (!message?.text.trim()) return;
  const projectId = current.id, conversationId = conversation.id, generation = viewGeneration;
  savingAnswers.add(key); target.disabled = true; target.setAttribute('aria-busy','true'); target.setAttribute('aria-label','正在保存…'); target.innerHTML = icon('pin') + '<span>正在保存…</span>';
  try {
    const result = await api(`/api/projects/${projectId}/documents`,{method:'POST',body:JSON.stringify({request_id:`answer-note:${id}`,title:message.text.replace(/^#+\s*/,'').split('\n').find(line=>line.trim())?.slice(0,80) || '对话笔记',document:answerNoteDocument(message)})});
    savedAnswers.set(key,result.artifact_id);
    try { (globalThis.MethodAtlasStorage?.local || localStorage).setItem(key,result.artifact_id); } catch { /* The saved note remains available in the project. */ }
    if (isCurrentView(generation,projectId,conversationId)) {
      const latest = await api(`/api/projects/${projectId}`);
      if (isCurrentView(generation,projectId,conversationId)) { current = latest; renderOutput(); toast('已保存为笔记，可点击打开。'); }
    }
  } catch (error) { if (isCurrentView(generation,projectId,conversationId)) toast(savedAnswers.has(key) ? '笔记已保存，成果列表暂未刷新；可点击打开笔记。' : error.message); }
  finally {
    savingAnswers.delete(key);
    if (isCurrentView(generation,projectId,conversationId)) {
      const focused = document.activeElement === target;
      renderChat();
      if (focused) document.querySelector(`[data-action="save-answer"][data-id="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
    }
  }
}
async function copyAnswer(target) {
  const id = target.dataset.id;
  const node = document.querySelector(`[data-answer="${CSS.escape(id)}"]`);
  if (!node || copiedAnswers.has(id)) return;
  try {
    const message = conversation.messages.find(message => message.id === id);
    if (!message) return;
    // Preserve the original plain-text payload when the visible answer uses block formatting.
    const original = document.createElement('p');
    original.className = 'answer-text answer-copy-text';
    original.setAttribute('aria-hidden','true'); original.inert = true;
    original.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre-wrap;pointer-events:none';
    original.style.width = `${node.clientWidth}px`;
    original.innerHTML = renderAnswerInlineText(chatAnswerText(message),message.task);
    let text;
    try { node.parentElement.append(original); text = original.innerText; }
    finally { original.remove(); }
    await navigator.clipboard.writeText(text);
    copiedAnswers.add(id);
    if (target.isConnected) { target.innerHTML = icon('check'); target.setAttribute('aria-label','已复制'); }
    toast('回答已复制');
    setTimeout(() => {
      copiedAnswers.delete(id);
      const button = document.querySelector(`[data-action="copy-answer"][data-id="${CSS.escape(id)}"]`);
      if (button) { button.innerHTML = icon('copy'); button.setAttribute('aria-label','复制回答'); }
    },1800);
  } catch { toast('复制失败，请选择回答文字后复制。'); }
}

function answerTextContext(raw, task) {
  const citations = task?.citations || [];
  const numbers = new Map([...new Set(citations.map(c=>c.id))].map((id,index)=>[id,index+1]));
  // Older answers may quote evidence verbatim but omit the model's citation marker.
  // Only exact saved excerpts get a sentence-level link; reading a source is not proof of a claim.
  const normalize = text => text.replace(/\s+/g,' ').trim();
  raw = raw.replace(/^>\s*([^\n]+)$/gm,(line,quote) => {
    if(line.includes('[cite:'))return line;
    const excerpt=normalize(quote);
    if(excerpt.length<12)return line;
    const matches=citations.filter(c=>c.quote && normalize(c.quote).includes(excerpt));
    return line+matches.map(c=>` [cite:${c.id}]`).join('');
  });
  const used=new Set([...raw.matchAll(/\[cite:([^\]]+)\]/g)].map(match=>match[1]));
  const unlinked=[...new Map(citations.filter(c=>c.id && !used.has(c.id)).map(c=>[c.id,c])).values()];
  // Downloads come from persisted file cards, never from model-authored URLs.
  raw = raw.replace(/\[[^\]\n]*\]\((?:https?:\/\/[^/\s)]+)?\/api\/projects\/[^\s)]+\/download(?:[?#][^\s)]*)?\)/g,'')
    .replace(/(?:https?:\/\/[^/\s)]+)?\/api\/projects\/[^\s)]+\/download(?:[?#][^\s)]*)?/g,'');
  return {raw,task,citations,numbers,unlinked};
}
function renderAnswerInline(raw, {task,citations,numbers}) {
  return esc(raw).replace(/^#{1,6}\s+(.+)$/gm,'<strong>$1</strong>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\[cite:([^\]]+)\]/g, (match,id) => { const c = citations.find(c => c.id === id); return c ? citationLink(c,'citation-inline',numbers.get(c.id)) : match; }).replace(/\[([^\]]+)\]\((\/api\/projects\/[^)]+\/download)\)/g,(match,label,url) => task?.files?.some(f => fileUrl(f.artifact_id,f.version_id) === url) ? '' : match);
}
function renderAnswerSources({unlinked,numbers}) {
  return unlinked.length?`<span class="answer-sources"><span class="answer-sources-label">本次读取的原文 <span>未标注到具体句子</span></span><span class="answer-source-links">${unlinked.map(c=>citationLink(c,'citation-inline',numbers.get(c.id))).join('')}</span></span>`:'';
}
// Notes and copied text keep the existing inline representation and source appendix.
function renderAnswerInlineText(raw, task) {
  const context = answerTextContext(raw,task);
  return renderAnswerInline(context.raw,context) + renderAnswerSources(context);
}
function answerTableRow(line) {
  const value = line.trim(), cells = [];
  let cell = '', pipes = 0, codeTicks = 0, leading = false, trailing = false;
  for (let index=0;index<value.length;index++) {
    const char = value[index];
    if (char === '\\' && (value[index+1] === '|' || value[index+1] === '\\')) {
      cell += value[index+1] === '|' ? '|' : '\\\\'; index++; trailing = false;
    } else if (char === '`') {
      let end = index+1;
      while (value[end] === '`') end++;
      const count = end-index;
      if (!codeTicks) codeTicks = count; else if (codeTicks === count) codeTicks = 0;
      cell += value.slice(index,end); index = end-1; trailing = false;
    } else if (char === '|' && !codeTicks) {
      leading ||= index === 0; cells.push(cell.trim()); cell = ''; pipes++; trailing = true;
    } else { cell += char; trailing = false; }
  }
  if (!pipes) return null;
  cells.push(cell.trim());
  if (leading) cells.shift();
  if (trailing) cells.pop();
  return cells;
}
function answerTableStart(lines, index) {
  const header = answerTableRow(lines[index]), separator = answerTableRow(lines[index+1] || '');
  return header?.length && separator?.length === header.length && separator.every(cell => /^:?-{3,}:?$/.test(cell))
    ? {header,align:separator.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left')}
    : null;
}
function answerListItem(line) {
  const match = line.match(/^ {0,3}(?:([-+*])|([0-9]{1,9})[.)])\s+(.+)$/);
  return match ? {type:match[1] ? 'ul' : 'ol',start:match[2] ? Number(match[2]) : null,text:match[3]} : null;
}
function renderAnswerText(raw, task) {
  const context = answerTextContext(raw,task), lines = context.raw.replace(/\r\n?/g,'\n').split('\n'), blocks = [];
  const inline = text => renderAnswerInline(text,context);
  for (let index=0;index<lines.length;) {
    if (!lines[index].trim()) { index++; continue; }
    // Keep fenced examples literal rather than interpreting their table/list syntax.
    const fence = lines[index].match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const paragraph = [lines[index++]];
      while (index<lines.length) {
        const line = lines[index++]; paragraph.push(line);
        const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === fence[1][0] && close[1].length >= fence[1].length) break;
      }
      blocks.push(`<p>${inline(paragraph.join('\n'))}</p>`); continue;
    }
    const table = answerTableStart(lines,index);
    if (table) {
      index += 2;
      const rows = [];
      while (index<lines.length) {
        const row = answerTableRow(lines[index]);
        if (!row || row.length !== table.header.length) break;
        rows.push(row); index++;
      }
      const cells = (row,tag) => row.map((cell,column) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} class="answer-align-${table.align[column]}">${inline(cell)}</${tag}>`).join('');
      blocks.push(`<div class="answer-table-scroll" tabindex="0" role="region" aria-label="回答表格"><table><thead><tr>${cells(table.header,'th')}</tr></thead><tbody>${rows.map(row=>`<tr>${cells(row,'td')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    const list = answerListItem(lines[index]);
    if (list) {
      const items = [];
      while (index<lines.length) {
        const item = answerListItem(lines[index]);
        if (!item || item.type !== list.type || answerTableStart(lines,index)) break;
        items.push(`<li>${inline(item.text)}</li>`); index++;
      }
      blocks.push(`<${list.type}${list.type === 'ol' ? ` start="${list.start}"` : ''}>${items.join('')}</${list.type}>`); continue;
    }
    const paragraph = [lines[index++]];
    while (index<lines.length && lines[index].trim() && !answerTableStart(lines,index) && !answerListItem(lines[index]) && !/^ {0,3}(?:`{3,}|~{3,})/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(`<p>${inline(paragraph.join('\n'))}</p>`);
  }
  return blocks.join('') + renderAnswerSources(context);
}
function chatAnswerText(message) {
  return message.task?.refs?.index_search || hasPaperResults(message.task)
    ? message.text.replace(/来源查询失败[：:][\s\S]*?(?:不代表没有相关论文。|$)/g,'') : message.text;
}

function hasPaperResults(task) {
  return task?.waits?.some(w => w.payload.kind === 'papers' && !w.payload.draft);
}

const processVisibility = new IntersectionObserver(entries => entries.forEach(({target,isIntersecting}) => {
  target.dataset.visible = String(isIntersecting);
  target.style.animationPlayState = isIntersecting && !document.hidden ? 'running' : 'paused';
}));
document.addEventListener('visibilitychange', () => document.querySelectorAll('.process-indicator').forEach(node => {
  node.style.animationPlayState = node.dataset.visible === 'true' && !document.hidden ? 'running' : 'paused';
}));

function renderChat(forceBottom = false, history = false) {
  if(window.MethodAtlasAI?.loading())return;
  if (shellOwnsPanels() && !window.MethodAtlasAI?.isOpen()) return;
  window.MethodAtlasAI?.mainPlaceholder();
  const host = window.MethodAtlasAI?.host() || document.getElementById('chat-body');
  markConversationRead();
  const previousForm = document.getElementById('chat-form');
  const inputFocus = document.activeElement?.id === 'chat-input';
  const caret = inputFocus ? [document.activeElement.selectionStart,document.activeElement.selectionEnd] : null;
  const previousLog = document.getElementById('chat-log');
  const previousRows = new Set([...previousLog?.querySelectorAll('[data-process-row]') || []].map(node => node.dataset.processRow));
  const motionTimes = new Map([...previousLog?.querySelectorAll('.process-indicator') || []].map(node => [node.closest('details').dataset.disclosure, {kind:node.dataset.motion,time:node.getAnimations()[0]?.currentTime}]));
  const scrollTop = previousLog?.scrollTop || 0;
  const followBottom = forceBottom || !previousLog || previousLog.scrollHeight - previousLog.clientHeight - scrollTop < 4;
  // Preserve blocks being read, including across task completion.
  previousLog?.querySelectorAll('details[open][data-disclosure]').forEach(node => {
    const rect = node.getBoundingClientRect(), viewport = previousLog.getBoundingClientRect();
    if (node.contains(document.activeElement) || (!followBottom && rect.bottom > viewport.top && rect.top < viewport.bottom)) disclosureState.set(node.dataset.disclosure,true);
  });
  const focusedKey = document.activeElement?.tagName === 'SUMMARY' ? document.activeElement.parentElement.dataset.disclosure : null;
  const started = conversation.messages.length > 0;
  const previousIds = new Set([...previousLog?.querySelectorAll('[data-message-id]') || []].map(node => node.dataset.messageId));
  const answeredTasks = new Set(conversation.messages.filter(message => message.role !== 'user').map(message => message.task?.id).filter(Boolean));
  const messages = conversation.messages.map(message => {
    const task = message.task;
    const fresh = !history && previousForm && message.id && !previousIds.has(message.id) ? ' message-enter' : '';
    if (message.role === 'user') return `<div class="message user${fresh}" data-message-id="${esc(message.id || 'pending')}">${fragmentCards(task?.refs ? [...(task.refs.selected_fragments || []),...(task.refs.context_references || [])] : message.selected_fragments)}${esc(message.text)}</div>${task && conversation.visibility !== 'private' && task.kind !== 'skill' ? window.MethodAtlasCollaboration?.relatedButton('run',task.id) || '' : ''}${task && !answeredTasks.has(task.id) ? `<div class="message agent${!finished(task.status) ? ' working' : ''}"><div class="agent-name">${icon('spark')}MethodAtlas</div>${renderProgress(task,!finished(task.status))}${taskControls(task)}</div>` : ''}`;
    const answer = chatAnswerText(message);
    return `<div class="message agent${fresh}" data-message-id="${esc(message.id)}">${hasPaperResults(task) ? '' : `<div class="agent-name">${icon('spark')}MethodAtlas</div>`}${renderProgress(task)}${taskControls(task || {})}<div class="answer-text" data-answer="${esc(message.id)}">${renderAnswerText(answer, task)}</div>${(task?.status === 'succeeded' ? task.citations || [] : []).filter(c => c.kind === 'figure').map(renderFigureInsight).join('')}${task?.status === 'succeeded' && task?.files?.length ? `<div class="file-list">${task.files.map(f => `<button class="file-card" data-action="file" data-id="${esc(f.artifact_id)}" data-version="${esc(f.version_id)}">${icon('output')}<span class="file-title">${esc(f.title)}</span><span class="file-version">${esc(artifactKindLabel(f))} · v${f.version_no}</span></button>`).join('')}</div>` : ''}${task?.refs?.progress_proposal?.id ? `<button type="button" data-diary="proposal" data-day="${esc(task.refs.progress_proposal.day)}">查看修订提案</button>` : ''}${answer ? answerActions(message.id) : ''}${state?.collaboration && conversation.visibility === 'private' && task?.status === 'succeeded' ? `<button type="button" class="answer-copy" data-action="publish-answer" data-id="${esc(message.id)}">发布为共享笔记</button>` : ''}</div>`;
  }).join('');
  const workingTask = conversation.messages.filter(message => message.role === 'user').map(message => message.task).find(task => task && !finished(task.status));
  const working = pending && !workingTask ? `<div class="message agent working"><div class="agent-name">${icon('spark')}MethodAtlas</div>${renderProgress(workingTask || liveTask, true)}</div>` : '';
  // The composer dock starts centred like a welcome screen and drops to the bottom once the conversation begins.
  const dropIn = started && lastStarted === false ? ' dock-enter' : '';
  lastStarted = started;
  const dock = `<div class="composer-dock${dropIn}">${conversation.visibility === 'private' ? '<p class="empty-small">私人探索 · 仅自己可见</p>' : ''}${queuePanel()}${composer()}</div>`;
  host.innerHTML = started ? `<div class="chat-body started"><div class="chat-log" id="chat-log">${conversation.has_more ? `<button type="button" class="secondary" data-action="older-messages" ${historyLoading?.generation === viewGeneration ? 'disabled aria-busy="true"' : ''}>${historyLoading?.generation === viewGeneration ? '加载中…' : '加载更早消息'}</button>` : ''}${messages}${working}${connectionNotice()}</div>${dock}</div>` : `<div class="chat-body"><div class="welcome"><div class="welcome-intro"><h1>从一个研究问题开始</h1><p class="welcome-ask">结合项目文献，比较方法、梳理脉络、形成成果</p></div>${dock}<nav class="research-shortcuts" aria-label="研究工具">${['lit-review','map','evolution','graph','experiment-plan','result-to-claim'].map(key => `<button type="button" data-action="task" data-value="${key}" title="${esc(taskInfo[key].description)}" ${pending ? 'disabled' : ''}>${researchIcon(key)}<span>${esc(taskInfo[key].title)}</span></button>`).join('')}<button type="button" data-skills-open>${researchIcon('skills')}<span>我的技能</span></button></nav><p class="research-hint">选择工具后可编辑要求，发送时开始研究</p></div></div>`;
  if (previousForm) document.getElementById('chat-form').replaceWith(previousForm);
  processVisibility.disconnect();
  document.querySelectorAll('.process-indicator').forEach(node => {
    const previous = motionTimes.get(node.closest('details').dataset.disclosure), animation = node.getAnimations()[0];
    if (animation && previous?.kind === node.dataset.motion && previous.time != null) animation.currentTime = previous.time;
    processVisibility.observe(node);
  });
  document.querySelectorAll('.execution-record[open][data-running=true] [data-process-row]').forEach(node => {
    if (!previousRows.has(node.dataset.processRow)) node.classList.add('enter');
  });
  const fragmentHost=document.getElementById('selected-fragment-draft'), fragments=selectedFragments(), fragmentSignature=JSON.stringify(fragments);
  if(fragmentHost && fragmentHost.dataset.signature!==fragmentSignature){
    const open=fragmentHost.querySelector('details')?.open;
    fragmentHost.innerHTML=fragmentCards(fragments,true);fragmentHost.dataset.signature=fragmentSignature;
    if(open && fragmentHost.firstElementChild)fragmentHost.firstElementChild.open=true;
  }
  syncComposer(document.getElementById('chat-form'));
  window.MethodAtlasAI?.sync();
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
    const year = String(p.published || '').match(/^\d{4}/)?.[0] || '年份未知';
    const version = ({publishedVersion:'正式发表版',acceptedVersion:'录用稿',submittedVersion:'投稿稿'})[p.source_version]
      || (p.source === 'arxiv' || p.publication_type === 'preprint' ? '预印本' : '版本未标明');
    const reason = recommendations?.find(p => p.candidate_id === c.id)?.reason || c.reasons?.[0]?.text || '检索命中；尚无推荐理由，请打开论文核对。';
    const title = /^https?:\/\//i.test(p.url || '')
      ? `<a class="candidate-title" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.title)}">${esc(p.title)}</a>`
      : `<span class="candidate-title" title="${esc(p.title)}">${esc(p.title)}</span>`;
    return `<li class="candidate-item"><div class="candidate-row">${title}${button('collect-papers','收录',`data-wait="${esc(w.id)}" data-candidate="${esc(c.id)}" aria-label="收录：${esc(p.title)}"`)}</div><p class="paper-meta">${esc(year)} · ${esc(version)}</p><p class="candidate-reason">${esc(reason)}</p></li>`;
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
  if (task.status !== 'waiting' && !waits.length) return '';
  const button = (action,label,extra='') => `<button type="button" data-action="control" data-control="${action}" data-id="${esc(task.id)}" ${extra}>${label}</button>`;
  const labels = {queued:'正在准备回答…',routing:'正在回答…',running:'正在处理…',waiting:'等待确认'};
  return `<div class="task-results">${task.status !== 'succeeded' && !waits.some(w => w.payload.kind === 'papers') ? `<p role="status">${labels[task.status] || ''}</p>` : ''}${waits.map(w => w.payload.kind === 'papers' ? paperWait(w,task,button) : `<div><p>${esc(w.payload.title || '')}：${esc(w.payload.description || '')}</p>${button('confirm','确认',`data-wait="${esc(w.id)}" data-accepted="true"`)}${button('confirm','不采纳',`data-wait="${esc(w.id)}" data-accepted="false"`)}</div>`).join('')}</div>`;
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
  if (!taskId || !current || !conversation || stoppingTasks.has(taskId)) return;
  stoppingTasks.add(taskId);
  const generation = viewGeneration, projectId = current.id, conversationId = conversation.id;
  const button = document.querySelector('.send-button[data-action="stop"]');
  if (button) button.disabled = true;
  try {
    await api(`/api/projects/${projectId}/conversations/${conversationId}/tasks/${taskId}/stop`,{method:'POST',body:'{}'});
    await refreshTask(taskId,generation,projectId,conversationId);
  } catch (error) { if(isCurrentView(generation,projectId,conversationId))toast(error.message); }
  finally { stoppingTasks.delete(taskId); syncComposer(); }
}

function renderOutput() {
  const host = document.getElementById('output-body');
  if (!host) return;
  hideTextSelection();
  const version = artifact && (artifact.viewed_snapshot && artifact.viewed_snapshot.id === versionId ? artifact.viewed_snapshot : artifact.versions.find(v => v.id === versionId) || artifact.versions.at(-1));
  syncPanelLayout();
  const draftView = version?.kind === 'manuscript' && (!versionId || versionId === 'draft');
  const nextKey = version ? `${artifact.id}:${draftView ? 'draft' : version.id}` : null;
  if (nextKey && nextKey === outputKey) return;
  window.MethodAtlasWriting?.unmount();
  outputKey = nextKey;
  if (version) versionId = draftView ? 'draft' : version.id;
  window.MethodAtlasComments?.sync(current?.id, artifact?.id, versionId);
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
  if (version && state?.collaboration) document.getElementById('studio-tools').insertAdjacentHTML('beforeend', '<button type="button" class="pill" data-comment-toggle>评论</button>');
  if (version && current.artifacts.find(item => item.id === artifact.id)?.visibility !== 'private') document.getElementById('studio-tools').insertAdjacentHTML('beforeend', window.MethodAtlasCollaboration?.relatedButton('artifact', artifact.id, !draftView && artifact.versions.some(v => v.id === version.id) ? version.id : null) || '');
  if (version?.kind === 'manuscript' && state?.collaboration && current.artifacts.find(item => item.id === artifact.id)?.visibility === 'private') document.getElementById('studio-tools').insertAdjacentHTML('beforeend', '<button type="button" class="pill" data-action="publish-document">发布副本</button>');
  if (version?.kind === 'graph' && version.id !== artifact.versions.at(-1).id) document.getElementById('studio-tools').insertAdjacentHTML('beforeend','<button data-action=restore-graph>恢复此版</button>');
  if (version && ['html','docx'].includes(version.kind) && version.id !== artifact.versions.at(-1).id) document.getElementById('studio-tools').insertAdjacentHTML('beforeend', '<button data-action="restore-artifact" title="追加恢复版本，保留当前及历史内容">恢复此版</button>');
  if (version?.kind === 'manuscript') {
    host.innerHTML = '';
    if (!window.MethodAtlasWriting) { outputKey = null; host.innerHTML = '<p role="status">编辑器正在加载，请稍候…</p>'; return; }
    document.querySelector('#studio-tools .download-menu')?.remove();
    const picker = document.getElementById('version-select');
    picker.innerHTML = '<option value="draft">当前草稿</option>'+artifact.versions.map(v=>`<option value="${esc(v.id)}">v${v.version_no} · ${esc(v.payload.summary || new Date(v.created).toLocaleString())}</option>`).join('');
    if (artifact.viewed_snapshot) picker.insertAdjacentHTML('beforeend', `<option value="${esc(artifact.viewed_snapshot.id)}">引用快照</option>`);
    picker.value = versionId;
    window.MethodAtlasWriting.mount(host, {project:current.id,artifact:artifact.id,selectedVersion:draftView ? null : versionId,
      context:()=>({conversation:serverConversationId(),selected:[...selected],papers:current.papers}),onCitation:openCitation,onAddFragment:fragment=>window.MethodAtlasAI.open(fragment),
      // 历史版本只读，得让编辑区自己能一键回到最新版（否则用户只会觉得「打不进去字」）。
      onOpenLatest:()=>{versionId='draft';renderOutput();},
        onSaved:(loaded,restoreVersion)=>{if(current?.id!==loaded.project_id || artifact?.id!==loaded.id)return;artifact=loaded;versionId='draft';if(!restoreVersion)outputKey=`${loaded.id}:draft`;saveWorkspaceState(); const index=current.artifacts.findIndex(a=>a.id===loaded.id);if(index>=0)current.artifacts[index]={...current.artifacts[index],title:loaded.title,updated:loaded.updated};const picker=document.getElementById('version-select');if(picker)picker.innerHTML='<option value="draft" selected>当前草稿</option>'+loaded.versions.map(v=>`<option value="${esc(v.id)}">v${v.version_no} · ${esc(v.payload.summary || new Date(v.created).toLocaleString())}</option>`).join('');if(picker)syncSelectMenu(picker);if(restoreVersion){renderOutput();}}});
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
  const gaps = Array.isArray(citation.gaps) ? citation.gaps.filter(item => typeof item === 'string' && item.trim()) : [];
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
    ${gaps.length ? `<section><h4>解读边界</h4><ul>${gaps.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>` : ''}
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
  }document.addEventListener('click',readingCitation,true);document.addEventListener('keydown',readingCitation,true);
  // 划词探针：沙盒 iframe 的选区事件主页面收不到，统一经 postMessage 上报，由主页面渲染划词菜单。
  let selectionTimer=null;
  const reportSelection=clear=>{
    clearTimeout(selectionTimer);
    if(clear){parent.postMessage({type:'methodatlas-output-selection',clear:true},'*');return;}
    selectionTimer=setTimeout(()=>{
      const chosen=document.getSelection();
      if(!chosen||chosen.isCollapsed||!chosen.rangeCount){parent.postMessage({type:'methodatlas-output-selection',clear:true},'*');return;}
      const rects=Array.from(chosen.getRangeAt(0).getClientRects()).filter(r=>r.width>1&&r.height>1),anchor=rects.at(-1);
      if(!anchor){parent.postMessage({type:'methodatlas-output-selection',clear:true},'*');return;}
      parent.postMessage({type:'methodatlas-output-selection',quote:String(chosen).trim().slice(0,4000),rect:{left:anchor.left,top:anchor.top,right:anchor.right,bottom:anchor.bottom}},'*');
    },180);
  };
  document.addEventListener('selectionchange',()=>reportSelection(false),true);
  document.addEventListener('scroll',()=>reportSelection(true),true);
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const key=event.key.length===1?event.key.toLowerCase():event.key;
    if(key==='Escape'){reportSelection(true);return;}
    const action={e:'explain',t:'translate',c:'comment',Enter:'ask'}[key];
    if(action)parent.postMessage({type:'methodatlas-output-selection',action},'*');
  });`;
  doc.body.append(script);
  window.MethodAtlasComments?.installPreview(doc, nonce);
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
    const loaded = await api(`/api/projects/${projectId}/artifacts/${id}${version && version !== 'draft' ? '?version_id=' + encodeURIComponent(version) : ''}`);
    if (generation !== viewGeneration || current?.id !== projectId || request !== artifactRequest) return;
    if (loaded.kind === 'progress') {
      document.dispatchEvent(new CustomEvent('open-project-memory', {detail:{day:loaded.versions.at(-1)?.payload.day,version}}));
      return;
    }
    artifact = loaded; versionId = version || (loaded.kind === 'manuscript' ? 'draft' : loaded.default_version_id); renderOutput();
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
  const requestId = (globalThis.MethodAtlasStorage?.local || localStorage).getItem(requestKey) || uid();
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(requestKey,requestId);
  target.disabled = true;
  try {
    const result = await api(`/api/projects/${projectId}/artifacts/${id}/restore`,{method:'POST',body:JSON.stringify({version_id:version,base_version_id:base,request_id:requestId})});
    if (generation === viewGeneration && request === artifactRequest && current?.id === projectId && artifact?.id === id && versionId === version) await loadArtifact(id,result.version_id);
  } catch (error) { toast(error.message); }
  finally { if (target.isConnected) target.disabled = false; }
}

// The history menu opens the selected archive read-only. Only the editor's confirmed
// 恢复到当前草稿 action replaces the draft; viewing an archive must never write it.
async function restoreDocument(target) {
  const id = artifact?.id, version = target.dataset.id;
  if (target.disabled || !id || !artifact.versions.some(item => item.id === version)) return;
  target.disabled = true;
  try {
    await loadArtifact(id, version, false);
  } catch (error) { toast(error.message); }
  finally { if (target.isConnected) target.disabled = false; }
}

async function submit() {
  const input = document.getElementById('chat-input'), text = input.value.trim();
  if (!text) { if (!pending) toast('请先输入问题。'); return; }
  const writingProject=current.id,writingInput=input.value,local=conversation.local,fragments=selectedFragments(),settings=window.MethodAtlasSettings?.request();
  try{if(local && !await window.MethodAtlasAI.prepareSend())return;}catch(error){toast(error.message);return;}
  if(current?.id!==writingProject || !input.isConnected)return;
  const writingConversation = conversation.id;
  const isAudit = /查新|引用(?:核查|审计|核验)|独立.{0,4}(?:审阅|审稿)|novelty check|citation audit|independent (?:paper )?review/i.test(text) && !/^\s*(?:请)?\s*(?:解释|介绍|什么是|如何|怎么)/.test(text) && !/(?:请|帮我)\s*(?:(?:根据|按照|按).{0,25}?(?:报告|意见|建议|结果))?\s*(?:修复|修改|修正)/.test(text);
  const writingResult = isAudit || window.MethodAtlasSettings?.request().deep_research ? null : await window.MethodAtlasWriting?.submit(text);
  if (writingResult?.handled) { if(writingResult.submitted && current?.id === writingProject && conversation?.id === writingConversation && input.isConnected && input.value === writingInput) { input.value = ''; (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`draft:${writingConversation}`); } return; }
  try { await window.MethodAtlasWriting?.flush(); } catch(error) { return toast(error.message); }
  if(current?.id !== writingProject || conversation?.id !== writingConversation || !input.isConnected || !local && input.value !== writingInput) return;
  if (busyTask()) return enqueue(text);
  await dispatchMessage(text,fragments,false,settings);
}

async function dispatchMessage(text, fragments = selectedFragments(), fromQueue = false, settings = window.MethodAtlasSettings?.request(), queued = null) {
  try{if(conversation.local && !await window.MethodAtlasAI.prepareSend())return false;}catch(error){toast(error.message);return false;}
  const origin = {generation:viewGeneration,project:current.id,conversation:conversation.id};
  try { if (!queued?.request && !settings?.deep_research && await window.MethodAtlasProgress?.revise(text)) return true; } catch(error) {toast(error.message);return false;}
  if (!isCurrentView(origin.generation,origin.project,origin.conversation)) return false;
  const generation = viewGeneration, projectId = current.id, conversationId = conversation.id;
  const requestKey = `request:${conversationId}`;
  const prior = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(requestKey) || 'null');
  const referenceVersion = window.MethodAtlasAI?.isOpen() ? null : artifact && (versionId === 'draft' && artifact.draft || artifact.versions.find(v => v.id === versionId) || artifact.versions.at(-1));
  const referenceArtifactId = artifact?.id, selectedPaperIds = [...new Set([...selected,...fragments.filter(f=>f.kind==='paper').map(f=>f.paper_id)])];
  const progressContext = window.MethodAtlasAI?.isOpen() ? null : window.MethodAtlasProgress?.context();
  if (!queued?.request && referenceVersion?.id.startsWith('draft_')) {
    try { await api(`/api/projects/${projectId}/documents/${artifact.id}/snapshot`, {method:'POST',body:JSON.stringify({version_id:referenceVersion.id})}); }
    catch(error) {toast(error.message);return false;}
    if (!isCurrentView(generation,projectId,conversationId)) return false;
  }
  let payload = {text, ...settings, replace_active:true, selected_paper_ids:selectedPaperIds, reference: referenceVersion && (referenceVersion.kind === 'manuscript' || referenceVersion.conversation_id === conversationId || conversation.messages.some(m => m.task_id === referenceVersion.task_id)) ? {artifact_id:referenceArtifactId, version_id:referenceVersion.id} : null};
  if(referenceVersion && !payload.reference) payload.report_sources = [{artifact_id:referenceArtifactId,version_id:referenceVersion.id}];
  if(progressContext?.reference) {payload.progress_reference = progressContext.reference;payload.reference=null;delete payload.report_sources;}
  const writingFragments=fragments.filter(f=>!f.kind), contexts=fragments.filter(f=>f.kind);
  if(writingFragments.length)payload.selected_fragments=writingFragments.map(({artifact_id,version_id,selection,text})=>({artifact_id,version_id,selection,text}));
  if(contexts.length)payload.context_references=contexts.map(({id,title,text,version_no,day,truncated,...reference})=>reference);
  const signature = JSON.stringify(payload);
  payload.client_message_id = queued?.id || (prior?.signature === signature ? prior.id : uid());
  if (queued?.request) payload = queued.request;
  try {
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem(requestKey, JSON.stringify({signature:JSON.stringify({...payload,client_message_id:undefined}),id:payload.client_message_id}));
    if (queued) updateQueued(conversationId, queued.id, {request:payload});
    saveSelectedFragments(selectedFragments().filter(f=>!fragments.some(sent=>sent.id===f.id)));
  } catch(error) {toast('无法保存发送草稿，请释放浏览器存储后重试。');return false;}
  pending = true;
  projectPollSequence++; clearTimeout(pollTimer);
  conversation.messages.push({role:'user', text, selected_fragments:fragments});
  const input = document.getElementById('chat-input');
  const draftEdit=draftEdits.get(conversationId), draftValue=(globalThis.MethodAtlasStorage?.local || localStorage).getItem(`draft:${conversationId}`);
  if (input && !fromQueue && input.value.trim()===text) input.value = '';
  renderChat(true);
  let result;
  try {
    result = await api(`/api/projects/${projectId}/conversations/${conversationId}/messages`, {method:'POST', body:JSON.stringify(payload)});
  } catch (error) {
    const sameView=isCurrentView(generation,projectId,conversationId), box=sameView?document.getElementById('chat-input'):null;
    window.MethodAtlasSettings?.sent(conversationId);
    if(sameView){pending=false;connectionWarning=error.status ? error.message : '暂时无法确认这条请求是否送达。输入已保留，请检查连接后刷新确认，再调整并发送。';if(conversation.messages.at(-1)?.role==='user' && conversation.messages.at(-1).text===text)conversation.messages.pop();}
    try {
      if(!fromQueue && box && !box.value && !selectedFragments().length && JSON.stringify(settings)===JSON.stringify(window.MethodAtlasSettings?.request())){
        box.value=text;(globalThis.MethodAtlasStorage?.local || localStorage).setItem(`draft:${conversationId}`,text);saveSelectedFragments(fragments,conversationId);
      } else if (!fromQueue) {
        const queue=sameView?messageQueue:JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(`queue:${conversationId}`)||'[]');
        queue.unshift({id:payload.client_message_id,text,fragments,settings,request:payload,failed:true});
        (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`queue:${conversationId}`,JSON.stringify(queue));
      }
    } catch(storageError) {toast('发送失败且无法保存草稿，请保留当前页面并复制原问题：'+text);}
    if(sameView){renderChat();if(state?.collaboration)pollTimer=setTimeout(()=>refreshTask(activeTaskId,generation,projectId,conversationId),3000);}
    return false;
  }
  window.MethodAtlasSettings?.sent(conversationId);
  // An accepted POST must never become a new draft just because refreshing failed.
  try {
    if (!input?.value && draftEdits.get(conversationId)===draftEdit && (globalThis.MethodAtlasStorage?.local || localStorage).getItem(`draft:${conversationId}`)===draftValue) (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`draft:${conversationId}`);
    (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`graph-prepared:${conversationId}`);
    (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`report-sources:${conversationId}`);
    if(JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(requestKey)||'null')?.id===payload.client_message_id)(globalThis.MethodAtlasStorage?.local || localStorage).removeItem(requestKey);
  } catch {}
  if (!isCurrentView(generation, projectId, conversationId)) return true;
  pending = false;
  renderChat();
  activeTaskId = result.task_id;
  if (result.duplicate) toast('这条请求已处理，继续读取原任务状态。');
  try {await refreshTask(result.task_id, generation, projectId, conversationId);}
  catch(error){connectionWarning='消息已发送，暂时无法读取回复。请恢复连接后刷新查看。';renderChat();}
  return true;
}

let historyLoading = null;
async function loadOlderMessages() {
  if (historyLoading?.generation === viewGeneration || !conversation?.has_more) return;
  const generation=viewGeneration, projectId=current.id, conversationId=conversation.id;
  const request={generation};historyLoading=request;renderChat(false,true);
  try {
    const page=await api(`/api/projects/${projectId}/conversations/${conversationId}/messages?before=${conversation.before}`);
    if (!isCurrentView(generation,projectId,conversationId)) return;
    const log=document.getElementById('chat-log');
    const anchor=[...(log?.querySelectorAll('[data-message-id]') || [])].find(node=>node.getBoundingClientRect().bottom>log.getBoundingClientRect().top);
    const anchorId=anchor?.dataset.messageId, top=anchor?.getBoundingClientRect().top;
    const knownTasks=new Map([...conversation.messages.map(m=>m.task).filter(Boolean),...(current.tasks || [])].map(task=>[task.id,task]));
    const messages=new Map(page.messages.map(message=>[message.id,knownTasks.has(message.task_id)?{...message,task:knownTasks.get(message.task_id)}:message]));
    conversation.messages.forEach(message=>messages.set(message.id,message));
    Object.assign(conversation,{...page,messages:[...messages.values()].sort((a,b)=>(a.created || '').localeCompare(b.created || ''))});
    historyLoading=null;renderChat(false,true);
    const preserved=anchorId && document.querySelector(`[data-message-id="${CSS.escape(anchorId)}"]`);
    if (preserved) document.getElementById('chat-log').scrollTop += preserved.getBoundingClientRect().top-top;
  } catch(error) { if(isCurrentView(generation,projectId,conversationId))toast(error.message); }
  finally {if(historyLoading===request){historyLoading=null;if(isCurrentView(generation,projectId,conversationId))renderChat(false,true);}}
}

function mergeProjectUpdate(previous, update) {
  const tasks = new Map(update.tasks.map(task=>[task.id,task]));
  return {...update, conversations:update.conversations.map(next=>{
    const prior = previous.conversations.find(item=>item.id===next.id);
    const messages = new Map((prior?.messages || []).filter(message=>message.id && !(message.id.startsWith('explanation_') && tasks.has(message.task_id))).map(message=>[message.id,message]));
    next.messages.forEach(message=>messages.set(message.id,message));
    return {...prior, ...next, messages:[...messages.values()].map(message=>tasks.has(message.task_id) ? {...message,task:tasks.get(message.task_id)} : message).sort((a,b)=>a.created.localeCompare(b.created))};
  })};
}

let projectPollSequence = 0;
async function refreshTask(taskId, generation, projectId, conversationId) {
  if (!isCurrentView(generation, projectId, conversationId)) return;
  const local=conversation.local?conversation:null;
  clearTimeout(pollTimer);
  if (pending || (state?.collaboration && document.hidden)) {
    pollTimer = setTimeout(()=>refreshTask(taskId,generation,projectId,conversationId),3000);
    return;
  }
  const sequence = ++projectPollSequence;
  let latest;
  try {
    const query = new URLSearchParams(local?{compact:'1'}:{compact:'1',conversation:conversationId});
    if (Number.isInteger(current.message_cursor)) {
      query.set('after', current.message_cursor);
      if (Number.isInteger(current.event_cursor)) query.set('events_after', current.event_cursor);
      const tracked = new Set(current.conversations.flatMap(c=>c.messages).map(m=>m.task).filter(t=>t && (!finished(t.status) || t.status==='waiting')).map(t=>t.id));
      if (taskId) tracked.add(taskId);
      tracked.forEach(id=>query.append('task',id));
    }
    latest = await api(`/api/projects/${projectId}${query.size ? '?' + query : ''}`);
    if (latest.delta) latest = mergeProjectUpdate(current, latest);
  } catch (error) {
    if (!isCurrentView(generation, projectId, conversationId) || sequence !== projectPollSequence) return;
    if (state?.collaboration && [403,404].includes(error.status)) {
      document.querySelectorAll('dialog[open]').forEach(node=>node.close());
      await home(true); toast('项目访问权已变更；浏览器中的未保存草稿仍保留。'); return;
    }
    pollFailures += 1;
    const retry = (error.retryable || error.status >= 500) && (state?.collaboration || pollFailures <= 5);
    connectionWarning = '暂时连接不上工作台，已有内容和输入已保留；正在尝试恢复同步。';
    renderChat();
    if (retry) pollTimer = setTimeout(() => refreshTask(taskId,generation,projectId,conversationId), Math.min(30000,1000 * 2 ** (pollFailures - 1)));
    return;
  }
  if (!isCurrentView(generation, projectId, conversationId) || sequence !== projectPollSequence) return;
  const wasDisconnected = !!connectionWarning;
  latest.conversations.forEach(item=>{const optimistic=window.MethodAtlasSettings?.pending?.(item.id);if(optimistic)item.chat_options=optimistic;});
  pollFailures = 0; connectionWarning = '';
  const before = JSON.stringify(conversation);
  if ((current.source_organization?.revision || 0) > (latest.source_organization?.revision || 0)) latest.source_organization = current.source_organization;
  const sourcesChanged = JSON.stringify(current.papers) !== JSON.stringify(latest.papers) || JSON.stringify(current.source_organization) !== JSON.stringify(latest.source_organization);
  const outputsChanged = JSON.stringify(current.artifacts) !== JSON.stringify(latest.artifacts);
  const newOutputs = latest.artifacts.filter(item => !current.artifacts.some(old => old.id === item.id));
  current = latest;
  conversation = current.conversations.find(item => item.id === conversationId) || local || current.conversations[0];
  if (!conversation) { await home(true); return; }
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
  if (artifact?.kind === 'manuscript') window.MethodAtlasWriting?.remoteVersion(current.id, artifact.id, current.artifacts.find(item => item.id === artifact.id)?.current_version_id);
  if (artifact && (artifact.kind !== 'manuscript' || versionId !== 'draft')) {
    const latestVersion = current.artifacts.find(item => item.id === artifact.id)?.current_version_id;
    const previous = document.querySelector('[data-shared-new-version]');
    if (latestVersion && latestVersion !== versionId) {
      if (previous?.dataset.version !== latestVersion) {
        previous?.remove();
        document.getElementById('studio-tools')?.insertAdjacentHTML('beforeend', `<button type="button" class="pill" data-shared-new-version data-action="file" data-id="${esc(artifact.id)}" data-version="${esc(latestVersion)}">查看新版</button>`);
      }
    } else previous?.remove();
  }
  if (state?.collaboration) window.dispatchEvent(new CustomEvent('methodatlas-project-sync', {detail:{project:projectId}}));
  // reuse full snapshots for one app process; add revision cursors if measured 20-user load exceeds capacity.
  if (state?.collaboration || projectRunningTask() || current.papers.some(p => p.availability?.fulltext === 'pending')) pollTimer = setTimeout(() => refreshTask(taskId,generation,projectId,conversationId).catch(error => toast(error.message)),state?.collaboration ? 3000 : 400);
  pumpQueue();
}

async function createProject(form) {
  const name = form.elements.name.value.trim();
  if (!name) { document.getElementById('project-error').textContent = '请输入项目名称。'; return; }
  const generation = viewGeneration, button = form.querySelector('[type=submit]'), dialog = form.closest('dialog'), session = form.dataset.session;
  const active = () => dialog.open && form.dataset.session === session && generation === viewGeneration;
  if (button.disabled) return;
  button.disabled = true;
  try {
    const result = await api('/api/projects', {method:'POST', body:JSON.stringify({name, ...(window.MethodAtlasCollaboration?.selectedWorkspace() ? {workspace_id:window.MethodAtlasCollaboration.selectedWorkspace()} : {})})});
    if(!active())return;
    if(form.elements.name.value.trim()!==name){toast('项目已创建，当前输入已保留。');return;}
    dialog.close();
    await openProject(result.project_id);
  } catch (error) { if(active())document.getElementById('project-error').textContent = error.message; }
  finally { if(form.dataset.session===session)button.disabled = false; }
}

document.addEventListener('click', event => {
  if (event.target.closest('#skill-workbench [data-skill-use], #skill-workbench [data-skills-open]')) document.getElementById('skill-workbench').hidePopover();
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'skill-workbench') { document.getElementById('skill-workbench').dataset.pointerMotion = String(event.detail > 0); renderSkillWorkbench(); }
  if (action === 'shell') { switchShellView(target.dataset.value); revealPanel('chat-panel'); }
  if (action === 'toggle-panel') togglePanel(target.dataset.panel);
  if (action === 'close-panels') { const id=activePanel; activePanel='chat-panel'; syncPanelLayout(); document.querySelector(`.app-header [data-panel="${id}"]`)?.focus(); }
  if (action === 'back-chat') { switchShellView('chat'); openMiddle('chat'); }
  if (action === 'control') controlTask(target);
  if (action === 'stop') stopTask(target.dataset.id);
  if (action === 'new-project') { const form=document.getElementById('new-project-form');form.reset();form.dataset.session=crypto.randomUUID();form.querySelector('[type=submit]').disabled=false; document.getElementById('project-error').textContent = ''; document.getElementById('project-dialog').showModal(); }
  if (action === 'refresh-status') { pollFailures = 0; refreshTask(activeTaskId,viewGeneration,current.id,conversation.id).catch(error => toast(error.message)); }
  if (action === 'settings') window.MethodAtlasSettings?.open();
  if (action === 'close-project') document.getElementById('project-dialog').close();
  if (action === 'view') { projectView = target.dataset.value; (globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-view',projectView); renderProjects(); target.closest('details')?.removeAttribute('open'); }
  if (action === 'task' && !pending && taskInfo[target.dataset.value]) {
    if (target.dataset.value === 'review' && !target.dataset.auditMode) { renderSkillWorkbench('review'); document.getElementById('skill-workbench').showPopover(); return; }
    document.getElementById('skill-workbench').hidePopover();
    (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`report-sources:${conversation.id}`);
    const input = document.getElementById('chat-input'), preparedKey = `graph-prepared:${conversation.id}`;
    if (target.dataset.value === 'graph') {
      if (!input.value.trim() || !(globalThis.MethodAtlasStorage?.local || localStorage).getItem(preparedKey)) input.value = [input.value.trim(),taskInfo.graph.prompt].filter(Boolean).join('\n\n');
      (globalThis.MethodAtlasStorage?.local || localStorage).setItem(preparedKey,'true');
    } else { appendChatPrompt(auditModes[target.dataset.auditMode]?.prompt || taskInfo[target.dataset.value].prompt); (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(preparedKey); }
    input.dispatchEvent(new Event('input',{bubbles:true})); input.focus(); input.setSelectionRange(input.value.length,input.value.length);
    syncComposer();
  }
  if (action === 'copy-answer') copyAnswer(target);
  if (action === 'save-answer') saveAnswer(target);
  if (action === 'home') home();
  if (action === 'open-project') openProject(target.dataset.id);
  if (action === 'new-chat') newConversation();
  if (action === 'new-private-chat') newConversation(false, 'private');
  if (action === 'publish-answer') window.MethodAtlasCollaboration.publishAnswer(target.dataset.id).catch(error => toast(error.message));
  if (action === 'publish-document') window.MethodAtlasCollaboration.publishDocument().catch(error => toast(error.message));
  if (action === 'paper') showPaper(target.dataset.id);
  if (action === 'citation') previewCitation(target,true);
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
  if (action === 'close-paper') { paperRequest++; detail = null; renderDetail(); renderPaperViews(); saveWorkspaceState(); }
  if (action === 'pdf-prev' || action === 'pdf-next') { detail.page += action === 'pdf-prev' ? -1 : 1; detail.focus = null; renderDetail(); }
  if (action === 'history' || action === 'close-history') { historyOpen = action === 'history' && !historyOpen; renderHistory(); document.querySelector(`[data-action=${historyOpen ? 'close-history' : 'history'}]`)?.focus(); }
  if (action === 'conversation') openProject(current.id,target.dataset.id);
  if (action === 'older-messages') loadOlderMessages();
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
    if (messageQueue[index].sending) return toast('正在确认发送结果，请稍候。');
    const action = queueAction.dataset.queueAction;
    if (action === 'up' && index) [messageQueue[index - 1], messageQueue[index]] = [messageQueue[index], messageQueue[index - 1]];
    if (action === 'retry') messageQueue[index].failed=false;
    if (action === 'edit') queueEditing = id;
    if (action === 'cancel') queueEditing = null;
    if (action === 'save') {
      const textarea = row.querySelector('textarea'), text = textarea.value.trim();
      if (!text) return toast('排队内容不能为空。');
      messageQueue[index].text = text;
      messageQueue[index].id = uid();
      delete messageQueue[index].request;
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
    (globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-sort',projectSort);
    const menu = sortOption.closest('details');
    if (menu) menu.open = false;
    renderProjects();
  }
});
document.addEventListener('input', event => { if (event.target.id === 'chat-input') { draftEdits.set(conversation.id,(draftEdits.get(conversation.id)||0)+1); (globalThis.MethodAtlasStorage?.local || localStorage).setItem(`draft:${conversation.id}`,event.target.value); syncComposer(); } });
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

  if (event.target.id === 'project-sort') { projectSort = event.target.value; (globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-sort',projectSort); renderProjects(); }
  if (event.target.id === 'select-all') { sortedSources().filter(paper => paper.current_version_id).forEach(paper => event.target.checked ? selected.add(paper.id) : selected.delete(paper.id)); saveSelection(); renderSelectionViews(); }
  if (event.target.dataset.paper) { event.target.checked ? selected.add(event.target.dataset.paper) : selected.delete(event.target.dataset.paper); saveSelection(); renderSelectionViews(); }
  if (event.target.id === 'settings-view') { projectView = event.target.value; (globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-view',projectView); if(document.getElementById('project-grid'))renderProjects(); }
  if (event.target.id === 'settings-sort') { projectSort = event.target.value; (globalThis.MethodAtlasStorage?.local || localStorage).setItem('project-sort',projectSort); if(document.getElementById('project-sort')) document.getElementById('project-sort').value = projectSort; if(document.getElementById('project-grid'))renderProjects(); }
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

// 划词菜单（主页面浮层，复用 reader 的 .reader-selection 样式）：
// - 成果栏：iframe 探针经 postMessage 上报选区，坐标需换算到主页面视口；
// - 发现/搜索结果（.discovery-body）：主文档直接捕获 selectionchange。
const OUTPUT_SELECTION_ACTIONS = [
  { action:'explain', label:'解释', glyph:'bulb', key:'E', prompt:'请解释下面这段内容的含义与背景：' },
  { action:'translate', label:'翻译', glyph:'translate', key:'T', prompt:'请将下面这段内容翻译成简体中文，专业术语保留英文：' },
  { action:'comment', label:'评论', glyph:'edit', key:'C', prompt:'请对下面这段内容给出评论与改进建议：' },
  { action:'ask', label:'提问', glyph:'chat', key:'Enter', prompt:'' },
];
// 发现页没有论文批注语境，按用户要求只保留解释/翻译/提问。
const DISCOVERY_SELECTION_ACTIONS = OUTPUT_SELECTION_ACTIONS.filter(a => a.action !== 'comment');
const textSelectionState = { quote: '', title: '', last: null, context: '' };
function hideTextSelection() {
  textSelectionState.quote = ''; textSelectionState.title = ''; textSelectionState.last = null; textSelectionState.context = '';
  const menu = document.getElementById('output-selection');
  if (menu) menu.hidden = true;
}
function showTextSelection(context, actions, data, frame = null) {
  if (!data.quote) return hideTextSelection();
  const version = context === 'output' ? artifact?.versions.find(v => v.id === versionId) : null;
  if (context === 'output' && !version) return;
  textSelectionState.quote = data.quote;
  textSelectionState.title = data.title || (version ? `${version.title} · 所选内容` : '所选内容');
  textSelectionState.last = { context, actions, data }; textSelectionState.context = context;
  let menu = document.getElementById('output-selection');
  if (!menu) {
    menu = document.createElement('div');
    menu.className = 'reader-selection';
    menu.id = 'output-selection';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '所选内容操作');
    document.body.append(menu);
  }
  menu.innerHTML = actions.map(a => `<button type="button" role="menuitem" data-output-action="${a.action}" aria-label="${a.label}">${icon(a.glyph)}<span>${a.label}</span><kbd aria-hidden="true">${a.key}</kbd></button>`).join('');
  // 选区矩形 → 菜单位置：iframe 内坐标先换算到主页面视口，再统一夹取在宿主可视范围内。
  let bounds, anchor;
  if (frame) {
    const frameRect = frame.getBoundingClientRect();
    bounds = frameRect;
    anchor = { left: frameRect.left + data.rect.left, top: frameRect.top + data.rect.top, right: Math.min(frameRect.right, frameRect.left + data.rect.right), bottom: Math.min(frameRect.bottom, frameRect.top + data.rect.bottom) };
  } else {
    const host = document.getElementById('chat-body');
    bounds = host?.getBoundingClientRect() || { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 };
    anchor = data.rect;
  }
  menu.hidden = false;
  const size = menu.getBoundingClientRect();
  const left = Math.max(bounds.left + 8, Math.min(anchor.right - size.width, bounds.right - size.width - 8));
  const top = anchor.bottom + 8 + size.height <= bounds.bottom ? anchor.bottom + 8 : Math.max(bounds.top + 8, anchor.top - size.height - 8);
  menu.style.left = left + 'px';
  menu.style.top = Math.min(top, bounds.bottom - size.height - 8) + 'px';
}
window.addEventListener('message', event => {
  const frame = document.getElementById('html-preview');
  if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
  const data = event.data;
  if (data?.type !== 'methodatlas-output-selection' || frame.dataset.context) return;
  if (!frame.isConnected || !document.getElementById('output-body')?.classList.contains('html-output')) return;
  if (data.action) {
    // 快捷键在 iframe 里按下时菜单可能尚未渲染，用最近一次选区数据补拉起再触发。
    if ((document.getElementById('output-selection')?.hidden || textSelectionState.context !== 'output') && textSelectionState.last?.context === 'output') showTextSelection('output', OUTPUT_SELECTION_ACTIONS, textSelectionState.last.data, frame);
    document.querySelector(`#output-selection [data-output-action="${data.action}"]`)?.click();
    return;
  }
  if (data.clear || !data.quote) { if (textSelectionState.context === 'output') hideTextSelection(); return; }
  showTextSelection('output', OUTPUT_SELECTION_ACTIONS, data, frame);
});
// 发现/搜索结果页：选区在主文档，直接捕获。
let discoverySelectionTimer = null;
document.addEventListener('selectionchange', () => {
  clearTimeout(discoverySelectionTimer);
  const host = document.getElementById('chat-body');
  if (!host?.classList.contains('discovery-body')) { if (textSelectionState.context === 'discovery') hideTextSelection(); return; }
  discoverySelectionTimer = setTimeout(() => {
    const chosen = getSelection(), quote = chosen?.toString().trim();
    const giveUp = () => { if (textSelectionState.context === 'discovery') hideTextSelection(); };
    if (!chosen || chosen.isCollapsed || !chosen.rangeCount || !quote) return giveUp();
    const range = chosen.getRangeAt(0), node = range.commonAncestorContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element?.closest('.discovery-body')) return giveUp();
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1), anchor = rects.at(-1);
    if (!anchor) return giveUp();
    const cardTitle = element.closest('.recommendation-row')?.querySelector('.recommendation-title')?.textContent?.trim();
    showTextSelection('discovery', DISCOVERY_SELECTION_ACTIONS, { quote: quote.slice(0, 4000), rect: { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom }, title: cardTitle ? `${cardTitle} · 所选内容` : '搜索结果 · 所选内容' });
  }, 180);
});
// 发现页菜单的主文档快捷键（成果栏的快捷键在 iframe 探针里处理）。
document.addEventListener('keydown', event => {
  const menu = document.getElementById('output-selection');
  if (!menu || menu.hidden || textSelectionState.context !== 'discovery') return;
  if (event.target.closest('input,textarea,select,[contenteditable=true]') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') { hideTextSelection(); return; }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const action = { e: 'explain', t: 'translate', Enter: 'ask' }[key];
  if (action) { event.preventDefault(); menu.querySelector(`[data-output-action="${action}"]`)?.click(); }
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#output-selection')) hideTextSelection();
  if (!event.target.closest('#selection-translate')) closeSelectionTranslate();
});
window.addEventListener('resize', () => { hideTextSelection(); closeSelectionTranslate(); });
// 翻译窗固定在视口中，滚动原文或译文时保留，方便对照阅读。
document.addEventListener('click', event => {
  const target = event.target.closest('[data-output-action]');
  if (!target) return;
  const quote = textSelectionState.quote, title = textSelectionState.title;
  const anchor = document.getElementById('output-selection')?.getBoundingClientRect() || null;
  hideTextSelection();
  if (!quote) return;
  if (target.dataset.outputAction === 'translate') { openSelectionTranslate(quote, title, anchor); return; }
  const prompts = Object.fromEntries(OUTPUT_SELECTION_ACTIONS.map(a => [a.action, a.prompt]));
  window.MethodAtlasAI.open({ id: uid(), kind: 'selection', title, text: quote }, prompts[target.dataset.outputAction] || '');
});
// 划词翻译卡片：点「翻译」不拉起 AI 大浮窗，就地弹出轻量译文卡片（标题 + 复制/关闭 + 继续追问）。
let selectionTranslateEpoch = 0;
let stopSelectionTranslateDrag = null;
function positionSelectionTranslate(card, left, top) {
  const margin = 12;
  card.style.left = Math.max(margin, Math.min(left, innerWidth - card.offsetWidth - margin)) + 'px';
  card.style.top = Math.max(margin, Math.min(top, innerHeight - card.offsetHeight - margin)) + 'px';
}
function closeSelectionTranslate() {
  stopSelectionTranslateDrag?.();
  selectionTranslateEpoch++;
  const card = document.getElementById('selection-translate');
  if (card) { card.hidden = true; delete card.dataset.quote; delete card.dataset.title; }
}
function openSelectionTranslate(quote, title, anchor) {
  let card = document.getElementById('selection-translate');
  if (!card) {
    card = document.createElement('section');
    card.className = 'selection-translate';
    card.id = 'selection-translate';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '划词翻译');
    card.hidden = true;
    card.innerHTML = `<header class="selection-translate-head"><strong>简体中文</strong><div class="row"><button class="icon" type="button" data-translate-copy aria-label="复制译文" disabled>${icon('copy')}</button><button class="icon" type="button" data-translate-close aria-label="关闭翻译">${icon('close')}</button></div></header><div class="selection-translate-body" role="status"></div><footer class="selection-translate-foot"><button class="quiet" type="button" data-translate-ask aria-label="继续追问">${icon('chat')}<span>继续追问</span></button></footer>`;
    document.body.append(card);
    const handle = card.querySelector('.selection-translate-head');
    handle.tabIndex = 0;
    handle.setAttribute('role', 'group');
    handle.setAttribute('aria-label', '移动翻译窗口，支持拖动和方向键');
    handle.title = '拖动移动窗口，也可用方向键移动';
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || event.target.closest('button')) return;
      stopSelectionTranslateDrag?.();
      const left = parseFloat(card.style.left), top = parseFloat(card.style.top);
      const x = event.clientX, y = event.clientY, pointer = event.pointerId;
      event.preventDefault();
      handle.focus({preventScroll:true});
      handle.setPointerCapture(pointer);
      card.classList.add('is-dragging');
      const move = e => {
        if (e.pointerId === pointer) positionSelectionTranslate(card, left + e.clientX - x, top + e.clientY - y);
      };
      const stop = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('lostpointercapture', stop);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
        card.classList.remove('is-dragging');
        stopSelectionTranslateDrag = null;
        if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      };
      stopSelectionTranslateDrag = stop;
      handle.addEventListener('pointermove', move);
      handle.addEventListener('lostpointercapture', stop);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
    handle.addEventListener('keydown', event => {
      if (event.target !== handle || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 64 : 16;
      positionSelectionTranslate(card, parseFloat(card.style.left) + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), parseFloat(card.style.top) + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
    });
    card.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !card.contains(button)) return;
      if (button.hasAttribute('data-translate-close')) return closeSelectionTranslate();
      if (button.hasAttribute('data-translate-copy')) {
        const body = card.querySelector('.selection-translate-body');
        navigator.clipboard.writeText(body.textContent).then(() => {
          button.setAttribute('aria-label', '已复制');
          clearTimeout(button._copyTimer);
          button._copyTimer = setTimeout(() => button.setAttribute('aria-label', '复制译文'), 1200);
        }).catch(() => toast('复制失败，请手动选择译文复制。'));
        return;
      }
      if (button.hasAttribute('data-translate-ask')) {
        const fragment = { id: uid(), kind: 'selection', title: card.dataset.title || '所选内容', text: card.dataset.quote || '' };
        closeSelectionTranslate();
        window.MethodAtlasAI.open(fragment, '');
      }
    });
  }
  card.dataset.quote = quote;
  card.dataset.title = title || '所选内容';
  card.hidden = false;
  const body = card.querySelector('.selection-translate-body');
  body.classList.add('is-loading');
  body.textContent = '正在翻译…';
  const copy = card.querySelector('[data-translate-copy]');
  copy.disabled = true;
  copy.setAttribute('aria-label', '复制译文');
  // 位置：尽量落在划词菜单原位（即选区下方），四周夹取在视口内。
  const margin = 12, width = Math.min(520, innerWidth - margin * 2);
  const left = anchor && anchor.width ? Math.max(margin, Math.min(anchor.left, innerWidth - width - margin)) : Math.max(margin, (innerWidth - width) / 2);
  card.style.left = left + 'px';
  card.style.top = '0px';
  const height = card.getBoundingClientRect().height;
  let top = anchor && anchor.width ? anchor.bottom + 8 : margin + 60;
  if (top + height > innerHeight - margin) top = anchor && anchor.width ? anchor.top - height - 8 : margin;
  card.style.top = Math.max(margin, Math.min(top, Math.max(margin, innerHeight - height - margin))) + 'px';
  requestSelectionTranslate(quote);
}
function requestSelectionTranslate(quote) {
  const token = ++selectionTranslateEpoch, project = current?.id;
  const card = document.getElementById('selection-translate');
  const body = card?.querySelector('.selection-translate-body');
  if (!card || !body) return;
  if (!project) { body.classList.remove('is-loading'); body.textContent = '请先打开一个项目再使用划词翻译。'; return; }
  api(`/api/projects/${project}/selection-translate`, { method: 'POST', body: JSON.stringify({ text: quote }) }).then(result => {
    if (token !== selectionTranslateEpoch || current?.id !== project || !card.isConnected || card.hidden) return;
    body.classList.remove('is-loading');
    body.textContent = result?.text || '译文为空，请重试。';
    card.querySelector('[data-translate-copy]').disabled = false;
    positionSelectionTranslate(card, parseFloat(card.style.left), parseFloat(card.style.top));
  }).catch(error => {
    if (token !== selectionTranslateEpoch || current?.id !== project || !card.isConnected || card.hidden) return;
    body.classList.remove('is-loading');
    body.textContent = error?.message || '翻译失败，请重试。';
    positionSelectionTranslate(card, parseFloat(card.style.left), parseFloat(card.style.top));
  });
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.getElementById('selection-translate')?.hidden === false) { closeSelectionTranslate(); return; }
  if (event.key === 'Escape' && document.getElementById('output-selection')?.hidden === false) { hideTextSelection(); return; }
  if (event.key === 'Escape' && historyOpen && !document.querySelector('dialog[open]')) { historyOpen = false; renderHistory(); document.querySelector('[data-action=history]')?.focus(); }
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); event.target.form?.requestSubmit();
  }
});

window.addEventListener('writing-ready', () => { if (current) renderOutput(); });
api('/api/state?summary=1').then(async data => {
  state = data;
  const invited = await window.MethodAtlasCollaboration?.acceptLink();
  if (invited) { state = await api('/api/state?summary=1'); return openProject(invited); }
  const saved = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem('methodatlas-view') || 'null');
  if (saved && data.projects.some(p => p.id === saved.projectId)) openProject(saved.projectId,saved.conversationId); else home();
}).catch(error => {
  if (error.status === 401) return window.MethodAtlasCollaboration?.login();
  document.getElementById('app').innerHTML = `<main class="home"><div class="home-content"><h1>暂时无法打开工作台</h1><p class="summary-text">${esc(error.message)}</p><button type="button" onclick="location.reload()">重试</button></div></main>`;
});

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
