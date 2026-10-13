"""Run: python -m backend.check_collaboration (real HTTP/SQLite, local Auth fixture)."""
import json
import os
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from .app import Handler, Service
from .auth import client_address, AuthError
from .check_support import temporary_directory
from .state import Store, json_text, new_id


def check_models(service, request, project, users, owner, member, outsider):
    settings, store = service.research.settings, service.store
    workspace = service.collaboration.project(users['owner@example.com'], project)['workspace_id']
    base = '/api/workspaces/' + workspace + '/model-settings'
    project_url = '/api/projects/' + project + '/model-settings'
    config = {'name': '团队隔离检查', 'base_url': 'https://api.deepseek.com', 'model': 'fixture-model', 'protocol': 'deepseek', 'api_key': 'TEAM_MODEL_SECRET_CANARY'}
    assert request(base, cookie=member)[0] == 403
    assert request(base + '/save', config, member)[0] == 403
    assert request(base + '/save', {**config, 'base_url': 'http://127.0.0.1:8765'}, owner)[0] == 403
    status, saved, _ = request(base + '/save', config, owner)
    assert status == 200 and config['api_key'] not in json_text(saved), saved
    ident = next(c['id'] for c in saved['connections'] if c['name'] == config['name'])
    assert ident not in {c['id'] for c in request(project_url, cookie=member)[1]['connections']}
    conversation = store.conversations(project)[0]['id']
    preference_url = '/api/projects/' + project + '/conversations/' + conversation + '/preferences'
    assert request(preference_url, {'connection_id': ident}, member)[0] == 403
    grant = {'project_id': project, 'connection_id': ident, 'enabled': True, 'default': True}
    assert request(base + '/grant', grant, member)[0] == 403
    assert request(base + '/grant', grant, owner)[0] == 200
    assert request(preference_url, {'connection_id': ident}, member)[0] == 200
    visible = request(project_url, cookie=member)[1]
    assert visible['default_id'] == ident and config['api_key'] not in json_text(visible)
    assert request(project_url, cookie=outsider)[0] == 403
    other_workspace = request('/api/workspaces', {'name': '独立团队'}, outsider)[1]['id']
    other_base = '/api/workspaces/' + other_workspace + '/model-settings'
    foreign = request(other_base + '/save', {**config, 'api_key': 'FOREIGN_MODEL_SECRET_CANARY'}, outsider)[1]
    foreign_id = foreign['default_id']
    assert ident not in {c['id'] for c in foreign['connections']}
    assert request(other_base + '/save', {**config, 'id': ident}, outsider)[0] == 400
    assert request(other_base + '/grant', {**grant, 'connection_id': foreign_id}, outsider)[0] == 403
    assert request(base + '/grant', {**grant, 'connection_id': foreign_id}, owner)[0] == 403
    assert request(preference_url, {'connection_id': foreign_id}, member)[0] == 403
    task = service.writing.task(project, '固定团队模型检查', 'running', conversation, user=users['member@example.com'])
    bound = task['refs']['model_config']
    assert bound['workspace_id'] == workspace and bound['connection_id'] == ident
    assert settings.for_task(task)[0]['api_key'] == config['api_key']
    request(base + '/save', {**config, 'id': ident, 'api_key': 'ROTATED_MODEL_SECRET_CANARY'}, owner)
    assert settings.for_task(task)[0]['api_key'] == config['api_key'], 'running task switched model version'
    assert settings.redact('TEAM_MODEL_SECRET_CANARY FOREIGN_MODEL_SECRET_CANARY ROTATED_MODEL_SECRET_CANARY') == '[redacted] [redacted] [redacted]'
    with patch.object(service.collaboration, 'event', side_effect=RuntimeError('controlled activity write failure')):
        assert request(base + '/grant', {**grant, 'enabled': False}, owner)[0] == 500
    assert store.task(task['id'])['status'] == 'running', 'failed grant transaction stopped the run'
    assert ident in {c['id'] for c in request(project_url, cookie=member)[1]['connections']}, 'failed event write revoked access'
    assert request(base + '/grant', {**grant, 'enabled': False}, owner)[0] == 200
    assert store.task(task['id'])['status'] == 'stopped' and store.task(task['id'])['revision'] == task['revision'] + 1
    try:
        settings.for_task(task)
    except PermissionError:
        pass
    else:
        raise AssertionError('revoked model snapshot remained executable')
    assert request(base + '/grant', grant, owner)[0] == 200
    assert store.task(task['id'])['status'] == 'stopped'
    pending = service.writing.task(project, '删除连接时停止运行', 'running', conversation, user=users['member@example.com'])
    assert request(base + '/delete', {'id': ident}, owner)[0] == 200
    assert store.task(pending['id'])['status'] == 'stopped'
    assert ident not in {c['id'] for c in request(project_url, cookie=member)[1]['connections']}
    default = settings.for_workspace(workspace).data['default_id']
    assert request(base + '/grant', {'project_id': project, 'connection_id': default, 'enabled': True, 'default': True}, owner)[0] == 200
    assert request(preference_url, {'connection_id': None}, member)[0] == 200
    team_limits = '/api/workspaces/' + workspace + '/resource-limits'
    project_limits = '/api/projects/' + project + '/resource-limits'
    assert request(team_limits, cookie=member)[0] == 403
    assert request(project_limits, cookie=outsider)[0] == 403
    assert request(project_limits, {'parallel_runs': 1}, member)[0] == 403
    assert request(project_limits, {'parallel_runs': True}, owner)[0] == 400
    assert request(team_limits, {'parallel_runs': 2}, owner)[0] == 200
    status, limits, _ = request(project_limits, {'parallel_runs': 3}, owner)
    assert status == 200 and limits['effective_parallel_runs'] == 2, limits
    assert request(project_limits, cookie=member)[1]['usage_scope'] == 'self'
    assert request(team_limits, {'parallel_runs': 5}, owner)[0] == 200
    assert request(project_limits, {'parallel_runs': 5}, owner)[0] == 200
    print('PASS: workspace model isolation, owner-only configuration, explicit project grants, frozen secret snapshots, revocation/deletion fences and credential redaction')


def check_work(service, request, root, project, users, owner, member, outsider):
    """HTTP boundaries including actual concurrent edits, private links and rollback."""
    store = service.store
    owner_id, member_id = users['owner@example.com']['id'], users['member@example.com']['id']
    endpoint = root + '/work-items'
    status, data, _ = request(endpoint, {'title': '比较基线', 'assignee': member_id, 'due_date': '2026-10-20'}, owner)
    assert status == 201, data
    item = data['item']; ident = item['id']; path = endpoint + '/' + ident
    assert item['revision'] == 1 and item['creator'] == owner_id
    assert request(endpoint, cookie=outsider)[0] == 403
    assert request(path + '/history', cookie=outsider)[0] == 403
    assert request(endpoint, {'title': 'bad', 'creator': member_id}, owner)[0] == 400
    assert request(endpoint, {'title': 'bad', 'assignee': users['outsider@example.com']['id']}, owner)[0] == 400
    assert request(endpoint, {'title': 'bad', 'due_date': '2026-02-30'}, owner)[0] == 400
    notice = request(root + '/notifications', cookie=member)[1]['notifications'][0]
    assert notice['entity_id'] == ident and not notice['read_at']
    request(root + '/notifications/read', {'ids': [notice['id']]}, owner)
    assert not request(root + '/notifications', cookie=member)[1]['notifications'][0]['read_at']
    assert request(root + '/notifications/read', {'ids': [notice['id']]}, member)[1]['notifications'][0]['read_at']
    with ThreadPoolExecutor(max_workers=2) as pool:
        updates = list(pool.map(lambda cookie: request(path, {'revision': 1, 'description': '并发修改'}, cookie), [owner, member]))
    assert sorted(r[0] for r in updates) == [200, 409], updates
    latest = request(path, cookie=member)[1]['item']
    assert latest['revision'] == 2
    assert len(request(path + '/history', cookie=member)[1]['history']) == 2
    assert request(path, {'revision': 2, 'status': 'done'}, member)[0] == 200
    owned = request(endpoint, {'title': '仅负责人可完成', 'assignee': owner_id}, owner)[1]['item']
    assert request(endpoint + '/' + owned['id'], {'revision': 1, 'status': 'done', 'assignee': member_id}, member)[0] == 403, 'self assignment bypassed completion authority'
    assert request(endpoint + '/' + owned['id'], {'revision': 1, 'status': 'done'}, member)[0] == 403

    paper = store.paste(project, '任务依据', '一条真实研究依据。')
    document = service.writing.save(project, None, {'request_id': 'work-links', 'title': '比较结果', 'document': [{'id': 'intro', 'type': 'p', 'children': [{'text': '保留证据。'}]}]})
    run = store.one('SELECT task_id FROM artifact_versions WHERE id=?', (document['version_id'],))['task_id']
    conversation = store.task(run)['conversation_id']
    group = new_id('group')
    store.run('INSERT INTO experiment_groups VALUES(?,?,?)', (group, project, json_text({'id': group, 'project_id': project, 'conversation_id': conversation, 'status': 'completed', 'spec': {'title': '基线实验', 'server': {'id': 'historical-server', 'name': '历史服务器'}, 'connection': {'username': 'research', 'host': 'example.com', 'port': 22}, 'directory': '/research', 'gpu_devices': [], 'steps': []}, 'completed_steps': [], 'changes': [], 'runs': []})))
    links = [{'kind': 'paper', 'id': paper}, {'kind': 'artifact', 'id': document['artifact_id'], 'version_id': document['version_id']}, {'kind': 'run', 'id': run}, {'kind': 'experiment', 'id': group}]
    status, data, _ = request(endpoint, {'title': '证据关系', 'links': links}, member)
    assert status == 201 and len(data['item']['links']) == 4, data
    linked = data['item']['id']
    # Reverse navigation preserves pinned evidence and authorizes the target first.
    def related(link, cookie=member):
        from urllib.parse import urlencode
        query = {'related_kind': link['kind'], 'related_id': link['id']}
        if link.get('version_id'):
            query['related_version'] = link['version_id']
        return request(endpoint + '?' + urlencode(query), cookie=cookie)
    for link in links:
        assert [i['id'] for i in related(link)[1]['items']] == [linked]
        assert related(link, outsider)[0] == 403
    assert [i['id'] for i in related({'kind':'artifact','id':document['artifact_id']})[1]['items']] == [linked]
    assert request(endpoint + '?related_kind=paper', cookie=member)[0] == 400
    assert related({'kind':'paper','id':paper,'version_id':'unknown'})[0] == 403
    second = service.writing.save(project, document['artifact_id'], {'request_id':'work-links-v2','base_version_id':document['version_id'],'title':'新比较结果','document':[{'id':'intro','type':'p','children':[{'text':'新证据。'}]}]})
    assert second['version_id'] != document['version_id']
    assert request(endpoint + '/' + linked, cookie=member)[1]['item']['links'][1]['title'] == '比较结果'
    assert related({'kind':'artifact','id':document['artifact_id'],'version_id':second['version_id']})[1]['items'] == []
    broad = request(endpoint, {'title':'追踪整个成果','links':[{'kind':'artifact','id':document['artifact_id']}]}, member)[1]['item']
    assert {i['id'] for i in related(links[1])[1]['items']} == {linked,broad['id']}
    assert [i['id'] for i in related({'kind':'artifact','id':document['artifact_id'],'version_id':second['version_id']})[1]['items']] == [broad['id']]
    other_project = next(p['id'] for p in store.projects() if p['id'] != project)
    foreign = store.paste(other_project, '保密资料', '不能共享')
    assert related({'kind':'paper','id':foreign})[0] == 403
    assert request(endpoint, {'title': '跨项目引用', 'links': [{'kind': 'paper', 'id': foreign}]}, member)[0] == 403
    assert request(endpoint, {'title': '伪造版本', 'links': [{'kind': 'artifact', 'id': document['artifact_id'], 'version_id': 'unknown'}]}, member)[0] == 403
    store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')", (document['artifact_id'], owner_id))
    store.run("INSERT OR REPLACE INTO conversation_scopes VALUES(?,?,'private')", (conversation, owner_id))
    for link in links[1:]:
        assert request(endpoint, {'title': '私人关联', 'links': [link]}, owner)[0] == 403, link
        assert related(link, owner)[0] == related(link, member)[0] == 403
    candidates = request(endpoint + '/candidates', cookie=owner)[1]['candidates']
    assert all(c['id'] not in (run, group, document['artifact_id']) for c in candidates)
    hidden = request(endpoint + '/' + linked, cookie=member)[1]['item']['links']
    assert hidden[1:] == [{'unavailable': True}] * 3, hidden
    history = request(endpoint + '/' + linked + '/history', cookie=member)[1]['history']
    assert history[0]['item']['links'][1:] == [{'unavailable': True}] * 3
    # Failing a later link leaves neither an item, history nor assignment notification.
    counts = [store.one(f'SELECT COUNT(*) AS n FROM {table}')['n'] for table in ('work_items', 'work_item_history', 'project_notifications')]
    assert request(endpoint, {'title': '原子失败', 'assignee': member_id, 'links': [links[0], links[1]]}, owner)[0] == 403
    assert counts == [store.one(f'SELECT COUNT(*) AS n FROM {table}')['n'] for table in ('work_items', 'work_item_history', 'project_notifications')]
    # Restore only test scope, keeping the standard authentication checks independent.
    store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?", (document['artifact_id'],))
    store.run("UPDATE conversation_scopes SET visibility='shared' WHERE conversation_id=?", (conversation,))
    fields = {key: '人工确认的通用研究方法' for key in ('name', 'description', 'scenarios', 'inputs', 'steps', 'template', 'example')}
    body = {'request_id': 'same-request-per-account', 'fields': fields, 'confirmed': True}
    first = request(root + '/skills/save', body, owner)
    second = request(root + '/skills/save', body, member)
    assert first[0] == second[0] == 200, (first, second)
    assert first[1]['id'] != second[1]['id'], 'cross-account idempotency exposed another personal skill'
    assert [s['id'] for s in request('/api/skills', cookie=owner)[1]] == [first[1]['id']]
    assert [s['id'] for s in request('/api/skills', cookie=member)[1]] == [second[1]['id']]
    assert request('/api/skills', cookie=outsider)[1] == []
    assert request(root + '/skills/delete', {'request_id': 'steal', 'id': first[1]['id'], 'base_version_id': first[1]['version_id']}, member)[0] == 403
    assert request(root + '/artifacts/' + first[1]['id'], cookie=member)[0] == 403
    skill_run = store.one('SELECT task_id FROM artifact_versions WHERE id=?', (first[1]['version_id'],))['task_id']
    assert request(root + '/tasks/' + skill_run, cookie=member)[0] == 403
    assert request(endpoint, {'title': '私人方法运行', 'links': [{'kind': 'run', 'id': skill_run}]}, owner)[0] == 403
    try:
        service.skills.bind(first[1]['version_id'], users['member@example.com'])
    except PermissionError:
        pass
    else:
        raise AssertionError('another member bound private Skill text')
    print('PASS: shared research work, assignment notifications, immutable history, atomic concurrent edits, completion authority, project/private evidence isolation')


def main():
    assert client_address('198.51.100.10', '203.0.113.9', True) == '198.51.100.10'
    assert client_address('127.0.0.1', '203.0.113.9') == '127.0.0.1'
    assert client_address('127.0.0.1', '203.0.113.9', True) == '203.0.113.9'
    try:
        client_address('127.0.0.1', '203.0.113.9, 198.51.100.10', True)
    except AuthError:
        pass
    else:
        raise AssertionError('proxy address list accepted')
    users = {f'{name}@example.com': {'id': str(uuid.uuid4()), 'email': f'{name}@example.com', 'email_confirmed_at': '2026-10-02T00:00:00Z'} for name in ('owner', 'member', 'outsider')}
    sessions = {}

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, data):
            raw = json.dumps(data).encode()
            self.send_response(status)
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            user = sessions.get(self.headers.get('Authorization', '').removeprefix('Bearer '))
            self.reply(200, user) if user else self.reply(401, {'error': 'invalid token'})

        def do_POST(self):
            assert self.headers.get('X-MethodAtlas-Client-IP') == '127.0.0.1'
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            if self.path == '/otp':
                return self.reply(200, {})
            if self.path == '/logout':
                sessions.pop(self.headers.get('Authorization', '').removeprefix('Bearer '), None)
                return self.reply(200, {})
            if self.path == '/verify' and body.get('token') == '123456' and body.get('email') in users:
                token = uuid.uuid4().hex
                sessions[token] = users[body['email']]
                return self.reply(200, {'access_token': token, 'refresh_token': 'fixture-refresh', 'expires_in': 3600})
            return self.reply(401, {'error': 'wrong code'})

    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    old_env = {k: os.environ.get(k) for k in ('METHODATLAS_AUTH_URL', 'METHODATLAS_LEGACY_OWNER_EMAIL', 'METHODATLAS_PUBLIC_URL')}
    os.environ.update(METHODATLAS_AUTH_URL=f'http://127.0.0.1:{provider.server_port}', METHODATLAS_LEGACY_OWNER_EMAIL='owner@example.com', METHODATLAS_PUBLIC_URL='')
    try:
        with temporary_directory() as directory:
            legacy = Store(Path(directory) / 'data' / 'methodatlas.sqlite3')
            try:
                legacy.create_project('Existing offline research')
            finally:
                legacy.close()
            service = Service(Path(directory) / 'pdf', Path(directory) / 'data')
            # This fixture exercises collaboration, not unattended real-model generation.
            service.progress.close()
            service.subscriptions.close()
            http = ThreadingHTTPServer(('127.0.0.1', 0), type('TestHandler', (Handler,), {'service': service}))
            threading.Thread(target=http.serve_forever, daemon=True).start()
            base = f'http://127.0.0.1:{http.server_port}'

            def request(path, body=None, cookie='', origin=base):
                headers = {'Content-Type': 'application/json', 'Origin': origin}
                if cookie:
                    headers['Cookie'] = cookie
                req = Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
                try:
                    response = urlopen(req, timeout=15)
                except HTTPError as exc:
                    response = exc
                with response:
                    return response.status, json.load(response), response.headers

            def login(email):
                status, data, headers = request('/api/auth/verify', {'email': email, 'code': '123456'})
                assert status == 200, data
                cookies = headers.get_all('Set-Cookie')
                assert all('HttpOnly' in c and 'SameSite=Lax' in c for c in cookies)
                assert 'access_token' not in json.dumps(data)
                return '; '.join(c.split(';', 1)[0] for c in cookies)

            try:
                assert request('/api/state')[0] == 401
                assert request('/api/auth/verify', {'email': 'owner@example.com', 'code': '000000'})[0] == 401
                outsider = login('outsider@example.com')
                assert request('/api/state', cookie=outsider)[1]['projects'] == [], 'first random account claimed legacy data'
                owner = login('owner@example.com')
                member = login('member@example.com')
                initial = request('/api/state', cookie=owner)[1]
                assert len(initial['projects']) == 1
                assert request('/api/projects/' + initial['projects'][0]['id'], cookie=outsider)[0] == 403
                assert request('/api/projects', {'name': 'CSRF'}, owner, origin='https://evil.example')[0] == 403
                status, made, _ = request('/api/projects', {'name': 'Shared research'}, owner)
                assert status == 201, made
                project = made['project_id']
                root = '/api/projects/' + project
                workspace = service.collaboration.project(users['owner@example.com'], project)['workspace_id']
                models = service.research.settings.for_workspace(workspace)
                configured = models.save({'name': '受控测试模型', 'base_url': 'https://api.deepseek.com', 'model': 'fixture', 'protocol': 'deepseek', 'api_key': 'fixture-only-key'})
                models.grant(project, {'connection_id': configured['default_id'], 'enabled': True}, users['owner@example.com'])
                invite = request(root + '/invite', {'email': 'member@example.com'}, owner)[1]
                assert 'token' in invite, invite
                assert service.store.one('SELECT token_hash FROM project_invitations WHERE id=?', (invite['id'],))['token_hash'] != invite['token']
                assert request('/api/invitations/accept', {'token': invite['token']}, outsider)[0] == 403
                assert request('/api/invitations/accept', {'token': invite['token']}, member)[0] == 200
                assert request('/api/invitations/accept', {'token': invite['token']}, member)[0] == 200
                assert len(request(root + '/members', cookie=member)[1]['members']) == 2
                before_rename = request(root, cookie=owner)[1]
                assert request(root + '/rename', {'name': '  共脑研究  '}, member)[0] == 403
                assert request(root + '/rename', {'name': '越权'}, outsider)[0] == 403
                for name in ('', ' ', '名' * 301, 42):
                    assert request(root + '/rename', {'name': name}, owner)[0] == 400
                status, renamed, _ = request(root + '/rename', {'name': '  共脑研究  '}, owner)
                assert status == 200, renamed
                after_rename = request(root, cookie=member)[1]
                assert after_rename['id'] == project and after_rename['name'] == '共脑研究'
                assert after_rename['papers'] == before_rename['papers']
                assert [c['id'] for c in after_rename['conversations']] == [c['id'] for c in before_rename['conversations']]
                assert next(p for p in request('/api/state', cookie=owner)[1]['projects'] if p['id'] == project)['name'] == '共脑研究'
                assert request(root + '/manage/archive', {}, owner)[0] == 200
                assert request(root + '/rename', {'name': '归档研究'}, owner)[0] == 200
                assert request(root + '/manage/unarchive', {}, owner)[0] == 200
                assert request(root + '/rename', {'name': 'Shared research'}, owner)[0] == 200
                assert request(root + '/invite', {'email': 'outsider@example.com'}, member)[0] == 403
                assert [p['id'] for p in request('/api/state', cookie=member)[1]['projects']] == [project]
                assert len(request('/api/state', cookie=owner)[1]['projects']) == 2
                assert request(root + '/manage/remove-member', {'user_id': users['owner@example.com']['id']}, owner)[0] == 400
                check_models(service, request, project, users, owner, member, outsider)
                check_work(service, request, root, project, users, owner, member, outsider)
                from .check_notifications import check as check_notifications
                check_notifications(service, request, root, project, users, owner, member, outsider)
                from .check_project_knowledge import check as check_knowledge
                check_knowledge(service, request, root, project, users, owner, member, outsider)
                from .check_activity import check as check_activity
                check_activity(service, request, root, project, users, owner, member, outsider)
                from .check_experiment_records import check as check_experiment_records
                check_experiment_records(service, request, root, project, users, owner, member, outsider)
                if '--copilot' in sys.argv:
                    from .check_project_copilot import check
                    check(service, project, users)
                from .check_comments import check_comments
                check_comments(service, request, root, project, users, owner, member, outsider)
                from .check_privacy import check_privacy
                check_privacy(service, request, root, project, users, owner, member)
                from .check_publication import check as check_publication
                check_publication(service, request, root, project, users, owner, member, outsider)
                from .check_collaborative_reviews import check as check_reviews
                check_reviews(service, request, root, project, users, owner, member, outsider)
                from .check_mail import check as check_mail
                check_mail(service, request, root, project, users, owner, member, outsider)
                from .check_integrated_collaboration import check as check_integrated
                check_integrated(service, request, root, project, users, owner, member, outsider)
                if '--servers' in sys.argv:
                    from .check_server_resources import check_http
                    check_http(service, request, project, users, owner, member, outsider)
                if '--browser' in sys.argv:
                    if '--mail-browser' in sys.argv:
                        from .check_mail import Transport
                        from .mail import ProjectMail
                        service.mail = ProjectMail(service,Transport())
                        service.mail.start()
                    seconds = int(next((arg.split('=',1)[1] for arg in sys.argv if arg.startswith('--browser-seconds=')), '900'))
                    if not 1 <= seconds <= 3600:
                        raise ValueError('Browser fixture duration must be 1–3600 seconds')
                    print(f'Browser fixture: {base} (owner@example.com / member@example.com, code 123456); closes after {seconds} seconds.', flush=True)
                    threading.Event().wait(seconds)
                # Concurrent reads must keep identities separate, including empty outsider lists.
                with ThreadPoolExecutor(max_workers=12) as pool:
                    results = list(pool.map(lambda c: request('/api/state', cookie=c)[1]['projects'], [owner, member, outsider] * 10))
                assert [len(p) for p in results] == [2, 1, 0] * 10
                assert request(root + '/manage/remove-member', {'user_id': users['member@example.com']['id']}, owner)[0] == 200
                assert request(root, cookie=member)[0] == 403, 'existing session retained project access'
                assert request(root + '/work-items', cookie=member)[0] == 403
                assert request(root + '/notifications', cookie=member)[0] == 403
                retained_skills = request('/api/skills', cookie=member)[1]
                assert len(retained_skills) == 1 and retained_skills[0]['source'] == {'unavailable': True}
                assert request('/api/invitations/accept', {'token': invite['token']}, member)[0] == 403, 'old invitation re-added removed member'
                invite = request(root + '/invite', {'email': 'member@example.com'}, owner)[1]
                assert request('/api/invitations/accept', {'token': invite['token']}, member)[0] == 200
                assert request(root + '/manage/transfer', {'user_id': users['member@example.com']['id']}, owner)[0] == 200
                assert request(root + '/manage/archive', {}, owner)[0] == 403
                assert request(root + '/manage/archive', {}, member)[0] == 200
                assert request(root + '/materials', {'title': 'blocked', 'text': 'archived'}, owner)[0] == 403
                assert request(root + '/work-items', {'title': 'blocked'}, owner)[0] == 403
                assert request(root + '/manage/unarchive', {}, member)[0] == 200
                assert request('/api/auth/logout', {}, outsider)[0] == 200
                assert request('/api/state', cookie=outsider)[0] == 401
                print('PASS: HTTP authentication, secure cookies, CSRF, legacy ownership, project isolation, invitations, revocation, transfer, archive and concurrent identities')
            finally:
                http.shutdown()
                http.server_close()
                service.close()
    finally:
        provider.shutdown()
        provider.server_close()
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == '__main__':
    main()
