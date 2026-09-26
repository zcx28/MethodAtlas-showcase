"""Settings acceptance: isolated HTTP/model servers, real Harness, no paid requests."""
import json
import os
import subprocess
import tempfile
import threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .app import Service, Handler
from .state import json_text
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch


def main():
    requests = []
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*_): pass
        def do_POST(self):
            if self.path.endswith('/files'):
                self.rfile.read(int(self.headers['Content-Length']));self.send_error(404);return
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append((self.path,body,self.headers.get('Authorization')))
            message={'role':'assistant','content':json_text({'answer':'verified'})}
            if isinstance(body['messages'][0]['content'],list):
                import base64,pymupdf
                pixels=pymupdf.Pixmap(base64.b64decode(body['messages'][0]['content'][1]['image_url']['url'].split(',')[1]))
                message['content']=['RED','GREEN','BLUE'][pixels.pixel(0,0).index(255)]
            if body.get('tools') and not body.get('stream'):
                message={'role':'assistant','content':None,'tool_calls':[{'id':'probe','type':'function','function':{'name':'connection_check','arguments':'{"ok":true}'}}]}
            if body.get('stream'):
                raw=('data: '+json.dumps({'id':'settings-check','choices':[{'index':0,'delta':message,'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n').encode()
            else: raw=json.dumps({'choices':[{'message':message}]}).encode()
            self.send_response(200);self.send_header('Content-Type','text/event-stream' if body.get('stream') else 'application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    provider=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory() as folder:
        service=Service(Path(folder)/'empty',Path(folder))
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
            project=service.store.projects()[0]['id']; conversation=service.store.create_conversation(project)
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
            if Path('.research-deps/bin/python').exists():
                chosen=service.research.settings.for_task(task)[0] | {'selected_effort':'high'}
                code='''import asyncio,json,tempfile
from backend.discovery_worker import model_config
from gpt_researcher.config.config import Config
from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
settings=model_config()
with tempfile.NamedTemporaryFile(mode='w',suffix='.json') as file:
    json.dump(settings,file); file.flush(); config=Config(file.name)
assert config.fast_llm_model==config.smart_llm_model==config.strategic_llm_model=='custom-v1'
assert config.reasoning_effort=='high'
provider=GenericLLMProvider.from_provider(config.smart_llm_provider,model=config.smart_llm_model,**config.llm_kwargs)
assert 'verified' in asyncio.run(provider.get_chat_response([{'role':'user','content':'Reply JSON'}],False))
'''
                subprocess.run(['.research-deps/bin/python','-c',code],env={**os.environ,'METHODATLAS_MODEL_CONFIG':json_text(chosen),'FAST_LLM':'other:wrong','LLM_PROVIDER':'wrong','LLM_KWARGS':'{}'},check=True,capture_output=True,timeout=60)
                assert requests[-1][1]['model']=='custom-v1' and requests[-1][1]['reasoning_effort']=='high' and requests[-1][2]=='Bearer secret-never-public'
            # Modifying/deleting a connection cannot change an already sent task.
            call('/api/settings/models/save',{**draft,'id':ident,'model':'custom-v2','api_key':'second-secret'})
            call('/api/settings/models/delete',{'id':ident})
            service.research.complete(task,'Return JSON.',{},'rag-write',128)
            assert requests[-1][1]['model']=='custom-v1' and requests[-1][2]=='Bearer secret-never-public'
            assert 'secret-never-public' not in json_text(service.task_view(project,task['id']))
            assert service.research.settings.path.stat().st_mode & 0o777==0o600
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
            print('PASS: real HTTP settings, capability probes, actual Harness model/effort/style/language, deep route, immutable task configuration and credential isolation')
        finally:
            server.shutdown();server.server_close();service.close()
    provider.shutdown();provider.server_close()


if __name__=='__main__': main()
