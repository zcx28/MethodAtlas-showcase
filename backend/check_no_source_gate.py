"""Deliver analysis without a second source-verification or exact-quote gate."""
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from .app import Service
from .agent import ProjectTools
from .audit import render
from .research_cache import research_card
from .errors import task_presentation


def main():
    with tempfile.TemporaryDirectory() as directory, patch.object(Service,'schedule'):
        service=Service(Path(directory)/'missing',Path(directory))
        try:
            store=service.store;p=store.projects()[0]['id'];c=store.conversations(p)[0]['id']
            paper=store.paste(p,'长段材料','Method A uses point clouds. '*35)
            tid=service.message(p,c,{'text':'生成文献综述','client_message_id':'no-source-gate'})['task_id']
            store.run("UPDATE tasks SET status='running' WHERE id=?",(tid,))
            tools=ProjectTools(store,store.task(tid));tools.set_scope(False)
            cid=tools.read_material(paper)['evidence'][0]['id']
            def complete(task,system,context,role,**kwargs):
                if role=='paper':
                    return {'claims':[{'text':'方法使用点云','quotes':[{'id':context['evidence'][0]['id'],'quote':'中文概述，不是逐字原句'}]}],'gaps':[]}
                if role=='paper-select':return {'selected':[0],'gaps':[]}
                raise AssertionError('Unexpected verification/review call: '+role)
            tools.research=SimpleNamespace(complete=complete)
            saved=tools.call('write_file',{'title':'综述','kind':'docx','content':'方法分析 [cite:'+cid+']','citation_ids':[cid],'output_key':'broad'})
            assert tools.call('write_file',{'title':'综述','kind':'docx','content':'方法分析 [cite:'+cid+']','citation_ids':[cid],'output_key':'broad'})==saved
            card=research_card(tools,paper,'分析方法')
            assert card['card']['claims'] and card['card']['verified'] is False
            draft={'view':'comparison','summary':'研究范围','nodes':[{'name':'方法','summary':'分析概述','detail':'模型分析正文','conditions':None,'metrics':None,'limitations':None,'evidence':[]}],'gaps':[]}
            tools.call('write_file',{'title':'无逐句引用的分析','kind':'html','content':json.dumps(draft),'citation_ids':[],'output_key':'no-inline'})
            finding={'location':'模型描述的位置','quote':'并非逐字摘录','severity':'提示','finding':'分析意见','support':'全文核验','suggestion':'可继续研究','evidence_ids':[]}
            html,_=render({'summary':'审阅意见','limitations':[],'findings':[finding]}, {'title':'审阅'}, {'第一段':'原稿'}, {},tools.references,{},[],[])
            assert '分析意见' in html and '全文核验' not in html
            legacy=task_presentation({'status':'failed','error':'旧错误','refs':{'error_info':{'code':'evidence','message':'部分结论尚未通过原文核验，未作为正式成果保存。','action':'revise','incident_id':'old'}},'files':[]})
            assert legacy['error_info']['action']=='new_request' and legacy['error_info']['incident_id']=='old'
            assert '未通过原文核验' not in legacy['error']
            other=store.create_project('其他项目');foreign=store.paste(other,'外部','材料')
            try:tools.read_material(foreign)
            except ValueError:pass
            else:raise AssertionError('Project boundary removed')
            print('PASS: broad citations, non-exact extracts, no-citation analysis, audit save, legacy resume, idempotency and project isolation')
        finally:service.close()


if __name__=='__main__':main()
