"""Public-boundary regression for preserving unedited research and checking overview facts."""
import copy
import json
import tempfile
from pathlib import Path

from .app import Service
from .agent import ProjectTools
from .research_pipeline import run


def main():
    with tempfile.TemporaryDirectory() as tmp:
        service = Service(Path(tmp)/'missing',Path(tmp))
        try:
            store=service.store
            project=store.projects()[0]['id']; conversation=store.conversations(project)[0]['id']
            papers=[store.paste(project,'方法'+str(i),f'Method {i} was evaluated indoors in 2024. Success is 80%.') for i in range(2)]
            def task(prompt,selected):
                tid=service.message(project,conversation,{'text':prompt,'selected_paper_ids':selected,'client_message_id':prompt},schedule=False)['task_id']
                store.run("UPDATE tasks SET status='running',kind='research' WHERE id=?",(tid,))
                return store.task(tid)
            first=task('生成方法地图',papers)
            tools=ProjectTools(store,first);tools.set_scope(True)
            citations=[tools.read_material(p)['evidence'][0]['id'] for p in papers]
            nodes=[{'name':'方法'+str(i),'summary':'室内方法','detail':'仅限室内','conditions':'室内','metrics':'80%','limitations':'室外待核对','evidence':['[cite:'+cid+']']} for i,cid in enumerate(citations)]
            original={'view':'methods','title':'方法地图','summary':'室内方法','nodes':nodes,'gaps':[],'opportunities':[]}
            saved=tools.call('write_file',{'title':'方法地图','kind':'html','content':json.dumps(original),'citation_ids':citations})
            second=task('只把第一个节点的summary改为室内评估方法',[papers[0]])
            store.run('UPDATE tasks SET checkpoint=?,refs=? WHERE id=?',(json.dumps({'route':{'research_view':'methods','only_selected':True,'revise_research':True}}),json.dumps({'reference':saved}),second['id']))
            class Model:
                def __init__(self):self.store=store;self.calls=[]
                def complete(self,task,system,context,role,**kwargs):
                    self.calls.append(role)
                    if role=='research-revision':
                        assert '/nodes/1/summary' not in context['allowed_paths']
                        return {'patches':[{'path':'/nodes/0/summary','value':'室内评估方法'}]}
                    if role=='verify':return {'verdicts':[{'index':c['index'],'supported':'虚构' not in c['text'],'reason':'原文核对'} for c in context['claims']]}
                    raise AssertionError(role)
            model=Model();run(model,store.task(second['id']))
            version=store.artifact(project,saved['artifact_id'])['versions'][-1]
            expected=copy.deepcopy(original);expected['nodes'][0]['summary']='室内评估方法'
            assert version['payload']['research']==expected,'Unrequested fields changed'
            assert model.calls==['research-revision'],'Wording revision reread papers'
            third=task('仅修改当前成果名称，不勾选材料',[])
            store.run('UPDATE tasks SET checkpoint=?,refs=? WHERE id=?',(json.dumps({'route':{'research_view':'methods','only_selected':True,'revise_research':True}}),json.dumps({'reference':{'artifact_id':saved['artifact_id'],'version_id':version['id']}}),third['id']))
            model.complete=lambda task,system,context,role,**kwargs: {'patches':[]} if role=='research-revision' else {'verdicts':[]}
            run(model,store.task(third['id']))
            print('PASS scoped field revision preserves other nodes, no extraction, no automatic source verification')
        finally:service.close()


if __name__=='__main__':main()
