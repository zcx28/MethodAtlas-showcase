"""Run via backend.check_collaboration: explicit private answer publication."""
import hashlib
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from .state import json_text, new_id, now


def check(service, request, root, project, users, owner, member, outsider):
    store, access = service.store, service.collaboration
    user = users['member@example.com']
    endpoint = root + '/conversations'
    assert request(endpoint, {'visibility': 'public'}, member)[0] == 400
    assert request(endpoint, {'visibility': 'private'}, outsider)[0] == 403
    status, created, _ = request(endpoint, {'visibility': 'private'}, member)
    assert status == 201 and created['visibility'] == 'private' and created['owner_id'] == user['id']
    chat = created['conversation_id']
    assert next(c for c in request(root, cookie=member)[1]['conversations'] if c['id'] == chat)['visibility'] == 'private'
    assert chat not in [c['id'] for c in request(root, cookie=owner)[1]['conversations']]
    task = service.writing.task(project, 'PRIVATE_PROMPT_CANARY', conversation=chat, user=user)
    paper = store.papers(project)[0]
    evidence = new_id('cite')
    location = {'kind': 'bibliography', 'page': 1, 'quote': ''}
    store.run('INSERT INTO evidence VALUES(?,?,?,?,?,?)', (evidence, project, chat, paper['id'], paper['current_version_id'], json_text(location)))
    message = new_id('message')
    raw = '明确发布的结论 [cite:' + evidence + ']。相同依据 [cite:' + evidence + ']'
    store.run("INSERT INTO messages(id,conversation_id,role,text,created,task_id) VALUES(?,?,'assistant',?,?,?)", (message, chat, raw, now(), task['id']))
    store.run("INSERT INTO messages(id,conversation_id,role,text,created) VALUES(?,?,'user',?,?)", (new_id('message'), chat, 'UNSELECTED_PRIVATE_CANARY', now()))
    body = {'request_id': 'publication-test', 'message_id': message, 'sha256': hashlib.sha256(raw.encode()).hexdigest(), 'title': '成员发布的研究笔记'}
    url = root + '/publish-message'
    assert request(url, body, owner)[0] == 403
    assert request(url, body, outsider)[0] == 403
    assert request(url, {**body, 'sha256': '0' * 64}, member)[0] == 400
    store.run("UPDATE tasks SET status='running' WHERE id=?", (task['id'],))
    assert request(url, body, member)[0] == 400
    store.run("UPDATE tasks SET status='succeeded' WHERE id=?", (task['id'],))
    before_files = set(store.root.rglob('*.html'))
    before_artifacts = len(store.artifacts(project))
    before_evidence = store.one('SELECT COUNT(*) AS n FROM evidence')['n']
    with patch.object(access, 'event', side_effect=RuntimeError('controlled publication activity failure')):
        assert request(url, body, member)[0] == 500
    assert set(store.root.rglob('*.html')) == before_files
    assert len(store.artifacts(project)) == before_artifacts
    assert store.one('SELECT COUNT(*) AS n FROM evidence')['n'] == before_evidence
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: request(url, body, member), range(2)))
    if results[0][0] != 201:
        service.writing.publish_message(project, body, user)
    assert all(result[0] == 201 for result in results), results
    value = results[0][1]
    assert results[1][1] == value and len(store.artifacts(project)) == before_artifacts + 1
    assert request(url, {**body, 'title': '不同标题'}, member)[0] == 400
    status, shared, _ = request(root + '/documents/' + value['artifact_id'], cookie=owner)
    assert status == 200, shared
    version = shared['versions'][-1]
    public = json_text(shared)
    for private in (chat, message, evidence, 'PRIVATE_PROMPT_CANARY', 'UNSELECTED_PRIVATE_CANARY'):
        assert private not in public, private
    assert len(version['citations']) == 1
    copied = version['citations'][0]
    assert copied['paper_version_id'] == paper['current_version_id']
    assert copied['id'] != evidence and copied['conversation_id'] != chat
    assert request(root + '/citations/' + copied['id'], cookie=owner)[0] == 200
    assert request(root + '/citations/' + evidence, cookie=owner)[0] == 403
    assert access.scope('conversation', chat)['visibility'] == 'private'
    events = store.all("SELECT * FROM activity_events WHERE kind='artifact_published' AND entity_id=?", (value['artifact_id'],))
    assert len(events) == 1 and events[0]['actor_id'] == user['id'] and chat not in events[0]['data']
    # Auth is rechecked even for an already committed operation receipt.
    with store.transaction() as db:
        db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?', (project, user['id']))
        try:
            service.writing.publish_message(project, body, user)
        except PermissionError:
            pass
        else:
            raise AssertionError('revoked publisher read a receipt')
        db.execute("INSERT INTO project_members VALUES(?,?,'member')", (project, user['id']))
    assert request(url, body, member)[1] == value
    # Publish one frozen draft without exposing its other versions or comments.
    document = [{'id': 'source-block', 'type': 'p', 'children': [{'text': 'PRIVATE_OLD_VERSION'}, {'type': 'citation', 'citation_id': evidence, 'children': [{'text': ''}]}]}]
    saved = service.writing.save(project, None, {'request_id': 'private-publish-source', 'conversation_id': chat, 'title': '私人文稿', 'document': document}, user=user)
    aid = saved['artifact_id']
    document[0]['children'][0]['text'] = '确认发布的当前草稿'
    draft = service.writing.save_draft(project, aid, {'request_id': 'private-publish-draft', 'base_version_id': saved['version_id'], 'title': '私人文稿', 'document': document}, user=user)
    source_url = root + '/documents/' + aid
    assert request(source_url + '/snapshot', {'version_id': draft['version_id']}, member)[0] == 200
    document[0]['children'][0]['text'] = 'PRIVATE_NEWER_DRAFT'
    newer = service.writing.save_draft(project, aid, {'request_id': 'private-publish-later', 'base_version_id': draft['version_id'], 'title': '私人文稿', 'document': document}, user=user)
    publish = {'request_id': 'document-publication', 'version_id': draft['version_id'], 'title': '共享固定草稿'}
    assert request(source_url + '/publish', publish, owner)[0] == 403
    assert request(source_url + '/publish', publish, outsider)[0] == 403
    assert request(source_url + '/publish', {**publish, 'version_id': value['version_id']}, member)[0] == 400
    before_files = set(store.root.rglob('*.html'))
    before_artifacts = len(store.artifacts(project))
    with patch.object(access, 'event', side_effect=RuntimeError('controlled document publication failure')):
        assert request(source_url + '/publish', publish, member)[0] == 500
    assert set(store.root.rglob('*.html')) == before_files and len(store.artifacts(project)) == before_artifacts
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: request(source_url + '/publish', publish, member), range(2)))
    assert all(result[0] == 201 for result in results), results
    published = results[0][1]
    assert results[1][1] == published and len(store.artifacts(project)) == before_artifacts + 1
    status, copied_doc, _ = request(root + '/documents/' + published['artifact_id'], cookie=owner)
    assert status == 200 and len(copied_doc['versions']) == 1 and not copied_doc['draft'] and not copied_doc['proposals']
    serialized = json_text(copied_doc)
    assert '确认发布的当前草稿' in serialized
    for private in (aid, saved['version_id'], draft['version_id'], chat, evidence, 'PRIVATE_OLD_VERSION', 'PRIVATE_NEWER_DRAFT'):
        assert private not in serialized, private
    assert service.writing.version(project, aid)['id'] == newer['version_id']
    summary = next(a for a in request(root, cookie=member)[1]['artifacts'] if a['id'] == aid)
    assert summary['current_version_id'] == newer['version_id'] and summary['visibility'] == 'private'
    assert aid not in [a['id'] for a in request(root, cookie=owner)[1]['artifacts']]
    assert access.scope('artifact', aid)['visibility'] == 'private'
    assert access.scope('artifact', published['artifact_id'])['visibility'] == 'shared'
    assert request(source_url + '/publish', {**publish, 'title': '不同内容'}, member)[0] == 400
    assert request(root + '/documents/' + published['artifact_id'] + '/publish', publish, member)[0] == 400
    assert request(source_url + '/publish', {**publish, 'request_id': 'publish-history', 'version_id': saved['version_id']}, member)[0] == 201
    with store.transaction() as db:
        db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?', (project, user['id']))
        try:
            service.writing.publish_document(project, aid, publish, user)
        except PermissionError:
            pass
        else:
            raise AssertionError('revoked publisher read a document receipt')
        db.execute("INSERT INTO project_members VALUES(?,?,'member')", (project, user['id']))
    print('PASS: private creation, explicit answer publication, fixed shared citations, private provenance, concurrent retry, revoked receipts and atomic file rollback')
    print('PASS: frozen draft/history publication, separate shared versions, permission checks and unchanged private source')
