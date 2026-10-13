"""Human experiment records and annotations, separate from execution authorization."""
import hashlib
import json
import math

from .errors import AppError
from .state import json_text, new_id, now

PLAN_FIELDS = {'objective','hypothesis','notes'}
RUN_FIELDS = {'title','status','dataset','dataset_version','split','evaluation','model','parameters',
              'configuration','code','commit','metrics','metric_units','metric_directions','conclusion','result','sources'}


class ExperimentRecords:
    def __init__(self, groups):
        self.groups, self.remote, self.store = groups, groups.remote, groups.store
        self.store.run('CREATE TABLE IF NOT EXISTS experiment_records(group_id TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL,PRIMARY KEY(group_id,entity_id))')
        self.store.run('CREATE TABLE IF NOT EXISTS experiment_record_history(group_id TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_id TEXT,record TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(group_id,entity_id,revision))')

    def access(self, user, project, ident=None, write=False):
        group = self.groups._get(project,ident) if ident else None
        self.remote.access(user,project,group.get('conversation_id') if group else None)
        if self.remote.online:
            self.store.collaboration.project(user,project,write=write)
        return group

    @staticmethod
    def text(value, limit=20000):
        if not isinstance(value,str) or len(value)>limit or '\x00' in value:
            raise ValueError('实验文字字段过长或格式无效')
        return value.strip()

    def receipt(self, db, project, user, body):
        request = body.get('request_id')
        if not isinstance(request,str) or not 1<=len(request)<=100:
            raise ValueError('实验修改需要稳定的request_id')
        key = 'experiment-record:'+project+':'+(user['id'] if user else 'local')
        fingerprint = hashlib.sha256(json_text(body).encode()).hexdigest()
        old = db.execute('SELECT result FROM file_commits WHERE task_id=? AND call_id=?',(key,request)).fetchone()
        if old:
            saved=json.loads(old['result'])
            if saved['fingerprint']!=fingerprint:
                raise AppError('conflict','同一修改标识已用于不同内容')
            return key,fingerprint,saved['value']
        return key,fingerprint,None

    def create(self, user, project, body):
        if not isinstance(body,dict) or set(body)-{'request_id','title',*PLAN_FIELDS}:
            raise ValueError('外部实验字段无效')
        title=self.text(body.get('title'),200)
        if not title:
            raise ValueError('请填写实验名称')
        with self.remote.lock, self.store.transaction() as db:
            self.access(user,project,write=True)
            key,fingerprint,prior=self.receipt(db,project,user,body)
            if prior:
                return self.groups.get(project,prior['group_id'],user=user)
            ident=new_id('group')
            group={'id':ident,'project_id':project,'conversation_id':None,'mode':'external','status':'recorded',
                   'spec':{'title':title,'plan':self.text(body.get('objective','')),'steps':[]},
                   'created_by':user['id'] if user else None,'created':now(),'runs':[],
                   'completed_steps':[],'changes':[],'wake':0,'last_task':None,'message':''}
            self.groups.save(group)
            fields={k:self.text(body.get(k,'')) for k in PLAN_FIELDS}
            self.persist(db,group,'plan',1,fields,user)
            db.execute('INSERT INTO file_commits VALUES(?,?,?)',(key,body['request_id'],json_text({'fingerprint':fingerprint,'value':{'group_id':ident}})))
            return self.groups.get(project,ident,user=user)

    def source(self, user, project, value):
        if not isinstance(value,dict) or value.get('kind') not in ('paper','artifact','run'):
            raise ValueError('实验依据应为项目文献、成果或Agent Run')
        link=self.store.project_work.shared_link(user,project,value)
        if link['kind']=='paper':
            paper=self.store.one('SELECT status FROM papers WHERE id=?',(link['id'],))
            if not paper or paper['status']=='removed':
                raise PermissionError('实验依据已移除')
        if link['kind'] in ('paper','artifact') and not link.get('version_id'):
            raise ValueError('实验依据必须固定到文献或成果版本')
        if self.remote.online and link['kind']=='artifact':
            if not self.store.collaboration.visible(user,'artifact',link['id']):
                raise PermissionError('实验依据当前不可访问')
        return {k:v for k,v in link.items() if k!='title'}

    def clean(self, user, group, ident, old, changes):
        allowed=PLAN_FIELDS if ident=='plan' else RUN_FIELDS
        if set(changes)-allowed:
            raise ValueError('实验记录包含未知或只读字段')
        external=group.get('mode')=='external'
        if ident!='plan' and not external and set(changes)&{'metrics','status'}:
            raise ValueError('平台采集的指标和执行状态为只读，请在结论中补充解释')
        if ident!='plan' and not external:
            captured=next(r for r in group['runs'] if r['id']==ident).get('record',{})
            directions=changes.get('metric_directions',{})
            for name,direction in (directions.items() if isinstance(directions,dict) else []):
                fixed=captured.get('metricDirections',{}).get(name)
                if fixed is not None and direction!=fixed:
                    raise ValueError('平台已采集的指标方向不能改写')
        value={**old,**changes}
        value={key:item for key,item in value.items() if key in allowed}
        for key,item in value.items():
            if key in ('parameters','metrics','metric_units','metric_directions'):
                if not isinstance(item,dict) or len(item)>100:
                    raise ValueError('参数和指标必须为对象，最多100项')
                for name,entry in item.items():
                    if not self.text(name,100):
                        raise ValueError('参数或指标名称不能为空')
                    if key=='metrics':
                        if type(entry) not in (int,float) or not math.isfinite(entry):
                            raise ValueError('手工指标必须为有限数值')
                    elif key=='metric_directions':
                        if entry not in ('higher','lower','unspecified'):
                            raise ValueError('指标方向为higher、lower或unspecified')
                    elif key=='metric_units':
                        self.text(entry,100)
                    elif type(entry) not in (str,int,float,bool,type(None)) or isinstance(entry,float) and not math.isfinite(entry) or isinstance(entry,str) and len(entry)>2000:
                        raise ValueError('参数值应为文字、有限数值、布尔或空值')
            elif key=='sources':
                if not isinstance(item,list) or len(item)>50:
                    raise ValueError('实验依据最多50项')
                value[key]=[self.source(user,group['project_id'],source) for source in item]
            else:
                value[key]=self.text(item,200 if key in ('title','dataset_version','split','model','commit') else 20000)
        if ident!='plan' and external:
            if not value.get('title'):
                raise ValueError('请填写本次运行名称')
            if value.get('status','planned') not in ('planned','running','completed','failed','cancelled','unknown'):
                raise ValueError('外部实验状态无效')
            value.setdefault('status','planned')
            metrics=set(value.get('metrics',{}))
            if set(value.get('metric_units',{}))-metrics or set(value.get('metric_directions',{}))-metrics:
                raise ValueError('单位与方向须对应已填写的指标')
        return value

    def persist(self, db, group, ident, revision, fields, user):
        stamp=now(); actor=user['id'] if user else None
        value={**fields,'id':ident,'revision':revision,'edited_by':actor,'updated':stamp}
        previous=db.execute('SELECT record FROM experiment_records WHERE group_id=? AND entity_id=?',(group['id'],ident)).fetchone()
        value['created_by']=json.loads(previous['record']).get('created_by') if previous else actor
        value['created']=json.loads(previous['record']).get('created') if previous else stamp
        db.execute('INSERT INTO experiment_records VALUES(?,?,?,?) ON CONFLICT(group_id,entity_id) DO UPDATE SET revision=excluded.revision,record=excluded.record',(group['id'],ident,revision,json_text(value)))
        db.execute('INSERT INTO experiment_record_history VALUES(?,?,?,?,?,?)',(group['id'],ident,revision,actor,json_text(value),stamp))
        if self.remote.online:
            self.store.collaboration.event(group['project_id'],actor,'experiment_record_changed',group['id'],{'conversation_id':group.get('conversation_id'),'title':group['spec']['title'],'entity_id':ident,'revision':revision})
        return value

    def save(self, user, project, group_id, entity, body):
        if not isinstance(body,dict) or set(body)-{'request_id','revision','fields'} or not isinstance(body.get('fields'),dict) or type(body.get('revision')) is not int:
            raise ValueError('实验修改请求无效')
        with self.remote.lock, self.store.transaction() as db:
            group=self.access(user,project,group_id,write=True)
            key,fingerprint,prior=self.receipt(db,project,user,{'group_id':group_id,'entity':entity,**body})
            if prior:
                return {'saved':prior,'experiment':self.groups.get(project,group_id,user=user)}
            ident=new_id('external_run') if entity=='new' else entity
            if entity=='new' and group.get('mode')!='external':
                raise ValueError('平台实验只能补充现有运行；外部运行请建立外部实验')
            if ident!='plan' and entity!='new' and not (group.get('mode')=='external' and db.execute('SELECT 1 FROM experiment_records WHERE group_id=? AND entity_id=?',(group_id,ident)).fetchone()) and ident not in {r['id'] for r in group['runs']}:
                raise ValueError('运行不属于此实验')
            row=db.execute('SELECT * FROM experiment_records WHERE group_id=? AND entity_id=?',(group_id,ident)).fetchone()
            revision=row['revision'] if row else 0
            if body['revision']!=revision:
                raise AppError('conflict','实验记录已有新修改，你的输入尚未保存，请回读后合并')
            old=json.loads(row['record']) if row else {}
            if old and self.present(user,project,old).get('unavailable'):
                raise PermissionError('记录依据当前不可访问，不能继续编辑')
            clean=self.clean(user,group,ident,old,body['fields'])
            value=self.persist(db,group,ident,revision+1,clean,user)
            saved={'group_id':group_id,'entity_id':ident,'revision':value['revision']}
            db.execute('INSERT INTO file_commits VALUES(?,?,?)',(key,body['request_id'],json_text({'fingerprint':fingerprint,'value':saved})))
            return {'saved':saved,'experiment':self.groups.get(project,group_id,user=user)}

    def present(self, user, project, record):
        try:
            for source in record.get('sources',[]):
                self.source(user,project,source)
        except (PermissionError,ValueError):
            return {'id':record['id'],'revision':record['revision'],'unavailable':True}
        value=dict(record)
        if self.remote.online:
            for key in ('created_by','edited_by'):
                person=self.store.one('SELECT email FROM collab_users WHERE id=?',(record.get(key),))
                value[key+'_email']=person['email'] if person else None
        return value

    def view(self, user, group):
        rows={r['entity_id']:json.loads(r['record']) for r in self.store.all('SELECT * FROM experiment_records WHERE group_id=? ORDER BY rowid',(group['id'],))}
        plan=rows.pop('plan',{'id':'plan','revision':0,'objective':group['spec'].get('plan',''),'hypothesis':'','notes':''})
        observations=[]
        if group.get('mode')=='external':
            observations=[{**self.present(user,group['project_id'],record),'origin':'member_reported'} for record in rows.values()]
        else:
            for run in group['runs']:
                recorded=rows.get(run['id'],{'id':run['id'],'revision':0})
                result=self.present(user,group['project_id'],recorded)
                if not result.get('unavailable'):
                    job=self.remote._get(group['project_id'],run['id'])
                    result={**result,'title':result.get('title') or job.get('name') or group['spec']['steps'][run['step']],
                            'status':job['status'],'metrics':run.get('record',{}).get('metrics',{}),
                            'metric_directions':{**result.get('metric_directions',{}),**run.get('record',{}).get('metricDirections',{})},
                            'configuration':result.get('configuration') or job['spec'].get('configuration',''),
                            'captured_evidence':run.get('evidence'),'metrics_immutable':True}
                observations.append({**result,'origin':'platform_captured'})
        return {'research':self.present(user,group['project_id'],plan),'observations':observations}

    def history(self, user, project, group_id, entity):
        self.access(user,project,group_id)
        return [self.present(user,project,json.loads(r['record'])) for r in self.store.all('SELECT record FROM experiment_record_history WHERE group_id=? AND entity_id=? ORDER BY revision DESC',(group_id,entity))]

    def compare(self, user, project, selections):
        with self.remote.lock, self.store.transaction():
            return self._compare(user,project,selections)

    def _compare(self, user, project, selections):
        if not isinstance(selections,list) or not 2<=len(selections)<=10:
            raise ValueError('请选择2–10次实验运行')
        rows=[]; unique=set()
        for selection in selections:
            if not isinstance(selection,dict) or set(selection)!={'group_id','run_id'} or any(not isinstance(v,str) or len(v)>100 for v in selection.values()):
                raise ValueError('比较运行标识无效')
            key=(selection['group_id'],selection['run_id'])
            if key in unique:
                raise ValueError('请勿重复选择同一运行')
            unique.add(key)
            group=self.groups.get(project,selection['group_id'],user=user)
            record=next((r for r in group['observations'] if r['id']==selection['run_id']),None)
            if not record or record.get('unavailable'):
                raise PermissionError('比较的实验运行不可访问')
            rows.append({**record,'group_id':group['id'],'experiment_title':group['spec']['title']})
        metrics=[]
        for metric in sorted(set().union(*(row.get('metrics',{}) for row in rows))):
            missing=[key for key in ('dataset','dataset_version','split','evaluation') if any(not row.get(key) for row in rows)]
            different=[key for key in ('dataset','dataset_version','split','evaluation') if len({row.get(key,'') for row in rows})>1]
            values=[row.get('metrics',{}).get(metric) for row in rows]
            units=[row.get('metric_units',{}).get(metric) for row in rows]
            directions=[row.get('metric_directions',{}).get(metric) for row in rows]
            reasons=[]
            if missing: reasons.append('缺少评估条件：'+', '.join(missing))
            if different: reasons.append('评估条件不同：'+', '.join(different))
            if any(type(value) not in (int,float) or not math.isfinite(value) for value in values): reasons.append('部分运行缺少数值指标')
            if any(not unit for unit in units) or len(set(units))!=1: reasons.append('指标单位未说明或不同')
            if any(direction not in ('higher','lower') for direction in directions) or len(set(directions))!=1: reasons.append('指标方向未说明或不同')
            if any(row.get('status') not in ('completed','succeeded') for row in rows): reasons.append('部分运行尚未记录为完成')
            item={'metric':metric,'values':values,'units':units,'directions':directions,'comparable':not reasons,'reasons':reasons}
            if not reasons:
                best=(max if directions[0]=='higher' else min)(values)
                item['best_runs']=[{'group_id':row['group_id'],'run_id':row['id']} for row,value in zip(rows,values) if value==best]
                item['interpretation']='仅比较已记录数值，不代表统计显著或科学主张已成立。成员录入条件未经平台独立核验。'
            metrics.append(item)
        return {'runs':rows,'metrics':metrics,'as_of':now()}
