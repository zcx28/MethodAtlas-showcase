"""Main-specific collaboration boundaries, using the existing real HTTP fixture."""
import copy
import json
import uuid
from unittest.mock import patch

from .chat_context import references
from .state import json_text, new_id, now


def denied(call):
    try:
        call()
    except PermissionError:
        return
    raise AssertionError('Unauthorized main-specific operation succeeded')


def check(service, request, root, project, users, owner, member, outsider):
    store, access = service.store, service.collaboration
    a, b = users['owner@example.com'], users['member@example.com']
    assert service.research.resources.global_limit == 2
    paper_id = store.paste(project, '整合边界验收材料', '原文 😀 核验。\n\n第二段研究材料。', user=a)
    paper = store.paper(project, paper_id)
    version = paper['version_id']
    base = root + '/papers/' + paper_id
    note = {'id':'note_' + str(uuid.uuid4()), 'version_id':version, 'page':1,
            'quote':'原文 😀 核验。', 'rects':[], 'comment':'A_PERSONAL_NOTE_CANARY', 'revision':0}
    status, saved, _ = request(base + '/reader/note', note, owner)
    assert status == 200, saved
    assert request(base + '/reader?version_id=' + version, cookie=member)[1] == []
    assert request(base + '/reader/note', {**note, 'revision':1}, member)[0] == 403
    assert request(base + '/reader/note', note, outsider)[0] == 403
    assert request(base + '/reader/document?version_id=' + version, cookie=outsider)[0] == 403
    assert request(base + '?version_id=' + version, cookie=outsider)[0] == 403
    assert len(request(base + '/reader?version_id=' + version, cookie=owner)[1]) == 1
    shared = next(c['id'] for c in store.conversations(project) if access.scope('conversation', c['id'])['visibility'] == 'shared')
    ref = {'kind':'paper', 'paper_id':paper_id, 'version_id':version, 'page':1, 'quote':note['quote'], 'rects':[],
           'notes':[{'id':note['id'], 'page':1, 'comment':note['comment']}]}
    denied(lambda: references(service, project, [ref], user=b, conversation=shared))
    assert references(service, project, [ref], user=a, conversation=shared)[0]['notes'][0]['comment'] == note['comment']

    comment = {'request_id':'paper-comment', 'version_id':version, 'text':'@member@example.com 请核验这条原文',
               'anchor':{'kind':'paper', 'page':1, 'quote':note['quote'], 'start':0, 'end':len(note['quote']), 'rects':[]}}
    status, result, _ = request(base + '/comments', comment, owner)
    assert status == 201, result
    thread = result['thread_id']
    assert request(base + '/comments', comment, owner)[1]['duplicate']
    assert request(base + '/comments', {**comment, 'request_id':'paper-false-offset', 'anchor':{**comment['anchor'], 'start':1}}, owner)[0] == 400
    assert request(base + '/comments', {**comment, 'request_id':'paper-false-version', 'version_id':'unknown'}, owner)[0] == 403
    assert request(base + '/comments', cookie=outsider)[0] == 403
    assert request(base + '/comments/' + thread + '/reply', {'request_id':'paper-reply', 'text':'B 已核对'}, member)[0] == 200
    assert request(base + '/comments/' + thread + '/resolve', {'request_id':'paper-stale', 'revision':1}, owner)[0] == 409
    assert request(base + '/comments/' + thread + '/resolve', {'request_id':'paper-resolve', 'revision':2}, owner)[0] == 200
    row = request(base + '/comments', cookie=member)[1]['threads'][0]
    assert row['resolved'] and row['location']['status'] == 'attached' and len(row['messages']) == 2
    notice = next(n for n in request(root + '/notifications', cookie=member)[1]['notifications'] if n['entity_id'] == thread)
    assert notice['target_kind'] == 'paper' and notice['paper_id'] == paper_id and notice['version_id'] == version
    new_version = new_id('paper_version')
    pages = json.loads(paper['pages']);pages[0]['text'] = '原文已修改。'
    store.run('INSERT INTO paper_versions VALUES(?,?,?,?,?,?,?,?)', (new_version,paper_id,'changed-paper',1,json_text(pages),now(),'paste-v2',None))
    store.run('UPDATE papers SET current_version_id=? WHERE id=?', (new_version,paper_id))
    changed = request(base + '/comments', cookie=member)[1]['threads'][0]
    assert changed['version_id'] == version and changed['quote'] == note['quote'] and changed['location']['status'] == 'changed'
    assert request(base + '/comments?version_id=' + version, cookie=member)[1]['threads'][0]['location']['status'] == 'attached'
    multi = {**comment, 'request_id':'paper-multi', 'anchor':{**comment['anchor'], 'fragments':[comment['anchor'], {'kind':'paper','page':1,'quote':'第二段研究材料。','start':len(note['quote'])+2,'end':len(json.loads(paper['pages'])[0]['text']),'rects':[]}]}}
    assert request(base + '/comments', multi, owner)[0] == 201

    org = root + '/source-organization'
    original = service.source_organization.get(project, user=a)
    status, pref, _ = request(org + '/preferences', {'revision':original['revision'], 'view':'labels','sort':'title','collapsed':[]}, owner)
    assert status == 200, pref
    assert service.source_organization.get(project,user=b)['view'] == 'list'
    assert service.source_organization.get(project,user=a)['sort'] == 'title'
    created = request(org + '/create', {'revision':pref['revision'],'name':'整合验收'}, owner)
    assert created[0] == 200, created
    def classify(task, prompt, context, *args):
        assert task['refs']['initiated_by'] == a['id']
        return {'groups':[{'name':'整合验收分类','paper_ids':[p['id'] for p in context['papers']]}]}
    with patch.object(service.research,'complete',side_effect=classify):
        classified = request(org + '/classify', {'revision':created[1]['revision'],'mode':'all'}, owner)
        assert classified[0] == 200, classified
    assert service.source_organization.get(project,user=a)['can_undo']
    assert not service.source_organization.get(project,user=b)['can_undo']
    assert request(org + '/undo', {'revision':classified[1]['revision']}, member)[0] == 403
    assert request(org + '/undo', {'revision':classified[1]['revision']}, owner)[0] == 200

    private = access.create_conversation(b, project, 'private')['conversation_id']
    doc = service.writing.save(project,None,{'request_id':'integrated-private-doc','title':'PRIVATE_SEARCH_INTEGRATION','conversation_id':private,'document':[{'id':'intro','type':'p','children':[{'text':'PRIVATE_SEARCH_INTEGRATION'}]}]},user=b)
    aid = doc['artifact_id']
    for cookie, visible in ((owner,False),(member,True),(outsider,False)):
        status, hits, _ = request('/api/search?scope=all&q=PRIVATE_SEARCH_INTEGRATION', cookie=cookie)
        assert status == 200 and bool(hits['total']) == visible, hits
    artifact_ref={'kind':'artifact','artifact_id':aid,'version_id':doc['version_id']}
    denied(lambda: references(service,project,[artifact_ref],user=a,conversation=shared))
    denied(lambda: references(service,project,[artifact_ref],user=b,conversation=shared))
    assert references(service,project,[artifact_ref],user=b,conversation=private)
    assert request(root + '/artifacts/' + aid + '/versions/' + doc['version_id'],cookie=owner)[0] == 403
    assert request(root + '/artifacts/' + aid + '/download?version_id=' + doc['version_id'],cookie=outsider)[0] == 403

    def complete(task, *args, **kwargs):
        assert task['refs']['initiated_by'] == b['id']
        assert task['refs']['model_config']['workspace_id']
        access.execution(task)
        if args[2] == 'subscription-direction':
            return {'requirements':'中文研究方向'}
        return {'query':'research evidence','focus':'研究依据','prompt':'只按真实元数据筛选'}
    with patch.object(service.research,'complete',side_effect=complete):
        status, drafted, _ = request(root + '/subscription/draft', {'requirements':'研究'}, member)
        assert status == 200 and drafted['requirements'] == '中文研究方向', drafted
        sub = service.subscriptions.create(project,{'name':'协作订阅','requirements':'研究'},user=b)
        service.subscriptions.stop.clear()  # The fixture stopped unattended timers, not manual work.
        enabled = service.subscriptions.execute(project,'enable',subscription_id=sub['id'],user=b)
        assert enabled['settings']['authorized_by'] == b['id']
    denied(lambda: service.subscriptions.execute(project,'refresh',subscription_id=sub['id']))
    parent = service.writing.task(project,'私人订阅','running',private,user=b)
    denied(lambda: service.subscriptions.execute(project,'refresh',subscription_id=sub['id'],parent_task=parent))
    store.run("UPDATE tasks SET status='succeeded' WHERE id=?", (parent['id'],))
    # Revoke and restore within the fixture: neither scheduled nor manual late results retain access.
    store.run('DELETE FROM project_members WHERE project_id=? AND user_id=?',(project,b['id']))
    denied(lambda: service.subscriptions.execute(project,automatic=True,subscription_id=sub['id']))
    store.run("INSERT INTO project_members VALUES(?,?,'member')", (project,b['id']))
    print('PASS: integrated reader personal ownership, pinned paper discussions/replies/CAS/mentions, changed and multi-fragment anchors, search/private floating references, personal organization preferences/undo, subscription actors/scheduling and default global concurrency 2')
