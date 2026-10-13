"""Bounded RAG, partial failures and explicit exploration without paid calls."""
from types import SimpleNamespace
from unittest.mock import patch
import json
import tempfile
from pathlib import Path
from .rag import run
from .research_context import References


def main():
    events, calls, inputs = [], [], []
    plan = {'mode':'rag', 'only_selected':True, 'reads':[{'paper_id':'a','query':'method'}, {'paper_id':'b','query':'method'}], 'files':[]}
    def complete(task, system, context, role, *args):
        inputs.append((role, context))
        return plan if role == 'rag-plan' else {'answer':'部分依据尚待核对。', 'files':[]}
    def call(name, args):
        calls.append(name)
        if name == 'read_material':
            if args['paper_id'] == 'a':
                raise TimeoutError('source unavailable')
            return {'evidence':[{'id':'cite_a','paper_id':'b','paper_version_id':'v','title':'B','page':1,'block':0,'quote':'The method works.'}]}
        return {}
    from .app import Service
    temporary = tempfile.TemporaryDirectory()
    with patch.object(Service, 'schedule'):
        service = Service(Path(temporary.name)/'empty',Path(temporary.name))
        project = service.store.projects()[0]['id']
        conversation = service.store.conversations(project)[0]['id']
        tid = service.message(project,conversation,{'text':'研究','client_message_id':'rag-check'})['task_id']
    service.store.run("UPDATE tasks SET status='running' WHERE id=?",(tid,))
    task = service.store.task(tid)
    research = SimpleNamespace(complete=complete, store=service.store)
    tools = SimpleNamespace(call=call, allowed={'a':{}, 'b':{}}, read_versions=set(), references=References(), list_files=lambda:{'files':[]})
    assert run(research, task, tools, {}) == '部分依据尚待核对。'
    assert [role for role, _ in inputs] == ['rag-plan','rag-write']
    assert len(inputs[-1][1]['gaps']) == 1 and len(inputs[-1][1]['evidence']) == 1
    assert calls == ['set_scope','read_material','read_material']
    original_reads, original_call = plan['reads'], tools.call
    plan['reads'] = [{'paper_id':'b','query':str(i)} for i in range(5)]
    def duplicate_reads(name,args):
        if name!='read_material':return {}
        last=args['query']=='4'
        return {'evidence':[{'id':'cite_unique' if last else 'cite_repeat','paper_id':'b','paper_version_id':'v','title':'B','page':2 if last else 1,'block':0,'quote':'Direct comparison.'*120 if last else 'General background. '*790}]}
    tools.call=duplicate_reads
    run(research,task,tools,{})
    quotes=[e['quote'] for result in inputs[-1][1]['evidence'] for e in result['evidence']]
    assert len(quotes)==2 and any('Direct comparison.' in q for q in quotes), 'Repeated snippets exhausted budget and displaced distinct comparison evidence'
    plan['files']=[{'artifact_id':'saved','version_id':'v1'}]
    def baseline_reads(name,args):
        if name=='read_file':return {'id':'v1','artifact_id':'saved','title':'Saved','kind':'docx','version_no':1,'body':'Previously saved analysis','citations':duplicate_reads('read_material',{'query':'0'})['evidence']}
        if name=='read_evidence':return duplicate_reads('read_material',{'query':'0'})
        return duplicate_reads(name,args)
    tools.call=baseline_reads
    run(research,task,tools,{})
    quotes=[e['quote'] for result in inputs[-1][1]['evidence'] for e in result['evidence']]
    assert len(quotes)==2, 'Reading an existing artifact repeats already included evidence'
    def oversized_baseline(name,args):
        if name=='read_evidence':
            return {'evidence':[{**duplicate_reads('read_material',{'query':'0'})['evidence'][0], 'id':'cite_large','quote':'x'*48001}]}
        return baseline_reads(name,args)
    tools.call=oversized_baseline
    assert run(research,task,tools,{}) is None, 'Distinct oversized baseline evidence bypassed budget'
    plan['files']=[]
    plan['reads'], tools.call = original_reads, original_call
    plan['mode'], plan['reason'] = 'explore', '全文覆盖需要逐段追查'
    calls.clear(); inputs.clear()
    assert run(research, task, tools, {}) is None
    assert len(inputs) == 1 and not calls and '升级 Agent' in service.store.events(tid)[-1]['message']
    plan['mode'] = 'rag'; plan['reads'][0]['paper_id'] = 'outside'
    try:
        run(research, task, tools, {})
    except ValueError as error:
        assert '超出材料范围' in str(error)
    else:
        raise AssertionError('out-of-scope retrieval accepted')
    plan['reads'] = []
    plan['files'] = [{'artifact_id':'file', 'version_id':'v1'}]
    tools.call = lambda name, args: {'body':'x' * 60001} if name == 'read_file' else {}
    tools.read_versions.add('v1')
    context = {}
    with patch('backend.rag.model_view', side_effect=lambda name, result, refs: result):
        assert run(research, task, tools, context) is None
    assert context['previous_scope'] == 'selected'
    assert context['pipeline_handoff']['baselines'] == plan['files']
    assert context['pipeline_handoff']['read_versions'] == ['v1']
    assert len(str(context)) < 1000
    calls.clear(); inputs.clear()
    plan = {'mode':'direct','intent':'chat','only_selected':False,'answer':'你好！'}
    assert run(research, task, tools, {}) == '你好！'
    assert len(inputs) == 1 and not calls
    plan['answer'] = '虚构引用[cite:unknown]'
    try:
        run(research, task, tools, {})
    except ValueError:
        pass
    else:
        raise AssertionError('direct answer accepted unsupported citation')
    service.close(); temporary.cleanup()
    from .agent import Research
    with tempfile.TemporaryDirectory() as directory, patch('deepseek_harness.DeepSeekHarness') as runtime:
        from .state import Store
        store = Store(Path(directory)/'check.sqlite3')
        research = Research(store)
        research.key = 'check-only'
        research.runtime({'project_id':'p','conversation_id':'c','id':'task','revision':0,'refs':{},'prompt':''}, 'route', 'rag-plan')
        store.close()
        config = json.loads(Path(runtime.call_args.kwargs['patches'][0]).read_text(encoding='utf-8'))
        assert next(p for p in config if p.get('id') == 'llm-deepseek')['config']['reasoningEffort'] == 'off'
    print('PASS: two-turn pipeline, partial failure stays RAG, explicit exploration, scope rejection')


if __name__ == '__main__':
    main()
