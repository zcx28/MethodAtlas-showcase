"""#59 public project tools + actual Harness HTTP boundary; no paid provider."""
import base64
import hashlib
import json
import tempfile
import threading
import time
import sys
from contextlib import nullcontext
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

import pymupdf

from .agent import ProjectTools
from .app import Handler, Service
from .research_context import model_view


def main():
    replies, requests = deque(), []

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            raw = self.rfile.read(int(self.headers['Content-Length']))
            if self.path.endswith('/files'):
                self.send_error(404)
                return
            body = json.loads(raw)
            requests.append(body)
            reply = replies.popleft()
            if reply == 'fail':
                self.send_error(402)
                return
            message = reply.get('_message') or {'role':'assistant','content':json.dumps(reply)}
            chunks = [{'id':'check', 'model':body['model'], 'choices':[{'index':0, 'delta':message,'finish_reason':None}]},
                      {'id':'check', 'model':body['model'], 'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if message.get('tool_calls') else 'stop'}],
                       'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}}]
            raw = (''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    provider = ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    with (nullcontext(tempfile.mkdtemp(prefix='vision-ui-')) if '--keep' in sys.argv else tempfile.TemporaryDirectory(ignore_cleanup_errors=True)) as directory:
        root = Path(directory)
        service = Service(root/'missing', root)
        service.research.key = 'controlled-only'
        service.research.model = 'deepseek-flash'  # Vision uses the selected model; no separate hard-coded model.
        service.research.base_url = f'http://127.0.0.1:{provider.server_port}'
        handler = type('VisionHandler',(Handler,),{'service':service})
        server = ThreadingHTTPServer(('127.0.0.1',0),handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            project = service.store.projects()[0]['id']
            conversation = service.store.conversations(project)[0]['id']
            with pymupdf.open() as doc:
                page = doc.new_page(width=300, height=200)
                page.draw_rect((10,10,80,50),color=(1,0,0),fill=(1,0,0))
                page.insert_text((20,80),'Figure 1. A = 20 ms. B = 30 ms.')
                raw = doc.tobytes()
            paper = service.store.import_pdf_bytes(project,raw,'Vision fixture')
            other = service.store.create_project('Other project')
            foreign = service.store.import_pdf_bytes(other,raw,'Foreign fixture')
            prompt = 'Read Figure 1'
            task_id = service.message(project,conversation,{'text':prompt,'client_message_id':'vision','selected_paper_ids':[paper]},schedule=False)['task_id']
            service.store.run("UPDATE tasks SET status='running',kind='chat' WHERE id=?",(task_id,))
            tools = ProjectTools(service.store,service.store.task(task_id))
            tools.research = service.research
            tools.call('set_scope',{'only_selected':True})
            candidates = tools.call('list_figures',{'paper_id':paper,'query':'Figure 1'})
            assert candidates['pages'][0]['page'] == 1 and candidates['version_id']
            args = {'paper_id':paper,'page':1,'question':'Report A latency','rect':[0.0,0,300,200]}
            def rejected(arguments):
                before = len(requests)
                try: tools.call('read_figure',arguments)
                except ValueError: pass
                else: raise AssertionError('Invalid figure request accepted')
                assert len(requests) == before
            rejected({k:v for k,v in args.items() if k != 'rect'})
            for changes in ({'paper_id':foreign},{'page':2},{'rect':[0,0,301,200]}, {'rect':[0,0,True,2]}, {'rect':[0,0,float('nan'),2]}, {'rect':[1,2]}):
                rejected({**args,**changes})
            initial = {'readable':True, 'observations':[
                {'text':'A latency is 20 ms.','basis':'image','visible':'A = 20 ms'},
                {'text':'Invented module','basis':'image','visible':'missing'},
                {'text':'Forged context','basis':'context','visible':'This is not in the page.'},
                {'text':'Mixed sources must be rejected','basis':'image/context','visible':'A = 20 ms'}], 'gaps':[]}
            replies.append(initial)
            result = tools.call('read_figure',args)
            assert [o['text'] for o in result['observations']] == [o['text'] for o in initial['observations'][:3]]
            assert result['gaps'] and tools.call('read_figure',args) == result and len(requests) == 1
            assert all(r['model'] == 'deepseek-flash' and not r.get('tools') for r in requests)
            for request in requests:
                urls = [b['image_url']['url'] for m in request['messages'] if isinstance(m['content'],list) for b in m['content'] if b['type']=='image_url']
                assert len(urls) == 1
                pixels = pymupdf.Pixmap(base64.b64decode(urls[0].split(',',1)[1]))
                red, green, blue = pixels.pixel(40,40)[:3]
                assert red > 240 and green < 15 and blue < 15
            cite = result['evidence'][0]
            assert cite['kind'] == 'figure' and cite['image']['source_sha256'] == hashlib.sha256(raw).hexdigest()
            assert model_view('read_figure',result,tools.references)['evidence'][0]['kind'] == 'figure'
            base = f'http://127.0.0.1:{server.server_port}/api/projects/{project}'
            with urlopen(base+'/citations/'+cite['id']) as response:
                assert json.load(response)['rect'] == [0,0,300,200]
            with urlopen(base+f'/papers/{paper}/pdf?version_id={result["version_id"]}') as response:
                assert response.read() == raw
            usage = service.store.task(task_id)['refs']['usage']
            assert {u['role'] for u in usage} == {'vision-read'}, usage
            assert all(u['model']=='deepseek-flash' and u['calls']==1 for u in usage)
            assert service.research.model == 'deepseek-flash'
            assert service.task_view(project,task_id)['files'] == []
            replies.append({'readable':False,'observations':initial['observations'],'gaps':['Unreadable']})
            unreadable = tools.call('read_figure',{**args,'question':'unreadable'})
            assert unreadable['observations'] == [] and unreadable['gaps']
            before = service.store.task(task_id)['evidence']
            replies.append('fail')
            try: tools.call('read_figure',{**args,'question':'provider failure'})
            except ValueError: pass
            else: raise AssertionError('Provider failure accepted')
            assert service.store.task(task_id)['evidence'] == before
            # Cached reads still fail when the immutable source bytes have been tampered with.
            source = Path(service.store.paper(project,paper)['source_path'])
            source.write_bytes(b'bad')
            rejected(args)
            source.write_bytes(raw)
            service.store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(task_id,))
            # Exercise normal message routing -> MCP selection/read -> actual vision SDK -> saved reply.
            def tool(name, args):
                return {'_message':{'role':'assistant','tool_calls':[{'index':0,'id':name,'type':'function',
                    'function':{'name':'mcp__methodatlas__'+name,'arguments':json.dumps(args)}}]}}
            replies.extend([{'intent':'chat','mode':'explore','reason':'Read original figure','only_selected':True},
                tool('set_scope',{'only_selected':True}), tool('list_figures',{'paper_id':paper,'query':'Figure 1'}),
                tool('read_figure',args), initial,
                {'_message':{'role':'assistant','content':'受控接口验收样例（非真实模型质量结果）：图中 A 为20 ms；其余结构未确认。[cite:E1]'}}])
            origin = f'http://127.0.0.1:{server.server_port}'
            body = {'text':'请读取原始 Figure 1，核对 A 的延迟并给原图引用。','client_message_id':'vision-http','selected_paper_ids':[paper]}
            endpoint = base+f'/conversations/{conversation}/messages'
            def post():
                with urlopen(Request(endpoint,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':origin})) as response:
                    return json.load(response)
            submitted = post()
            deadline = time.monotonic()+90
            while time.monotonic() < deadline:
                view = service.task_view(project,submitted['task_id'])
                if view['status'] in ('succeeded','failed'):
                    break
                time.sleep(.1)
            assert view['status']=='succeeded',view.get('error')
            assert not view['files'] and view['citations'][0]['kind']=='figure'
            assert post()['duplicate'] and not replies
            print('PASS HTTP chat routing, candidate selection, MCP image read, final image citation and duplicate message')
            service.close()
            service = Service(root/'missing',root)
            assert service.store.citation(project,cite['id'],conversation) == cite
            assert Path(service.store.paper(project,paper,result['version_id'])['source_path']).read_bytes() == raw
            assert not replies
            print('PASS actual image pixels, single-pass image analysis, unreadable/failure preservation, version citation HTTP, scope, cache, usage and restart')
            if '--keep' in sys.argv:
                print('Preserved controlled UI fixture:',root,flush=True)
        finally:
            server.shutdown()
            server.server_close()
            service.close()
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
