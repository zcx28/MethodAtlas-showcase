"""Exercise shared activity through authenticated HTTP and durable source writes."""
import json
from urllib.parse import urlencode
from unittest.mock import patch

from .agent import ProjectTools
from .state import json_text, new_id, now


def check(service, request, root, project, users, owner, member, outsider):
    store, access = service.store, service.collaboration
    user, peer = users['owner@example.com'], users['member@example.com']
    endpoint = root + '/activity'
    def events(**filters):
        status, result, _ = request(endpoint + '?' + urlencode(filters), cookie=member)
        assert status == 200, result
        return result
    assert request(endpoint, cookie=outsider)[0] == 403
    for query in ('limit=51','offset=-1','after=2026-10-03','after=invalid',
                  'after=2026-10-04T00:00:00Z&before=2026-10-03T00:00:00Z'):
        assert request(endpoint + '?' + query,cookie=member)[0] == 400
    paper = store.paste(project,'Activity upload','Activity unique material',user=peer)
    assert store.paste(project,'Duplicate','Activity unique material',user=user) == paper
    uploaded = events(query='Activity upload')['events']
    assert len(uploaded) == 1 and uploaded[0]['kind'] == 'paper_uploaded'
    assert uploaded[0]['actor_id'] == peer['id'] and uploaded[0]['reference']['id'] == paper
    stamp = uploaded[0]['created']
    assert events(query='Activity upload',after=stamp)['total'] == 1
    assert events(query='Activity upload',before=stamp)['total'] == 0
    assert events(query='Activity upload',actor=user['id'])['total'] == 0
    with patch.object(access,'paper_event',side_effect=RuntimeError('activity storage failure')):
        try:
            store.paste(project,'ACTIVITY_ROLLBACK','rollback material',user=peer)
        except RuntimeError:
            pass
        else:
            raise AssertionError('material transaction ignored failed activity write')
    assert not store.one("SELECT 1 FROM papers WHERE title='ACTIVITY_ROLLBACK'")
    item = service.project_work.save(user,project,None,{'title':'Activity original task','assignee':peer['id']})
    service.project_work.save(peer,project,item['id'],{'revision':1,'title':'Activity renamed task','status':'doing'})
    history = events(query='Activity original task')['events']
    assert len(history) == 1 and history[0]['changes']['status'] == 'todo'
    changed = events(query='Activity renamed task')['events']
    assert changed[0]['actor_id'] == peer['id'] and changed[0]['changes']['status'] == 'doing'
    page1, page2 = events(query='Activity',limit=1), events(query='Activity',limit=1,offset=1)
    assert page1['next_offset'] == 1 and page1['events'][0]['id'] != page2['events'][0]['id']

    conversation = access.work_context(peer,project)
    task = service.writing.task(project,'Activity Agent lifecycle','running',conversation,user=peer)
    tools = ProjectTools(store,task)
    assert tools.call('list_project_activity',{'query':'Activity upload'})['total'] == 1
    for status in ('waiting','running'):
        store.run('UPDATE tasks SET status=?,updated=? WHERE id=?',(status,now(),task['id']))
    store.run("UPDATE tasks SET status='succeeded',updated=? WHERE id=?",(now(),task['id']))
    transitions = events(query='Activity Agent lifecycle')['events']
    assert {r['kind'] for r in transitions} == {'agent_run_running','agent_run_waiting','agent_run_succeeded'}
    assert len(transitions) == 4, 'resuming the same revision lost a lifecycle transition'
    assert all(r['actor_id'] == peer['id'] and r['attribution']=='initiator' for r in transitions)
    assert 'fixture-only-key' not in json.dumps(transitions)
    private = store.create_conversation(project)
    store.run("INSERT INTO conversation_scopes VALUES(?,?,'private')",(private,peer['id']))
    private_task = service.writing.task(project,'ACTIVITY_PRIVATE_RUN','running',private,user=peer)
    store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(private_task['id'],))
    doc = service.writing.save(project,None,{'request_id':'activity-draft','title':'Activity shared draft','document':[{'id':'p','type':'p','children':[{'text':'shared body'}]}]},user=peer)
    aid = doc['artifact_id']
    service.writing.save_draft(project,aid,{'request_id':'activity-draft-edit','title':'Activity edited draft','base_version_id':doc['version_id'],'document':[{'id':'p','type':'p','children':[{'text':'edited body'}]}]},user=peer)
    drafts = events(query='Activity edited draft')['events']
    assert any(r['kind']=='artifact_draft_changed' and r['actor_id']==peer['id'] for r in drafts)
    service.comments.change(peer,project,aid,None,'create',{'request_id':'activity-comment','version_id':doc['version_id'],'text':'ACTIVITY_PRIVATE_COMMENT'})
    derived = service.progress.record(project,{'request_id':'activity-derived','kind':'idea','text':'ACTIVITY_PRIVATE_DERIVED','sources':['artifact_versions:'+doc['version_id']]},user=peer)
    store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')",(aid,peer['id']))
    try:
        output = events(limit=50)
        assert 'ACTIVITY_PRIVATE' not in json.dumps(output)
        assert not any(r.get('reference',{}).get('id') in (aid,derived['id']) for r in output['events'] if r.get('reference'))
    finally:
        store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?",(aid,))
        store.run("UPDATE conversation_scopes SET visibility='shared' WHERE conversation_id=?",(private,))
    group_id = new_id('group')
    group = {'id':group_id,'project_id':project,'conversation_id':conversation,'created_by':peer['id'],
             'authorized_by':user['id'],'created':now(),'spec':{'title':'Activity experiment'},'status':'prepared'}
    store.run('INSERT INTO experiment_groups VALUES(?,?,?)',(group_id,project,json_text(group)))
    group['status'] = 'completed'
    store.run('UPDATE experiment_groups SET record=? WHERE id=?',(json_text(group),group_id))
    group_events = events(query='Activity experiment')['events']
    assert {r['kind'] for r in group_events} == {'experiment_created','experiment_completed'}
    assert next(r for r in group_events if r['kind']=='experiment_completed')['actor_id'] == user['id']
    store.run('DELETE FROM experiment_groups WHERE id=?',(group_id,))
    # SQLite trigger effects must share the originating transaction's rollback.
    try:
        with store.transaction():
            service.writing.task(project,'ACTIVITY_TRIGGER_ROLLBACK','running',conversation,user=peer)
            raise RuntimeError('rollback')
    except RuntimeError:
        pass
    assert events(query='ACTIVITY_TRIGGER_ROLLBACK')['total'] == 0
    live = service.writing.task(project,'Activity permission recheck','running',conversation,user=peer)
    tools = ProjectTools(store,live)
    tools.call('list_project_activity',{'query':'Activity upload'})
    with store.transaction() as db:
        db.execute('DELETE FROM project_members WHERE project_id=? AND user_id=?',(project,peer['id']))
        for operation in (lambda:tools.call('list_project_activity',{'query':'Activity upload'}),
                          lambda:store.paste(project,'Revoked upload','revoked material',user=peer)):
            try:
                operation()
            except PermissionError:
                pass
            else:
                raise AssertionError('removed member retained activity/material access')
        db.execute("INSERT INTO project_members VALUES(?,?,'member')",(project,peer['id']))
    store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(live['id'],))
    print('PASS: unified activity attribution, history, pagination/time filters, private-source exclusion, atomic rollback and current authorization')
