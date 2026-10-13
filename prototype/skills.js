// 笔记以工作台视图呈现：笔记列表 | 笔记正文 | 写作。后端仍要求七个字段，名称之外的五个字段
// 作为隐藏元数据原样保留：界面只露出标题和正文，导入、导出与分享折叠在正文下方。
const skillFields = {name:'名称', description:'用途', scenarios:'适用场景', inputs:'输入', steps:'步骤', template:'模板', example:'示例'};
// A brand-new note has nothing to say in the hidden metadata; these keep the backend validator happy.
const skillFieldDefaults = {description:'自由笔记', scenarios:'不限场景', inputs:'无固定输入', template:'自由结构', example:'无示例'};
let skillEdit = null;
const skillStyle = document.createElement('style');
skillStyle.textContent = '.memory-column label{display:grid;gap:0.375rem;font-size:0.8125rem;color:var(--muted)}.memory-column label:has(input[type=checkbox]){display:flex;align-items:flex-start;gap:0.5rem}.memory-column textarea{width:100%;min-width:0}.memory-column input[type=file]{width:100%}';
document.head.append(skillStyle);
const skillPost = (action, body) => api(`/api/projects/${skillEdit.project}/skills/${action}`, {method:'POST', body:JSON.stringify(body)});
const skillDraftKey = () => `skill-draft:${current.id}:${conversation.id}`;
function rememberSkillDraft(editing = skillEdit) {
  if (!editing) return;
  // Only 标题 and 正文 live in the DOM now; the hidden metadata travels along unchanged.
  if (skillEdit === editing) editing.fields = {...editing.fields,
    name:document.querySelector('#skill-name')?.value ?? editing.fields.name,
    steps:document.querySelector('#skill-steps')?.value ?? editing.fields.steps};
  editing.dirty = JSON.stringify(skillFieldsOf(editing)) !== editing.savedSnapshot;
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(editing.draftKey || skillDraftKey(), JSON.stringify({...editing, saving:false}));
}

// Editing and leaving preserve a local draft. Only the explicit save action
// confirms a snapshot and creates a reusable method version.

// 标题和正文来自界面，其余五个字段是隐藏元数据：保留原值，空着的新笔记用默认值补齐，
// 这样后端的字段校验不变，导出的 Markdown 结构也不变。
function skillFieldsOf(editing) {
  return Object.fromEntries(Object.keys(skillFields).map(key => {
    if (key === 'name') return [key, ((editing.fields.name ?? '') + '').trim() || '未命名笔记'];
    if (key === 'steps') return [key, ((editing.fields.steps ?? '') + '').trim()];
    const value = (editing.fields[key] || '').trim();
    return [key, value || skillFieldDefaults[key]];
  }));
}

function skillStateText(editing, note) {
  const item = editing.item;
  // 有 note 时说明正处在某次写入的前后：这时只交代这件事和「上一次写入的版本」的关系，
  // 避免和 head 里的「已保存」互相打架。
  if (note) return `${note} · ${item ? `上次确认 v${item.version_no}` : '尚未确认保存'}`;
  if (editing.dirty) return `草稿已保存在本机，尚未确认保存${item ? ` · 上次确认 v${item.version_no}` : ''}`;
  return item ? `v${item.version_no} · ${item.status === 'archived' ? '已归档' : '已保存'} · 共 ${item.versions.length} 个版本` : '草稿：尚未保存';
}

function paintSkillState(editing, note) {
  const host = document.querySelector('#skill-state');
  if (host && skillEdit === editing) host.textContent = skillStateText(editing, note);
  const discard = document.querySelector('[data-skill-action=discard]');
  if (discard && skillEdit === editing) discard.hidden = !editing.dirty;
}

async function saveSkillEditing(editing) {
  const fields = skillFieldsOf(editing);
  const snapshot = JSON.stringify(fields);
  const status = document.querySelector('#skill-error');
  if (!fields.steps) throw new Error('请填写方法正文后再确认保存');
  if (!editing.dirty || snapshot === editing.savedSnapshot) {
    editing.dirty = false;
    if (status) status.textContent = '内容未改变，无需追加版本。';
    paintSkillState(editing); return;
  }
  const action = editing.imported ? 'import' : 'save';
  const request = editing.request;
  const body = {request_id:editing.request + ':' + action, id:editing.item?.id, base_version_id:editing.item?.version_id,
    fields, confirmed:true, draft_id:editing.draft_id};
  if (editing.imported) body.markdown = editing.imported;
  const result = await api(`/api/projects/${editing.project}/skills/${action}`, {method:'POST', body:JSON.stringify(body)});
  personalSkills = await api('/api/skills');
  const saved = personalSkills.find(item => item.id === result.id);
  if (saved) { editing.item = saved; editing.imported = null; }
  // A response only acknowledges its own snapshot; typing during the request is still dirty.
  const changedDuringSave = editing.request !== request;
  if (!changedDuringSave) editing.fields = fields;
  editing.savedSnapshot = snapshot;
  editing.dirty = changedDuringSave;
  if (skillEdit !== editing) return;
  // 草稿留着并同步成刚保存的这份：下次回到笔记视图，编辑器还停在同一篇上，而不是空白页。
  (globalThis.MethodAtlasStorage?.local || localStorage).setItem(editing.draftKey || skillDraftKey(), JSON.stringify({...editing, saving:false}));
  const list = document.querySelector('.skills-dialog .skills-columns > section');
  if (list && document.querySelector('.skills-dialog[open]')) list.innerHTML = skillListHTML();
  const save = document.querySelector('[data-skill-action=save]');
  if (save) save.textContent = '确认更新方法';
  const tools = document.querySelector('#skill-tools-body');
  if (tools) tools.innerHTML = skillToolsHTML();
  if (status) status.textContent = editing.dirty ? '已确认保存刚才的版本；之后的修改仍是本机草稿，请再次确认保存。' : '方法已确认保存。';
  paintSkillState(editing);
}

function flushPendingSkill() { if (skillEdit?.dirty) rememberSkillDraft(); }
window.addEventListener('pagehide', flushPendingSkill);

function canLeaveSkillDraft(editing) {
  rememberSkillDraft(editing);
  if (!editing.dirty) return true;
  const status = document.querySelector('#skill-error');
  if (status) status.textContent = '改动已保存在本机草稿；请先确认保存，或明确放弃未保存改动，再切换或操作已保存版本。';
  paintSkillState(editing);
  return false;
}

function skillListHTML() {
  const rows = personalSkills.map(item => `<button type="button" class="library-row card${skillEdit?.item?.id === item.id ? ' active' : ''}" data-skill-pick="${esc(item.id)}"${skillEdit?.item?.id === item.id ? ' aria-current="true"' : ''}>${icon('method')}<span class="library-row-body"><strong>${esc(item.fields.name)}</strong><small>v${item.version_no} · ${item.status === 'archived' ? '已归档' : '可用'}</small></span></button>`).join('');
  return `<div class="source-actions"><button class="primary" data-skill-action="new">${icon('plus')}新建笔记</button><small>共 ${personalSkills.length} 个</small></div><div class="library-list cards">${rows || '<p class="empty-small">还没有笔记。可以新建、从协作提炼，或导入 Markdown。</p>'}</div>`;
}

function skillEditorHTML() {
  return `<input class="skill-title" id="skill-name" value="${esc(skillEdit.fields.name)}" maxlength="300" placeholder="笔记标题" aria-label="笔记标题">
    <p class="dialog-status" id="skill-state">${esc(skillStateText(skillEdit))}</p>
    <div class="skill-body"><textarea id="skill-steps" placeholder="从这里开始记录…" maxlength="8000" aria-label="笔记正文">${esc(skillEdit.fields.steps)}</textarea></div>
    <div class="row memory-editor-actions"><button class="primary" data-skill-action="save">${skillEdit.item ? '确认更新方法' : '确认保存方法'}</button><button data-skill-action="discard" ${skillEdit.dirty ? '' : 'hidden'}>放弃未保存改动</button></div>
    <p id="skill-error" class="dialog-status" role="status"></p>
    <details class="panel-help"><summary>导入、导出与分享</summary><div id="skill-tools-body">${skillToolsHTML()}</div></details>`;
}

function skillToolsHTML() {
  const item = skillEdit?.item;
  const completed = conversation.messages.filter(message => message.role === 'assistant' && message.task?.status === 'succeeded');
  return `<details class="memory-settings"><summary>从已完成协作提炼 / 复制内置能力</summary>
      <label class="dialog-field">来源回答<select id="skill-source">${completed.map(message => `<option value="${esc(message.task.id)}">${esc(message.text.slice(0, 100))}</option>`).join('')}</select></label>
      <label class="dialog-field">提炼要求<input id="skill-instruction" value="提炼研究流程、版式和质量规则，替换原主题与私密信息"></label>
      <div class="row"><button data-skill-action="draft" ${completed.length ? '' : 'disabled'}>提炼草稿</button></div>
      <label class="dialog-field">内置能力<select id="skill-builtin">${Object.entries(taskInfo).map(([key, task]) => `<option value="${key}">${esc(task.title)}</option>`).join('')}</select></label>
      <div class="row"><button data-skill-action="builtin">复制后定制</button></div></details>
    <label class="dialog-field">导入 Markdown（先预览）<input id="skill-import" type="file" accept=".md,text/markdown"></label>
    ${item ? `<div class="row memory-editor-actions"><button data-skill-action="export">导出 Markdown</button><button data-skill-action="share">生成分享下载地址</button></div>
      <div class="row memory-editor-actions"><button data-skill-action="${item.status === 'archived' ? 'restore' : 'archive'}">${item.status === 'archived' ? '恢复使用' : '归档'}</button><button data-skill-action="delete">删除</button>${item.share_token ? '<button data-skill-action="revoke">撤回分享</button>' : ''}</div>` : ''}
    ${item?.share_token ? `<label class="dialog-field">分享下载地址<input readonly value="${esc(location.origin + '/api/skills/shared/' + item.share_token)}"></label><p class="dialog-status"><a href="/api/skills/shared/${esc(item.share_token)}" download title="下载分享版本">${icon('download')} 分享版本</a></p>` : ''}
    <details class="panel-help"><summary>说明</summary><p>只保存以上笔记文字。请删除私密原文、凭据和原主题细节，改用占位符；来源记录留在本机，不进入导出。单次对话调整不会修改笔记。</p><p>分享地址只在本工作台服务可访问时有效。本机地址不能供其他电脑访问；请导出 Markdown 传给他人。撤回使旧地址失效，无法追回已经下载或导入的副本。</p></details>`;
}

function showSkills(item = null, fields = null, extra = {}) {
  skillEdit = {project:current.id, item, fields:fields || item?.fields || Object.fromEntries(Object.keys(skillFields).map(key => [key, ''])), request:uid(), ...extra};
  // 草稿 key 在编辑态建立时就固定：离开项目回首页时 current/conversation 已被清空，那时再算会抛错。
  skillEdit.draftKey = skillDraftKey();
  // 打开时先记下「服务端已有的内容」当作基线：只有改动真的不同于它才会写入新版本。
  skillEdit.savedSnapshot = extra.savedSnapshot ?? JSON.stringify(skillFieldsOf({fields:item?.fields || {}}));
  skillEdit.dirty = extra.dirty ?? JSON.stringify(skillFieldsOf(skillEdit)) !== skillEdit.savedSnapshot;
  let dialog = document.querySelector('.skills-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'skills-dialog';
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeSkills(); });
  }
  dialog.innerHTML = '<button type="button" data-skills-close aria-label="关闭技能管理">×</button><h2>我的技能</h2><div class="skills-columns"><section>' + skillListHTML() + '</section><section>' + skillEditorHTML() + '</section></div>';
  if (!dialog.open) dialog.showModal();
}

window.MethodAtlasSkills = {
  activate: async () => {
    if (!document.getElementById('source-body')) return;
    try {
      personalSkills = await api('/api/skills');
      if (skillEdit?.saving) { toast('方法正在确认保存，请完成后再打开。'); return; }
      const saved = JSON.parse((globalThis.MethodAtlasStorage?.local || localStorage).getItem(skillDraftKey()) || 'null');
      if (saved) showSkills(saved.item, saved.fields, saved);
      else showSkills();
    } catch (error) { toast(error.message); }
  },
  // Workspace navigation preserves the local draft without confirming a version.
  flushPending: flushPendingSkill
};

document.addEventListener('click', async event => {
  const use = event.target.closest('[data-skill-use]');
  if (use && !pending) {
    const item = personalSkills.find(s => s.id === use.dataset.skillUse);
    const input = document.getElementById('chat-input');
    if (!item || !input) return;
    appendChatPrompt(`请使用个人研究 Skill「${item.fields.name}」版本 ${item.version_id}，围绕当前项目的新主题和材料开展研究。请先确认输入是否充足；本次调整不要更新原 Skill。`);
    // The version is visible editable text, never a hidden stale selection.
    (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(`report-sources:${conversation.id}`);
    return;
  }
  if (!event.target.closest('[data-skills-open]')) return;
  if (!current?.id) return;
  window.MethodAtlasSkills.activate();
});

document.addEventListener('change', async event => {
  const node = event.target;
  if (!node.closest('.skills-dialog') || !skillEdit) return;
  if (node.id === 'skill-source') { skillEdit.request = uid(); return; }
  if (node.id !== 'skill-import') return;
  const editing = skillEdit;
  try {
    const file = node.files[0];
    node.value = '';
    if (!file) return;
    if (file.size > 100000) throw new Error('Markdown 文件过大');
    const markdown = await file.text();
    const result = await api(`/api/projects/${editing.project}/skills/preview-import`, {method:'POST',body:JSON.stringify({markdown})});
    if (skillEdit !== editing || current?.id !== editing.project) return;
    if (editing.saving || !canLeaveSkillDraft(editing) || skillEdit !== editing) return;
    showSkills(null, result.fields, {imported:markdown});
    rememberSkillDraft();
  } catch (error) { const status = document.querySelector('#skill-error'); if (skillEdit === editing && status) status.textContent = error.message; }
});

document.addEventListener('input', event => {
  const node = event.target;
  if (!node.closest('.skills-dialog') || !skillEdit) return;
  if (node.id === 'skill-instruction') { skillEdit.request = uid(); return; }
  if (node.tagName !== 'TEXTAREA' && node.id !== 'skill-name') return;
  // 每个新的 request_id 都对应一次新的写入：后端用它做幂等键，重放同一次请求不会多出版本。
  skillEdit.request = uid();
  skillEdit.dirty = true;
  rememberSkillDraft();
  paintSkillState(skillEdit);
});

document.addEventListener('click', async event => {
  const pick = event.target.closest('[data-skill-pick]');
  if (pick && pick.closest('.skills-dialog') && skillEdit) {
    if (skillEdit.saving || !canLeaveSkillDraft(skillEdit)) return;
    showSkills(personalSkills.find(item => item.id === pick.dataset.skillPick));
    return;
  }
  const button = event.target.closest('[data-skill-action]');
  if (!button || !button.closest('.skills-dialog') || !skillEdit) return;
  const action = button.dataset.skillAction, editing = skillEdit;
  if (editing.saving) return;
  rememberSkillDraft(editing);
  if (action === 'save') {
    editing.saving = true; button.disabled = true;
    try { await saveSkillEditing(editing); }
    catch (error) {
      if (skillEdit === editing) {
        const status = document.querySelector('#skill-error');
        if (status) status.textContent = '确认保存失败：' + error.message;
        paintSkillState(editing);
      }
    } finally { editing.saving = false; if (button.isConnected) button.disabled = false; }
    return;
  }
  if (action === 'discard') {
    if (!confirm('放弃当前未确认的改动？已保存的方法和历史版本仍保留。')) return;
    (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(editing.draftKey);
    return showSkills(editing.item);
  }
  if (action !== 'delete' && !canLeaveSkillDraft(editing)) return;
  if (action === 'new') { (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(skillDraftKey()); return showSkills(); }
  if (action === 'builtin') {
    const builtin = taskInfo[document.querySelector('#skill-builtin').value];
    return showSkills(null, {name:builtin.title + '（个人副本）', description:builtin.prompt, scenarios:'围绕新的研究主题复用', inputs:'当前项目的论文与研究问题', steps:builtin.prompt, template:'按研究问题、方法、比较、局限组织内容', example:'例如：围绕一个新主题比较已选论文；不包含原主题资料'});
  }
  // Export/share operate only on the already confirmed version.
  const fields = skillFieldsOf(editing);
  const confirmed = ['export', 'share'].includes(action)
    ? confirm(`确认${action === 'export' ? '导出' : '分享'}已保存的 v${editing.item.version_no} 方法文字？`) : false;
  if (['export', 'share'].includes(action) && !confirmed) return;
  const body = {request_id:editing.request + ':' + action, id:editing.item?.id, base_version_id:editing.item?.version_id,
    fields, confirmed, draft_id:editing.draft_id};
  const status = document.querySelector('#skill-error');
  try {
    if (action === 'delete' && !confirm('删除此笔记并撤回分享？历史任务采用的版本仍保留。')) return;
    if (['export','share'].includes(action) && JSON.stringify(fields) !== JSON.stringify(editing.item.fields)) throw new Error('笔记有未保存的修改；请先明确更新，再分享该版本');
    button.disabled = true;
    if (status) status.textContent = action === 'draft' ? '正在提炼；原笔记未改变…' : '正在保存…';
    if (action === 'draft') {
      const result = await skillPost('draft', {request_id:body.request_id, task_id:document.querySelector('#skill-source').value, instruction:document.querySelector('#skill-instruction').value});
      if (skillEdit !== editing || current?.id !== editing.project) return;
      showSkills(editing.item, result.fields, {draft_id:result.draft_id});
      rememberSkillDraft();
      return;
    }
    // Edited imported methods are saved as a reviewed draft, with the import hash retained by the server.
    let result;
    if (action === 'save' && editing.imported) result = await skillPost('import', {...body, markdown:editing.imported, fields});
    else result = await skillPost(action, body);
    if (action === 'export') {
      const url = URL.createObjectURL(new Blob([result.markdown], {type:'text/markdown;charset=utf-8'}));
      const link = document.createElement('a'); link.href = url; link.download = 'research-skill.md'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const host = document.querySelector('#skill-error');
      if (host) host.textContent = '已导出确认的版本。';
      return;
    }
    personalSkills = await api('/api/skills');
    if (skillEdit !== editing || current?.id !== editing.project) return;
    (globalThis.MethodAtlasStorage?.local || localStorage).removeItem(skillDraftKey());
    if (!shellOwnsPanels()) renderChat();
    showSkills(result.deleted ? null : personalSkills.find(item => item.id === result.id));
    const host = document.querySelector('#skill-error');
    if (host) host.textContent = '操作已保存。';
  } catch (error) {
    if (skillEdit === editing && status) status.textContent = error.message;
  } finally { if (button.isConnected) button.disabled = false; }
});

async function closeSkills() {
  try {
    if (skillEdit?.saving) { toast('方法正在确认保存，请完成后再关闭。'); return; }
    flushPendingSkill();
    document.querySelector('.skills-dialog')?.close();
    if (skillEdit?.dirty) toast('草稿已保存在本机，尚未确认保存。');
  }
  catch (error) { toast(error.message); }
}
document.addEventListener('click', event => { if (event.target.closest('[data-skills-close]')) closeSkills(); });
