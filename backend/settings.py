"""Local model connections; public preferences never contain credentials."""
import copy
import hashlib
import json
import os
import secrets
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from .state import json_text, new_id, now
from .errors import AppError, failure_message, http_code

STYLE = {'brief':'先给简明结论，省略不必要的展开。', 'balanced':'先给结论，再解释关键依据。', 'detailed':'详细说明证据、比较条件、推导和局限。'}
LANGUAGE = {'auto':'跟随本次用户提问的语言。', 'zh':'默认用中文回答，保留必要的原文术语。', 'en':'Default to English, preserving original terms.'}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def public(config):
    return {k:v for k,v in config.items() if k != 'api_key'} | {'has_key':bool(config.get('api_key'))}


def effort_for(config, options, role):
    selected = options.get('effort', 'auto')
    # Extraction/routing retains its short, non-reasoning path; the chosen effort governs research answers.
    if role in ('paper','repair','rag-plan','subscription-strategy','subscription-select','paper-select'):
        return 'off'
    if selected != 'auto':
        if selected not in config.get('efforts', []):
            raise ValueError('当前模型不支持所选思考强度，请在聊天框重新选择')
        return selected
    # Auto is the economical default; explicit thinking choices still apply.
    return 'off'


def provider_patch(config, effort, timeout=180000):
    """Reuse the SDK's bundled adapter; credentials only enter the child environment."""
    retries = {'mode':'normal','maxRetries':1 if timeout == 10000 else 2,'backoff':{'initialDelayMs':250,'maxDelayMs':1000,'jitterRatio':0}}
    if config['protocol'] == 'deepseek':
        return [], {'model':config['model'], 'api_key':config['api_key'], 'base_url':config['base_url'], 'env':{'DSH_TELEMETRY_DISABLED':'1'}}, effort
    compat = {'supportsStore':False,'supportsDeveloperRole':False,'maxTokensField':config.get('token_field','max_tokens'), 'supportsReasoningEffort':config['reasoning'] == 'openai'}
    route = {'api':'openai-completions','baseURL':config['base_url'],'apiKeyEnv':'METHODATLAS_MODEL_KEY',
             'streamIdleTimeoutMs':timeout,'retryPolicy':retries,'compat':compat,
             'models':[{'id':config['model'],'contextWindow':config['context_window'],'maxTokens':config['max_output'],
                        'input':['text','image'] if config.get('vision') else ['text'],
                        'reasoningEfforts':{level:level for level in config.get('efforts',[]) if level != 'off'} or False}]}
    patches = [{'id':'llm-deepseek','disabled':True}, {'insert':[{'id':'methodatlas-model','name':'@deepseek-ai/dsh-llm-pi-ai','config':{'providers':{'methodatlas':route}}}]}]
    args = {'provider':'methodatlas','model':config['model'],'env':{'METHODATLAS_MODEL_KEY':config['api_key'] or 'local-no-key','DSH_TELEMETRY_DISABLED':'1'}}
    if effort != 'off':
        args['reasoning_effort'] = effort
        route['reasoning'] = effort
    return patches, args, effort


class ModelSettings:
    def __init__(self, store, research):
        self.store, self.research = store, research
        self.lock = threading.RLock()
        self.path = store.root / 'private' / 'model-connections.json'
        self.path.parent.mkdir(mode=0o700, exist_ok=True)
        os.chmod(self.path.parent, 0o700)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {'connections':{},'versions':{},'default_id':''}
        store.run("CREATE TABLE IF NOT EXISTS conversation_preferences(conversation_id TEXT PRIMARY KEY,body TEXT NOT NULL)")
        store.model_settings = self

    def write(self):
        fd, filename = tempfile.mkstemp(dir=self.path.parent, prefix='.models-')
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as file:
                json.dump(self.data,file,ensure_ascii=False)
                file.flush(); os.fsync(file.fileno())
            os.replace(filename,self.path)
        except OSError:
            self.data = json.loads(self.path.read_text()) if self.path.exists() else {'connections':{},'versions':{},'default_id':''}
            raise ValueError('模型配置写入失败，原有配置已保留，请检查本机磁盘') from None
        finally:
            if os.path.exists(filename): os.unlink(filename)

    def fallback(self):
        return {'id':'','name':'应用默认模型','protocol':'deepseek','base_url':self.research.base_url,
                'model':self.research.model,'api_key':self.research._key,'reasoning':'deepseek',
                'efforts':['off','low','high'],'vision':self.research.model == 'deepseek-flash','tools':True,'context_window':1000000,'max_output':32768,
                'checks':{},'source':'environment'}

    def selected(self, connection_id=None):
        with self.lock:
            ident = self.data['default_id'] if connection_id is None else connection_id
            if ident:
                if ident not in self.data['connections']:
                    raise ValueError('所选模型连接已删除，请重新选择；没有自动切换模型')
                return copy.deepcopy(self.data['connections'][ident])
            return self.fallback()

    def view(self):
        with self.lock:
            return {'connections':[public(v) for v in self.data['connections'].values()], 'default_id':self.data['default_id'],
                    'language':self.data.get('language','auto'), 'fallback':public(self.fallback()), 'data_directory':str(self.store.root), 'backend':'running','version':'本地研究工作台 · 设置 v1'}

    def validate(self, body):
        if not isinstance(body,dict) or set(body) - {'id','name','protocol','base_url','model','api_key','reasoning','context_window','max_output','token_field','make_default'}:
            raise ValueError('模型连接字段无效')
        if body.get('id') is not None and not isinstance(body['id'],str): raise ValueError('模型连接标识无效')
        with self.lock:
            old = self.data['connections'].get(body.get('id'),{})
            value = {**old, **body}
        for key, limit in (('name',80),('base_url',2000),('model',200)):
            if not isinstance(value.get(key),str) or not value[key].strip() or len(value[key]) > limit:
                raise ValueError('请填写有效的连接名称、API 地址和模型 ID')
            value[key] = value[key].strip()
        url = urlsplit(value['base_url'])
        if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('API 地址须为不含账号、查询参数的 HTTP(S) 地址')
        if url.scheme != 'https' and url.hostname not in ('localhost','127.0.0.1','::1'):
            raise ValueError('远程 API 地址必须使用 HTTPS；本机服务可以使用 HTTP')
        value['base_url'] = value['base_url'].rstrip('/').removesuffix('/chat/completions')
        value.setdefault('protocol','openai')
        if value['protocol'] not in ('deepseek','openai'): raise ValueError('请选择 DeepSeek 或 OpenAI 兼容接口')
        value.setdefault('reasoning','deepseek' if value['protocol']=='deepseek' else 'none')
        if value['reasoning'] not in ('none','openai','deepseek') or (value['protocol']=='openai' and value['reasoning']=='deepseek'):
            raise ValueError('推理参数协议与接口类型不匹配')
        key = body.get('api_key')
        if key is not None and (not isinstance(key,str) or len(key)>4096 or '\n' in key or '\r' in key):
            raise ValueError('API Key 格式无效')
        value['api_key'] = key.strip() if key else old.get('api_key','')
        if not value['api_key'] and url.hostname not in ('localhost','127.0.0.1','::1'): raise ValueError('请填写 API Key')
        for field, default, low, high in (('context_window',128000,4096,2000000),('max_output',32768,256,131072)):
            value.setdefault(field,default)
            if type(value[field]) is not int or not low<=value[field]<=high: raise ValueError('模型容量设置无效')
        value.setdefault('token_field','max_tokens')
        if value['token_field'] not in ('max_tokens','max_completion_tokens'): raise ValueError('输出参数格式无效')
        if type(value.get('make_default',False)) is not bool: raise ValueError('默认模型选项无效')
        value['id'] = old.get('id') or new_id('connection')
        if body.get('id') and not old: raise ValueError('模型连接不存在')
        # A changed endpoint/model/key invalidates the old capability evidence.
        if any(value.get(k)!=old.get(k) for k in ('base_url','model','api_key','protocol','reasoning','token_field','context_window','max_output')):
            value.update(checks={},efforts=['off'] if value['protocol']=='deepseek' else [],tools=False,vision=False)
        return value

    def save(self, body):
        value = self.validate(body)
        with self.lock:
            default = value.pop('make_default',False)
            self.data['connections'][value['id']] = value
            if default or not self.data['default_id']: self.data['default_id'] = value['id']
            self.write()
        return self.view()

    def global_preferences(self, body):
        if set(body) != {'language'} or not isinstance(body['language'],str) or body['language'] not in LANGUAGE: raise ValueError('回答语言无效')
        with self.lock:
            self.data['language'] = body['language']; self.write()
        return self.view()

    def change(self, action, body):
        ident = body.get('id')
        if ident is not None and not isinstance(ident,str): raise ValueError('模型连接标识无效')
        if action == 'save': return self.save(body)
        if action == 'test': return self.test(ident)
        with self.lock:
            if ident not in self.data['connections']: raise ValueError('模型连接不存在')
            if action == 'default': self.data['default_id'] = ident
            elif action == 'delete':
                del self.data['connections'][ident]
                if self.data['default_id']==ident: self.data['default_id'] = next(iter(self.data['connections']), '')
            else: raise ValueError('未知模型设置操作')
            self.write()
        return self.view()

    def preferences(self, conversation, body=None):
        if not self.store.one('SELECT 1 FROM conversations WHERE id=?',(conversation,)): raise ValueError('对话不存在')
        row = self.store.one('SELECT body FROM conversation_preferences WHERE conversation_id=?',(conversation,))
        options = json.loads(row['body']) if row else {'connection_id':None,'effort':'auto','style':'balanced','language':'auto'}
        if body is not None:
            if not isinstance(body,dict) or set(body)-set(options): raise ValueError('对话偏好字段无效')
            options.update(body)
            if any(not isinstance(options.get(key),str) for key in ('style','language','effort')) or options['style'] not in STYLE or options['language'] not in LANGUAGE or options['effort'] not in ('auto','off','low','medium','high'):
                raise ValueError('对话偏好选项无效')
            if options['connection_id'] is not None and not isinstance(options['connection_id'],str): raise ValueError('模型连接标识无效')
            config = self.selected(options['connection_id'])
            if options['effort']!='auto' and options['effort'] not in config.get('efforts',[]): raise ValueError('模型未通过该思考强度测试，请重新选择')
            self.store.run('INSERT OR REPLACE INTO conversation_preferences VALUES(?,?)',(conversation,json_text(options)))
        return options

    def snapshot(self, options):
        config = self.selected(options.get('connection_id'))
        if options.get('effort','auto') not in ['auto',*config.get('efforts',[])]: raise ValueError('模型不支持所选思考强度')
        version = hashlib.sha256(json_text(config).encode()).hexdigest()
        with self.lock:
            if version not in self.data['versions']:
                self.data['versions'][version] = config
                self.write()
        return {'version':version, 'name':config['name'], 'model':config['model'], 'options':copy.deepcopy(options)}

    def for_task(self, task):
        with self.store.transaction():
            row = self.store.task(task['id'])
            bound = (row or task).get('refs',{}).get('model_config')
            if bound is None:
                bound = self.snapshot({'connection_id':None,'effort':'auto','style':'balanced','language':self.data.get('language','auto')})
                if row:
                    self.store.run('UPDATE tasks SET refs=? WHERE id=?',(json_text({**row['refs'],'model_config':bound}),task['id']))
            task.setdefault('refs',{})['model_config'] = bound
        with self.lock:
            config = self.data['versions'].get(bound['version'])
            if not config: raise ValueError('此任务绑定的模型配置不可用，请重新发送')
            return copy.deepcopy(config), copy.deepcopy(bound['options'])

    def redact(self, message):
        with self.lock:
            keys = {v.get('api_key','') for v in [self.fallback(),*self.data['connections'].values(),*self.data['versions'].values()]}
        for key in keys:
            if key: message = message.replace(key,'[redacted]')
        return message

    def test(self, ident):
        config = self.selected(ident)
        if not ident: raise ValueError('请先保存要测试的自定义连接')
        opener = build_opener(NoRedirect())
        def request(extra=None, messages=None):
            body = {'model':config['model'],'messages':messages or [{'role':'user','content':'Reply exactly OK.'}], 'stream':False,
                    config.get('token_field','max_tokens'):256, **(extra or {})}
            req = Request(config['base_url']+'/chat/completions',data=json_text(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+config['api_key']},method='POST')
            try:
                with opener.open(req,timeout=20) as response:
                    result = json.loads(response.read(1000000))
                return result['choices'][0]['message']
            except HTTPError as error:
                raise AppError('authentication' if error.code in (401,403) else http_code(error.code), f'接口返回 HTTP {error.code}：' + error.read(2000).decode('utf-8','replace'), status=error.code) from error
            except Exception as error:
                raise ValueError('接口未返回有效回答：'+type(error).__name__) from error
        checks, efforts = {}, ['off'] if config['protocol']=='deepseek' else []
        for kind in ('chat','tools','vision',*({'openai':['low','medium','high'],'deepseek':['low','high'],'none':[]}[config['reasoning']])):
            try:
                if kind=='chat':
                    result=request(); assert result.get('content'), '没有回答内容'
                elif kind=='tools':
                    result=request({'tools':[{'type':'function','function':{'name':'connection_check','description':'Call this function to verify tools.','parameters':{'type':'object','properties':{'ok':{'type':'boolean'}},'required':['ok']}}}], 'tool_choice':{'type':'function','function':{'name':'connection_check'}}})
                    assert any(t.get('function',{}).get('name')=='connection_check' for t in result.get('tool_calls',[])), '未返回工具调用'
                elif kind=='vision':
                    import base64
                    import pymupdf
                    expected, rgb = secrets.choice([('RED',(255,0,0)),('GREEN',(0,255,0)),('BLUE',(0,0,255))])
                    pix=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,16,16),False)
                    for y in range(16):
                        for x in range(16): pix.set_pixel(x,y,rgb)
                    uri='data:image/png;base64,'+base64.b64encode(pix.tobytes('png')).decode()
                    result=request(messages=[{'role':'user','content':[{'type':'text','text':'What is the single background color? Reply exactly RED, GREEN or BLUE.'},{'type':'image_url','image_url':{'url':uri}}]}]); assert str(result.get('content','')).strip().upper().rstrip('.') == expected, '未正确识别测试图像颜色，图像能力未验证'
                else:
                    params={'reasoning_effort':kind}
                    if config['reasoning']=='deepseek': params['thinking']={'type':'enabled'}
                    result=request(params); assert result.get('content') or result.get('reasoning_content'), '没有模型响应'
                    efforts.append(kind)
                checks[kind]={'ok':True,'message':'请求通过；参数接受不等于模型内部行为证明' if kind in efforts and kind!='off' else '接口验证通过'}
            except Exception as error:
                checks[kind]={'ok':False,'message':failure_message(self.store, error, operation='connection_test', capability=kind)}
        with self.lock:
            if self.data['connections'].get(ident)!=config: raise ValueError('测试期间连接已修改，请重新测试')
            config.update(checks=checks,efforts=efforts,tools=checks.get('tools',{}).get('ok',False),vision=checks.get('vision',{}).get('ok',False),tested_at=now())
            self.data['connections'][ident]=config; self.write()
        return self.view()
