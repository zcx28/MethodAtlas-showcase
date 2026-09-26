"""Selection boundaries, structured replacements and immutable chat snapshots."""
import copy
import tempfile
from pathlib import Path
from unittest.mock import patch
from .app import Service
from .writing import selection_parts, selection_text, replace_selection


def rejects(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError('Invalid selection was accepted')


def main():
    nodes = [
        {'id':'a','type':'h2','children':[{'text':'前😀标题','bold':True}]},
        {'id':'b','type':'ul','children':[
            {'type':'li','children':[{'text':'列表甲'},{'type':'citation','citation_id':'protected','children':[{'text':''}]},{'text':'引用后'}]},
            {'type':'li','children':[{'text':'列表乙结尾','italic':True}]}]},
    ]
    selection = {'anchor':{'path':[1,1,0],'offset':3},'focus':{'path':[0,0],'offset':3}}
    parts = selection_parts(nodes,selection)
    assert [p['text'] for p in parts] == ['标题','列表甲','引用后','列表乙']
    revised = replace_selection(nodes, parts, ['新标题','条目甲','参考后','条目乙'])
    assert revised[0]['children'][0] == {'text':'前😀','bold':True}
    assert revised[1]['children'][0]['children'][3] == nodes[1]['children'][0]['children'][1]
    assert revised[1]['children'][1]['children'][-1] == {'text':'结尾','italic':True}
    assert [n['type'] for n in revised] == ['h2','ul']
    assert len(revised[1]['children']) == 2
    rejects(lambda: replace_selection(nodes,parts,['wrong count']))
    rejects(lambda: selection_parts(nodes,{'anchor':{'path':[0,0],'offset':2},'focus':{'path':[0,0],'offset':4}}))
    table = [{'id':'t','type':'table','children':[{'type':'tr','children':[{'type':'td','children':[{'type':'p','children':[{'text':'单元格'}]}]}]}]}]
    table_range = {'anchor':{'path':[0,0,0,0,0],'offset':0},'focus':{'path':[0,0,0,0,0],'offset':3}}
    assert selection_text(table,table_range) == '单元格'
    rejects(lambda: selection_parts(table,table_range))
    formula=[{'id':'eq','type':'equation','formula':'E=mc^2','children':[{'text':''}]}]
    formula_range={'anchor':{'path':[0],'offset':2},'focus':{'path':[0],'offset':6}}
    assert selection_text(formula,formula_range)=='mc^2'
    rejects(lambda:selection_parts(formula,formula_range))
    with tempfile.TemporaryDirectory() as directory:
        service = Service(Path(directory)/'papers',Path(directory))
        try:
            project = service.store.create_project('选区回归')
            conversation = service.store.conversations(project)[0]['id']
            document = [nodes[0], {'id':'b','type':'ul','children':[nodes[1]['children'][1]]}]
            saved = service.writing.save(project,None,{'request_id':'create','title':'文档','document':document})
            aid = saved['artifact_id']
            selected = {'anchor':{'path':[0,0],'offset':3},'focus':{'path':[1,0,0],'offset':3}}
            fragment = {'artifact_id':aid,'version_id':saved['version_id'],'selection':selected,'text':'标题\n列表乙'}
            body = {'text':'请解释选中的内容','client_message_id':'message','selected_fragments':[fragment]}
            result = service.message(project,conversation,body,schedule=False)
            task = service.store.task(result['task_id'])
            assert service.research.context(task)['selected_fragments'][0]['text'] == fragment['text']
            assert service.message(project,conversation,body,schedule=False)['duplicate']
            invalid = copy.deepcopy(body);invalid['client_message_id']='bad';invalid['selected_fragments'][0]['text']='伪造'
            rejects(lambda: service.message(project,conversation,invalid,schedule=False))
            other = service.store.create_project('其他项目')
            rejects(lambda: service.message(other,service.store.conversations(other)[0]['id'],body,schedule=False))
            request = {'request_id':'edit','base_version_id':saved['version_id'],'instruction':'改写标题和条目','mode':'edit','selection':selected}
            service.research.key = 'check-only'
            def complete(task,system,context,*args):
                assert context['selection_parts']==['标题','列表乙'] and '前😀' in context['surrounding_text']
                return {'texts':['新标题','新条目'],'summary':'局部改写'}
            with patch.object(service.research,'complete',complete):
                item = service.writing.propose(project,aid,request)
            assert item['proposals'][-1]['status']=='pending',item['proposals'][-1]
            assert len(item['versions'])==1
            accepted = service.writing.decide(project,aid,'edit','accept')
            assert accepted['versions'][-1]['payload']['document'][1]['type']=='ul'
            assert len(accepted['versions'])==2
            # Sending the old selected snapshot after editing still resolves its old version.
            body['client_message_id']='old-snapshot'
            result = service.message(project,conversation,body,schedule=False)
            assert service.store.task(result['task_id'])['refs']['selected_fragments'][0]['text']=='标题\n列表乙'
            # Same id must not replay another snapshot.
            invalid=copy.deepcopy(body);invalid['selected_fragments']=[]
            rejects(lambda:service.message(project,conversation,invalid,schedule=False))
        finally:
            service.close()
    print('PASS: multi-block/list/citation/UTF-16 selection, table quote-only, proposal review, snapshot version/isolation/idempotency')


if __name__=='__main__':
    main()
