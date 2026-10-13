"""Run through check_collaboration: trusted actor, cached tools and shared memory."""
import hashlib
import json
import copy
from unittest.mock import patch

from .agent import ProjectTools
from .state import StaleRun, json_text, new_id, now


def check_privacy(service, request, root, project, users, owner, member):
    store, access = service.store, service.collaboration
    owner_user, member_user = users['owner@example.com'], users['member@example.com']
    shared = store.conversations(project)[0]['id']
    private = store.create_conversation(project)
    store.run("INSERT INTO conversation_scopes VALUES(?,?,'private')", (private, member_user['id']))

    def run(actor, conversation):
        task = service.writing.task(project, '运行权限检查', 'running', conversation, user=actor)
        store.run("UPDATE tasks SET kind='research' WHERE id=?", (task['id'],))
        return store.task(task['id'])

    public_run, private_run = run(member_user, shared), run(member_user, private)
    owner_run = run(owner_user, shared)
    public_tools, private_tools = ProjectTools(store, public_run), ProjectTools(store, private_run)
    public_tools.set_scope(False)
    private_tools.set_scope(False)
    document = service.writing.save(project, None, {'request_id': 'private-actor-doc', 'title': '私人成果不得摘要', 'document': [{'id': 'private-content', 'type': 'p', 'children': [{'text': 'PRIVATE_RESEARCH_CANARY'}]}]})
    aid, vid = document['artifact_id'], document['version_id']
    store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')", (aid, member_user['id']))
    public_artifact = next(a['id'] for a in store.artifacts(project) if a['id'] != aid and access.visible(owner_user, 'artifact', a['id']))
    assert aid not in [a['id'] for a in public_tools.list_files(True)['files']]
    assert aid in [a['id'] for a in private_tools.list_files(True)['files']]
    assert private_tools.read_file(aid, vid, True)['title'] == '私人成果不得摘要'
    for call in (lambda: public_tools.read_file(aid, vid, True),
                 lambda: access.execution(owner_run, aid),
                 lambda: access.execution(private_run, public_artifact, write=True),
                 lambda: service.message(project, shared, {'text': '不能隐式发布', 'client_message_id': 'private-reference', 'selected_fragments': [{'artifact_id': aid, 'version_id': vid, 'selection': {'anchor': {'path': [0, 0], 'offset': 0}, 'focus': {'path': [0, 0], 'offset': 7}}, 'text': 'PRIVATE'}]}, schedule=False, user=member_user)):
        try:
            call()
        except PermissionError:
            pass
        else:
            raise AssertionError('private context crossed a shared/owner boundary')
    assert request(root + '/conversations/' + private + '/preferences', cookie=owner)[0] == 403
    assert all(c['id'] != private for c in request(root, cookie=owner)[1]['conversations'])
    secret_message = new_id('message')
    store.run("INSERT INTO messages(id,conversation_id,role,text,created) VALUES(?,?,'user',?,?)", (secret_message, private, 'PRIVATE_MESSAGE_CANARY', now()))
    # Even with another member's private conversation newest, right-pane work uses
    # a shared context; private edits stay private and record the authenticated actor.
    payload = {'request_id': 'shared-writing-context', 'title': '共享文稿', 'document': [{'id': 'shared-text', 'type': 'p', 'children': [{'text': '共享研究结果。'}]}]}
    status, shared_doc, _ = request(root + '/documents', payload, owner)
    assert status == 201, shared_doc
    shared_task = store.task(service.writing.version(project, shared_doc['artifact_id'])['task_id'])
    assert shared_task['refs']['initiated_by'] == owner_user['id'] and shared_task['conversation_id'] != private
    assert access.visible(member_user, 'artifact', shared_doc['artifact_id'])
    proposal = {'request_id': 'shared-polish', 'mode': 'polish', 'instruction': '润色表达', 'base_version_id': shared_doc['version_id']}
    seen = []

    def complete(task, system, context, role, max_tokens):
        store.assert_active(task['id'], task['revision'])
        seen.append((task, context))
        nodes = copy.deepcopy(context['document'])
        nodes[0]['children'][0]['text'] += ' 经复核。'
        return {'document': nodes, 'summary': '润色表达'}

    with patch.object(service.research, 'complete', complete):
        url = root + '/documents/' + shared_doc['artifact_id'] + '/propose'
        assert request(url, {**proposal, 'conversation_id': private, 'chat_options': {'effort': 'high'}}, owner)[0] == 403
        assert request(url, {**proposal, 'conversation_id': private}, member)[0] == 403
        assert not seen, 'unauthorized context reached the model'
        status, result, _ = request(url, proposal, owner)
        assert status == 200 and result['proposals'][-1]['status'] == 'pending', result
        assert seen[-1][0]['refs']['initiated_by'] == owner_user['id']
        assert 'PRIVATE_' not in json_text(seen[-1][1])
        status, result, _ = request(root + '/documents/' + aid + '/propose', {**proposal, 'request_id': 'private-polish', 'base_version_id': vid}, member)
        assert status == 200 and result['proposals'][-1]['status'] == 'pending', result
        assert seen[-1][0]['conversation_id'] == private and seen[-1][0]['refs']['initiated_by'] == member_user['id']
        assert request(root + '/documents/' + aid, cookie=owner)[0] == 403
    paper = store.papers(project)[0]
    reference = {'paper_id': paper['id'], 'paper_version_id': paper['current_version_id']}
    private_citation = request(root + '/documents/' + aid + '/reference', reference, member)[1]
    shared_citation = request(root + '/documents/' + shared_doc['artifact_id'] + '/reference', reference, owner)[1]
    assert private_citation['conversation_id'] == private and shared_citation['conversation_id'] != private
    assert private_citation['id'] != shared_citation['id']
    cited = copy.deepcopy(payload['document'])
    cited[0]['children'].append({'type': 'citation', 'citation_id': private_citation['id'], 'children': [{'text': ''}]})
    draft = {'request_id': 'private-evidence-in-shared-draft', 'title': payload['title'], 'document': cited, 'base_version_id': shared_doc['version_id']}
    assert request(root + '/documents/' + shared_doc['artifact_id'] + '/draft', draft, owner)[0] == 403
    assert request(root + '/documents/' + shared_doc['artifact_id'] + '/draft', draft, member)[0] == 403
    status, saved, _ = request(root + '/documents/' + aid + '/draft', {**draft, 'base_version_id': vid}, member)
    assert status == 200, saved
    assert service.writing.version(project, aid)['payload']['edited_by'] == member_user['id']
    event_id = 'messages:' + secret_message
    private_note = {'request_id': 'private-derived-note', 'kind': 'idea', 'text': 'PRIVATE_DERIVED_CANARY', 'source_id': event_id}
    for actor in (None, member_user):
        try:
            service.progress.record(project, private_note, user=actor)
        except PermissionError:
            pass
        else:
            raise AssertionError('unattributed/private source entered shared knowledge')
    # Existing legacy dependencies still require transitive redaction even though new writes reject them.
    store.run('INSERT INTO progress_events VALUES(?,?,?,?,?)', ('private-derived-note', project, 'idea', now(), json_text({'text':private_note['text'], 'source_id':event_id})))
    parent = event_id
    for index in range(100):
        ident = 'private-chain-' + str(index)
        store.run('INSERT INTO progress_events VALUES(?,?,?,?,?)', (ident, project, 'idea', now(), json_text({'source_id': parent, 'text': 'PRIVATE_CHAIN_CANARY'})))
        parent = ident
    workspace = store.root / 'workspaces' / project
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / 'unclaimed-private.md').write_text('UNCLAIMED_DISK_CANARY', encoding='utf-8')
    service.progress.scan_files(project)
    events = service.progress.events(project)
    visible = json_text(events)
    assert all(secret not in visible for secret in ('PRIVATE_RESEARCH_CANARY', 'PRIVATE_MESSAGE_CANARY', 'PRIVATE_DERIVED_CANARY', 'PRIVATE_CHAIN_CANARY', 'UNCLAIMED_DISK_CANARY'))
    assert store.one('SELECT 1 FROM progress_events WHERE id=?', (event_id,)), 'private evidence should be retained, not deleted'

    # A successful cached tool result is still protected by current execution rights.
    arguments = {'project_wide': True}
    call_id = hashlib.sha256(('list_files' + json.dumps(arguments, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()
    store.run('INSERT INTO tool_calls VALUES(?,?,?,?,?,?,?,?,?)', (public_run['id'], public_run['revision'], call_id, 'list_files', json_text(arguments), 'succeeded', json_text({'secret': 'CACHED_CANARY'}), now(), now()))
    missing = service.writing.task(project, '未经认证的后台运行', 'running', shared)
    try:
        store.assert_active(missing['id'], missing['revision'])
    except PermissionError:
        service.research.fail(missing, PermissionError('missing actor'))
    else:
        raise AssertionError('unattributed online execution accepted')
    assert store.task(missing['id'])['status'] == 'stopped'

    def revoked_completion(task, system, context, role, max_tokens):
        assert request(root + '/manage/remove-member', {'user_id': member_user['id']}, owner)[0] == 200
        nodes = copy.deepcopy(context['document'])
        nodes[0]['children'][0]['text'] = 'LATE_WRITING_CANARY'
        return {'document': nodes, 'summary': 'must not persist'}

    with patch.object(service.research, 'complete', revoked_completion):
        assert request(url, {**proposal, 'request_id': 'revoked-writing'}, member)[0] == 403
    revoked = store.one('SELECT * FROM writing_proposals WHERE id=?', ('revoked-writing',))
    assert revoked['status'] == 'failed' and revoked['after_nodes'] is None
    assert store.task(revoked['task_id'])['status'] == 'stopped'
    try:
        service.writing.save_draft(project, aid, draft, user=member_user)
    except PermissionError:
        pass
    else:
        raise AssertionError('revoked member saved a draft past the HTTP authorization check')
    for task in (public_run, private_run):
        stopped = store.task(task['id'])
        assert stopped['status'] == 'stopped' and stopped['revision'] == task['revision'] + 1
    for call in (lambda: public_tools.call('list_files', arguments),
                 lambda: service.research.save_answer(public_run, 'LATE_RESULT_CANARY'),
                 lambda: service.research.context(private_run)):
        try:
            call()
        except (PermissionError, StaleRun):
            pass
        else:
            raise AssertionError('revoked execution consumed cache or committed a late result')
    assert not store.one("SELECT 1 FROM messages WHERE text='LATE_RESULT_CANARY'")
    invitation = request(root + '/invite', {'email': member_user['email']}, owner)[1]
    assert request('/api/invitations/accept', {'token': invitation['token']}, member)[0] == 200
    assert store.task(public_run['id'])['status'] == 'stopped', 'rejoining resumed revoked work'
    store.run("UPDATE tasks SET status='stopped',revision=revision+1 WHERE id=?", (owner_run['id'],))
    print('PASS: execution identity, private file/context isolation, authenticated writing, shared diary/derived-source filtering, member revocation, cached tool fence and late-result protection')
