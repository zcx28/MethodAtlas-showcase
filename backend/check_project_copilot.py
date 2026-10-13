"""Shared task tools, checked through the collaboration fixture and real Harness."""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from .agent import ProjectTools
from .errors import AppError
from .state import json_text, new_id


def check(service, project, users):
    store, access, work = service.store, service.collaboration, service.project_work
    owner, member = users['owner@example.com'], users['member@example.com']
    conversation = access.work_context(owner, project)
    task = service.writing.task(project, '创建分页测试任务，分配给协作者', 'running', conversation, user=owner)
    tools = ProjectTools(store, task)
    args = {'request_id': 'copilot-create', 'changes': {'title': 'Copilot work check', 'description': 'x' * 900, 'assignee': member['id']}}
    result = tools.call('save_project_work', args)
    ident = result['item']['id']
    assert result['item']['creator'] == owner['id'] and result['item']['revision'] == 1
    assert any(link['kind'] == 'run' and link['id'] == task['id'] for link in result['item']['links'])
    assert tools.call('save_project_work', args)['duplicate']
    assert len(work.history(owner, project, ident)) == 1
    assert store.one('SELECT COUNT(*) AS n FROM project_notifications WHERE entity_id=?', (ident,))['n'] == 1
    event = store.one('SELECT data FROM activity_events WHERE entity_id=?', (ident,))
    assert json.loads(event['data'])['task_id'] == task['id']
    found = tools.call('list_project_work', {'query': 'Copilot work check', 'status': 'open', 'limit': 1})
    assert found['total'] == 1 and found['items'][0]['description_truncated']
    assert len(found['items'][0]['description']) == 800
    assert len(tools.call('read_project_work', {'item_id': ident})['item']['description']) == 900
    assert tools.call('list_project_work', {'assignee': 'me', 'query': 'Copilot work check'})['total'] == 0
    linked = store.one("SELECT id FROM work_items WHERE project_id=? AND title='证据关系'", (project,))['id']
    shared_links = tools.call('read_project_work', {'item_id': linked})['item']['links']
    artifact = next(link['id'] for link in shared_links if link['kind'] == 'artifact')
    store.run("UPDATE artifact_scopes SET visibility='private' WHERE artifact_id=?", (artifact,))
    try:
        assert {'unavailable': True} in tools.call('read_project_work', {'item_id': linked})['item']['links'], 'read cache exposed a newly private link'
    finally:
        store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?", (artifact,))
    other_project = next(p['id'] for p in store.projects() if p['id'] != project)
    foreign = work.save(owner, other_project, None, {'title': 'OTHER_PROJECT_CANARY'})
    try:
        tools.call('read_project_work', {'item_id': foreign['id']})
    except AppError as error:
        assert error.code == 'not_found'
    else:
        raise AssertionError('cross-project task read accepted')
    other = work.save(owner, project, None, {'title': 'Copilot work check second'})
    page = tools.call('list_project_work', {'query': 'Copilot work check', 'limit': 1})
    assert page['next_offset'] == 1 and page['total'] == 2
    assert tools.call('list_project_work', {'query': 'Copilot work check', 'limit': 1, 'offset': 1})['items'][0]['id'] == other['id']
    work.save(member, project, ident, {'revision': 1, 'description': 'Human change'})
    try:
        tools.call('save_project_work', {'request_id': 'stale-edit', 'item_id': ident, 'revision': 1, 'changes': {'description': 'lost update'}})
    except AppError as error:
        assert error.code == 'conflict'
    else:
        raise AssertionError('AI overwrote human edit')
    # Exact retries retain the original result and do not undo later human changes.
    duplicate = tools.call('save_project_work', args)
    assert duplicate['item']['revision'] == 1 and duplicate['current_revision'] == 2
    assert work.get(owner, project, ident)['description'] == 'Human change'
    for bad in ({**args, 'changes': {'title': 'changed request'}},
                {'request_id': 'complete', 'item_id': ident, 'revision': 2, 'changes': {'status': 'done'}}):
        try:
            work.agent_save(task, **bad)
        except (AppError, PermissionError):
            pass
        else:
            raise AssertionError('AI bypassed completion or idempotency rule')
    with patch.object(access, 'event', side_effect=RuntimeError('activity write failed')):
        try:
            work.agent_save(task, 'rollback', {'title': 'must rollback'})
        except RuntimeError:
            pass
        else:
            raise AssertionError('write failure did not propagate')
    assert not store.one("SELECT 1 FROM work_items WHERE title='must rollback'")
    assert not store.one('SELECT 1 FROM file_commits WHERE task_id=? AND call_id=?', ('project-work:' + task['id'], 'rollback'))
    # Lose the tool response after the business transaction commits, then resume.
    original_event = store.event
    def lose_response(ident, status, *args):
        if status == 'tool_done':
            raise RuntimeError('lost tool response')
        return original_event(ident, status, *args)
    update = {'request_id': 'recover-update', 'item_id': ident, 'revision': 2, 'changes': {'priority': 'high'}}
    with patch.object(store, 'event', lose_response):
        try:
            tools.call('save_project_work', update)
        except RuntimeError:
            pass
        else:
            raise AssertionError('failure injection did not fire')
    store.run('UPDATE tasks SET revision=revision+1 WHERE id=?', (task['id'],))
    task = store.task(task['id'])
    tools = ProjectTools(store, task)
    assert tools.call('save_project_work', update)['duplicate']
    assert work.get(owner, project, ident)['revision'] == 3
    private = store.create_conversation(project)
    store.run("INSERT INTO conversation_scopes VALUES(?,?,'private')", (private, owner['id']))
    private_task = service.writing.task(project, '私人探索', 'running', private, user=owner)
    private_tools = ProjectTools(store, private_task)
    assert 'save_project_work' not in {t[0] for t in private_tools.definitions}
    assert private_tools.call('read_project_work', {'item_id': ident})['item']['id'] == ident
    try:
        work.agent_save(private_task, 'private-leak', {'title': 'PRIVATE_CANARY'})
    except PermissionError:
        pass
    else:
        raise AssertionError('private research published a shared task')
    # A former member cannot retrieve previously successful operations.
    with store.transaction() as db:
        db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?', (project, owner['id']))
        try:
            tools.call('save_project_work', args)
        except PermissionError:
            pass
        else:
            raise AssertionError('revoked actor consumed operation receipt')
        db.execute("INSERT INTO project_members VALUES(?,?,'owner')", (project, owner['id']))
    for run in (task, private_task):
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?", (run['id'],))
    harness(service, project, owner, member)
    print('PASS: Copilot work search/pagination, trusted mutations, CAS, completion authority, durable retry, privacy, revocation and actual Harness tool loop')


def harness(service, project, owner, member):
    calls, stage = [], [0]
    records = service.remote.groups.records
    group = records.create(owner,project,{'request_id':'harness-experiments','title':'Harness experiment comparison'})
    selections = []
    for index,value in enumerate((80,82)):
        saved = records.save(owner,project,group['id'],'new',{'request_id':'harness-run-'+str(index),'revision':0,'fields':{'title':'Harness run '+str(index),'status':'completed','dataset':'benchmark','dataset_version':'v1','split':'test','evaluation':'top1','metrics':{'accuracy':value},'metric_units':{'accuracy':'percent'},'metric_directions':{'accuracy':'higher'}}})
        selections.append({'group_id':group['id'],'run_id':saved['saved']['entity_id']})
    evidence = service.progress.record(project, {'request_id':'harness-knowledge-source','kind':'idea','text':'需要按相同评估条件复核实验。'},user=owner)
    knowledge = service.progress.record(project, {'request_id':'harness-knowledge','kind':'decision','text':'Knowledge harness conclusion：仍需复核实验。','sources':[evidence['id']],'confirmed':True},user=member)
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(body)
            action = None
            if not body.get('tools'):
                message = {'role': 'assistant', 'content': json_text({'intent': 'research', 'mode': 'explore', 'only_selected': False, 'reason': '读取并修改项目研究任务'})}
            else:
                names = {t['function']['name'] for t in body['tools']}
                assert 'mcp__methodatlas__save_project_work' in names
                current = service.store.one("SELECT id,revision FROM work_items WHERE project_id=? AND title='Harness shared task'", (project,))
                if stage[0] == 0:
                    action = ('list_project_work', {'status': 'open'})
                elif stage[0] == 1:
                    action = ('save_project_work', {'request_id': 'harness-create', 'changes': {'title': 'Harness shared task', 'assignee': member['id']}})
                elif stage[0] == 2:
                    assert current
                    action = ('read_project_work', {'item_id': current['id']})
                elif stage[0] == 3:
                    action = ('save_project_work', {'request_id': 'harness-update', 'item_id': current['id'], 'revision': current['revision'], 'changes': {'status': 'doing'}})
                elif stage[0] == 4:
                    assert 'mcp__methodatlas__list_project_knowledge' in names
                    action = ('list_project_knowledge', {'state':'confirmed','query':'Knowledge harness conclusion'})
                elif stage[0] == 5:
                    assert 'Knowledge harness conclusion' in json_text(body['messages'])
                    action = ('read_project_knowledge', {'record_id':knowledge['id']})
                elif stage[0] == 6:
                    assert 'mcp__methodatlas__list_project_activity' in names
                    action = ('list_project_activity', {'query':'Harness shared task','actor':owner['id']})
                elif stage[0] == 7:
                    assert 'mcp__methodatlas__read_experiment_group' in names
                    action = ('read_experiment_group', {'group_id':group['id']})
                elif stage[0] == 8:
                    assert 'mcp__methodatlas__compare_experiment_runs' in names
                    assert 'member_reported' in json_text(body['messages'])
                    action = ('compare_experiment_runs', {'selections':selections})
                if action:
                    name, args = action
                    message = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'copilot-' + str(stage[0]), 'type': 'function', 'function': {'name': 'mcp__methodatlas__' + name, 'arguments': json_text(args)}}]}
                else:
                    assert 'best_runs' in json_text(body['messages']) and 'member_reported' in json_text(body['messages'])
                    assert 'confirmed_by' in json_text(body['messages']) and member['id'] in json_text(body['messages'])
                    message = {'role': 'assistant', 'content': '已创建共享研究任务、分配给协作者并设为进行中，尚未确认完成。项目知识中协作者已确认仍需复核实验，保留原研究依据。'}
                stage[0] += 1
            chunks = [{'id': 'copilot-' + str(len(calls)), 'choices': [{'index': 0, 'delta': message, 'finish_reason': None}]},
                      {'id': 'copilot-' + str(len(calls)), 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if action else 'stop'}], 'usage': {'prompt_tokens': 100, 'completion_tokens': 30, 'total_tokens': 130}}]
            raw = (''.join('data: ' + json.dumps(c) + '\n\n' for c in chunks) + 'data: [DONE]\n\n').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    models = service.research.settings.for_project(project)
    previous = service.research.settings.view(project)['default_id']
    connection = None
    try:
        with patch.dict(os.environ, {'METHODATLAS_MODEL_HOSTS': '127.0.0.1'}):
            saved = models.save({'name': 'Copilot local provider', 'base_url': f'http://127.0.0.1:{provider.server_port}', 'model': 'fixture', 'protocol': 'deepseek', 'api_key': 'fixture'})
        connection = next(c['id'] for c in saved['connections'] if c['name'] == 'Copilot local provider')
        # This provider deliberately implements the tool protocol; the loop below proves it.
        models.data['connections'][connection]['tools'] = True
        models.write()
        models.grant(project, {'connection_id': connection, 'enabled': True, 'default': True}, owner)
        conversation = service.store.create_conversation(project)
        run = service.message(project, conversation, {'text': '创建一个共享研究任务，分配给协作者并设为进行中', 'client_message_id': new_id('request')}, user=owner)
        end = time.monotonic() + 90
        while time.monotonic() < end:
            task = service.store.task(run['task_id'])
            if task['status'] in ('succeeded', 'failed', 'stopped'):
                break
            time.sleep(.1)
        assert task['status'] == 'succeeded', (task.get('error'), (service.store.root / 'logs' / 'errors.jsonl').read_text(encoding='utf-8').splitlines()[-1:])
        item = service.store.one("SELECT * FROM work_items WHERE project_id=? AND title='Harness shared task'", (project,))
        assert item['assignee'] == member['id'] and item['creator'] == owner['id'] and item['status'] == 'doing' and item['revision'] == 2
        assert len(calls) == 11, len(calls)
        assert sum(r.get('calls', 0) for r in service.store.task(run['task_id'])['refs']['usage']) == 11
    finally:
        if connection:
            models.grant(project, {'connection_id': previous, 'enabled': True, 'default': True}, owner)
            models.change('delete', {'id': connection})
        provider.shutdown(); provider.server_close()
