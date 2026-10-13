"""Human knowledge confirmation on existing append-only research events."""
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from urllib.parse import quote

from .agent import ProjectTools
from .state import json_text, new_id, now


def check(service, request, root, project, users, owner, member, outsider):
    store, progress = service.store, service.progress
    user, peer = users['owner@example.com'], users['member@example.com']
    endpoint = root + '/progress'
    paper = store.paste(project, '知识确认依据', '基线需要在相同评估条件下复核。')
    version = store.one('SELECT current_version_id FROM papers WHERE id=?', (paper,))[0]
    source = 'paper_versions:' + version
    body = {'request_id':'human-confirm','kind':'decision','text':'已核对基线，仍需补充消融实验。','sources':[source],'confirmed':True}
    assert request(endpoint + '/events', {**body,'confirmed':False}, member)[0] == 400
    assert request(endpoint + '/events', {**body,'sources':[]}, member)[0] == 400
    assert request(endpoint + '/events', {**body,'actor_id':user['id']}, member)[0] == 400
    assert request(endpoint + '/events', body, outsider)[0] == 403
    assert request(endpoint + '/knowledge', cookie=outsider)[0] == 403
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _:request(endpoint + '/events',body,member),range(2)))
    assert all(r[0] == 200 for r in replies), replies
    ident = replies[0][1]['id']
    assert replies[1][1]['id'] == ident
    assert store.one('SELECT COUNT(*) AS n FROM activity_events WHERE entity_id=?',(ident,))['n'] == 1
    record = request(endpoint + '/knowledge/' + ident, cookie=owner)[1]['record']
    assert record['state'] == 'confirmed' and record['confirmed_by'] == peer['id']
    assert record['actor_email'] == peer['email'] and record['sources'][0]['reference']['version_id'] == version
    assert request(endpoint + '/events', {**body,'text':'changed retry'}, member)[0] == 400
    other = request(endpoint + '/events',body,owner)[1]['id']
    assert other != ident, 'retry key crossed identities'
    page = request(endpoint + '/knowledge?state=confirmed&limit=1', cookie=member)[1]
    assert page['next_offset'] == 1 and page['total'] == 2
    assert request(endpoint + '/knowledge?limit=100',cookie=member)[0] == 400
    assert source in {r['id'] for r in request(endpoint + '/events?query=' + quote('知识确认依据'),cookie=owner)[1]['records']}
    dependent = request(endpoint + '/events',{**body,'request_id':'dependent','text':'基于此前结论的后续判断','sources':[ident]},owner)[1]['id']
    retract = {'request_id':'retract','kind':'overturned','text':'评估条件不同，撤回此前判断。','supersedes':ident}
    saved = request(endpoint + '/events',retract,owner)
    assert saved[0] == 200 and request(endpoint + '/events',retract,owner)[1] == saved[1]
    conflict = request(endpoint + '/events',{**retract,'request_id':'second-retraction'},member)
    assert conflict[0] == 409, conflict[:2]
    record = request(endpoint + '/knowledge/' + ident,cookie=member)[1]['record']
    assert record['state'] == 'retracted' and record['retraction']['actor_id'] == user['id']
    assert record['text'] == body['text'] and record['retraction']['text'] == retract['text']
    dependent_record = request(endpoint + '/knowledge/' + dependent,cookie=member)[1]['record']
    assert dependent_record['state'] == 'confirmed' and dependent_record['needs_review']
    assert dependent_record['sources'][0]['retracted'], 'derived knowledge hid its retracted evidence'
    legacy = new_id('legacy')
    store.run('INSERT INTO progress_events VALUES(?,?,?,?,?)',(legacy,project,'decision',now(),json_text({'text':'迁移前旧判断'})))
    assert request(endpoint + '/knowledge/' + legacy,cookie=member)[1]['record']['state'] == 'legacy'

    doc = service.writing.save(project,None,{'request_id':'knowledge-source','title':'共享结论依据','document':[{'id':'p','type':'p','children':[{'text':'SOURCE_PRIVATE_CANARY'}]}]},user=user)
    aid, vid = doc['artifact_id'], doc['version_id']
    derived = request(endpoint + '/events',{**body,'request_id':'derived','text':'DERIVED_PRIVATE_CANARY','sources':['artifact_versions:' + vid]},member)[1]['id']
    conversation = service.collaboration.work_context(peer,project)
    task = service.writing.task(project,'查询项目知识','running',conversation,user=peer)
    tools = ProjectTools(store,task)
    assert tools.call('read_project_knowledge',{'record_id':derived})['record']['state'] == 'confirmed'
    assert not any('confirm' in t[0] and 'knowledge' in t[0] for t in tools.definitions)
    store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')",(aid,user['id']))
    try:
        for cookie in (owner,member):
            assert request(endpoint + '/knowledge/' + derived,cookie=cookie)[0] == 403
            output = request(endpoint + '/knowledge',cookie=cookie)[1]
            assert 'PRIVATE_CANARY' not in json.dumps(output)
            assert request(endpoint + '/events',{**body,'request_id':'private','sources':['artifact_versions:' + vid]},cookie)[0] == 403
        try:
            tools.call('read_project_knowledge',{'record_id':derived})
        except PermissionError:
            pass
        else:
            raise AssertionError('cached read leaked newly private derived knowledge')
    finally:
        store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?",(aid,))
    with patch.object(service.collaboration,'event',side_effect=RuntimeError('injected activity failure')):
        try:
            progress.record(project,{**body,'request_id':'atomic','text':'KNOWLEDGE_ROLLBACK'},user=peer)
        except RuntimeError:
            pass
        else:
            raise AssertionError('activity failure ignored')
    assert not store.one("SELECT 1 FROM progress_events WHERE data LIKE '%KNOWLEDGE_ROLLBACK%'")
    foreign = next(p['id'] for p in store.projects() if p['id'] != project)
    foreign_paper = store.paste(foreign,'别的项目','OTHER_PROJECT_CANARY')
    foreign_version = store.one('SELECT current_version_id FROM papers WHERE id=?',(foreign_paper,))[0]
    assert request(endpoint + '/events',{**body,'request_id':'foreign','sources':['paper_versions:' + foreign_version]},owner)[0] == 403
    with store.transaction() as db:
        db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?',(project,peer['id']))
        try:
            tools.call('list_project_knowledge',{})
        except PermissionError:
            pass
        else:
            raise AssertionError('revoked initiator read project knowledge')
        db.execute("INSERT INTO project_members VALUES(?,?,'member')",(project,peer['id']))
    store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(task['id'],))
    print('PASS: attributed human knowledge, fixed sources, pagination, retraction history, stable concurrent retry, private/cross-project filtering, revocation and rollback')
