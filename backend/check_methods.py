"""Research views exercise the existing file/tool and HTTP boundaries."""
import json
import tempfile
import threading
import hashlib
import copy
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from .agent import ProjectTools
from .app import Handler, Service, ThreadingHTTPServer


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        root = Path(directory)
        service = Service(root / 'missing', root)
        try:
            project = service.store.projects()[0]['id']
            conversation = service.store.conversations(project)[0]['id']
            paper = service.store.paste(project, '室内研究', '方法甲只在室内验证，成功率为80%，不能推断室外效果。')
            task = service.message(project, conversation, {'text':'生成方法地图', 'client_message_id':'methods'}, schedule=False)['task_id']
            service.store.run("UPDATE tasks SET status='running' WHERE id=?", (task,))
            tools = ProjectTools(service.store, service.store.task(task))
            tools.set_scope(False)
            cite = tools.read_material(paper)['evidence'][0]['id']
            content = {'view':'methods', 'summary':'室内研究比较，不能跨条件排名。', 'nodes':[
                {'name':f'方法甲 [cite:{cite}]', 'summary':'室内策略', 'detail':'仅验证室内效果。',
                 'conditions':'室内', 'metrics':'成功率80%', 'limitations':'室外尚未验证', 'evidence':[f'[cite:{cite}]']}],
                'gaps':['室外效果尚待核对'], 'opportunities':[{'text':'检验室外迁移效果', 'evidence':[f'[cite:{cite}]']}]}
            saved = tools.call('write_file', {'title':'方法研究', 'kind':'html', 'content':json.dumps(content), 'citation_ids':[cite]})
            version = service.file_version(project, saved['artifact_id'], saved['version_id'])
            assert 'research-section' in version['body'] and '待验证' in version['body']
            assert '<details' not in version['body'] and 'data-method=' not in version['body']
            assert '仅验证室内效果。' in version['body']
            from .methods import render
            citations = [service.store.citation(project,cite,conversation)]
            another = {**citations[0],'id':'cite_'+'f'*32,'quote':'另一段依据'}
            multiple = copy.deepcopy(content)
            multiple['nodes'][0]['evidence'].append('[cite:'+another['id']+']')
            multi_html, _ = render(json.dumps(multiple), citations+[another])
            assert another['id'] not in multi_html
            import re
            assert all('data-citation' not in h for h in re.findall(r'<h2>(.*?)</h2>',multi_html))
            assert '>原文</button>' not in multi_html
            assert json.loads(tools.read_file(saved['artifact_id'], saved['version_id'])['body']) == content
            from .research_pipeline import preflight
            from .methods import ResearchValidationError
            from types import SimpleNamespace
            tools.research=SimpleNamespace(complete=lambda *args,**kwargs:{'patches':[{'path':'/summary','value':'仅依据已读原文'}]})
            invalid_summary=copy.deepcopy(content);invalid_summary['summary']=''
            repaired=preflight(tools,invalid_summary,[service.store.citation(project,cite,conversation)],'repair-input-identity')
            assert repaired['summary']=='仅依据已读原文'
            later=copy.deepcopy(repaired);later['nodes'][0]['conditions']=''
            try:preflight(tools,later,[service.store.citation(project,cite,conversation)],'repair-input-identity')
            except ResearchValidationError:pass
            else:raise AssertionError('Later draft reverted to cached pre-verification repair')
            tools.research=None
            original = service.file_path(project, version).read_bytes()
            # Actual short aliases are decoded before validation/storage; repeat saves are idempotent.
            alias = tools.references.alias(cite)
            args = {'title':'方法研究', 'kind':'html', 'content':json.dumps(content).replace(cite,alias), 'citation_ids':[alias]}
            assert tools.call('write_file', args) == saved
            plain = copy.deepcopy(content)
            plain['nodes'][0]['evidence'] = [alias]
            plain['opportunities'][0]['evidence'] = [alias]
            tools.call('write_file', dict(args, title='结构化引用', content=json.dumps(plain), output_key='plain'))
            for invalid in [dict(content,nodes=[]), dict(content,nodes=[dict(content['nodes'][0],evidence=[])]),
                            dict(content,nodes=[dict(content['nodes'][0],evidence=['[cite:E999]'])]),
                            dict(content,nodes=[dict(content['nodes'][0],conditions='')])]:
                try:
                    tools.call('write_file', dict(args,title='不能保存',content=json.dumps(invalid),output_key='bad'))
                except ValueError:
                    pass
                else:
                    raise AssertionError('Unfounded research accepted')
            updated = copy.deepcopy(content)
            updated['nodes'][0]['detail'] = '修订后仍只验证室内；<script>alert(1)</script>'
            revision = tools.call('write_file', dict(args,content=json.dumps(updated),artifact_id=saved['artifact_id'],base_version_id=saved['version_id']))
            assert revision['version_no'] == 2
            revised = service.file_version(project,saved['artifact_id'],revision['version_id'])
            assert '&lt;script&gt;' in revised['body'] and '<script>alert(1)' not in revised['body']
            timeline = copy.deepcopy(content)
            timeline['view'] = 'evolution'
            timeline['nodes'][0].update(period=f'年代待核对 [cite:{cite}]',problem='室内控制',improvement='有条件地改善室内效果')
            evolution = tools.call('write_file',dict(args,title='技术演进',content=json.dumps(timeline)))
            assert '研究时间：' in service.file_version(project,evolution['artifact_id'],evolution['version_id'])['body']
            from html.parser import HTMLParser
            class Buttons(HTMLParser):
                opened = False
                def handle_starttag(self, tag, attrs):
                    if tag == 'button':
                        assert not self.opened, 'Nested buttons break independent stage/citation clicks'
                        self.opened = True
                def handle_endtag(self, tag):
                    if tag == 'button': self.opened = False
            Buttons().feed(service.file_version(project,evolution['artifact_id'],evolution['version_id'])['body'])
            comparison = tools.call('write_file',dict(args,title='正式方法比较',content=json.dumps(dict(content,view='comparison'))))
            assert '指标与结果' in service.file_version(project,comparison['artifact_id'],comparison['version_id'])['body']
            # Chat cannot write files; selected is a focus until scope is explicitly restricted.
            second = service.store.paste(project,'补充材料','只验证仿真。')
            next_task = service.message(project,conversation,{'text':'比较','client_message_id':'chat','selected_paper_ids':[paper]},schedule=False)['task_id']
            service.store.run("UPDATE tasks SET status='running',kind='chat' WHERE id=?", (next_task,))
            chat = ProjectTools(service.store,service.store.task(next_task))
            chat.set_scope(False)
            assert chat.read_material(second)['evidence']
            chat.set_scope(True)
            for operation in [lambda: chat.read_material(second),lambda: chat.write_file('非法成果','html',json.dumps(content),[cite])]:
                try: operation()
                except ValueError: pass
                else: raise AssertionError('Chat write / strict scope escaped')
            # The model boundary may return the HTML payload as an object, not an encoded string.
            from types import SimpleNamespace
            from .rag import run
            service.store.run("UPDATE tasks SET kind='research' WHERE id=?", (next_task,))
            model = SimpleNamespace(store=service.store,complete=lambda task,system,context,role,*args:
                {'mode':'rag','intent':'research','only_selected':True,'reads':[{'paper_id':paper,'query':'','page':1}],'files':[]} if role == 'rag-plan' else
                {'answer':'已按原文比较。','files':[{'title':'结构化模型边界','kind':'html','content':content,'citation_ids':[cite]}]})
            run(model,service.store.task(next_task),ProjectTools(service.store,service.store.task(next_task)),{})
            assert any(v['title'] == '结构化模型边界' for v in service.task_view(project,next_task)['files'])
            service.store.run("UPDATE tasks SET status='succeeded' WHERE id IN (?,?)", (task,next_task))
            server = ThreadingHTTPServer(('127.0.0.1',0),type('MethodsHandler',(Handler,),{'service':service}))
            threading.Thread(target=server.serve_forever,daemon=True).start()
            base = f'http://127.0.0.1:{server.server_port}'
            url = f'{base}/api/projects/{project}/artifacts/{saved["artifact_id"]}/restore'
            body = {'version_id':saved['version_id'],'base_version_id':revision['version_id'],'request_id':'restore-once'}
            def post(target, request):
                return json.load(urlopen(Request(target,json.dumps(request).encode(),{'Content-Type':'application/json'})))
            try:
                restored = post(url,body)
                assert restored['version_no'] == 3 and post(url,body) == restored
                assert restored['version_id'] not in {v['version_id'] for v in service.task_view(project,task)['files']}, 'Restoration is not a new output from the original model run'
                restored_version = service.file_version(project,saved['artifact_id'],restored['version_id'])
                assert restored_version['body'] == version['body'] and restored_version['citations'] == version['citations']
                for target,request in [(url,dict(body,request_id='stale')), (url,dict(body,version_id=revision['version_id'])),
                                       (url.replace(project,service.store.create_project('隔离项目')),body),
                                       (url,dict(body,request_id='foreign-version',version_id=evolution['version_id'],base_version_id=restored['version_id']))]:
                    try: post(target,request)
                    except HTTPError as error: assert error.code == 400
                    else: raise AssertionError('Invalid restoration accepted')
                assert service.file_path(project,version).read_bytes() == original
                assert len(service.store.artifact(project,saved['artifact_id'])['versions']) == 3
                # Restore refuses corrupted bytes, preserving the current version.
                path = service.file_path(project,revised)
                before = path.read_bytes()
                path.write_bytes(b'broken')
                try:
                    post(url,dict(body,request_id='corrupt',version_id=revision['version_id'],base_version_id=restored['version_id']))
                except HTTPError as error: assert error.code == 400
                else: raise AssertionError('Corrupt restoration accepted')
                path.write_bytes(before)
                service.close()
                service = Service(root/'missing',root)
                server.RequestHandlerClass.service = service
                assert service.file_version(project,saved['artifact_id'],restored['version_id'])['materials'] == version['materials']
                assert hashlib.sha256(service.file_path(project,version).read_bytes()).hexdigest() == version['payload']['sha256']
            finally:
                server.shutdown(); server.server_close()
            print('PASS methods/comparison/evolution; evidence, chat/scope, immutable revisions, restore retry/conflict/corruption/isolation, restart')
        finally:
            service.close()


if __name__ == '__main__':
    main()
