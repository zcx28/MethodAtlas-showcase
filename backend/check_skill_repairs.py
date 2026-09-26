"""Replay format failures at the real quote and JSON boundaries, without model calls."""
from .agent import exact_substring
from .research_context import parse_object

def main():
    from .research_context import References
    refs=References(); cid='cite_'+'1'*32; refs.alias(cid)
    assert refs.decode('[citation:E1]')=='[cite:'+cid+']'
    source='With the policy architec-\nture fixed, transfer improves.'
    assert exact_substring(source,'With the policy architec-ture fixed, transfer improves.')[2] == source
    assert parse_object("{'view': 'evolution', 'nodes': [], 'summary': '原始文本'}")['view']=='evolution'
    assert parse_object('说明\n{"nodes":[{"text":"原话"],"gaps":[]}\n结束') == {'nodes':[{'text':'原话'}],'gaps':[]}
    from .delivery_check import table_arithmetic
    table=table_arithmetic('|配置|A|B|\n|---|---|---|\n|baseline|36.0|36.0|\n|sim|65.3|57.3|')
    assert table[0]['absolute_column_gaps']['A / B']=={'baseline':'0.0','sim':'8.0'}
    for text in ("__import__('os').system('echo unsafe')", "{'x': set([1])}"):
        try:parse_object(text)
        except (ValueError,SyntaxError):pass
        else:raise AssertionError('Executable expression accepted')
    try:exact_substring('The action-specific loss decreased.','The actionspecific loss decreased.')
    except ValueError:pass
    else:raise AssertionError('Lexical hyphen silently removed')
    from .research_pipeline import compact_delivery
    a='cite_'+'a'*32;b='cite_'+'b'*32
    draft={'view':'comparison','summary':'有据比较','nodes':[{'name':'方法','summary':'概述 [cite:'+a+']','detail':'机制 [cite:'+a+']','metrics':None,'conditions':'待核对','limitations':None,'evidence':['[cite:'+a+']','[cite:'+b+']']}],'gaps':['未通过的内部核验原因']}
    compact_delivery(draft)
    assert draft['nodes'][0]['evidence']==['[cite:'+a+']'] and draft['nodes'][0]['conditions'] is None and draft['gaps']==[]
    from .methods import render
    markup,_=render(__import__('json').dumps(draft),[{'id':a}])
    assert '<h2>方法</h2>' in markup and b not in markup and '待核对' not in markup
    import tempfile,json
    from pathlib import Path
    from types import SimpleNamespace
    from .app import Service
    from .agent import ProjectTools
    with tempfile.TemporaryDirectory() as folder:
        service=Service(Path(folder)/'missing',Path(folder));service.schedule=lambda:None
        try:
            store=service.store;p=store.create_project('check');c=store.conversations(p)[0]['id']
            paper=store.paste(p,'Source','Score was 70.3. Score became 69.3. Unused background.')
            tid=service.message(p,c,{'text':'生成结果分析','selected_paper_ids':[paper],'client_message_id':'review'},schedule=False)['task_id']
            store.run("UPDATE tasks SET status='running',kind='research',checkpoint=? WHERE id=?",(json.dumps({'route':{'skills':['research-result-to-claim']}}),tid))
            tools=ProjectTools(store,store.task(tid));tools.set_scope(True)
            cites=tools.read_material(paper,query='',limit=4)['evidence'];calls=[]
            def complete(task,system,context,role,**kwargs):
                calls.append(role);assert role=='delivery-review'
                assert list(context['quotes'])==['Q1','Q2','Q3']
                return {'content':'下降1个百分点。[cite:Q1][cite:Q2]','citation_ids':['Q1','Q2','Q3']}
            tools.research=SimpleNamespace(complete=complete)
            args={'title':'结果','kind':'docx','content':'数值不降。','citation_ids':[cites[0]['id']]}
            saved=tools.write_file(**args);tools.write_file(**args)
            assert len(store.artifact(p,saved['artifact_id'])['versions'][-1]['citations'])==2
            assert calls==['delivery-review'],calls
            assert len(store.task(tid)['checkpoint']['delivery_checks'])==1
            def bad(*args,**kwargs):return {'content':'不完整引用。[cite:Q999]','citation_ids':['Q1']}
            tools.research=SimpleNamespace(complete=bad,fail=service.research.fail)
            for _ in range(2):
                try:tools.call('write_file',{**args,'content':'另一份草稿'})
                except ValueError as error:assert 'citation_ids' in str(error)
                else:raise AssertionError('Unlisted citation accepted')
            assert tools.write_failures==2

        finally:service.close()
    print('PASS quote line-wrap variants and literal-only model JSON recovery')

if __name__=='__main__':main()
