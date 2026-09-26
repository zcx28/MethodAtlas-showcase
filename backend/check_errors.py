"""Public failure contract: safe UI, private diagnostics, durable recovery."""
import json
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
from types import SimpleNamespace

from .app import Handler, Service
from .errors import AppError, record_error
from .agent import ProjectTools


def main():
    with tempfile.TemporaryDirectory() as directory, patch.object(Service, 'schedule'):
        service = Service(Path(directory) / 'missing', Path(directory))
        try:
            project = service.store.projects()[0]['id']
            conversation = service.store.conversations(project)[0]['id']
            sent = service.message(project, conversation, {'text':'核查论文', 'client_message_id':'error-check'})
            service.store.run("UPDATE tasks SET status='running' WHERE id=?", (sent['task_id'],))
            service.research.fail(service.store.task(sent['task_id']), ValueError('成果中有引用范围过大；请先用 select_quote 逐字选择直接支持主张的一句或相邻短句'))
            task = service.task_view(project, sent['task_id'])
            assert 'select_quote' not in task['error'], task['error']
            assert task['error_info']['code'] == 'evidence' and task['error_info']['action'] == 'new_request'
            assert task['error_info']['next_step'] and task['error_info']['incident_id']
            logs = (Path(directory) / 'logs' / 'errors.jsonl').read_text()
            assert 'select_quote' in logs and task['error_info']['incident_id'] in logs
            assert task['status'] == 'failed'
            resumed = service.control(project, conversation, task['id'], 'resume', {})
            assert resumed['status'] == 'queued' and not resumed.get('error_info')
            assert service.control(project, conversation, task['id'], 'resume', {})['revision'] == resumed['revision']
            # Historical failures remain readable but never expose raw exceptions.
            service.store.run("UPDATE tasks SET error=?,status='failed',refs='{}' WHERE id=?", ('DeepSeek HTTP 402 select_quote /Users/private/server.py', task['id']))
            legacy = service.task_view(project, task['id'])
            assert legacy['error_info']['code'] == 'billing' and 'HTTP' not in legacy['error']
            service.research.key = 'test-secret-value'
            for code, status in [('billing',402), ('authentication',401), ('rate_limit',429), ('unavailable',503)]:
                try:
                    raise AppError(code, f'upstream HTTP {status} select_quote test-secret-value', status=status)
                except AppError as exc:
                    info = record_error(service.store, exc, tool='select_quote')
                assert info['code'] == code and 'HTTP' not in info['message']
                assert info['retryable'] == (code in ('rate_limit','unavailable'))
            logs = (Path(directory) / 'logs' / 'errors.jsonl').read_text()
            assert 'test-secret-value' not in logs and 'Traceback' in logs and '"http_status": 402' in logs
            upstream = RuntimeError('requests-style provider failure')
            upstream.response = SimpleNamespace(status_code=429)
            try:
                raise ValueError('wrapped provider failure') from upstream
            except ValueError as exc:
                info = record_error(service.store, exc)
            assert info['code'] == 'rate_limit'
            assert json.loads((Path(directory)/'logs'/'errors.jsonl').read_text().splitlines()[-1])['http_status'] == 429
            # A failed provider request must not exhaust the single content repair.
            paper = service.store.paste(project, '原文', 'The method uses point clouds.')
            tid = service.message(project, conversation, {'text':'生成方法比较','client_message_id':'repair'})['task_id']
            service.store.run("UPDATE tasks SET status='running' WHERE id=?", (tid,))
            tools = ProjectTools(service.store, service.store.task(tid)); tools.set_scope(False)
            cite = tools.read_material(paper)['evidence'][0]['id']
            draft = {'view':'methods','summary':'','nodes':[{'name':'方法','summary':'点云方法','detail':'使用点云','conditions':None,'metrics':None,'limitations':None,'evidence':[cite]}],'gaps':[]}
            args = {'title':'恢复后的成果','kind':'html','content':json.dumps(draft),'citation_ids':[cite],'output_key':'repair-check'}
            model = SimpleNamespace(complete=lambda *a,**k:None)
            tools.research = model
            with patch.object(model, 'complete', side_effect=AppError('unavailable','HTTP 503 temporary')):
                try:
                    tools.call('write_file', args)
                except AppError as exc:
                    service.research.fail(tools.task, exc)
                else:
                    raise AssertionError('provider failure became a published report')
            failed = service.task_view(project,tid)
            assert failed['error_info']['code'] == 'unavailable' and not failed['files']
            service.control(project,conversation,tid,'resume',{})
            service.store.run("UPDATE tasks SET status='running' WHERE id=?", (tid,))
            tools = ProjectTools(service.store, service.store.task(tid));tools.set_scope(False);tools.research=model
            with patch.object(model, 'complete', return_value={'patches':[{'path':'/summary','value':'仅依据已读原文'}]}) as repair:
                saved = tools.call('write_file',args)
                assert tools.call('write_file',args) == saved and repair.call_count == 1
            assert len(service.task_view(project,tid)['files']) == 1
            # Actual HTTP boundary, not only the internal failure helper.
            server = ThreadingHTTPServer(('127.0.0.1',0), type('ErrorCheckHandler',(Handler,),{'service':service}))
            threading.Thread(target=server.serve_forever,daemon=True).start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                for error, expected in [(ValueError('select_quote 引用范围过大'),400), (RuntimeError('internal_function secret test-secret-value'),500), (PermissionError('internal_acl'),403)]:
                    with patch.object(service, 'state', side_effect=error):
                        try:
                            urlopen(base+'/api/state')
                            raise AssertionError('failure became success')
                        except HTTPError as response:
                            body = json.load(response)
                            assert response.code == expected
                            assert not any(word in json.dumps(body) for word in ('select_quote','internal_function','internal_acl','test-secret-value'))
                            assert body['error_info']['next_step'] and body['error_info']['incident_id']
                for request in (Request(base+'/api/missing'), Request(base+'/api/missing', data=b'{}', headers={'Content-Type':'application/json'})):
                    try:
                        urlopen(request)
                    except HTTPError as response:
                        assert response.code == 404 and json.load(response)['error_info']['code'] == 'not_found'
                    else:
                        raise AssertionError('unknown route accepted')
                try:
                    urlopen(Request(base+'/api/projects', data=b'{bad json', headers={'Content-Type':'application/json'}))
                except HTTPError as response:
                    assert response.code == 400 and json.load(response)['error_info']['code'] == 'input'
                else:
                    raise AssertionError('malformed input accepted')
            finally:
                server.shutdown(); server.server_close()
            print('PASS: private diagnostics, public mapping, idempotent resume')
        finally:
            service.close()


if __name__ == '__main__':
    main()
