"""Online review authorization, shared evidence, project calendar and revocation."""
import json
from datetime import datetime
from unittest.mock import patch

from .state import json_text, new_id


@patch('backend.project_work.now', lambda: '2026-10-03T12:00:00+00:00')
@patch('backend.collaboration.now', lambda: '2026-10-03T12:00:00+00:00')
def check(service, request, root, project, users, owner, member, outsider):
    progress, store = service.progress, service.store
    user, peer = users['owner@example.com'], users['member@example.com']
    endpoint = root + '/progress'
    # Own dated evidence: earlier checks run on today's date, not this report's day.
    assert request(root+'/work-items', {'title':'固定研究日的回顾样例'}, owner)[0] == 201
    assert request(endpoint+'/settings',{'timezone':'America/New_York'},member)[0] == 403
    assert request(endpoint+'/settings',{'timezone':'invalid/zone'},owner)[0] == 400
    assert request(endpoint+'/settings',{'authorized_by':peer['id']},owner)[0] == 400
    assert progress.generate(project,automatic=True)['status']=='authorization_required'
    for cookie in (member,owner):
        assert request(endpoint+'/generate',{'conversation_id':next(r['id'] for r in store.conversations(project) if not service.collaboration.shared_metadata({'conversation_id':r['id']}))},cookie)[0] == 403
    original_clock = progress.clock
    calls, behavior = [], ['normal']
    def complete(task, system, context, role, max_tokens):
        store.assert_active(task['id'],task['revision'])
        assert task['refs']['initiated_by'] in (user['id'],peer['id'])
        assert 'UNSELECTED_PRIVATE_CANARY' not in json_text(context)
        calls.append(context)
        if behavior[0]=='disable':
            progress.settings(project,{'enabled':False},user=user)
            try:
                store.assert_active(task['id'],task['revision'])
            except PermissionError:
                pass
            else:
                raise AssertionError('disabled schedule retained execution permission')
        source = next((e['id'] for e in context.get('activities',[]) if e['kind']=='task_created'), context.get('activities',[{}])[0].get('id')) if context.get('activities') else context['summaries'][0]['sources'][0]
        return {'items':[{'section':context['sections'][0],'text':'负责人创建了共享研究任务，后续仍需研究。','sources':[source]}],'highlights':['共享项目研究进展']}
    try:
        # DST spring transition has a 23-hour local day; UTC midnight is not its boundary.
        progress.clock = lambda:datetime.fromisoformat('2026-10-04T06:00:00+00:00')
        settings = request(endpoint+'/settings',{'timezone':'America/New_York','enabled':True},owner)
        assert settings[0] == 200 and settings[1]['authorized_by']==user['id']
        assert progress.today(project)=='2026-10-04'
        for stamp,label in [('2026-03-08T04:59:59+00:00','before'),('2026-03-08T05:00:00+00:00','start'),('2026-03-09T03:59:59+00:00','end'),('2026-03-09T04:00:00+00:00','after')]:
            store.run('INSERT INTO progress_events VALUES(?,?,?,?,?)',('tz-check:'+label,project,'idea',stamp,json_text({'text':'tz-check '+label})))
        ids = {e['id'] for e in progress.events(project,'2026-03-08')}
        assert {'tz-check:start','tz-check:end'} <= ids and not {'tz-check:before','tz-check:after'} & ids
        progress.clock = lambda:datetime.fromisoformat('2026-10-03T23:00:00+00:00')
        with patch.object(service.research,'complete',complete):
            result = request(endpoint+'/2026-10-03/generate',{},member)
            assert result[0]==200 and result[1]['status']=='ready',(result[:2],(store.root/'logs/errors.jsonl').read_text(encoding='utf-8').splitlines()[-1:])
            assert calls and all(c['timezone']=='America/New_York' and c['as_of'] for c in calls)
            assert any(e['kind']=='task_created' for c in calls for e in c.get('activities',[]))
            assert any(c['work_state'] for c in calls)
            latest = progress.latest(project,'2026-10-03')
            assert store.task(latest['task_id'])['refs']['initiated_by']==peer['id']
            assert latest['payload']['timezone']=='America/New_York'
            assert latest['payload']['as_of']=='2026-10-03T23:00:00+00:00'
            def unread(cookie):
                return next(d for d in request(endpoint,cookie=cookie)[1]['days'] if d['day']=='2026-10-03')['unread']
            def notices(cookie):
                return [n for n in request(root+'/notifications',cookie=cookie)[1]['notifications'] if n['kind']=='review_published']
            assert unread(owner) and unread(member)
            assert any(n['version_id']==latest['id'] and not n['read_at'] for n in notices(owner))
            assert request(endpoint+'/2026-10-03/read',{'version_id':latest['id']},member)[0]==200
            assert not unread(member) and unread(owner), 'reading by one member cleared another member unread state'
            saved = request(endpoint+'/2026-10-03/save',{'base_version_id':latest['id'],'content':latest['body']+'\n\n成员手动补充。'},member)
            assert saved[0]==200,saved
            manual = progress.latest(project,'2026-10-03')
            assert manual['payload']['edited_by']==peer['id']
            assert unread(member) and unread(owner)
            assert request(endpoint+'/2026-10-03/read',{'version_id':latest['id']},member)[0]==200
            assert unread(member),'reading an old notification marked latest revision read'
            notice = next(n for n in notices(owner) if n['version_id']==manual['id'])
            assert request(root+'/notifications/read',{'ids':[notice['id']]},member)[0]==200
            assert unread(owner), 'another user marked a notification read'
            assert request(root+'/notifications/read',{'ids':[notice['id']]},owner)[0]==200
            assert not unread(owner) and unread(member)
            count = len(notices(member))
            assert request(endpoint+'/2026-10-03/save',{'base_version_id':manual['id'],'content':manual['body']},member)[0]==200
            assert len(notices(member))==count,'unchanged content created duplicate notifications'
            old_file = progress.path(project,'2026-10-03').read_bytes()
            store.run("CREATE TEMP TRIGGER reject_review_notice BEFORE INSERT ON project_notifications WHEN NEW.kind='review_published' BEGIN SELECT RAISE(ABORT,'injected notification failure'); END")
            try:
                assert request(endpoint+'/2026-10-03/save',{'base_version_id':manual['id'],'content':manual['body']+' failed write'},member)[0]>=400
                assert progress.latest(project,'2026-10-03')['id']==manual['id']
                assert progress.path(project,'2026-10-03').read_bytes()==old_file
                assert len(notices(member))==count
            finally:
                store.run('DROP TRIGGER reject_review_notice')
            source_doc = service.writing.save(project,None,{'request_id':'review-private-source','title':'回顾权限依据','document':[{'id':'p','type':'p','children':[{'text':'REVIEW_SOURCE_CANARY'}]}]},user=peer)
            restricted = progress.publish(project,'2026-10-02','# 含后来私人依据的回顾\nREVIEW_DERIVED_CANARY','human',None,['artifact_versions:'+source_doc['version_id']],[],user=peer)
            comment = request(root+'/artifacts/'+restricted['artifact_id']+'/comments',{'request_id':'review-source-mention','version_id':restricted['id'],'text':'@owner@example.com 请核验回顾依据','mentions':[user['id']]},member)
            assert comment[0]==201,comment
            assert any(n['entity_id']==comment[1]['thread_id'] for n in request(root+'/notifications',cookie=owner)[1]['notifications'])
            store.run("INSERT OR REPLACE INTO artifact_scopes VALUES(?,?,'private')",(source_doc['artifact_id'],peer['id']))
            try:
                for cookie in (owner,member):
                    assert request(endpoint+'/2026-10-02',cookie=cookie)[0]==403
                    assert request(root+'/artifacts/'+restricted['artifact_id'],cookie=cookie)[0]==403
                    assert all(n['version_id']!=restricted['id'] for n in notices(cookie))
                    assert not any(n['entity_id']==comment[1]['thread_id'] for n in request(root+'/notifications',cookie=cookie)[1]['notifications']), 'hidden report title leaked via mention notification'
                    assert 'REVIEW_DERIVED_CANARY' not in json_text(request(endpoint,cookie=cookie)[1])
            finally:
                store.run("UPDATE artifact_scopes SET visibility='shared' WHERE artifact_id=?",(source_doc['artifact_id'],))
            assert any(e['data'].get('version_id')==manual['id'] for e in progress.events(project)), 'collaboration sources hid manual revision history'
            # A fresh day with new collaboration evidence must run under the saved owner authorization.
            service.collaboration.event(project,user['id'],'task_created',store.one('SELECT id FROM work_items WHERE project_id=?',(project,))['id'],{'revision':1})
            progress.clock = lambda:datetime.fromisoformat('2026-10-04T06:00:00+00:00')
            # Existing human content remains protected; explicit revision runs can still be authorized and fenced.
            result = progress.generate(project,'2026-10-03',instruction='补充成员贡献',automatic=True)
            assert result['status']=='needs_update',result
            assert progress.latest(project,'2026-10-03')['id']==manual['id']
            # Automatic summaries must use the authorizing owner and not trigger themselves repeatedly.
            result = progress.generate(project,'2026-09-28-w',automatic=True)
            assert result['status']=='ready',result
            weekly = progress.latest(project,'2026-09-28-w')
            assert store.task(weekly['task_id'])['refs']['initiated_by']==user['id']
            count = len(calls)
            assert progress.generate(project,'2026-09-28-w',automatic=True)['status']=='ready'
            assert len(calls)==count,'review-generated activity caused a regeneration loop'
            behavior[0]='disable'
            result = progress.generate(project,'2026-10-01-m',automatic=True)
            assert result['status']=='failed',result
            assert progress.latest(project,'2026-10-01-m') is None
            assert progress.generate(project,'2026-10-01-m',automatic=True)['status']=='disabled'
            behavior[0]='normal'
            progress.settings(project,{'enabled':True},user=user)
            assert progress.generate(project,'2026-10-01-m',automatic=True)['status']=='ready','renewed authorization could not retry failed summary'
        assert request(endpoint+'/generate',{},outsider)[0]==403
    finally:
        progress.clock = original_clock
        progress.settings(project,{'timezone':'Asia/Shanghai','enabled':False},user=user)
        store.run("DELETE FROM progress_events WHERE id LIKE 'tz-check:%' AND project_id=?",(project,))
    print('PASS: project timezone/DST, shared collaboration review evidence, trusted manual/scheduled authors, owner authorization and revoked late-result fence')
