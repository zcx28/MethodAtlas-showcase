"""Research delivery, cache and cancellation checks at public task/tool boundaries."""
import copy
import json
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path

from .app import Service
from .agent import ProjectTools, Research, exact_substring
from types import SimpleNamespace
from .research_pipeline import run, revise, plain, requested_view
from .paper_research import verify_claims
from .research_skills import selected_skills
from .state import StaleRun


def main():
    for prompt in ('生成文献综述', '生成论文关系图谱', '生成实验计划', '基于方法比较生成实验计划'):
        assert requested_view({'kind':'research','prompt':prompt,'checkpoint':{'route':{'research_view':'methods'}}}) is None
    assert selected_skills({'kind':'research','prompt':'生成实验计划','checkpoint':{'route':{}}}) == ['research-experiment-plan']
    assert selected_skills({'kind':'chat','prompt':'解释实验计划是什么','checkpoint':{'route':{}}}) == []
    assert selected_skills({'kind':'research','prompt':'生成论文关系','checkpoint':{'route':{'skills':['research-lit-review']}}}) == ['research-paper-relations']
    for prompt in ('根据这份文献综述生成实验计划','基于已有的方法比较生成实验计划'):
        for names in ([],['research-experiment-plan']):
            assert selected_skills({'kind':'research','prompt':prompt,'checkpoint':{'route':{'skills':names}}}) == ['research-experiment-plan']
    with tempfile.TemporaryDirectory() as tmp:
        service = Service(Path(tmp)/'missing',Path(tmp))
        try:
            store = service.store
            project = store.projects()[0]['id']
            papers = [store.paste(project,'方法'+str(i),f'Method {i} was evaluated indoors in 2024. The success rate is 80%. Outdoor performance is unknown.') for i in range(2)]
            class Model:
                def __init__(self):
                    self.store=store;self.calls=Counter();self.active=0;self.peak=0;self.lock=threading.Lock()
                def complete(self,task,system,context,role,**kwargs):
                    self.calls[role]+=1
                    if role=='paper':
                        with self.lock:self.active+=1;self.peak=max(self.peak,self.active)
                        time.sleep(.04)
                        e={**context['evidence'][0]}
                        e['quote']=e['quote'].split(' Outdoor')[0]
                        with self.lock:self.active-=1
                        return {'claims':[{'text':e['quote'],'quotes':[{'id':e['id'],'quote':e['quote']}]}],'gaps':[]}
                    if role=='paper-select' and getattr(self,'partial_failure',False) and context['title']=='方法0':raise ValueError('模拟单篇选择失败')
                    if role=='paper-select': return {'selected':[0],'gaps':[]}
                    if role=='verify': return {'verdicts':[{'index':c['index'],'supported':True,'reason':'显式核查'} for c in context['claims']]}
                    if role=='research-synthesis':
                        nodes=[]
                        for card in context['cards']:
                            claim=card['card']['claims'][0]
                            nodes.append({'name':'室内方法','summary':claim['text']+' [cite:'+claim['citation_ids'][0]+']','detail':claim['text']+' [cite:'+claim['citation_ids'][0]+']','conditions':'室内','metrics':'成功率80%','limitations':'室外尚未验证','period':'2024','problem':'室内控制','improvement':'效果待核对','evidence':claim['citation_ids']})
                        for node in nodes:
                            for field in ('conditions','metrics','limitations','problem','improvement'):
                                node[field]+=' [cite:'+node['evidence'][0]+']'
                        return {'view':'evolution','summary':'仅比较室内实验','nodes':nodes,'gaps':[],'opportunities':[]}
                    raise AssertionError(role)
            model=Model()
            def task(prompt):
                conversation=store.create_conversation(project)
                tid=service.message(project,conversation,{'text':prompt,'selected_paper_ids':papers,'client_message_id':conversation},schedule=False)['task_id']
                store.run("UPDATE tasks SET status='running',kind='research',checkpoint=? WHERE id=?",(json.dumps({'route':{'research_view':'evolution','only_selected':True}}),tid))
                return store.task(tid)
            first=task('生成技术演进')
            run(model,first)
            assert model.peak==2,'Workers must actually overlap'
            assert model.calls['verify']==0,'Generation must not verify sources'
            cold=model.calls.copy()
            second=task('请换一种说法生成技术演进')
            run(model,second)
            assert model.calls['paper']==cold['paper'],'Rephrasing reread full text'
            assert model.calls['verify']==cold['verify'],'Identical claims were verified again'
            before=model.calls.copy()
            run(model,store.task(second['id']))
            assert model.calls==before,'Restart must reuse completed stages'
            assert len(service.task_view(project,second['id'])['files'])==1,'Duplicate artifact'
            model.partial_failure=True
            partial=task('生成技术演进，保留部分失败')
            run(model,partial)
            assert store.task(partial['id'])['checkpoint']['research_flow']['gaps']
            assert not store.task(partial['id'])['checkpoint']['research_flow']['draft']['gaps']
            model.partial_failure=False
            tools=ProjectTools(store,second);tools.set_scope(True)
            class Limited(Model):
                def complete(self,task,system,context,role,**kwargs):
                    if len(context['claims']) > 2:
                        self.calls['exhausted']+=1
                        raise ValueError('Harness 未正常完成：max-tokens')
                    return super().complete(task,system,context,role,**kwargs)
            tools.research=Limited()
            cid=store.task(second['id'])['evidence'][0]
            checks=[{'text':f'核验预算回归 {i}','citation_ids':[cid]} for i in range(5)]
            try: verify_claims(tools,checks)
            except ValueError as error: assert 'max-tokens' in str(error)
            else: raise AssertionError('Exhaustion must stop automatic verification')
            assert tools.research.calls['exhausted']==1
            tools.research=Model()
            assert len(verify_claims(tools,checks)['verdicts'])==5
            cached_calls=tools.research.calls.copy()
            verify_claims(tools,checks)
            assert tools.research.calls==cached_calls
            class InterruptedRepair(Model):
                repairs=0
                def complete(self,task,system,context,role,**kwargs):
                    if role in ('research-supplement','repair') and 'rejected' in context:
                        self.repairs+=1
                        if self.repairs==1: raise ValueError('Harness 未正常完成：max-tokens')
                        return {'fields':[]}
                    result=super().complete(task,system,context,role,**kwargs)
                    if role=='research-synthesis':
                        for node in result['nodes']:node['metrics']='补读恢复检查：未支持指标'
                    if role=='verify':
                        for claim,verdict in zip(context['claims'],result['verdicts']):
                            verdict['supported']=not claim['text'].startswith('补读恢复检查')
                    return result
            interrupted_model=InterruptedRepair();recoverable=task('生成技术演进，补读失败后继续')
            run(interrupted_model,recoverable)
            assert interrupted_model.repairs==0 and interrupted_model.calls['verify']==0
            # A paid draft must survive local validation/repair failures.
            from unittest.mock import patch
            frozen_model=Model();frozen_task=task('生成技术演进，恢复已生成草稿')
            with patch('backend.research_pipeline.preflight',side_effect=ValueError('local validation failed')):
                try: run(frozen_model,frozen_task)
                except ValueError: pass
                else: raise AssertionError('Expected validation failure')
            paid=frozen_model.calls['research-synthesis']
            checkpoint=store.task(frozen_task['id'])['checkpoint']
            checkpoint['research_flow'].update(verified=True,draft={'nodes':[]})
            store.update_active(frozen_task['id'],frozen_task['revision'],checkpoint=checkpoint)
            run(frozen_model,store.task(frozen_task['id']))
            assert frozen_model.calls['research-synthesis']==paid, 'Resume paid for the same synthesis twice'
            class RevisionModel(Model):
                def complete(self,task,system,context,role,**kwargs):
                    if role=='research-revision':
                        self.calls[role]+=1
                        return {'patches':[{'path':'/summary','value':'修订草稿'}]}
                    return super().complete(task,system,context,role,**kwargs)
            revision_model=RevisionModel()
            revision_task=store.task(first['id'])
            revision_tools=ProjectTools(store,revision_task);revision_tools.set_scope(True)
            revision_tools.research=revision_model
            saved=revision_task['checkpoint']['research_flow']['completed']
            baseline=revision_tools.read_file(saved['artifact_id'],saved['version_id'])
            with patch('backend.research_pipeline.preflight',side_effect=ValueError('local revision validation failed')):
                for _ in range(2):
                    state=store.task(first['id'])['checkpoint'].get('research_flow',{})
                    # Exercise the unfinished revision stage, not the baseline's completed draft.
                    try:revise(revision_model,revision_tools,baseline,{}, {'revision_patches':state.get('revision_patches')})
                    except ValueError:pass
                    else:raise AssertionError('Expected local validation failure')
            assert revision_model.calls['research-revision']==1, 'Revision patches regenerated after local failure'
            foreign=store.task(first['id'])['evidence'][0]
            try:tools.read_evidence([foreign])
            except ValueError:pass
            else:raise AssertionError('Cross conversation evidence leaked')
            assert plain('待核对事实 [cite:cite_123')=='待核对事实'
            assert exact_substring('The environ-\nment is safe.','environment is safe.')[2]=='environ-\nment is safe.'
            try:exact_substring('safe safe','safe')
            except ValueError:pass
            else:raise AssertionError('Ambiguous quote accepted')
            closed=[]
            handles={('task',1,str(i)):SimpleNamespace(close=lambda i=i:closed.append(i)) for i in range(2)}
            Research.cancel(SimpleNamespace(store=SimpleNamespace(),active_lock=threading.RLock(),active=handles),'task',1)
            assert sorted(closed)==[0,1], 'Cancel missed a parallel Worker'
            usage_task=task('用量去重检查')
            store.run('UPDATE tasks SET refs=? WHERE id=?',(json.dumps({'usage':[{'role':'main','model':'test','calls':2,'inputTokens':100}]}),usage_task['id']))
            recorder=SimpleNamespace(store=store,model='test')
            event={'type':'assistant/message','seq':1,'data':{'message':{'id':'unique-response'},'usage':{'inputTokens':10,'cacheReadTokens':30,'outputTokens':20,'reasoningTokens':5}}}
            for _ in range(2):Research.record_usage(recorder,usage_task,SimpleNamespace(events=[event]),'main',session_id='session')
            recorded=store.task(usage_task['id'])['refs']['usage'][0]
            assert recorded['calls']==3 and recorded['inputTokens']==110 and recorded['outputTokens']==20,'Usage lost legacy totals or counted callback twice'
            broken_task=task('生成技术演进，测试修复终止')
            broken=ProjectTools(store,broken_task);broken.set_scope(True)
            evidence=broken.read_material(papers[0])['evidence'][0]
            cid=broken.select_quote(evidence['id'],evidence['quote'].split(' Outdoor')[0])['evidence'][0]['id']
            class Broken:
                calls=0
                def complete(self,*args,**kwargs):
                    self.calls+=1
                    return {'patches':[]}
                def fail(self,t,error):store.update_active(t['id'],t['revision'],status='failed',error=str(error))
                def cancel(self,*args):pass
            broken.research=Broken()
            invalid={'view':'evolution','summary':'室内测试','nodes':[{'name':'方法','evidence':[cid]}],'gaps':[]}
            try:broken.call('write_file',{'title':'不能发布','kind':'html','content':json.dumps(invalid),'citation_ids':[cid]})
            except StaleRun:pass
            else:raise AssertionError('Exhausted repair did not end automatic attempt')
            assert broken.research.calls==1 and not service.task_view(project,broken_task['id'])['files']
            try:broken.call('read_material',{'paper_id':papers[0]})
            except StaleRun:pass
            else:raise AssertionError('Failed format repair allowed further research')
            write_task=task('生成论文关系，重复保存错误必须停止')
            writes=ProjectTools(store,write_task);writes.research=Broken()
            bad_graph={'title':'invalid graph','kind':'graph','content':'{}','citation_ids':[]}
            for _ in range(2):
                try:writes.call('write_file',bad_graph)
                except ValueError:pass
                else:raise AssertionError('Expected invalid graph')
            try:writes.call('write_file',bad_graph)
            except StaleRun:pass
            else:raise AssertionError('Repeated failed writes allowed unlimited model rounds')
            assert store.task(write_task['id'])['status']=='failed'
            assert store.task(write_task['id'])['checkpoint']['file_failure']['arguments']==bad_graph
            alias_task=task('保存失败保留引用身份')
            alias_tools=ProjectTools(store,alias_task);alias_tools.research=Broken()
            alias_tools.set_scope(True)
            evidence=alias_tools.read_material(papers[0])['evidence'][0]
            alias=alias_tools.references.alias(evidence['id'])
            graph={'focus':f'[cite:{alias}] [cite:E99]','all_papers':False,'unverified':[],
                'nodes':[{'paper_id':papers[0],'version_id':evidence['paper_version_id'],'title':'方法0','problem':'问题','approach':'方法','limitations':'待核对','citation_ids':[alias,'E99']}],
                'edges':[{'source':papers[0],'target':papers[0],'relationship':'比较','explanation':'待核对','citation_ids':[alias,'E99']}]}
            bad={'title':'invalid graph','kind':'graph','content':json.dumps(graph),'citation_ids':[alias,'E99']}
            try:alias_tools.call('write_file',bad)
            except ValueError:pass
            frozen=store.task(alias_task['id'])['checkpoint']['file_failure']['arguments']
            assert frozen['citation_ids']==[evidence['id'],'unresolved:E99']
            assert '[cite:'+evidence['id']+']' in frozen['content'] and '[cite:unresolved:E99]' in frozen['content']
            frozen_graph=json.loads(frozen['content'])
            assert frozen_graph['nodes'][0]['citation_ids']==frozen_graph['edges'][0]['citation_ids']==[evidence['id'],'unresolved:E99']
            malformed_task=task('生成成果，非法JSON必须停止')
            malformed=ProjectTools(store,malformed_task);malformed.research=Broken()
            try:malformed.call('write_file',{'title':'非法JSON','kind':'html','content':'{"view":"evolution",','citation_ids':[]})
            except StaleRun:pass
            else:raise AssertionError('Malformed JSON escaped terminal guard')
            assert store.task(malformed_task['id'])['checkpoint']['research_output_failure']['draft']=='{"view":"evolution",'
            stopped=task('生成技术演进，测试停止')
            store.run('UPDATE tasks SET revision=revision+1 WHERE id=?',(stopped['id'],))
            try:run(model,stopped)
            except StaleRun:pass
            else:raise AssertionError('Stale task wrote results')
            print('PASS fixed research delivery, two workers, rephrasing/cross-conversation cache, verification cache, restart/idempotency, quote offsets and stale task fences')
        finally:service.close()

if __name__=='__main__':main()
