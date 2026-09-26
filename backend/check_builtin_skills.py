"""New skill loading, deterministic layout and exact RAG quotes without paid calls."""
import json
import io
import tempfile
from pathlib import Path
from unittest.mock import patch
from docx import Document

from .research_skills import SKILLS, research_skills, runtime_skills, selected_skills
from .files import render_file
from .app import Service
from .agent import ProjectTools
from .rag import run


def main():
    from .state import canonical_citation_id
    assert canonical_citation_id('cite:cite_'+'a'*32) == 'cite_'+'a'*32
    assert canonical_citation_id('cite:unknown') == 'cite:unknown'
    assert len(SKILLS) == 8
    for name in SKILLS:
        with patch('deepseek_harness.DeepSeekHarness') as harness, tempfile.TemporaryDirectory() as folder:
            service = Service(Path(folder)/'no-import',Path(folder))
            service.research.key = 'test-only'
            task = {'id':'check','revision':0,'project_id':'p','conversation_id':'c','refs':{},'prompt':'按所选技能分析','kind':'research','checkpoint':{'route':{'skills':[name]}}}
            service.research.runtime(task,'protocol','rag-write')
            config = json.loads(Path(harness.call_args.kwargs['patches'][0]).read_text())
            prompt = next(p['config']['personaPrefix'] for p in config if p.get('id')=='system-prompt')
            assert prompt.count('# MethodAtlas 内置研究成果规范') == 1
            assert research_skills([name],shared=False) in prompt and 'Mimir' not in prompt
            service.close()
    assert runtime_skills({'checkpoint':{'route':{'research_view':'evolution'}}},'research-synthesis') == ['research-evolution']
    assert runtime_skills({'checkpoint':{'route':{'research_view':'evolution'}}},'research-revision') == ['research-evolution']
    assert selected_skills({'kind':'research','prompt':'不要生成文献综述，请生成实验计划','checkpoint':{'route':{'skills':['research-experiment-plan']}}}) == ['research-experiment-plan']
    assert selected_skills({'kind':'research','prompt':'生成文献综述，再生成实验计划','checkpoint':{}}) == ['research-lit-review','research-experiment-plan']
    assert runtime_skills({},'vision-read') == ['research-figure-reading']
    assert runtime_skills({},'verify-claims') == []
    assert selected_skills({'kind':'research','prompt':'生成结果分析','checkpoint':{'route':{'audit':'review'}}}) == ['research-result-to-claim']
    _, body = render_file('html','报告','<style>p{display:none}</style><p style="height:10px;overflow:scroll">真实结论</p>',[],flat=True)
    assert '真实结论' in body and 'p{display:none}' not in body and 'height:10px' not in body
    raw, _ = render_file('docx','研究简报：完整标题','\n# 研究简报\n\n## 证据\n正文',[],flat=True)
    assert [p.text for p in Document(io.BytesIO(raw)).paragraphs] == ['研究简报：完整标题','证据','正文']
    try:render_file('html','报告','<button>重置布局</button>',[],flat=True)
    except ValueError:pass
    else:raise AssertionError('Built-in output accepted navigation controls')
    with tempfile.TemporaryDirectory() as folder:
        service = Service(Path(folder)/'no-import',Path(folder));service.schedule=lambda:None
        try:
            s=service.store;p=s.create_project('精确引用');c=s.conversations(p)[0]['id']
            material=s.paste(p,'原始材料','Prior work exists. '+('Context sentence. '*40)+'Comparison is required.')
            routed=service.message(p,c,{'text':'生成结果分析','client_message_id':'route-result','selected_paper_ids':[material]},schedule=False)['task_id']
            with patch.object(service.research,'settings') as settings, patch.object(service.research,'complete',return_value={'intent':'research','mode':'explore','audit':'review','only_selected':True}):
                settings.for_task.return_value=({'api_key':'test-only','protocol':'deepseek'}, {})
                service.route(routed)
            assert 'audit' not in s.task(routed)['checkpoint']['route']
            assert s.task(routed)['checkpoint']['route']['skills'] == ['research-result-to-claim']
            s.run("UPDATE tasks SET status='stopped' WHERE id=?",(routed,))
            sent=service.message(p,c,{'text':'生成文献综述','client_message_id':'quotes','selected_paper_ids':[material]},schedule=False)
            tid=sent['task_id'];s.run("UPDATE tasks SET kind='research',status='running' WHERE id=?",(tid,))
            route={'mode':'rag','only_selected':True,'skills':['research-lit-review'],'reads':[{'paper_id':material,'query':'work'}],'files':[]}
            s.update_active(tid,s.task(tid)['revision'],checkpoint={'route':route});task=s.task(tid)
            calls=[]
            def complete(task,system,context,role,*args):
                calls.append(role);source=context['evidence'][0]['evidence'][0]['id']
                return {'answer':'已按原文分析','files':[{'title':'研究简报','kind':'docx','content':'已有研究。[cite:Q1]\n\n仍需对照。[cite:Q2]','citation_ids':['Q1','Q2'],'evidence_quotes':[{'id':'Q1','source_id':source,'quote':'Prior work exists.'},{'id':'Q2','source_id':source,'quote':'Comparison is required.'}]}]}
            tools=ProjectTools(s,task)
            tools.set_scope(True)
            broad=tools.read_material(material,query='work',limit=4)['evidence'][0]['id']
            tools.write_file('长段引用可保存','docx','已有研究。',[broad])
            with patch.object(service.research,'complete',side_effect=complete),patch.object(tools,'select_quote',side_effect=AssertionError('Exact quote gate must not run')):
                run(service.research,task,tools,{})
            assert s.task(tid)['checkpoint']['generated_draft'] and calls==['rag-write']
            task=s.task(tid);tools=ProjectTools(s,task)
            with patch.object(service.research,'complete',side_effect=AssertionError('Paid draft regenerated')):
                run(service.research,task,tools,{})
            artifact=s.artifact(p,s.task(tid)['artifact_id'])['versions'][0]
            assert artifact['citations'] and 'Prior work exists.' in artifact['citations'][0]['quote']
            assert '[cite:Q' not in artifact['body'] and len(artifact['citations'])==1
        finally:service.close()
    print('PASS: eight first-party skills in Harness; layout isolation; direct source references; cached drafts without quote verification')


if __name__=='__main__':main()
