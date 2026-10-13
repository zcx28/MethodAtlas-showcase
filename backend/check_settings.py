"""Settings acceptance: isolated HTTP/model servers, real Harness, no paid requests."""
import json
import os
import subprocess
import threading
import time
from collections import deque
from io import BytesIO
from types import SimpleNamespace
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .app import Service, Handler
from .state import json_text
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
from .check_support import temporary_directory


def main():
    from .settings import streaming_message
    chunks = [{'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'connection_','arguments':'{"ok":'}}]}}]},
              {'choices':[{'delta':{'tool_calls':[{'index':0,'function':{'name':'check','arguments':'true}'}}]},'finish_reason':'tool_calls'}]}]
    wire = b''.join(('data: '+json.dumps(chunk)+'\n\n').encode() for chunk in chunks)
    message = streaming_message(BytesIO(wire+b'data: [DONE]\n\n'))
    assert message['tool_calls'][0]['function'] == {'name':'connection_check','arguments':'{"ok":true}'}
    for invalid in (b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', b'data: {"error":{"message":"failed"}}\n\n', b'x'*1000001):
        try: streaming_message(BytesIO(invalid))
        except ValueError: pass
        else: raise AssertionError('invalid/truncated test stream accepted')
    requests = []
    gateway_steps = deque()
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*_): pass
        def do_POST(self):
            if self.path.endswith('/files'):
                self.rfile.read(int(self.headers['Content-Length']));self.send_error(404);return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append((self.path,body,self.headers.get('Authorization')))
            if self.path=='/v2/chat/completions' and gateway_steps:
                print(json_text({'remaining':len(gateway_steps),'model':body['model'],'path':self.path,'stream':body.get('stream'),'tool_count':len(body.get('tools',[])),'tool_choice':body.get('tool_choice'),'thinking':body.get('thinking'),'reasoning_effort':body.get('reasoning_effort')}),flush=True)
            if self.path=='/v2/chat/completions' and (body.get('stream') is not True or body.get('tools') and body.get('tool_choice')!='auto'):
                self.send_error(400,'Gateway requires streaming and automatic tool selection');return
            # DeepSeek defaults to thinking, which rejects forced tool_choice.
            if body['model'] == 'deepseek-probe' and body.get('tool_choice') and body.get('thinking', {}).get('type') != 'disabled':
                self.send_error(400, 'Thinking mode does not support forced tool_choice'); return
            message={'role':'assistant','content':json_text({'answer':'verified'})}
            if isinstance(body['messages'][0]['content'],list):
                import base64,pymupdf
                pixels=pymupdf.Pixmap(base64.b64decode(body['messages'][0]['content'][1]['image_url']['url'].split(',')[1]))
                message['content']=['RED','GREEN','BLUE'][pixels.pixel(0,0).index(255)]
            if body.get('tools'):
                if body['model']=='controlled-deepseek' and body.get('thinking')!={'type':'disabled'}:
                    self.send_error(400,'Thinking mode cannot force a named tool');return
                message={'role':'assistant','content':None,'tool_calls':[{'id':'probe','type':'function','function':{'name':'connection_check','arguments':'{"ok":true}'}}]}
                if body['model']=='invalid-tool-stream': message['tool_calls'][0]['function']['arguments']='{"ok":true'
                elif body['model']=='nonboolean-tool-stream': message['tool_calls'][0]['function']['arguments']='{"ok":1}'
            if self.path=='/v2/chat/completions' and gateway_steps:
                if len(gateway_steps)<4 and not body.get('tools'):
                    self.send_error(400,'Unexpected non-tool stage after reading plan');return
                step=gateway_steps.popleft();message=step(body) if callable(step) else step
            if body.get('stream'):
                deltas=[]
                if message.get('tool_calls'):
                    tool=message['tool_calls'][0];name=tool['function']['name'];arguments=tool['function']['arguments']
                    first_name,last_name=('connection_','check') if name=='connection_check' else (name,'')
                    deltas=[{'tool_calls':[{'index':0,'id':tool['id'],'type':'function','function':{'name':first_name,'arguments':arguments[:5]}}]},
                            {'tool_calls':[{'index':0,'function':{**({'name':last_name} if last_name else {}),'arguments':arguments[5:]}}]}]
                else:
                    text=message['content'];deltas=[{'content':text[:2]},{'content':text[2:]}]
                raw=(': keepalive\r\n\r\n'+''.join('data: '+json.dumps({'id':'settings-check','choices':[{'index':0,'delta':delta,'finish_reason':None}]},ensure_ascii=False)+'\r\n\r\n' for delta in deltas)+
                     'data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if message.get('tool_calls') else 'stop'}]})+'\r\n\r\ndata: [DONE]\r\n\r\n').encode()
            else: raw=json.dumps({'choices':[{'message':message}]}).encode()
            content_type='text/event-stream' if body.get('stream') else 'application/json'
            if body['model']=='truncated-stream': raw=b'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n'
            elif body['model']=='malformed-stream': raw=b'data: invalid JSON\n\n'
            elif body['model']=='oversized-stream': raw=b'data: '+b'x'*1000000+b'\n\n'
            elif body['model']=='invalid-utf8-stream': raw=b'data: \xff\n\n'
            elif body['model']=='error-stream': raw=b'data: {"error":{"message":"upstream secret-never-public"}}\n\n'
            elif body['model']=='legacy-json':
                raw=json.dumps({'choices':[{'message':message}]}).encode();content_type='application/json'
            elif body['model']=='multiline-stream':
                if message.get('tool_calls'): message['tool_calls'][0]['index']=0
                chunk=json.dumps({'choices':[{'index':0,'delta':message,'finish_reason':'tool_calls' if message.get('tool_calls') else 'stop'}]},indent=2)
                raw=(''.join('data: '+line+'\n' for line in chunk.splitlines())+'\ndata: [DONE]\n\n').encode()
            self.send_response(200);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    provider=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    with temporary_directory() as folder:
        service=Service(Path(folder)/'empty',Path(folder),background=False)
        class BoundHandler(Handler): pass
        BoundHandler.service=service
        server=ThreadingHTTPServer(('127.0.0.1',0),BoundHandler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        def call(path,body=None):
            req=Request(f'http://127.0.0.1:{server.server_port}'+path,data=json_text(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
            with urlopen(req) as response: return json.load(response)
        try:
            initial=call('/api/settings'); assert initial['default_id']=='' and 'api_key' not in initial['fallback']
            draft={'name':'Test model','protocol':'openai','base_url':f'http://127.0.0.1:{provider.server_port}/v1','model':'custom-v1','api_key':'secret-never-public','reasoning':'openai'}
            result=call('/api/settings/models/save',draft); ident=result['default_id']
            assert ident and 'secret-never-public' not in json_text(result)
            result=call('/api/settings/models/test',{'id':ident})
            config=result['connections'][0]
            assert config['max_output'] == 32768
            assert config['tools'] and config['vision'] and config['efforts']==['low','medium','high']
            gateway=call('/api/settings/models/save',{**draft,'base_url':f'http://127.0.0.1:{provider.server_port}/v2','name':'Streaming subscription','protocol':'deepseek','reasoning':'deepseek','model':'deepseek-v4-pro'})
            gateway_id=next(c['id'] for c in gateway['connections'] if c['model']=='deepseek-v4-pro')
            gateway=call('/api/settings/models/test',{'id':gateway_id})
            gateway_config=next(c for c in gateway['connections'] if c['id']==gateway_id)
            assert gateway_config['tools'] and gateway_config['vision'] and gateway_config['efforts']==['off','low','high'], gateway_config['checks']
            assert gateway['default_id']==ident, 'adding/testing a subscription must preserve the old default'
            assert all(wire.get('stream') is True and (not wire.get('tools') or wire.get('tool_choice')=='auto') for path,wire,_ in requests if path=='/v2/chat/completions')
            print('PASS: streaming-only subscription probes concatenate text and function name/argument deltas without replacing the old default',flush=True)
            for model in ('truncated-stream','malformed-stream','oversized-stream','invalid-utf8-stream','error-stream','invalid-tool-stream','nonboolean-tool-stream','legacy-json','multiline-stream'):
                saved=call('/api/settings/models/save',{**draft,'model':model,'name':model,'reasoning':'none'})
                fault_id=next(c['id'] for c in saved['connections'] if c['model']==model)
                checked=call('/api/settings/models/test',{'id':fault_id})
                evidence=next(c for c in checked['connections'] if c['id']==fault_id)
                if model in ('legacy-json','multiline-stream'):
                    assert all(v['ok'] for v in evidence['checks'].values()), (model,evidence['checks'])
                elif model in ('invalid-tool-stream','nonboolean-tool-stream'):
                    assert evidence['checks']['chat']['ok'] and evidence['checks']['vision']['ok'] and not evidence['tools'], (model,evidence['checks'])
                else:
                    assert not any(v['ok'] for v in evidence['checks'].values()), (model,evidence['checks'])
                assert 'secret-never-public' not in json_text(checked)
                call('/api/settings/models/delete',{'id':fault_id})
            assert 'secret-never-public' not in (service.store.root/'logs'/'errors.jsonl').read_text(encoding='utf-8')
            assert call('/api/settings')['default_id']==ident
            print('PASS: incomplete/malformed/oversized/invalid UTF-8/error streams and incomplete/nonboolean tool JSON fail safely; legacy JSON and multiline SSE remain compatible',flush=True)
            deep = call('/api/settings/models/save', {**draft, 'name':'DeepSeek probe', 'model':'deepseek-probe', 'protocol':'deepseek', 'reasoning':'deepseek'})
            deep_id = next(c['id'] for c in deep['connections'] if c['model']=='deepseek-probe')
            probes = call('/api/settings/models/test', {'id':deep_id})
            probe = next(c for c in probes['connections'] if c['id']==deep_id)
            assert probe['tools'] and probe['vision'] and all(c['ok'] for c in probe['checks'].values())
            assert all('thinking' not in b for _,b,_ in requests if b['model']=='custom-v1')
            assert {b['thinking']['type'] for _,b,_ in requests if b['model']=='deepseek-probe'} == {'enabled','disabled'}
            call('/api/settings/models/delete', {'id':deep_id})
            project=service.store.projects()[0]['id']; conversation=service.store.create_conversation(project)
            gateway_conversation=call(f'/api/projects/{project}/conversations',{})['conversation_id']
            gateway_prefs={'connection_id':gateway_id,'effort':'high','style':'balanced','language':'zh'}
            call(f'/api/projects/{project}/conversations/{gateway_conversation}/preferences',gateway_prefs)
            source=call(f'/api/projects/{project}/materials',{'title':'模型工具验收材料','text':'蓝色方法只在室内验证。'})
            def tool(name,arguments):
                return {'role':'assistant','tool_calls':[{'id':'subscription-'+name,'type':'function','function':{'name':'mcp__methodatlas__'+name,'arguments':json_text(arguments)}}]}
            def cite_material(body):
                evidence=json.loads(body['messages'][-1]['content'])
                if 'evidence' not in evidence: evidence=json.loads(evidence['content'][0]['text'])
                quote=evidence['evidence'][0]
                assert quote['quote']=='蓝色方法只在室内验证。'
                return {'role':'assistant','content':'蓝色方法只在室内验证。[cite:'+quote['id']+']'}
            gateway_steps.extend([{'role':'assistant','content':json_text({'intent':'research','mode':'explore','reason':'明确读取提供材料','only_selected':True})},
                                  tool('set_scope',{'only_selected':True}),tool('read_material',{'paper_id':source['paper_id']}),cite_material])
            start=len(requests)
            submitted=call(f'/api/projects/{project}/conversations/{gateway_conversation}/messages',{'text':'完整读取勾选材料并引用原文','selected_paper_ids':[source['paper_id']],'client_message_id':'subscription-read','chat_options':gateway_prefs})
            deadline=time.monotonic()+45
            while time.monotonic()<deadline:
                read_task=call(f'/api/projects/{project}/tasks/{submitted["task_id"]}')
                if read_task['status'] in ('succeeded','failed','interrupted'): break
                time.sleep(.1)
            assert read_task['status']=='succeeded', read_task.get('error')
            assert not gateway_steps and read_task['citations'][0]['quote']=='蓝色方法只在室内验证。'
            assert read_task['citations'][0]['paper_id']==source['paper_id'] and read_task['citations'][0]['page']==1
            actual=[wire for path,wire,_ in requests[start:] if path=='/v2/chat/completions']
            assert actual and all(wire['model']=='deepseek-v4-pro' and wire['stream'] is True for wire in actual)
            tool_requests=[wire for wire in actual if wire.get('tools')]
            assert tool_requests and all(wire.get('tool_choice')=='auto' and wire.get('thinking')=={'type':'enabled'} and wire.get('reasoning_effort')=='high' for wire in tool_requests)
            assert actual[0].get('thinking')=={'type':'disabled'}, 'routing must retain its short off policy'
            print('PASS: actual native Harness subscription sends streaming, automatic tools, high thinking and reads/cites the frozen material through public HTTP',flush=True)
            prefs={'connection_id':ident,'effort':'high','style':'brief','language':'en'}
            assert call(f'/api/projects/{project}/conversations/{conversation}/preferences',prefs)==prefs
            sent=service.message(project,conversation,{'text':'比较已选论文','client_message_id':'settings-message','chat_options':prefs,'deep_research':True},schedule=False)
            task=service.store.task(sent['task_id']); assert task['refs']['deep_research'] is True
            # Route button skips ordinary search and retains the existing deep-research pipeline.
            service.route(task['id']); task=service.store.task(task['id']); assert task['checkpoint']['route']['deep_search'] is True and 'direct_search' not in task['checkpoint']['route']
            service.store.run("UPDATE tasks SET status='running' WHERE id=?",(task['id'],))
            from .agent import ProjectTools
            project_tools=ProjectTools(service.store,task)
            project_tools.call('set_scope',{'only_selected':False})
            with patch('backend.discovery.discover',return_value={'candidates':[],'sources':[]}) as discovery:
                project_tools.call('search_papers',{'query':'settings acceptance','deep':False})
                assert 'quick' not in discovery.call_args.kwargs, 'chat deep toggle must govern the actual search'
            result=service.research.complete(task,'Return a JSON object.',{},'rag-write',16384)
            assert result=={'answer':'verified'}
            path,wire,auth=requests[-1]
            assert path=='/v1/chat/completions' and wire['model']=='custom-v1' and wire['reasoning_effort']=='high' and auth=='Bearer secret-never-public'
            assert wire.get('max_tokens',wire.get('max_completion_tokens')) == 16384
            assert 'Default to English' in json_text(wire) and '简明结论' in json_text(wire)
            import base64,pymupdf
            pix=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,8,8),False);pix.clear_with(255)
            service.research.complete(task,'Return JSON.',{},'vision-read',128,images=[pix.tobytes('png')])
            blocks=[b for m in requests[-1][1]['messages'] if isinstance(m['content'],list) for b in m['content']]
            assert any(b.get('type')=='image_url' and b['image_url']['url'].startswith('data:image/') for b in blocks)
            deep=call('/api/settings/models/save',{**draft,'name':'DeepSeek probe','protocol':'deepseek','reasoning':'deepseek','model':'controlled-deepseek'})
            deep_id=next(c['id'] for c in deep['connections'] if c['model']=='controlled-deepseek')
            checked=call('/api/settings/models/test',{'id':deep_id})
            assert next(c for c in checked['connections'] if c['id']==deep_id)['tools']
            call('/api/settings/models/delete',{'id':deep_id})
            search_python=Path(os.getenv('PAPER_SEARCH_PYTHON','.research-deps/bin/python'))
            if search_python.exists():
                code='''import asyncio,json,os,tempfile
from backend.discovery_worker import model_config
from gpt_researcher.config.config import Config
from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
settings=model_config()
with tempfile.NamedTemporaryFile(mode='w',suffix='.json') as file:
    json.dump(settings,file); file.flush(); config=Config(file.name)
assert config.fast_llm_model==config.smart_llm_model==config.strategic_llm_model==json.loads(os.environ['METHODATLAS_MODEL_CONFIG'])['model']
assert config.reasoning_effort=='high'
provider=GenericLLMProvider.from_provider(config.smart_llm_provider,model=config.smart_llm_model,**config.llm_kwargs)
assert json.loads(asyncio.run(provider.get_chat_response([{'role':'user','content':'Reply JSON'}],False)))=={'answer':'verified'}
'''
                for chosen,expected in ((service.research.settings.for_task(task)[0],'custom-v1'),(service.research.settings.for_task(service.store.task(submitted['task_id']))[0],'deepseek-v4-pro')):
                    subprocess.run([str(search_python),'-c',code],env={**os.environ,'METHODATLAS_MODEL_CONFIG':json_text(chosen | {'selected_effort':'high'}),'FAST_LLM':'other:wrong','LLM_PROVIDER':'wrong','LLM_KWARGS':'{}'},check=True,capture_output=True,timeout=60)
                    wire=requests[-1][1]
                    assert wire['model']==expected and wire['reasoning_effort']=='high' and wire['stream'] is True and requests[-1][2]=='Bearer secret-never-public'
                    if expected=='deepseek-v4-pro': assert wire['thinking']=={'type':'enabled'}
                print('PASS: actual GPT Researcher/LangChain non-streaming caller receives the full concatenated SSE answer for both connections',flush=True)
            # Modifying/deleting a connection cannot change an already sent task.
            call('/api/settings/models/save',{**draft,'id':ident,'model':'custom-v2','api_key':'second-secret'})
            call('/api/settings/models/delete',{'id':ident})
            service.research.complete(task,'Return JSON.',{},'rag-write',128)
            assert requests[-1][1]['model']=='custom-v1' and requests[-1][2]=='Bearer secret-never-public'
            assert 'secret-never-public' not in json_text(service.task_view(project,task['id']))
            sdk_root = service.store.root / 'harness'
            if os.name == 'nt':
                sdk_root = Path('\\\\?\\' + str(sdk_root.resolve()))
            sdk_logs=[log for sessions in sdk_root.glob('*/*/*/*/*/sessions') for log in sessions.rglob('*.jsonl')]
            assert sdk_logs, 'the real SDK must have persisted session logs for credential isolation to be checked'
            assert all(key not in log.read_text(encoding='utf-8') for log in sdk_logs for key in ('secret-never-public','second-secret'))
            print(f'PASS: neither connection credential appears in {len(sdk_logs)} actual SDK JSONL session logs',flush=True)
            if os.name == 'nt':
                # chmod mode bits do not describe Windows access control.
                subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', '''
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:METHODATLAS_CHECK_FILE
$allowed = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-4')
foreach ($rule in $acl.Access) {
    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and $sid -notin $allowed) { throw "Unexpected credential-file access: $sid" }
}
'''], env={**{k:v for k,v in os.environ.items() if k.upper() != 'PSMODULEPATH'}, 'METHODATLAS_CHECK_FILE':str(service.research.settings.path)}, check=True)
            else:
                assert service.research.settings.path.stat().st_mode & 0o777==0o600
            call('/api/settings/models/delete',{'id':gateway_id})
            assert call('/api/settings')['default_id']==''
            with patch.object(service.research.settings,'view',side_effect=ValueError('old credential: secret-never-public')):
                try: call('/api/settings')
                except HTTPError as error: assert 'secret-never-public' not in error.read().decode()
                else: raise AssertionError('expected redacted HTTP error')
            with patch.object(service.research.settings,'change',side_effect=ValueError('old credential: secret-never-public')):
                try: call('/api/settings/models/test',{'id':'deleted'})
                except HTTPError as error: assert 'secret-never-public' not in error.read().decode()
                else: raise AssertionError('expected redacted HTTP error')
            from .settings import ModelSettings
            reopened=ModelSettings(service.store,service.research)
            assert reopened.for_task(task)[0]['api_key']=='secret-never-public'
            assert reopened.preferences(conversation)==prefs
            stream_draft={**draft,'name':'Streaming gateway','base_url':'https://copilot.tencent.com/v2','model':'stream-only'}
            stream_id=call('/api/settings/models/save',stream_draft)['default_id']
            def local_probe(req,timeout):
                return urlopen(Request(f'http://127.0.0.1:{provider.server_port}/v2/chat/completions',data=req.data,headers=dict(req.header_items())),timeout=timeout)
            with patch('backend.settings.build_opener',return_value=SimpleNamespace(open=local_probe)):
                streamed=service.research.settings.test(stream_id)['connections'][0]
            assert streamed['tools'] and streamed['vision'] and streamed['efforts']==['low','medium','high']
            from .discovery_worker import model_config
            for selected in (stream_draft,{**stream_draft,'base_url':'http://127.0.0.1:12345/gateway','protocol':'deepseek'}):
                with patch.dict(os.environ,{'METHODATLAS_MODEL_CONFIG':json_text({**selected,'selected_effort':'high'})}):
                    assert model_config()['LLM_KWARGS']['streaming'] is True
            with patch.dict(os.environ,{'METHODATLAS_MODEL_CONFIG':json_text({**draft,'selected_effort':'high'})}):
                assert model_config()['LLM_KWARGS']['streaming'] is True
            print('PASS: real HTTP settings, capability probes, actual Harness model/effort/style/language, deep route, immutable task configuration and credential isolation')
        finally:
            server.shutdown();server.server_close();service.close()
    provider.shutdown();provider.server_close()


if __name__=='__main__': main()
