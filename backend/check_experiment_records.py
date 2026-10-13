"""Collaborative experiment HTTP/CAS/provenance checks in the real app fixture."""
import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from .agent import ProjectTools
from .state import new_id, json_text, now


def check(service, request, root, project, users, owner, member, outsider):
    store=service.store
    base=root+'/remote/groups'
    body={'request_id':'external-create','title':'协作实验验收','objective':'比较两次训练','hypothesis':'增大训练集改善准确率'}
    status,group,_=request(base+'/external',body,owner)
    assert status==201, group
    ident=group['id']; path=base+'/'+ident
    assert group['mode']=='external' and 'server' not in group['spec'] and group['research']['revision']==1
    assert request(base+'/external',body,owner)[1]['id']==ident
    assert request(base+'/external',{**body,'title':'changed'},owner)[0]==409
    assert request(path,cookie=outsider)[0]==403
    assert request(path+'/records/plan/history',cookie=outsider)[0]==403
    assert request(path+'/confirm',{'digest':'fake'},member)[0]==400
    assert any(g['id']==ident for g in request(base,cookie=member)[1])
    edit={'request_id':'plan-edit','revision':1,'fields':{'notes':'both-edit'}}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda cookie:request(path+'/records/plan',edit,cookie),[owner,member]))
    assert sorted(r[0] for r in results)==[200,409], results
    assert len(request(path+'/records/plan/history',cookie=member)[1]['history'])==2
    before=request(path,cookie=member)[1]
    with patch.object(service.collaboration,'event',side_effect=RuntimeError('controlled rollback')):
        assert request(path+'/records/plan',{'request_id':'rollback','revision':2,'fields':{'notes':'not committed'}},member)[0]==500
    assert request(path,cookie=member)[1]['research']==before['research']
    fields={'title':'Baseline','status':'completed','dataset':'CIFAR10','dataset_version':'v1','split':'test','evaluation':'top1','model':'CNN','parameters':{'seed':42},'configuration':'baseline','code':'https://example.com/repo','commit':'abc123','metrics':{'accuracy':80},'metric_units':{'accuracy':'percent'},'metric_directions':{'accuracy':'higher'},'conclusion':'baseline result'}
    create={'request_id':'run-one','revision':0,'fields':fields}
    status,first,_=request(path+'/records/new',create,member)
    assert status==200, first
    run=first['saved']['entity_id']
    assert request(path+'/records/new',create,member)[1]['saved']==first['saved']
    second=request(path+'/records/new',{'request_id':'run-two','revision':0,'fields':{**fields,'title':'More data','metrics':{'accuracy':82}}},owner)[1]['saved']['entity_id']
    selections=[{'group_id':ident,'run_id':r} for r in (run,second)]
    compare=lambda:request(base+'/compare',{'selections':selections},member)
    status,result,_=compare()
    assert status==200 and result['metrics'][0]['comparable'],result
    assert result['metrics'][0]['best_runs']==[selections[1]]
    assert request(base+'/compare',{'selections':selections},outsider)[0]==403
    assert request(path+'/records/'+second,{'request_id':'different-split','revision':1,'fields':{'split':'validation'}},owner)[0]==200
    result=compare()[1]
    assert not result['metrics'][0]['comparable'] and 'best_runs' not in result['metrics'][0]
    conversation=service.collaboration.work_context(users['owner@example.com'],project)
    task=service.writing.task(project,'比较两个实验','running',conversation,user=users['owner@example.com'])
    tools=ProjectTools(store,task)
    assert not tools.call('compare_experiment_runs',{'selections':selections})['metrics'][0]['comparable']
    # A fixed paper reference disappearing hides the entire derived observation and history.
    paper=store.paste(project,'实验资料','实验数据来源。')
    source={'kind':'paper','id':paper,'version_id':store.one('SELECT id FROM paper_versions WHERE paper_id=?',(paper,))['id']}
    assert request(path+'/records/'+run,{'request_id':'source','revision':1,'fields':{'sources':[source],'result':'DERIVED_EXPERIMENT_CANARY'}},member)[0]==200
    store.run('DELETE FROM papers WHERE id=?',(paper,))
    assert 'DERIVED_EXPERIMENT_CANARY' not in json_text(request(path,cookie=member)[1])
    assert 'DERIVED_EXPERIMENT_CANARY' not in json_text(request(path+'/records/'+run+'/history',cookie=member)[1])
    assert compare()[0]==403
    assert request(path+'/records/'+run,{'request_id':'hidden-edit','revision':2,'fields':{'sources':[]}},member)[0]==403
    events=request(root+'/activity',cookie=member)[1]['events']
    assert not any(e['kind']=='experiment_record_changed' and e['changes'].get('entity_id')==run and e['changes'].get('revision')==2 for e in events)
    # Actual captured execution metrics and status cannot be replaced by annotations.
    platform=new_id('group'); job=new_id('exp')
    store.run('INSERT INTO remote_experiments(id,project_id,name,spec,digest,status,job,created) VALUES(?,?,?,?,?,?,?,?)',(job,project,'Captured run',json_text({'configuration':'captured config'}),'digest','succeeded','{}',now()))
    service.remote.groups.save({'id':platform,'project_id':project,'conversation_id':conversation,'spec':{'title':'Captured','plan':'actual','steps':['baseline']},'status':'completed','created':now(),'runs':[{'id':job,'step':0,'record':{'metrics':{'accuracy':90},'metricDirections':{'accuracy':'higher'}}}],'completed_steps':[0],'changes':[]})
    native=base+'/'+platform+'/records/'+job
    assert request(native,{'request_id':'overwrite','revision':0,'fields':{'metrics':{'accuracy':999}}},member)[0]==400
    assert request(native,{'request_id':'annotate','revision':0,'fields':{'dataset':'CIFAR10','metric_units':{'accuracy':'percent'},'conclusion':'explain'}},member)[0]==200
    snapshot=request(base+'/'+platform,cookie=member)[1]['observations'][0]
    assert snapshot['metrics']=={'accuracy':90} and snapshot['status']=='succeeded' and snapshot['origin']=='platform_captured'
    # Read tools must recheck the private conversation boundary on each call.
    private=service.collaboration.create_conversation(users['owner@example.com'],project,'private')['conversation_id']
    group=service.remote.groups._get(project,platform);group['conversation_id']=private;service.remote.groups.save(group)
    assert request(base+'/'+platform,cookie=member)[0]==403
    try: tools.call('read_experiment_group',{'group_id':platform})
    except PermissionError: pass
    else: raise AssertionError('shared copilot read private experiment')
    store.run('DELETE FROM experiment_groups WHERE id=?',(platform,))
    store.run('DELETE FROM remote_experiments WHERE id=?',(job,))
    store.run('DELETE FROM conversation_scopes WHERE conversation_id=?',(private,))
    store.run('DELETE FROM conversations WHERE id=?',(private,))
    store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(task['id'],))
    print('PASS: collaborative experiment records, HTTP isolation, concurrent CAS, idempotency, rollback, source revocation, immutable captured metrics and Copilot comparison')
