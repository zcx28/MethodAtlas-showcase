"""Personal skills through HTTP and the installed native Harness (controlled model)."""
import json
import tempfile
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .app import Service, Handler
from .state import new_id


FIELDS = dict(name='可追溯比较', description='复用方法比较流程', scenarios='新主题', inputs='当前项目材料与问题',
              steps='先列证据，再比较条件，区分结论与假设。METHOD-V1', template='问题 / 证据 / 限制', example='比较主题甲的两个方法，不足明确标记。')
REQUESTS = []


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        REQUESTS.append(body)
        context = json.dumps(body['messages'], ensure_ascii=False)
        if '从用户已完成协作提炼' in context:
            answer = FIELDS
        else:
            answer = {'intent':'chat', 'mode':'direct', 'only_selected':False, 'answer':'按已确认方法回答新主题；不足明确标记。'}
        chunk = {'id':'skill-check','choices':[{'index':0,'delta':{'role':'assistant','content':json.dumps(answer, ensure_ascii=False)},'finish_reason':'stop'}],
                 'usage':{'prompt_tokens':20,'completion_tokens':20,'total_tokens':40}}
        raw = ('data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n').encode()
        self.send_response(200)
        self.send_header('Content-Type','text/event-stream')
        self.send_header('Content-Length',str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main():
    provider = ThreadingHTTPServer(('127.0.0.1',0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        service = Service(Path(directory)/'empty', Path(directory))
        service.progress.close()
        service.research.key = 'local-check'
        service.research.base_url = f'http://127.0.0.1:{provider.server_port}'
        handler = type('SkillsHandler', (Handler,), {'service':service, 'log_message':lambda *args:None})
        server = ThreadingHTTPServer(('127.0.0.1',0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f'http://127.0.0.1:{server.server_port}'

        def api(path, body=None):
            request = urllib.request.Request(origin+path, json.dumps(body).encode() if body is not None else None, headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read().decode()
                return json.loads(raw) if response.headers.get_content_type() == 'application/json' else raw

        def rejects(path, body=None):
            try:
                api(path, body)
            except urllib.error.HTTPError as error:
                assert error.code == 400, error.read()
                return
            raise AssertionError('invalid request accepted')

        try:
            project = api('/api/state')['projects'][0]['id']
            other = api('/api/projects', {'name':'其他主题'})['project_id']
            conversation = service.store.conversations(project)[0]['id']
            source = service.message(project, conversation, {'text':'比较方法，PRIVATE-SOURCE 不要分享', 'client_message_id':'source'}, schedule=False)
            service.route(source['task_id'])
            assert service.store.task(source['task_id'])['status'] == 'succeeded'
            assert api('/api/skills') == []
            root = f'/api/projects/{project}/skills/'
            draft_request = {'task_id':source['task_id'], 'request_id':'draft'}
            draft = api(root+'draft', draft_request)
            assert '按已确认方法回答新主题' in json.dumps(REQUESTS[-1]['messages'], ensure_ascii=False), 'distillation must include the selected completed answer, not just its question'
            assert api(root+'draft', draft_request) == draft
            assert draft['fields'] == FIELDS and api('/api/skills') == []
            rejects(f'/api/projects/{other}/skills/draft', {'task_id':source['task_id']})
            save = {'request_id':'save', 'fields':draft['fields'], 'draft_id':draft['draft_id'], 'confirmed':True}
            rejects(root+'save', {**save, 'confirmed':False})
            skill = api(root+'save', save)
            assert api(root+'save', save) == skill
            rejects(root+'save', {**save, 'fields':{**FIELDS, 'name':'changed'}})
            assert not service.store.artifacts(project)
            prompt = f'这次调用个人研究 Skill「可追溯比较」版本 {skill["version_id"]} 研究新主题；临时用列表，不更新方法。'
            conv2 = service.store.conversations(other)[0]['id']
            sent = service.message(other, conv2, {'text':prompt, 'client_message_id':'use'}, schedule=False)
            base = {'id':skill['id'], 'base_version_id':skill['version_id'], 'confirmed':True}
            updated = api(root+'save', {**base, 'request_id':'update', 'fields':{**FIELDS, 'steps':'METHOD-V2'}})
            rejects(root+'save', {**base, 'request_id':'stale', 'fields':FIELDS})
            rejects(root+'save', {**base, 'base_version_id':updated['version_id'], 'request_id':'multiline', 'fields':{**FIELDS, 'name':'bad\nname'}})
            unselected = service.store.root / 'workspaces' / other / '.agents' / 'skills'
            unselected.mkdir(parents=True)
            (unselected / 'unselected.md').write_text('---\nname: unselected-private-method\ndescription: MUST-NOT-DISCOVER\n---\nPRIVATE-METHOD', encoding='utf-8')
            service.route(sent['task_id'])
            task = service.store.task(sent['task_id'])
            assert task['status'] == 'succeeded', task['error']
            # This proves the installed SDK loads the frozen Markdown through its native plugin.
            model_input = json.dumps(REQUESTS[-1]['messages'], ensure_ascii=False)
            assert '<skill_content' in model_input and 'METHOD-V1' in model_input, model_input
            assert 'METHOD-V2' not in model_input and 'PRIVATE-SOURCE' not in model_input
            assert 'unselected-private-method' not in model_input and 'MUST-NOT-DISCOVER' not in model_input
            assert task['refs']['personal_skill']['version_id'] == skill['version_id']
            assert api('/api/skills')[0]['version_no'] == 2
            base = {**base, 'base_version_id':updated['version_id']}
            exported = api(root+'export', {**base, 'request_id':'export'})['markdown']
            assert 'PRIVATE-SOURCE' not in exported and source['task_id'] not in exported
            imported = api(f'/api/projects/{other}/skills/import', {'request_id':'import', 'markdown':exported, 'confirmed':True})
            assert imported['id'] != skill['id'] and imported['fields'] == updated['fields']
            rejects(root+'import', {'request_id':'bad-import', 'markdown':'---\nname: ../../secret\n---\ncode', 'confirmed':True})
            shared = api(root+'share', {**base, 'request_id':'share'})
            url = '/api/skills/shared/'+shared['share_token']
            assert api(url) == exported
            api(root+'revoke', {**base, 'request_id':'revoke'})
            rejects(url)
            api(root+'archive', {**base, 'request_id':'archive'})
            try:
                service.message(other, conv2, {'text':prompt, 'client_message_id':'archived'}, schedule=False)
                raise AssertionError('archived skill accepted')
            except ValueError:
                pass
            api(root+'restore', {**base, 'request_id':'restore'})
            copied = api(root+'copy', {**base, 'fields':FIELDS, 'request_id':'copy'})
            assert copied['id'] != skill['id']
            api(root+'delete', {'id':copied['id'], 'base_version_id':copied['version_id'], 'request_id':'delete'})
            assert all(s['id'] != copied['id'] for s in api('/api/skills'))
            service.close()
            service = Service(Path(directory)/'empty', Path(directory))
            handler.service = service
            assert any(s['id'] == skill['id'] and s['version_no'] == 2 for s in api('/api/skills'))
            assert service.store.task(sent['task_id'])['refs']['personal_skill'] == task['refs']['personal_skill']
            rejects(url)
            print('PASS: draft/confirm, native frozen Skill loading, cross-project reuse, temporary edits, versions, duplicate/conflict protection, import/export, share/revoke, archive/copy/delete and restart')
            print('Controlled provider requests:', len(REQUESTS))
        finally:
            service.close()
            server.shutdown()
            server.server_close()
    provider.shutdown()
    provider.server_close()


if __name__ == '__main__':
    main()
