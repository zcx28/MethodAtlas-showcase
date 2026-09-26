"""Experiment-group authorization and continuation over the existing Mimir/SSH path."""
import hashlib
import json
from pathlib import PurePosixPath
from .state import json_text, new_id, now


class ExperimentGroups:
    def __init__(self, remote):
        self.remote, self.store = remote, remote.store
        self.service = None
        self.store.run('CREATE TABLE IF NOT EXISTS experiment_groups(id TEXT PRIMARY KEY,project_id TEXT,record TEXT)')

    def save(self, group):
        self.store.run('INSERT INTO experiment_groups VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
                       (group['id'], group['project_id'], json_text(group)))
        return group

    def get(self, project, ident):
        self.remote.project(project)
        row = self.store.one('SELECT record FROM experiment_groups WHERE id=? AND project_id=?', (ident, project))
        if not row:
            raise ValueError('实验组不属于此项目')
        return json.loads(row['record'])

    def list(self, project):
        self.remote.project(project)
        return [json.loads(r['record']) for r in self.store.all('SELECT record FROM experiment_groups WHERE project_id=? ORDER BY rowid DESC', (project,))]

    def prepare(self, project, body):
        from .remote import text
        self.remote.project(project)
        if body.keys() - {'conversation_id','server_id','directory','title','plan','steps','resources','network','gpu_devices','max_seconds','max_storage_mb'}:
            raise ValueError('实验组包含未知字段')
        conversation = body.get('conversation_id')
        if not self.store.one('SELECT 1 FROM conversations WHERE id=? AND project_id=?', (conversation, project)):
            raise ValueError('对话不属于此项目')
        server = next((s for s in self.remote.servers()['servers'] if s['id'] == body.get('server_id')), None)
        if not server:
            raise ValueError('请选择已登记服务器')
        directory = text(body.get('directory'), 1000)
        path = PurePosixPath(directory)
        if not path.is_absolute() or '..' in path.parts or str(path) != directory or directory == '/':
            raise ValueError('需要已有、非根目录的 Linux 绝对路径')
        steps = body.get('steps')
        if not isinstance(steps, list) or not 1 <= len(steps) <= 50 or any(not isinstance(s,str) or not s.strip() or len(s)>1000 for s in steps) or len(set(steps)) != len(steps):
            raise ValueError('需要1–50个不重复实验步骤')
        network = body.get('network', False)
        devices = body.get('gpu_devices', [])
        if type(network) is not bool or not isinstance(devices,list) or any(type(d) is not int or not 0 <= d <= 63 for d in devices) or len(set(devices)) != len(devices):
            raise ValueError('网络权限或 GPU 编号无效')
        limits = {}
        for key in ('max_seconds','max_storage_mb'):
            value = body.get(key)
            if value is not None and (type(value) is not int or not 1 <= value <= 2**31-1):
                raise ValueError('实验组额度必须为正整数或留空')
            limits[key] = value
        spec = {'server':server, 'connection':self.remote.bridge('resolve',server), 'directory':directory,
                'title':text(body.get('title'),200), 'plan':text(body.get('plan'),12000), 'steps':steps,
                'resources':text(body.get('resources',''),1000,empty=True), 'network':network,
                'gpu_devices':devices, **limits}
        group = {'id':new_id('group'),'project_id':project,'conversation_id':conversation,'spec':spec,
                 'digest':hashlib.sha256(json_text(spec).encode()).hexdigest(), 'status':'awaiting_confirmation',
                 'created':now(), 'runs':[], 'completed_steps':[], 'changes':[], 'wake':0, 'last_task':None, 'message':''}
        return self.save(group)

    def connection(self, group):
        spec = group['spec']
        server = next((s for s in self.remote.servers()['servers'] if s['id'] == spec['server']['id']), None)
        if server != spec['server'] or self.remote.bridge('resolve',server) != spec['connection']:
            raise ValueError('SSH 配置已变化，请创建新授权')

    def active(self, project, ident):
        group = self.get(project, ident)
        if group['status'] != 'active':
            raise ValueError('实验组未授权或已暂停/结束')
        self.connection(group)
        if group.get('deadline'):
            from datetime import datetime, timezone
            if datetime.now(timezone.utc).timestamp() >= group['deadline']:
                group.update(status='paused',message='已达到实验组时长额度')
                self.save(group)
                raise ValueError(group['message'])
        return group

    def busy(self, group):
        return any(self.remote.get(group['project_id'],r['id'])['status'] in ('submitting','queued','running','unknown') for r in group['runs'])

    def control(self, project, ident, action, body):
        with self.remote.lock:
            group = self.get(project, ident)
            if body != {'digest':group['digest']}:
                raise ValueError('授权内容已变化，请重新预览')
            if action not in ('confirm','pause','resume'):
                raise ValueError('未知实验组操作')
            if group['status'] == 'completed':
                raise ValueError('实验组已完成；新的研究目标须新建计划')
            if action == 'pause':
                group.update(status='paused',message='AI 后续操作已暂停；已提交远程任务继续运行')
                self.save(group)
                if self.service and group.get('last_task'):
                    task = self.store.task(group['last_task'])
                    if task and task['status'] in ('queued','routing','running','waiting'):
                        self.store.run("UPDATE tasks SET status='stopped',revision=revision+1,updated=? WHERE id=?", (now(),task['id']))
                        import threading
                        threading.Thread(target=self.service.research.cancel,args=(task['id'],task['revision']),daemon=True).start()
                return group
            if action == 'resume' and group['status'] == 'awaiting_confirmation':
                raise ValueError('请先确认完整实验组授权')
            self.connection(group)
            check = self.remote.bridge('group-check', {'id':ident,'spec':group['spec'],'digest':group['digest']})
            if check.get('sandbox') != 'bubblewrap':
                raise ValueError('远端缺少可用的执行隔离；未开启自主实验')
            if group['status'] == 'active':
                return group
            if 'authorized_at' not in group:
                group['authorized_at'] = now()
                from datetime import datetime, timezone
                seconds = group['spec'].get('max_seconds')
                group['deadline'] = datetime.now(timezone.utc).timestamp() + seconds if seconds else None
            group.update(status='active',message='',wake=group['wake']+1,last_task=None)
            return self.save(group)

    def workspace(self, project, ident, body):
        from .remote import text
        with self.remote.lock:
            group = self.active(project, ident)
            if self.busy(group):
                raise ValueError('先等待当前任务终态，再读取或修改工作文件')
            operation = body.get('operation')
            if operation not in ('list','read','write') or body.keys() - {'operation','path','content','before_sha256'}:
                raise ValueError('工作文件操作无效')
            path = text(body.get('path','.'),1000)
            if PurePosixPath(path).is_absolute() or '..' in PurePosixPath(path).parts:
                raise ValueError('路径必须在实验组工作目录内')
            if operation == 'write':
                text(body.get('content'),60000,empty=True)
                if not isinstance(body.get('before_sha256'),str):
                    raise ValueError('修改须提供原文件哈希；新建使用空字符串')
            value = self.remote.bridge('workspace',{'id':ident,'spec':group['spec'],'digest':group['digest'],**body})
            if operation == 'write':
                group['changes'].append({**value,'created':now()})
                self.save(group)
            return value

    def run(self, project, ident, body):
        from .remote import text
        with self.remote.lock:
            group = self.active(project,ident)
            if body.keys() - {'step','command','request_id','kind','repair_of','configuration'}:
                raise ValueError('实验运行包含未知字段')
            step = body.get('step')
            if type(step) is not int or not 0 <= step < len(group['spec']['steps']):
                raise ValueError('实验步骤必须属于已确认计划')
            key = text(body.get('request_id'),100)
            command = text(body.get('command'),4000)
            kind = body.get('kind','run')
            if kind not in ('run','setup','repair'):
                raise ValueError('运行类型无效')
            fingerprint = hashlib.sha256(json_text(body).encode()).hexdigest()
            prior = next((r for r in group['runs'] if r['key'] == key),None)
            if prior:
                if prior['fingerprint'] != fingerprint:
                    raise ValueError('同一运行标识已用于不同内容')
                item = self.remote.get(project,prior['id'])
                return self.remote.confirm(project,item['id'],{'digest':item['digest']}) if item['status'] in ('awaiting_confirmation','unknown','submitting') else item
            if self.busy(group):
                raise ValueError('先等待或重连当前任务，不得重复启动')
            if group['runs']:
                previous=group['runs'][-1]
                if previous.get('purpose',previous['kind'])!='setup' and self.remote.get(project,previous['id'])['status']=='succeeded' and not previous.get('evidence'):
                    raise ValueError('先保存上一运行的真实指标证据，再启动后续实验')
            if step in group['completed_steps']:
                raise ValueError('该步骤已完成；扩大计划须另行确认')
            attempt = 0
            latest = next((r for r in reversed(group['runs']) if r['step'] == step),None)
            if latest and self.remote.get(project,latest['id'])['status'] == 'failed':
                if kind != 'repair' or body.get('repair_of') != latest['id']:
                    raise ValueError('此步骤上次运行失败；须沿该记录修复，不得通过新运行绕过计数')
            if kind == 'repair':
                if not latest or latest['id'] != body.get('repair_of') or self.remote.get(project,latest['id'])['status'] != 'failed':
                    raise ValueError('只能修复同一步骤最新的已确认失败任务')
                attempt = latest['attempt'] + 1
                if attempt > 3:
                    group.update(status='paused',message='同一故障连续三次修复仍失败，请求人工处理')
                    self.save(group)
                    raise ValueError(group['message'])
            limits = group['spec']
            sandbox = {'group_id':ident,'digest':group['digest'],'network':limits['network'],
                       'gpu_devices':limits['gpu_devices'],'deadline':group.get('deadline'),
                       'max_storage_mb':limits.get('max_storage_mb')}
            job_id = new_id('exp')
            spec = {'project_id':project,'server':limits['server'],'connection':limits['connection'],
                    'directory':limits['directory'],'command':command,'resources':limits['resources'],
                    'configuration':text(body.get('configuration',''),10000,empty=True), 'sandbox':sandbox}
            digest = hashlib.sha256(json_text(spec).encode()).hexdigest()
            with self.store.transaction() as db:
                db.execute('INSERT INTO remote_experiments(id,project_id,spec,digest,status,job,created,name) VALUES(?,?,?,?,?,?,?,?)',
                           (job_id,project,json_text(spec),digest,'awaiting_confirmation','{}',now(),group['spec']['steps'][step]))
                group['runs'].append({'id':job_id,'key':key,'fingerprint':fingerprint,'step':step,'kind':kind,'purpose':latest.get('purpose',latest['kind']) if kind=='repair' else kind,'attempt':attempt})
                self.save(group)
            return self.remote.confirm(project,job_id,{'digest':digest})

    def record(self, project, ident, experiment_id, result_path, summary, directions=None):
        """Metrics are parsed from a versioned JSON object or CSV, never supplied as invented numbers."""
        from .remote import text
        import csv
        import io
        import math
        with self.remote.lock:
            group = self.active(project,ident)
            run = next((r for r in group['runs'] if r['id'] == experiment_id),None)
            if not run:
                raise ValueError('运行不属于此实验组')
            if run.get('evidence'):
                if run.get('result_path') != str(PurePosixPath(result_path)):
                    raise ValueError('该运行已有固定指标版本，不覆盖；其他文件可通过结果读取入口取回')
                return {'record':run['record'],'evidence':run['evidence'],'summary':run['summary']}
            if self.busy(group) or group['runs'][-1]['id']!=experiment_id:
                raise ValueError('须在后续运行开始前固定当前结果，避免读取被覆盖的结果')
            item = self.remote.observe(project,experiment_id)
            if item['status'] not in ('succeeded','failed'):
                raise ValueError('仅记录已确认终态的结果')
            result = self.remote.fetch(project,experiment_id,{'path':result_path})
            raw, _ = self.remote.result_file(project,result['id'])
            if result_path.endswith('.json'):
                metrics = json.loads(raw)
            elif result_path.endswith('.csv'):
                rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8'))))
                if len(rows) != 1:
                    raise ValueError('请先将所选指标保存为单行 CSV 或 JSON 对象，原始日志仍保留')
                metrics = rows[0]
            else:
                raise ValueError('指标文件应为 JSON 对象或单行 CSV')
            if not isinstance(metrics,dict) or not metrics or len(metrics)>100:
                raise ValueError('指标应为非空对象，最多100项')
            for key, value in metrics.items():
                text(key,100)
                if isinstance(value,str):
                    try:
                        metrics[key] = float(value)
                    except ValueError:
                        text(value,1000)
                if type(metrics[key]) not in (str,int,float) or isinstance(metrics[key],(int,float)) and not math.isfinite(metrics[key]):
                    raise ValueError('指标必须为有限数值或文字')
            outcome = self.remote.bridge('experiment-save', {'id':experiment_id,'projectId':project,
                'name':item['name'] or group['spec']['steps'][run['step']], 'status':'success' if item['status']=='succeeded' else 'failed',
                'metrics':metrics,'metricDirections':directions or {},'serverId':group['spec']['server']['id'],
                'logPath':item['job'].get('logPath','')})
            run['evidence'] = result
            run['result_path'] = str(PurePosixPath(result_path))
            run['summary'] = text(summary,4000)
            run['record'] = outcome['experiment']
            self.save(group)
            return {'record':outcome['experiment'],'evidence':result,'summary':summary}

    def chart(self, project, ident, metric):
        group=self.get(project,ident)
        rows=[]
        for run in group['runs']:
            record=run.get('record',{})
            value=record.get('metrics',{}).get(metric)
            if type(value) in (int,float) and value>=0:
                rows.append({'id':run['id'],'name':record['name'],'value':value})
        if not rows:
            raise ValueError('没有可绘制的非负数值指标，完整数值见结果表')
        return self.remote.bridge('metric-chart',{'metric':metric,'rows':rows})

    def finish_step(self, project, ident, step, summary):
        from .remote import text
        with self.remote.lock:
            group = self.active(project,ident)
            if type(step) is not int or not 0 <= step < len(group['spec']['steps']):
                raise ValueError('实验步骤无效')
            if self.busy(group):
                raise ValueError('仍有未完成或未知运行')
            runs = [r for r in group['runs'] if r['step']==step and r.get('purpose',r['kind'])!='setup']
            if not runs or not any(r.get('evidence') for r in runs):
                raise ValueError('先保存真实结果证据；失败或无结果可暂停请求帮助')
            if step not in group['completed_steps']:
                group['completed_steps'].append(step)
                group.setdefault('conclusions',{})[str(step)] = text(summary,4000)
            if len(group['completed_steps']) == len(group['spec']['steps']):
                group.update(status='completed',message='实验计划已完成，结果分析仍按证据判断')
            return self.save(group)

    def tick(self):
        """The existing SSH observer wakes the existing research queue; no second agent runtime."""
        if not self.service or self.service.closing:
            return
        with self.remote.lock:
            for row in self.store.all('SELECT project_id,id FROM experiment_groups'):
                group = self.get(row['project_id'],row['id'])
                if group['status'] != 'active':
                    continue
                try:
                    group=self.active(group['project_id'],group['id'])
                except ValueError:
                    if group['status']=='active':
                        group.update(status='paused',message='授权或额度需重新检查，请查看设置后恢复')
                        self.save(group)
                    continue
                last = self.store.task(group['last_task']) if group.get('last_task') else None
                if last and last['status'] in ('queued','routing','running','waiting'):
                    continue
                if last and last['status']=='interrupted':
                    if self.busy(group):
                        continue
                    self.service.control(group['project_id'],group['conversation_id'],last['id'],'resume',{})
                    continue
                if last and last['status'] in ('failed','stopped'):
                    group.update(status='paused',message='Agent 任务中断；确认恢复后继续，远程任务未被终止')
                    self.save(group)
                    continue
                if self.busy(group):
                    continue
                if group['runs']:
                    latest = group['runs'][-1]
                    item = self.remote.get(group['project_id'],latest['id'])
                    if latest['attempt'] >= 3 and item['status'] == 'failed':
                        group.update(status='paused',message='连续三次修复失败，请求人工处理')
                        self.save(group)
                        continue
                signature = json_text([group['wake'],[[r['id'],self.remote.get(group['project_id'],r['id'])['status']] for r in group['runs']]])
                if signature == group.get('scheduled_signature'):
                    group.update(status='paused',message='Agent 未提交下一项任务或完成计划，请检查对话后恢复')
                    self.save(group)
                    continue
                if not self.service.research.key:
                    continue
                key = hashlib.sha256(signature.encode()).hexdigest()
                # Store enqueue and its identity in one transaction, before scheduling.
                with self.store.transaction():
                    value = self.service.message(group['project_id'],group['conversation_id'],
                        {'text':f"继续已授权实验组 {group['id']}。先读取实验组与真实任务状态，在已确认计划内执行下一步或分析结果。",
                         'client_message_id':f"experiment:{group['id']}:{key}"},schedule=False)
                    task = self.store.task(value['task_id'])
                    if task['status'] == 'queued':
                        self.store.run('UPDATE tasks SET refs=?,checkpoint=? WHERE id=?',
                            (json_text({**task['refs'],'experiment_group':group['id']}),
                             json_text({'route':{'intent':'research','mode':'explore','reason':'已授权实验组继续','only_selected':False,
                                                 'skills':['research-experiment-plan','research-result-to-claim']}}),value['task_id']))
                    group.update(last_task=value['task_id'],scheduled_signature=signature)
                    self.save(group)
                self.service.schedule()
