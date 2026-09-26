from __future__ import annotations
import argparse
import hashlib
import json
import mimetypes
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
import pymupdf
from .agent import Research
from .literature import import_literature, import_links, import_pdf_files, material_row, retry_literature, search_literature
from .state import Store, json_text, new_id, now
from .writing import Writing, selection_text
from .progress import Progress
from .errors import ERRORS, AppError, public_payload, record_error, task_presentation

ROOT = Path(__file__).resolve().parents[1]


class Service:
    def __init__(self, pdf_dir: Path, data_dir: Path):
        self.store = Store(data_dir / 'methodatlas.sqlite3')
        self.store.sync_pdfs(pdf_dir)
        self.research = Research(self.store)
        self.writing = Writing(self.store, self.research)
        from .skills import Skills
        self.skills = Skills(self)
        self.progress = Progress(self.store, self.research)
        self.store.progress = self.progress
        from .remote import Remote
        self.remote = Remote(self.store)
        self.store.remote = self.remote
        self.remote.start()
        from .subscriptions import Subscriptions
        self.subscriptions = Subscriptions(self.store, self.research, self.progress)
        self.store.subscriptions = self.subscriptions
        # Design limit: one research worker locally; chat and routing have separate capacity.
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='methodatlas')
        self.router = ThreadPoolExecutor(max_workers=2, thread_name_prefix='route')
        self.chat_worker = ThreadPoolExecutor(max_workers=2, thread_name_prefix='chat')
        self.scheduling = threading.RLock()
        self.inflight = {}
        self.closing = False
        self.downloads = ThreadPoolExecutor(max_workers=2, thread_name_prefix='paper-download')
        self.downloading = set()
        self.schedule_downloads()
        self.schedule()
        self.progress.start()
        self.subscriptions.start()
        self.remote.groups.service = self

    def schedule_downloads(self):
        from .discovery import download_collected
        with self.scheduling:
            if self.closing:
                return
            for paper in self.store.all("SELECT id,project_id FROM papers WHERE json_extract(availability,'$.fulltext')='pending'"):
                if paper['id'] in self.downloading:
                    continue
                self.downloading.add(paper['id'])
                future = self.downloads.submit(download_collected,self.store,paper['project_id'],paper['id'])
                future.add_done_callback(lambda done, pid=paper['id']: self.download_finished(pid))

    def download_finished(self, paper_id):
        with self.scheduling:
            self.downloading.discard(paper_id)

    def schedule(self):
        with self.scheduling:
            if self.closing:
                return
            for row in self.store.all("SELECT id FROM tasks WHERE status='queued' ORDER BY created,id"):
                task = self.store.task(row['id'])
                if task['id'] in self.inflight:
                    continue
                routed = 'route' in task['checkpoint']
                lane = ('chat' if task['checkpoint']['route'].get('direct_search') else task['kind']) if routed else 'route'
                if lane == 'research':
                    if 'research' in self.inflight.values():
                        continue
                    blocker = self.store.one("SELECT 1 FROM tasks WHERE conversation_id=? AND id<>? AND (status='waiting' OR (created<? AND status IN ('queued','routing','running'))) AND kind<>'chat'", (task['conversation_id'],task['id'],task['created']))
                    if blocker:
                        continue
                if lane == 'route' and list(self.inflight.values()).count('route') >= 2 or lane == 'chat' and list(self.inflight.values()).count('chat') >= 2:
                    continue
                self.inflight[task['id']] = lane
                executor = self.router if lane == 'route' else self.chat_worker if lane == 'chat' else self.worker
                future = executor.submit(self.route if lane == 'route' else self.research.run, task['id'])
                future.add_done_callback(lambda done, tid=task['id']: self.dispatched(tid))

    def dispatched(self, task_id):
        with self.scheduling:
            self.inflight.pop(task_id, None)
            self.schedule()

    def route(self, task_id):
        with self.store.transaction() as db:
            if db.execute("UPDATE tasks SET status='routing' WHERE id=? AND status='queued'", (task_id,)).rowcount != 1:
                return
            task = self.store.task(task_id)
        try:
            from .agent import ProjectTools
            from .rag import PLAN
            from .direct_search import route as search_route
            plan = ({'intent':'research','mode':'explore','reason':'用户选择内置深度调研','only_selected':task['refs'].get('previous_scope') == 'selected','deep_search':True} if task['refs'].get('deep_research') else search_route(task))
            if plan is None:
                config, _ = self.research.settings.for_task(task)
                if not config['api_key'] and config['protocol'] == 'deepseek':
                    raise ValueError('未配置模型连接，请在设置中添加连接')
                context = self.research.context(task)
                plan = self.research.complete(task, PLAN, {**context, 'available_files':ProjectTools(self.store, task).list_files()}, 'rag-plan', 2048)
            from .audit import requested_mode
            audit = requested_mode(task['prompt'])
            if audit and not task['refs'].get('deep_research'):
                plan.update(intent='research', mode='explore', audit=audit, reason='论文核查')
            elif plan.get('audit'):
                from .research_skills import selected_skills
                skills = selected_skills({**task, 'kind':'research', 'checkpoint':{'route':plan}})
                if skills != ['research-paper-audit']:
                    plan.pop('audit')
                    plan['skills'] = skills
            if plan.get('mode') not in ('direct','rag','explore') or type(plan.get('only_selected')) is not bool or plan.get('intent') not in ('research','chat'):
                raise ValueError('研究路由格式无效')
            if plan['mode'] == 'direct':
                from .rag import direct_answer
                answer = direct_answer(plan)
                with self.store.transaction() as db:
                    self.store.update_active(task_id,task['revision'],kind='chat',status='succeeded')
                    db.execute("INSERT INTO messages(id,conversation_id,role,text,created,task_id) VALUES(?,?,'assistant',?,?,?)", (new_id('message'),task['conversation_id'],answer.strip(),now(),task_id))
                    db.execute('UPDATE conversations SET updated=? WHERE id=?', (now(),task['conversation_id']))
                return
            with self.store.transaction():
                checkpoint = self.store.task(task_id)['checkpoint']
                deferred = bool(self.store.one("SELECT 1 FROM tasks WHERE conversation_id=? AND created<? AND status IN ('queued','routing','running','waiting') AND kind<>'chat'", (task['conversation_id'],task['created'])))
                self.store.update_active(task_id, task['revision'], kind=plan['intent'], checkpoint={**checkpoint, 'route':plan, 'deferred':deferred}, status='queued')
                self.store.event(task_id, 'queued', '研究已排队' if plan['intent'] == 'research' else '正在回答追问')
        except Exception as error:
            self.research.fail(task, error)

    def control(self, project_id, conversation_id, task_id, action, body):
        if action == 'collect-papers':
            from .discovery import collect
            with self.store.transaction():
                collect(self.store,project_id,conversation_id,task_id,body)
                if body.get('all') is True:
                    for wait in self.store.task_view(task_id)['waits']:
                        if wait['id'] != body['wait_id'] and wait['payload'].get('kind') == 'papers' and not wait['payload'].get('draft'):
                            collect(self.store,project_id,conversation_id,task_id,{'wait_id':wait['id'],'all':True})
            self.schedule_downloads()
            return self.task_view(project_id,task_id)
        cancel_revision = None
        with self.remote.lock, self.store.transaction() as db:
            task = self.store.task(task_id)
            if not task or task['project_id'] != project_id or task['conversation_id'] != conversation_id:
                raise ValueError('任务不属于当前项目和对话')
            status = task['status']
            if action == 'stop':
                if status in ('queued','routing','running','waiting'):
                    cancel_revision = task['revision']
                    db.execute("UPDATE tasks SET status='stopped',revision=revision+1,updated=? WHERE id=?", (now(),task_id))
                    self.store.event(task_id, 'stopped', '停止已生效；此前提交的成果保留，迟到结果不会提交')
            elif action == 'resume':
                if self.store.one("SELECT 1 FROM task_waits WHERE task_id=? AND response IS NULL AND COALESCE(json_extract(payload,'$.collection'),0)=0", (task_id,)):
                    raise ValueError('请先处理待确认对象')
                if status in ('stopped','interrupted','failed'):
                    db.execute("UPDATE tasks SET status='queued',revision=revision+1,error=NULL,blocked_reason=NULL,updated=? WHERE id=?", (now(),task_id))
                    self.store.event(task_id, 'queued', '继续原目标，复用已保存的匹配进度')
            elif action == 'confirm':
                if not isinstance(body.get('wait_id'),str):
                    raise ValueError('确认对象标识无效')
                wait = db.execute('SELECT * FROM task_waits WHERE id=? AND task_id=?', (body.get('wait_id'),task_id)).fetchone()
                response = body.get('response')
                if not wait or not isinstance(response,dict) or len(json_text(response)) > 100000:
                    raise ValueError('确认对象或回应无效')
                from .discovery import validate_confirmation
                if json.loads(wait['payload']).get('collection'):
                    raise ValueError('此清单请使用逐篇收录或全部收录')
                validate_confirmation(json.loads(wait['payload']), response)
                if wait['response'] is not None:
                    if json.loads(wait['response']) != response:
                        raise ValueError('确认对象已消费，不能改变回应')
                else:
                    db.execute('UPDATE task_waits SET response=? WHERE id=?', (json_text(response),wait['id']))
                    if status == 'waiting':
                        db.execute("UPDATE tasks SET status='queued',updated=? WHERE id=?", (now(),task_id))
                    self.store.event(task_id, 'confirmed', '确认已保存：' + wait['object_key'])
            elif action == 'paper-retry':
                key = body.get('import_key')
                imports = task['refs'].get('paper_imports', {})
                if status not in ('failed','interrupted','stopped','succeeded') or key not in imports or imports[key]['status'] != 'failed':
                    raise ValueError('只能重试已结束任务中的失败收录项')
                db.execute("UPDATE tasks SET status='queued',revision=revision+1,error=NULL,refs=? WHERE id=?", (json_text({**task['refs'],'paper_imports':{k:v for k,v in imports.items() if k != key}}),task_id))
            elif action == 'redirect':
                # A new goal gets a new snapshot and no old plan; existing records remain audit evidence.
                text = body.get('text')
                if not isinstance(text,str) or not text.strip():
                    raise ValueError('请提供新研究目标')
                if body.get('client_message_id') == self.store.one('SELECT client_message_id FROM messages WHERE id=?', (task['message_id'],))['client_message_id']:
                    raise ValueError('新目标必须使用新的请求标识')
                result = self.message(project_id, conversation_id, body, schedule=False)
                if not result['duplicate']:
                    cancel_revision = task['revision']
                    if status in ('queued','routing','running','waiting'):
                        db.execute("UPDATE tasks SET status='stopped',revision=revision+1,updated=? WHERE id=?", (now(),task_id))
                        self.store.event(task_id, 'stopped', '改变方向：旧目标已停止，新目标 ' + result['task_id'])
                task_id = result['task_id']
            elif action == 'retry':
                if status not in ('failed','interrupted','stopped','succeeded'):
                    raise ValueError('请先停止任务，再重试失败材料')
                call_id = body.get('call_id')
                if not isinstance(call_id,str):
                    raise ValueError('失败操作标识无效')
                failure = task['refs'].get('failures', {}).get(call_id)
                if not failure:
                    raise ValueError('没有该失败材料操作')
                checkpoint = {**task['checkpoint'], 'retry':failure}
                db.execute("UPDATE tasks SET status='queued',revision=revision+1,error=NULL,checkpoint=?,updated=? WHERE id=?", (json_text(checkpoint),now(),task_id))
                self.store.event(task_id, 'queued', '仅重试失败材料，其他进度保留')
            else:
                raise ValueError('未知任务操作')
        if cancel_revision is not None:
            self.research.cancel(task['id'], cancel_revision)
        self.schedule()
        return self.task_view(project_id, task_id)

    def state(self):
        return {'projects': [self.project_state(p['id']) for p in self.store.projects()],
                'model': self.research.settings.selected()['model'], 'configured': bool(self.research.key), 'harness': '0.1.5rc1 / sdk-minimal'}

    def material_summary(self, paper):
        item = material_row(dict(paper))
        item.pop('path', None)
        return item

    def delivered_version(self, artifact_id):
        return self.store.one("SELECT v.id,v.title FROM artifact_versions v JOIN tasks t ON t.id=v.task_id WHERE v.artifact_id=? AND t.status='succeeded' ORDER BY v.version_no DESC LIMIT 1", (artifact_id,))

    def project_state(self, project_id):
        project = self.store.project(project_id)
        if not project:
            raise ValueError('项目不存在')
        conversations = []
        for conversation in self.store.conversations(project_id):
            messages = self.store.messages(conversation['id'])
            replied = {m['task_id'] for m in messages if m['role'] == 'assistant'}
            presented = []
            for message in messages:
                if message['task_id']:
                    message['task'] = self.task_view(project_id, message['task_id'])
                presented.append(message)
                task = message.get('task')
                if message['role'] == 'user' and task and task.get('failure_reply') and task['id'] not in replied:
                    presented.append({'id':'explanation_'+task['id'], 'role':'assistant','text':task['failure_reply'],'task_id':task['id'],'task':task,'created':message['created']})
            conversations.append({**conversation, 'chat_options': self.research.settings.preferences(conversation['id']), 'messages': presented, 'reads': self.store.reading_history(conversation['id'])})
        return {**dict(project), 'papers': [self.material_summary(p) for p in self.store.papers(project_id)],
                'conversations': conversations, 'artifacts': [{**a, 'title':v['title']} for a in self.store.artifacts(project_id) if (v := self.delivered_version(a['id']))]}

    def task_view(self, project_id, task_id):
        task = self.store.task_view(task_id)
        if not task or task['project_id'] != project_id:
            raise ValueError('任务不属于当前项目')
        task['citations'] = [self.store.citation(project_id, cid, task['conversation_id']) for cid in task['evidence']]
        task['files'] = [{**dict(row), 'downloadable': bool(json.loads(row['payload']).get('filename'))} for row in self.store.all("SELECT artifact_id,id AS version_id,title,kind,version_no,payload FROM artifact_versions WHERE task_id=? AND json_extract(payload,'$.restored_from') IS NULL", (task_id,))]
        return task_presentation(task)

    def message(self, project_id, conversation_id, body, schedule=True):
        if not self.store.one('SELECT 1 FROM conversations WHERE id=? AND project_id=?', (conversation_id,project_id)):
            raise ValueError('项目或对话归属无效')
        text, client_id = body.get('text'), body.get('client_message_id')
        replace_active = body.get('replace_active', False)
        if type(replace_active) is not bool:
            raise ValueError('打断参数必须为布尔值')
        if not isinstance(text,str) or not text.strip() or len(text) > 100000:
            raise ValueError('消息不能为空，最多 100000 字符')
        if not isinstance(client_id,str) or not 1 <= len(client_id) <= 200:
            raise ValueError('必须提供稳定的 client_message_id')
        selected = body.get('selected_paper_ids', [])
        if not isinstance(selected,list) or not all(isinstance(p,str) for p in selected):
            raise ValueError('重点材料必须是标识列表')
        papers = self.store.papers(project_id)
        if not set(selected) <= {p['id'] for p in papers}:
            raise ValueError('文献不属于当前项目')
        reference = body.get('reference')
        if reference is not None:
            if not isinstance(reference,dict) or set(reference) != {'artifact_id','version_id'}:
                raise ValueError('参考成果必须绑定具体版本')
            version = self.file_version(project_id, reference['artifact_id'], reference['version_id'])
            if version['kind'] != 'manuscript':
                self.file_version(project_id, reference['artifact_id'], reference['version_id'], conversation_id)
        fragments = body.get('selected_fragments', [])
        if not isinstance(fragments, list) or len(fragments) > 20:
            raise ValueError('最多添加20个文本片段')
        checked_fragments = []
        for fragment in fragments:
            if not isinstance(fragment, dict) or set(fragment) != {'artifact_id', 'version_id', 'selection', 'text'} or any(not isinstance(fragment.get(k), str) for k in ('artifact_id', 'version_id', 'text')):
                raise ValueError('文本片段须绑定成果、版本和选区')
            version = self.writing.version(project_id, fragment['artifact_id'], fragment['version_id'])
            original = selection_text(version['payload']['document'], fragment['selection'])
            if original != fragment['text']:
                raise ValueError('文本片段与来源版本不一致，请重新选择')
            checked_fragments.append({**fragment, 'title': version['title'], 'version_no': version['version_no']})
        if sum(len(f['text']) for f in checked_fragments) > 20000:
            raise ValueError('所选文本片段总计最多20000字符')
        report_sources = body.get('report_sources', [])
        if not isinstance(report_sources, list) or len(report_sources) > 20:
            raise ValueError('汇报最多选择20个项目成果')
        for source in report_sources:
            if not isinstance(source, dict) or set(source) != {'artifact_id', 'version_id'} or any(not isinstance(v, str) for v in source.values()):
                raise ValueError('汇报来源须绑定成果与版本')
            self.file_version(project_id, source['artifact_id'], source['version_id'])
        progress_reference = body.get('progress_reference')
        progress_context = None
        if progress_reference is not None:
            if not isinstance(progress_reference, dict) or set(progress_reference) != {'artifact_id', 'version_id'}:
                raise ValueError('研究回顾必须绑定具体版本')
            report = self.file_version(project_id, progress_reference['artifact_id'], progress_reference['version_id'])
            if report['kind'] != 'progress':
                raise ValueError('请选择研究回顾版本')
            progress_context = {**progress_reference, 'day': report['payload']['day'], 'body': report['body'][:24000], 'truncated': len(report['body']) > 24000}
        deep_research = body.get('deep_research', False)
        if type(deep_research) is not bool: raise ValueError('深度调研选项必须为布尔值')
        preferences = self.research.settings.preferences(conversation_id)
        request_data = {'text':text,'selected':selected,'reference':reference}
        if 'chat_options' in body:
            preferences = self.research.settings.preferences(conversation_id, body['chat_options'])
            request_data['chat_options'] = body['chat_options']
        if deep_research: request_data['deep_research'] = True
        if progress_reference is not None:
            request_data['progress_reference'] = progress_reference
        if checked_fragments:
            request_data['selected_fragments'] = checked_fragments
        if replace_active:
            request_data['replace_active'] = True
        if report_sources:
            request_data['report_sources'] = report_sources
        fingerprint = hashlib.sha256(json_text(request_data).encode()).hexdigest()
        stopped = []
        with self.remote.lock, self.store.transaction() as db:
            existing = db.execute('SELECT * FROM messages WHERE client_message_id=?', (client_id,)).fetchone()
            if existing:
                task = self.store.task(existing['task_id'])
                if existing['conversation_id'] != conversation_id or task['refs'].get('request_hash') != fingerprint:
                    raise ValueError('重复请求标识已用于其他内容或对话')
                return {'message_id':existing['id'], 'task_id':task['id'], 'duplicate':True}
            approved_group = None
            if text.strip().strip('。！!') == '按你判断执行':
                drafts = [g for g in self.remote.groups.list(project_id) if g['conversation_id']==conversation_id and g['status']=='awaiting_confirmation']
                if len(drafts)>1:
                    raise ValueError('有多个待确认实验组，请在远程实验入口选择具体计划')
                if drafts:
                    approved_group = drafts[0]
            if approved_group:
                self.remote.groups.control(project_id,approved_group['id'],'confirm',{'digest':approved_group['digest']})
            personal_skill = self.skills.bind(text)
            if replace_active:
                stopped = db.execute("SELECT id,revision FROM tasks WHERE conversation_id=? AND status IN ('queued','routing','running','waiting')", (conversation_id,)).fetchall()
                for old in stopped:
                    db.execute("UPDATE tasks SET status='stopped',revision=revision+1,updated=? WHERE id=?", (now(),old['id']))
                    self.store.event(old['id'], 'stopped', '已按新消息调整方向，已有成果保留')
            previous = db.execute('SELECT scope_mode FROM tasks WHERE conversation_id=? ORDER BY created DESC LIMIT 1', (conversation_id,)).fetchone()
            snapshot = [{'id':p['id'], 'title':p['title'], 'version_id':p['current_version_id'], 'pages':p['page_count'], 'status':p['status'], 'focus':p['id'] in selected} for p in papers]
            message_id, task_id = new_id('message'), new_id('task')
            refs = {'request_hash':fingerprint, 'reference':reference, 'report_sources':report_sources, 'previous_scope':previous['scope_mode'] if previous else 'project'}
            refs['model_config'] = self.research.settings.snapshot(preferences)
            refs['deep_research'] = deep_research
            if progress_context:
                refs['progress_context'] = progress_context
            if checked_fragments:
                refs['selected_fragments'] = checked_fragments
            if approved_group:
                refs['experiment_group']=approved_group['id']
            if personal_skill:
                refs['personal_skill'] = personal_skill
            db.execute("INSERT INTO messages(id,conversation_id,client_message_id,role,text,created,task_id) VALUES(?,?,?,'user',?,?,?)", (message_id,conversation_id,client_id,text,now(),task_id))
            db.execute("INSERT INTO tasks(id,project_id,conversation_id,message_id,prompt,selected_paper_ids,generate,status,created,updated,snapshot,refs,scope_mode) VALUES(?,?,?,?,?,?,0,'queued',?,?,?,?,?)", (task_id,project_id,conversation_id,message_id,text,json_text(selected),now(),now(),json_text(snapshot),json_text(refs),refs['previous_scope']))
            db.execute("UPDATE conversations SET title=CASE WHEN title='新对话' THEN ? ELSE title END,updated=? WHERE id=?", (text[:30],now(),conversation_id))
            if approved_group:
                self.store.run('UPDATE tasks SET checkpoint=? WHERE id=?', (json_text({'route':{'intent':'research','mode':'explore','reason':'用户确认实验组','only_selected':False,'skills':['research-experiment-plan','research-result-to-claim']}}),task_id))
                group=self.remote.groups.get(project_id,approved_group['id'])
                group.update(last_task=task_id,scheduled_signature=json_text([group['wake'],[]]))
                self.remote.groups.save(group)
            self.store.event(task_id, 'queued', '请求已保存，等待 Harness')
        for old in stopped:
            threading.Thread(target=self.research.cancel, args=(old['id'], old['revision']), daemon=True).start()
        if schedule:
            self.schedule()
        return {'message_id':message_id, 'task_id':task_id, 'duplicate':False}

    def file_version(self, project_id, artifact_id, version_id, conversation_id=None):
        item = self.store.artifact(project_id, artifact_id)
        version = next((v for v in item['versions'] if v['id'] == version_id), None) if item else None
        if not version:
            raise ValueError('成果或版本归属无效')
        if conversation_id and self.store.task(version['task_id'])['conversation_id'] != conversation_id:
            raise ValueError('成果不属于当前对话')
        return version

    def file_path(self, project_id, version):
        workspace = (self.store.root / 'workspaces' / project_id).resolve()
        filename = version['payload'].get('filename', '')
        if not filename or Path(filename).name != filename:
            raise ValueError('该历史版本没有可下载文件')
        path = (workspace / filename).resolve()
        if path.parent != workspace or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != version['payload'].get('sha256'):
            raise ValueError('成果文件缺失或校验失败')
        return path

    def restore_artifact(self, project_id, artifact_id, body):
        request = body.get('request_id')
        if not isinstance(request, str) or not 1 <= len(request) <= 100:
            raise ValueError('恢复需要稳定的请求标识')
        fingerprint = hashlib.sha256(json_text(body).encode()).hexdigest()
        key = 'restore:' + project_id + ':' + artifact_id
        with self.store.transaction() as db:
            prior = db.execute('SELECT result FROM file_commits WHERE task_id=? AND call_id=?', (key,request)).fetchone()
            if prior:
                result = json.loads(prior['result'])
                if result['fingerprint'] != fingerprint:
                    raise ValueError('恢复请求标识已用于其他内容')
                return result['value']
            old = self.file_version(project_id, artifact_id, body.get('version_id'))
            latest = self.store.artifact(project_id, artifact_id)['versions'][-1]
            if latest['id'] != body.get('base_version_id'):
                raise ValueError('成果已有新版，请回读后再恢复；旧内容已保留')
            if old['kind'] not in ('html', 'docx'):
                raise ValueError('此入口仅恢复研究 HTML / DOCX 成果')
            self.file_path(project_id, old)
            for citation in old['citations']:
                self.store.citation(project_id, citation['id'])
            # Immutable bytes are shared; restoration appends metadata, never overwrites files.
            vid = new_id('artifact_version')
            payload = {**old['payload'], 'base_version_id':latest['id'], 'restored_from':old['id'], 'author':'human'}
            db.execute('INSERT INTO artifact_versions(id,artifact_id,task_id,version_no,title,body,citations,materials,created,kind,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (vid,artifact_id,old['task_id'],latest['version_no']+1,old['title'],old['body'],json_text(old['citations']),json_text(old['materials']),now(),old['kind'],json_text(payload)))
            db.execute('UPDATE artifacts SET title=?,updated=? WHERE id=?', (old['title'],now(),artifact_id))
            value = {'artifact_id':artifact_id,'version_id':vid,'version_no':latest['version_no']+1}
            db.execute('INSERT INTO file_commits VALUES(?,?,?)', (key,request,json_text({'fingerprint':fingerprint,'value':value})))
            return value

    def close(self):
        self.closing = True
        self.subscriptions.close()
        self.progress.close()
        self.remote.close()
        for task_id in list(self.inflight):
            task = self.store.task(task_id)
            if task and task['status'] in ('running','routing'):
                with self.store.transaction() as db:
                    db.execute("UPDATE tasks SET status='interrupted',revision=revision+1 WHERE id=?", (task_id,))
                    self.store.event(task_id, 'interrupted', '服务关闭，已保存进度；可主动继续')
                self.research.cancel(task_id, task['revision'])
        self.router.shutdown(wait=True, cancel_futures=True)
        self.chat_worker.shutdown(wait=True, cancel_futures=True)
        self.worker.shutdown(wait=True, cancel_futures=True)
        self.downloads.shutdown(wait=True, cancel_futures=True)
        self.research.close()
        self.store.close()


class Handler(BaseHTTPRequestHandler):
    service: Service

    def log_message(self, *_):
        pass

    def trusted(self, mutation=False, content_types=None):
        hosts = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in hosts:
            raise PermissionError('仅限本机访问')
        origin = self.headers.get('Origin')
        if origin is not None and origin not in {'http://' + host for host in hosts}:
            raise PermissionError('拒绝跨站请求')
        if mutation and self.headers.get_content_type() not in (content_types or {'application/json'}):
            raise PermissionError('写入内容类型不受支持')

    def multipart(self, raw):
        header = f"Content-Type: {self.headers.get('Content-Type')}\r\nMIME-Version: 1.0\r\n\r\n".encode('ascii')
        message = BytesParser(policy=policy.default).parsebytes(header + raw)
        if not message.is_multipart():
            raise ValueError('上传表单格式无效')
        files, fields = [], {}
        for part in message.iter_parts():
            if part.get_content_disposition() != 'form-data':
                continue
            name = part.get_param('name', header='content-disposition')
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b''
            if filename is not None:
                files.append((Path(filename).name, payload))
            elif name:
                fields[name] = payload.decode(part.get_content_charset() or 'utf-8', 'replace')
        return files, fields

    def send_bytes(self, status, raw, content_type, filename=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        if filename:
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(filename))
        self.end_headers()
        self.wfile.write(raw)

    def send_json(self, status, payload):
        self.send_bytes(status, json_text(public_payload(payload)).encode(), 'application/json; charset=utf-8')

    def failure(self, exc):
        info = record_error(self.service.store, exc, method=self.command, path=urlparse(self.path).path)
        # Keep the existing HTTP contract for legacy validation errors; new typed
        # failures carry their own category while clients migrate to error_info.
        status = ERRORS[info['code']][4] if isinstance(exc, AppError) else 403 if isinstance(exc, PermissionError) else 400 if isinstance(exc, (ValueError, KeyError)) else 500
        self.send_json(status, {'error':info['message'], 'error_info':info, 'explanation':getattr(exc,'public_explanation',None)})

    def do_GET(self):
        try:
            self.trusted()
            parsed = urlparse(self.path)
            path, query = unquote(parsed.path), parse_qs(parsed.query)
            if path == '/api/settings':
                return self.send_json(200, self.service.research.settings.view())
            match = re.fullmatch(r'/api/projects/([^/]+)/conversations/([^/]+)/preferences', path)
            if match:
                if not self.service.store.one('SELECT 1 FROM conversations WHERE id=? AND project_id=?',(match[2],match[1])): raise ValueError('对话不属于项目')
                return self.send_json(200,self.service.research.settings.preferences(match[2]))
            match = re.fullmatch(r'/api/projects/([^/]+)/remote/groups/(group_[a-f0-9]{32})/chart', path)
            if match:
                svg=self.service.remote.groups.chart(match[1],match[2],query.get('metric',[''])[0])
                return self.send_bytes(200,svg.encode(),'image/svg+xml')
            match = re.fullmatch(r'/api/projects/([^/]+)/remote/groups(?:/(group_[a-f0-9]{32}))?', path)
            if match:
                groups = self.service.remote.groups
                return self.send_json(200, groups.get(match[1],match[2]) if match[2] else groups.list(match[1]))
            match = re.fullmatch(r'/api/projects/([^/]+)/remote/results/([a-f0-9]{64})', path)
            if match:
                raw, name = self.service.remote.result_file(match[1], match[2])
                return self.send_bytes(200, raw, 'application/octet-stream', name)
            match = re.fullmatch(r'/api/projects/([^/]+)/remote(?:/(exp_[a-f0-9]{32}))?', path)
            if match:
                return self.send_json(200, self.service.remote.get(match[1], match[2]) if match[2] else self.service.remote.list(match[1]))
            if path == '/api/skills':
                return self.send_json(200, self.service.skills.list())
            match = re.fullmatch(r'/api/skills/shared/([A-Za-z0-9_-]+)', path)
            if match:
                return self.send_bytes(200, self.service.skills.shared(match[1]).encode(), 'text/markdown; charset=utf-8', 'research-skill.md')
            match = re.fullmatch(r'/api/projects/([^/]+)/subscription', path)
            if match:
                return self.send_json(200, self.service.subscriptions.get(match[1]))
            match = re.fullmatch(r'/api/projects/([^/]+)/progress/([0-9-]+(?:-[wm])?)/export', path)
            if match:
                format = query.get('format', ['markdown'])[0]
                raw = self.service.progress.export(match[1], match[2], query.get('version', [''])[0], format)
                return self.send_bytes(200, raw, 'application/pdf' if format == 'pdf' else 'text/markdown; charset=utf-8', match[2] + ('.pdf' if format == 'pdf' else '.md'))
            match = re.fullmatch(r'/api/projects/([^/]+)/progress(?:/([0-9-]+(?:-[wm])?))?', path)
            if match:
                return self.send_json(200, self.service.progress.get(match[1], match[2]) if match[2] else self.service.progress.timeline(match[1]))
            if path == '/api/state':
                return self.send_json(200, self.service.state())
            match = re.fullmatch(r'/api/projects/([^/]+)/documents/([^/]+)/versions/([^/]+)/layout(?:/(pdf))?', path)
            if match:
                from .paper_layout import get_layout, layout_pdf
                if not match[4]:
                    return self.send_json(200, get_layout(self.service.writing, match[1], match[2], match[3]))
                download = query.get('download', ['0'])[0] == '1'
                raw, filename = layout_pdf(self.service.writing, match[1], match[2], match[3], download=download)
                return self.send_bytes(200, raw, 'application/pdf', filename if download else None)
            match = re.fullmatch(r'/api/projects/([^/]+)/documents/([^/]+)(?:/versions/([^/]+)/export)?', path)
            if match:
                if not match[3]:
                    return self.send_json(200, self.service.writing.get(match[1], match[2]))
                kind = query.get('format', ['html'])[0]
                raw, filename = self.service.writing.export(match[1], match[2], match[3], kind)
                return self.send_bytes(200, raw, mimetypes.guess_type(filename)[0] or 'application/octet-stream', filename)
            match = re.fullmatch(r'/api/projects/([^/]+)', path)
            if match:
                return self.send_json(200, self.service.project_state(match[1]))
            match = re.fullmatch(r'/api/projects/([^/]+)/tasks/([^/]+)', path)
            if match:
                return self.send_json(200, self.service.task_view(match[1],match[2]))
            match = re.fullmatch(r'/api/projects/([^/]+)/citations/([^/]+)/export', path)
            if match:
                from .exports import export_figure
                return self.send_bytes(200, export_figure(self.service.store, match[1], match[2]), 'application/pdf', '图表解读.pdf')
            match = re.fullmatch(r'/api/projects/([^/]+)/citations/([^/]+)', path)
            if match:
                return self.send_json(200, self.service.store.citation(match[1],match[2]))
            match = re.fullmatch(r'/api/projects/([^/]+)/papers/([^/]+)(?:/(pdf|page|fragment))?', path)
            if match:
                paper = self.service.store.paper(match[1], match[2], query.get('version_id',[None])[0])
                if not paper:
                    raise ValueError('文献或版本归属无效')
                if match[3]:
                    if not paper['source_path']:
                        raise ValueError('该材料没有可用的原始 PDF')
                    source = Path(paper['source_path'])
                    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != paper['sha256']:
                        raise ValueError('原 PDF 缺失或内容校验失败')
                    if match[3] == 'pdf':
                        filename = paper['title'] + '.pdf' if query.get('download',['0'])[0] == '1' else None
                        return self.send_bytes(200, source.read_bytes(), 'application/pdf', filename)
                    page = int(query.get('page',['1'])[0])
                    with pymupdf.open(source) as pdf:
                        if not 1 <= page <= len(pdf):
                            raise ValueError('页码超出该文献范围')
                        current_page = pdf[page - 1]
                        clip = None
                        if match[3] == 'fragment':
                            values = [float(query.get(name,[None])[0]) for name in ('x0','y0','x1','y1')]
                            clip = pymupdf.Rect(values)
                            if clip.is_empty or clip.is_infinite or not clip.intersects(current_page.rect):
                                raise ValueError('原文图片范围无效')
                        raw = current_page.get_pixmap(matrix=pymupdf.Matrix(1.8,1.8), clip=clip, alpha=False).tobytes('png')
                    return self.send_bytes(200, raw, 'image/png')
                paper = material_row(paper)
                paper['pages'] = json.loads(paper['pages'])
                paper['kind'] = 'pdf' if paper['source_path'] else 'text'
                paper.pop('path',None)
                paper.pop('source_path',None)
                return self.send_json(200,paper)
            match = re.fullmatch(r'/api/projects/([^/]+)/artifacts/([^/]+)(?:/versions/([^/]+)/(download|preview|sources|export))?', path)
            if match:
                self.service.progress.sync_project(match[1])
                if not match[3]:
                    item = self.service.store.artifact(match[1],match[2])
                    if not item:
                        raise ValueError('成果不存在')
                    delivered = self.service.delivered_version(item['id'])
                    item['default_version_id'] = delivered['id'] if delivered else None
                    return self.send_json(200,item)
                version = self.service.file_version(match[1],match[2],match[3])
                if match[4] == 'export':
                    from .exports import export_version
                    if version['payload'].get('filename'):
                        self.service.file_path(match[1], version)
                    format = query.get('format', [''])[0]
                    raw = export_version(self.service.store, match[1], version, format)
                    mime, extension = ('text/markdown; charset=utf-8', 'md') if format == 'markdown' else ('application/pdf', 'pdf')
                    return self.send_bytes(200, raw, mime, f'{version["title"]}-v{version["version_no"]}.{extension}')
                if version['kind'] == 'manuscript' and match[4] == 'download':
                    raw, filename = self.service.writing.export(match[1], match[2], match[3], 'html')
                    return self.send_bytes(200, raw, 'text/html; charset=utf-8', filename)
                if match[4] == 'sources':
                    return self.send_bytes(200, json_text({'title':version['title'], 'version_id':version['id'],
                        'materials':version['materials'], 'citations':version['citations'],
                        'report':version['payload'].get('report')}).encode(), 'application/json; charset=utf-8', version['title'] + '-sources.json')
                file = self.service.file_path(match[1],version)
                if match[4] == 'preview':
                    if version['kind'] == 'png':
                        return self.send_bytes(200, file.read_bytes(), 'image/png')
                    content = file.read_text('utf-8') if version['kind'] in ('html','graph') else version['body']
                    if version['kind'] == 'graph':
                        from .graph import preview_graph
                        content = preview_graph(content)
                    return self.send_json(200, {'kind': version['kind'], 'content': content})
                return self.send_bytes(200,file.read_bytes(),mimetypes.guess_type(file)[0] or 'application/octet-stream',version['payload']['day'] + '.md' if version['kind'] == 'progress' else version['title'] + '.' + ('html' if version['kind'] == 'graph' else version['kind']))
            if path == '/app.js':
                app = ROOT / 'prototype' / 'app.js'
                raw = app.read_bytes() + b'\n\n' + (ROOT / 'prototype/literature.js').read_bytes() + b'\n\n' + (ROOT / 'prototype/progress.js').read_bytes() + b'\n\n' + (ROOT / 'prototype/subscriptions.js').read_bytes()
                raw += b'\n\n' + (ROOT / 'prototype/skills.js').read_bytes()
                raw += b'\n\n' + (ROOT / 'prototype/remote.js').read_bytes()
                raw += b'\n\n' + (ROOT / 'prototype/settings.js').read_bytes()
                return self.send_bytes(200, raw, 'text/javascript; charset=utf-8')
            if path in ('/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs'):
                file = ROOT / 'prototype' / path.lstrip('/')
                return self.send_bytes(200, file.read_bytes(), 'text/javascript; charset=utf-8')
            if path in ('/writing.js', '/writing.css'):
                file = ROOT / 'prototype' / 'dist' / path.lstrip('/')
                if not file.is_file():
                    raise ValueError('写作组件尚未构建，请运行 npm run build:writing')
                return self.send_bytes(200, file.read_bytes(), 'text/css' if path.endswith('.css') else 'text/javascript')
            if path in ('/', '/index.html', '/literature.js', '/home.css', '/settings.css', '/report.css', '/assets/methodatlas-mark.png'):
                file = ROOT / 'prototype' / ('index.html' if path == '/' else path.lstrip('/'))
                content_type = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png'}[file.suffix]
                return self.send_bytes(200, file.read_bytes(), content_type)
            raise AppError('not_found', 'Unknown API route: ' + path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.failure(exc)

    def do_POST(self):
        try:
            path = unquote(urlparse(self.path).path)
            upload = re.fullmatch(r'/api/projects/([^/]+)/sources/files', path)
            self.trusted(mutation=True, content_types={'multipart/form-data'} if upload else {'application/json'})
            length = int(self.headers.get('Content-Length',0))
            limit = 120 * 1024 * 1024 if upload else 2_000_000
            if not 0 < length <= limit:
                raise ValueError('请求大小无效，批量 PDF 最多 120 MB' if upload else '请求大小无效，最多 2 MB')
            if upload:
                files, fields = self.multipart(self.rfile.read(length))
                target = fields.get('target_paper_id') or None
                return self.send_json(207, import_pdf_files(self.service.store, upload[1], files, target))
            try:
                body = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeError) as exc:
                raise AppError('input', '请求正文不是有效 JSON') from exc
            if not isinstance(body,dict):
                raise ValueError('请求必须是 JSON 对象')
            if path == '/api/settings/preferences':
                return self.send_json(200,self.service.research.settings.global_preferences(body))
            match = re.fullmatch(r'/api/settings/models/(save|test|default|delete)', path)
            if match:
                return self.send_json(200,self.service.research.settings.change(match[1],body))
            match = re.fullmatch(r'/api/projects/([^/]+)/conversations/([^/]+)/preferences', path)
            if match:
                if not self.service.store.one('SELECT 1 FROM conversations WHERE id=? AND project_id=?',(match[2],match[1])): raise ValueError('对话不属于项目')
                return self.send_json(200,self.service.research.settings.preferences(match[2],body))
            match = re.fullmatch(r'/api/projects/([^/]+)/remote/groups/(prepare|group_[a-f0-9]{32})(?:/(confirm|pause|resume|upload))?', path)
            if match:
                groups = self.service.remote.groups
                if match[2] == 'prepare' and not match[3]:
                    result = groups.prepare(match[1],body)
                elif match[3] == 'upload':
                    result = groups.workspace(match[1],match[2],{'operation':'write',**body})
                else:
                    result = groups.control(match[1],match[2],match[3],body)
                return self.send_json(200,result)
            if path == '/api/remote/servers/preview-import':
                return self.send_json(200, self.service.remote.preview_import(body))
            match = re.fullmatch(r'/api/remote/servers/(save|delete|check)', path)
            if match:
                return self.send_json(200, self.service.remote.servers(match[1], body))
            match = re.fullmatch(r'/api/projects/([^/]+)/remote/(prepare|exp_[a-f0-9]{32})(?:/(confirm|observe|log|result|cancel|fetch|repair|rename))?', path)
            if match:
                remote, project, ident, action = self.service.remote, match[1], match[2], match[3]
                if ident == 'prepare' and action is None:
                    result = remote.prepare(project, body)
                elif action == 'observe':
                    result = remote.observe(project, ident)
                elif action in ('log', 'result'):
                    result = remote.read(project, ident, body, result=action == 'result')
                elif action == 'repair':
                    result = remote.prepare_repair(project, ident, body)
                elif action in ('confirm', 'cancel', 'fetch'):
                    result = getattr(remote, action)(project, ident, body)
                else:
                    raise ValueError('未知远程实验操作')
                return self.send_json(200, result)
            match = re.fullmatch(r'/api/projects/([^/]+)/skills/(draft|save|copy|import|preview-import|export|archive|restore|delete|share|revoke)', path)
            if match:
                if match[2] == 'preview-import':
                    from .skills import parse_markdown
                    return self.send_json(200, {'fields':parse_markdown(body.get('markdown'))})
                result = self.service.skills.draft(match[1], body) if match[2] == 'draft' else self.service.skills.change(match[1], match[2], body)
                return self.send_json(200, result)
            match = re.fullmatch(r'/api/projects/([^/]+)/artifacts/([^/]+)/restore', path)
            if match:
                artifact = self.service.store.artifact(match[1], match[2])
                if artifact and artifact['kind'] == 'graph':
                    from .graph import restore_graph
                    return self.send_json(200, restore_graph(self.service, match[1], match[2], body))
                return self.send_json(200, self.service.restore_artifact(match[1], match[2], body))
            match = re.fullmatch(r'/api/projects/([^/]+)/subscription/(create|settings|enable|refresh|run|choose)', path)
            if match:
                project, action = match[1], match[2]
                subscription = self.service.subscriptions
                if action == 'create':
                    item = subscription.create(project, body)
                    result = subscription.execute(project, 'enable', subscription_id=item['id'])
                elif action == 'settings':
                    ident = body.pop('subscription_id', None)
                    subscription.settings(project, body, ident)
                    result = subscription.get(project)
                elif action == 'choose':
                    result = subscription.choose(project, body)
                    self.service.schedule_downloads()
                else:
                    ident = body.pop('subscription_id', None)
                    if body:
                        raise ValueError('此操作不接受额外设置，请先保存偏好')
                    result = subscription.execute(project, action, subscription_id=ident)
                return self.send_json(200, result)
            match = re.fullmatch(r'/api/projects/([^/]+)/progress/(settings|events|generate|[0-9-]+(?:-[wm])?)(?:/(save|generate|decide|read|delete|undo|chat))?', path)
            if match:
                progress, project, target, action = self.service.progress, match[1], match[2], match[3]
                if target == 'settings':
                    result = progress.settings(project, body)
                elif target == 'events':
                    result = progress.record(project, body)
                elif target == 'generate' or action == 'generate':
                    if body.get('conversation_id') and not self.service.store.one('SELECT 1 FROM conversations WHERE id=? AND project_id=?',(body['conversation_id'],project)): raise ValueError('对话不属于项目')
                    result = progress.generate(project, None if target == 'generate' else target, body.get('instruction', ''), expected_base=body.get('base_version_id'), conversation=body.get('conversation_id'), chat_options=body.get('chat_options'))
                elif action == 'save':
                    result = progress.save(project, target, body)
                elif action == 'decide':
                    result = progress.decide(project, target, body)
                elif action in ('read', 'delete', 'undo', 'chat'):
                    result = progress.action(project, target, action, body)
                else:
                    raise ValueError('日报操作无效')
                return self.send_json(200, result)
            match = re.fullmatch(r'/api/projects/([^/]+)/documents/([^/]+)/layout(?:/(approve))?', path)
            if match:
                from .paper_layout import create_layout, approve_layout
                operation = approve_layout if match[3] else create_layout
                return self.send_json(200, operation(self.service.writing, match[1], match[2], body))
            match = re.fullmatch(r'/api/projects/([^/]+)/documents(?:/([^/]+)(?:/(save|propose|restore|reference)|/proposals/([^/]+)/(accept|reject))?)?', path)
            if match:
                writing = self.service.writing
                if not match[2]:
                    return self.send_json(201, writing.save(match[1], None, body))
                if match[4]:
                    return self.send_json(200, writing.decide(match[1], match[2], match[4], match[5]))
                operation = {'save': writing.save, 'propose': writing.propose, 'restore': writing.restore, 'reference': writing.reference}.get(match[3])
                if not operation:
                    raise ValueError('文档操作无效')
                return self.send_json(200, operation(match[1], match[2], body))
            if path == '/api/projects':
                name = body.get('name')
                if not isinstance(name,str) or not name.strip() or len(name) > 300:
                    raise ValueError('项目名称无效')
                return self.send_json(201, {'project_id':self.service.store.create_project(name)})
            match = re.fullmatch(r'/api/projects/([^/]+)/conversations', path)
            if match:
                if not self.service.store.project(match[1]):
                    raise ValueError('项目不存在')
                return self.send_json(201, {'conversation_id':self.service.store.create_conversation(match[1])})
            match = re.fullmatch(r'/api/projects/([^/]+)/materials', path)
            if match:
                return self.send_json(201, {'paper_id':self.service.store.paste(match[1],body.get('title'),body.get('text'))})
            match = re.fullmatch(r'/api/projects/([^/]+)/sources/text', path)
            if match:
                return self.send_json(201, {'paper_id':self.service.store.paste(match[1],body.get('title'),body.get('text'))})
            match = re.fullmatch(r'/api/projects/([^/]+)/sources/links', path)
            if match:
                return self.send_json(207, import_links(self.service.store, match[1], body))
            match = re.fullmatch(r'/api/projects/([^/]+)/literature/search', path)
            if match:
                return self.send_json(200, search_literature(self.service.store, match[1], body))
            match = re.fullmatch(r'/api/projects/([^/]+)/literature/import', path)
            if match:
                return self.send_json(201, import_literature(self.service.store, match[1], body))
            match = re.fullmatch(r'/api/projects/([^/]+)/papers/([^/]+)/retry', path)
            if match:
                return self.send_json(200, retry_literature(self.service.store, match[1], match[2]))
            match = re.fullmatch(r'/api/projects/([^/]+)/conversations/([^/]+)/messages', path)
            if match:
                return self.send_json(202,self.service.message(match[1],match[2],body))
            match = re.fullmatch(r'/api/projects/([^/]+)/conversations/([^/]+)/tasks/([^/]+)/(stop|resume|redirect|retry|confirm|paper-retry|collect-papers)', path)
            if match:
                return self.send_json(200,self.service.control(match[1],match[2],match[3],match[4],body))
            raise AppError('not_found', 'Unknown API route: ' + path)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            self.failure(exc)


def main():
    parser = argparse.ArgumentParser(description='MethodAtlas local Harness workbench')
    parser.add_argument('--host', choices=['127.0.0.1'], default='127.0.0.1')
    parser.add_argument('--port', type=int, default=int(os.getenv('METHODATLAS_PORT','8765')))
    parser.add_argument('--pdf-dir', type=Path, default=Path(os.getenv('METHODATLAS_PDF_DIR','论文')))
    parser.add_argument('--data-dir', type=Path, default=Path(os.getenv('METHODATLAS_DATA_DIR','.methodatlas-data')))
    args = parser.parse_args()
    service = Service(args.pdf_dir.resolve(),args.data_dir.resolve())
    handler = type('AppHandler',(Handler,),{'service':service})
    server = None
    for port in ([args.port] if args.port != 8765 else range(8765,8791)):
        try:
            server = ThreadingHTTPServer((args.host,port),handler)
            break
        except OSError:
            continue
    if server is None:
        service.close()
        raise RuntimeError('本地端口不可用')
    print(f'MethodAtlas: http://{args.host}:{server.server_port}',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.close()


if __name__ == '__main__':
    main()
