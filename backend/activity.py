"""One permission-filtered view over existing collaboration and research events."""
import json
from datetime import datetime, timezone


LABELS = {
    'project_created':'创建项目', 'project_migrated':'迁入已有项目', 'project_archive':'归档项目', 'project_unarchive':'恢复项目', 'project_renamed':'重命名项目',
    'member_invited':'邀请成员', 'member_joined':'加入项目', 'member_removed':'移除成员', 'invite_revoked':'撤销邀请', 'ownership_transferred':'转移项目负责人',
    'task_created':'创建研究任务', 'task_updated':'更新研究任务', 'task_completed':'确认任务完成',
    'paper_uploaded':'上传研究资料', 'artifact_published':'发布共享成果', 'artifact_draft_changed':'编辑成果草稿',
    'comment_created':'添加评论', 'comment_replied':'回复评论', 'comment_resolved':'解决评论', 'comment_reopened':'重新打开评论',
    'agent_run_queued':'Agent 排队', 'agent_run_running':'Agent 开始执行', 'agent_run_succeeded':'Agent 完成',
    'agent_run_failed':'Agent 失败', 'agent_run_stopped':'Agent 已停止', 'agent_run_interrupted':'Agent 已中断', 'agent_run_waiting':'Agent 等待确认', 'agent_run_controlled':'操作 Agent 运行',
    'experiment_created':'创建实验计划', 'experiment_completed':'实验计划完成', 'experiment_record_changed':'补充实验记录',
    'model_access_changed':'修改模型授权', 'server_access_changed':'修改服务器授权', 'server_deleted':'删除服务器连接',
    'server_execution_access_changed':'修改实验执行权限', 'resource_limits_changed':'修改资源额度',
    'material':'保存资料版本', 'version':'保存成果版本', 'research':'完成研究', 'experiment':'实验状态变化',
    'experiment_result':'保存实验结果', 'deleted':'移除研究内容', 'progress_revision':'修订研究回顾',
    'decision':'记录研究判断', 'idea':'记录待验证想法', 'question':'记录待解决问题', 'overturned':'撤回研究判断', 'editing_state':'处理文稿修订',
}


class ProjectActivity:
    def __init__(self, service):
        self.service, self.store, self.access = service, service.store, service.collaboration
        # Capture transitions in the same commit, including background runs and autosaves.
        with self.store.lock, self.store.db:
            self.store.db.executescript('''
                CREATE INDEX IF NOT EXISTS activity_project_time ON activity_events(project_id,created,id);
                DROP TRIGGER IF EXISTS collab_run_transition;
                CREATE TRIGGER collab_run_transition AFTER UPDATE OF status,refs ON tasks
                WHEN json_extract(NEW.refs,'$.initiated_by') IS NOT NULL AND NEW.status IN ('queued','running','waiting','succeeded','failed','stopped','interrupted')
                AND (NEW.kind<>'writing' OR json_extract(NEW.refs,'$.model_config') IS NOT NULL)
                AND (NEW.status<>OLD.status OR json_extract(OLD.refs,'$.initiated_by') IS NULL) BEGIN
                  INSERT INTO activity_events VALUES('run:'||hex(randomblob(16)),NEW.project_id,
                  json_extract(NEW.refs,'$.initiated_by'),'agent_run_'||NEW.status,NEW.id,
                  json_object('task_id',NEW.id,'conversation_id',NEW.conversation_id,'revision',NEW.revision,'title',NEW.prompt),NEW.updated);
                END;
                CREATE TRIGGER IF NOT EXISTS collab_draft_saved AFTER INSERT ON writing_drafts
                WHEN json_extract(NEW.value,'$.payload.edited_by') IS NOT NULL BEGIN
                  INSERT OR IGNORE INTO activity_events SELECT 'draft:'||json_extract(NEW.value,'$.id'),a.project_id,
                  json_extract(NEW.value,'$.payload.edited_by'),'artifact_draft_changed',a.id,
                  json_object('artifact_id',a.id,'title',json_extract(NEW.value,'$.title')),json_extract(NEW.value,'$.created') FROM artifacts a WHERE a.id=NEW.artifact_id;
                END;
                CREATE TRIGGER IF NOT EXISTS collab_experiment_created AFTER INSERT ON experiment_groups BEGIN
                  INSERT OR IGNORE INTO activity_events VALUES('group-created:'||NEW.id,NEW.project_id,json_extract(NEW.record,'$.created_by'),
                  'experiment_created',NEW.id,json_object('conversation_id',json_extract(NEW.record,'$.conversation_id'),'title',json_extract(NEW.record,'$.spec.title')),COALESCE(json_extract(NEW.record,'$.created'),strftime('%Y-%m-%dT%H:%M:%f+00:00','now')));
                END;
                CREATE TRIGGER IF NOT EXISTS collab_experiment_completed AFTER UPDATE OF record ON experiment_groups
                WHEN json_extract(NEW.record,'$.status')='completed' AND json_extract(OLD.record,'$.status')<>'completed' BEGIN
                  INSERT OR IGNORE INTO activity_events VALUES('group-completed:'||NEW.id,NEW.project_id,json_extract(NEW.record,'$.authorized_by'),
                  'experiment_completed',NEW.id,json_object('conversation_id',json_extract(NEW.record,'$.conversation_id'),'title',json_extract(NEW.record,'$.spec.title')),strftime('%Y-%m-%dT%H:%M:%f+00:00','now'));
                END;
            ''')

    def list(self, user, project, *, query='', actor='', after='', before='', offset=0, limit=30):
        if not isinstance(query,str) or len(query)>200 or not isinstance(actor,str) or len(actor)>100:
            raise ValueError('活动筛选条件无效')
        if type(offset) is not int or offset<0 or type(limit) is not int or not 1<=limit<=50:
            raise ValueError('活动分页无效')
        def instant(value):
            if not isinstance(value,str) or len(value)>50:
                raise ValueError('活动时间范围无效')
            stamp = datetime.fromisoformat(value.replace('Z','+00:00'))
            if stamp.tzinfo is None:
                raise ValueError('活动时间须包含时区')
            return stamp.astimezone(timezone.utc)
        lower, upper = instant(after) if after else None, instant(before) if before else None
        if lower and upper and lower>=upper:
            raise ValueError('活动时间范围无效')
        with self.store.transaction():
            if not user:
                raise PermissionError('项目活动需要已验证成员')
            self.access.project(user,project)
            result = self._collect(project)
            result = [r for r in result if (not actor or r['actor_id']==actor) and query.casefold() in (r['title']+' '+r['action']).casefold()
                      and (not lower or instant(r['created'])>=lower) and (not upper or instant(r['created'])<upper)]
            result.sort(key=lambda r:(instant(r['created']),r['id']),reverse=True)
            total = len(result)
            return {'events':result[offset:offset+limit],'total':total,'next_offset':offset+limit if offset+limit<total else None,
                    'as_of':datetime.now(timezone.utc).isoformat()}

    def _collect(self, project):
        """Internal shared-only evidence for authenticated APIs and scheduled reviews."""
        with self.store.transaction():
            research = self.service.progress.events(project)
            rows = self.store.all('SELECT * FROM activity_events WHERE project_id=? ORDER BY created,id',(project,))
            result, captured_versions, captured_runs = [], set(), set()
            for row in rows:
                event = dict(row); data = json.loads(event['data']); kind = event['kind']; ident = event['entity_id']
                if kind.startswith('knowledge_'):
                    continue  # The original research record already contains author, content and sources.
                if kind not in LABELS or not self.access.shared_metadata(data):
                    continue
                title, reference, changes = data.get('title',''), None, {}
                if kind.startswith('task_'):
                    saved = self.store.one('SELECT record FROM work_item_history WHERE item_id=? AND revision=?',(ident,data.get('revision')))
                    if not saved:
                        continue
                    item = json.loads(saved['record']); title = item['title']; reference = {'kind':'work','id':ident}
                    previous = self.store.one('SELECT record FROM work_item_history WHERE item_id=? AND revision=?',(ident,data['revision']-1))
                    old = json.loads(previous['record']) if previous else {}
                    changes = {key:item[key] for key in ('title','status','assignee','priority','due_date') if item.get(key)!=old.get(key)}
                elif kind.startswith('agent_run_'):
                    task = self.store.task(ident)
                    if not task or not self.access.shared_metadata({'task_id':ident}):
                        continue
                    title = title or task['prompt']; reference = {'kind':'run','id':ident}; captured_runs.add(ident)
                    if data.get('action'):
                        changes['action'] = data['action']
                elif kind.startswith('comment_'):
                    thread = self.store.one('SELECT artifact_id,version_id,target_kind FROM comment_threads WHERE id=? AND project_id=?',(ident,project))
                    if not thread:
                        continue
                    title = self.store.one('SELECT title FROM ' + ('papers' if thread['target_kind'] == 'paper' else 'artifacts') + ' WHERE id=?',(thread['artifact_id'],))
                    title = title['title'] if title else '成果评论'
                    reference = {'kind':thread['target_kind'],'id':thread['artifact_id'],'version_id':thread['version_id']}
                elif kind.startswith('artifact_'):
                    reference = {'kind':'artifact','id':ident}
                    if data.get('version_id'):
                        reference['version_id'] = data['version_id']; captured_versions.add(data['version_id'])
                    if not title:
                        artifact = self.store.one('SELECT title FROM artifacts WHERE id=?',(ident,))
                        title = artifact['title'] if artifact else '已移除成果'
                elif kind == 'paper_uploaded':
                    paper = self.store.one('SELECT title FROM papers WHERE id=? AND project_id=?',(ident,project))
                    title = title or (paper['title'] if paper else '已移除资料')
                    reference = {'kind':'paper','id':ident,'version_id':data['version_id']}; captured_versions.add(data['version_id'])
                elif kind == 'experiment_record_changed':
                    saved = self.store.one('SELECT record FROM experiment_record_history WHERE group_id=? AND entity_id=? AND revision=?',(ident,data.get('entity_id'),data.get('revision')))
                    if not saved or self.service.remote.groups.records.present(None,project,json.loads(saved['record'])).get('unavailable'):
                        continue
                    reference = {'kind':'experiment','id':ident}
                    changes = {'entity_id':data['entity_id'],'revision':data['revision']}
                elif kind in ('experiment_created','experiment_completed'):
                    reference = {'kind':'experiment','id':ident}
                elif kind.endswith('_changed'):
                    changes = {key:data[key] for key in ('enabled','default','max_concurrent','scope') if key in data}
                result.append(self.present(event['id'],kind,title,event['created'],event['actor_id'],reference,changes))
            for event in research:
                data, kind = event['data'], event['kind']
                if kind not in LABELS or data.get('version_id') in captured_versions or kind=='research' and (data.get('tool') or data.get('task_id') in captured_runs):
                    continue
                actor_id = data.get('actor_id') or data.get('initiated_by') or data.get('executed_by') or data.get('payload',{}).get('edited_by')
                reference = None
                if kind in ('decision','idea','question','overturned'):
                    reference = {'kind':'knowledge','id':event['id']}
                elif data.get('paper_id'):
                    reference = {'kind':'paper','id':data['paper_id']}
                elif data.get('artifact_id'):
                    reference = {'kind':'artifact','id':data['artifact_id']}
                    version = self.store.one('SELECT task_id,payload FROM artifact_versions WHERE id=?',(data.get('version_id'),))
                    if version and not actor_id:
                        task = self.store.task(version['task_id'])
                        actor_id = json.loads(version['payload']).get('edited_by') or (task['refs'].get('initiated_by') if task else None)
                elif data.get('task_id'):
                    reference = {'kind':'run','id':data['task_id']}
                    task = self.store.task(data['task_id']); actor_id = actor_id or (task['refs'].get('initiated_by') if task else None)
                elif data.get('experiment_id'):
                    reference = {'kind':'experiment','id':data['experiment_id']}
                if reference and reference['kind'] in ('paper','artifact') and data.get('version_id'):
                    reference['version_id'] = data['version_id']
                title = data.get('title') or data.get('text') or ''
                result.append(self.present('research:'+event['id'],kind,title,event['created'],actor_id,reference,{}))
            return result

    def present(self, ident, kind, title, created, actor, reference, changes):
        person = self.store.one('SELECT email FROM collab_users WHERE id=?',(actor,)) if actor else None
        return {'id':ident,'kind':kind,'action':LABELS[kind],'title':str(title or '')[:500],'created':created,
                'actor_id':actor,'actor_email':person['email'] if person else None,'reference':reference,'changes':changes,
                'attribution':'initiator' if kind.startswith('agent_run_') and kind!='agent_run_controlled' else 'authorizer' if kind=='experiment_completed' else 'actor'}
