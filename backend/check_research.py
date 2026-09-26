"""Real #14 five-paper review artifacts; no canned model responses or conclusions."""
import hashlib
import json
import os
import time
from pathlib import Path

from .app import Service


def main():
    if not os.getenv('DEEPSEEK_API_KEY'):
        raise SystemExit('DEEPSEEK_API_KEY missing; no model call attempted')
    data = Path(os.getenv('METHODATLAS_CHECK_DATA', '.methodatlas-data/issue-14-five'))
    service = Service(Path(os.getenv('METHODATLAS_PDF_DIR', '论文')), data)
    try:
        project = service.store.projects()[-1]['id']
        chosen = [p['id'] for p in service.store.papers(project) if p['title'].startswith(('01_', '02_', '04_', '06_', '10_'))]
        assert len(chosen) == 5, 'Needs RT-1, RT-2, Diffusion Policy, OpenVLA and DP3'
        conversation = os.getenv('METHODATLAS_REVIEW_CONVERSATION') or service.store.create_conversation(project)
        prompt = ('仅基于勾选的 RT-1、RT-2、Diffusion Policy、OpenVLA、DP3，研究机器人操作学习的路线与方法差异。'
                  '请逐篇分段读取可用正文，围绕问题整理方法、实验条件、结果和局限，再综合。不要仅凭摘要或几个搜索命中。'
                  '交付可阅读的中文综述 DOCX，以及一份包含方法关系可视化和对比的 HTML，HTML 原文引用可点击。'
                  '写法按材料自然组织，不要求固定章节或字数。不同数据集、指标和条件不混同排名；'
                  '交付前回读关键结论原文，保留冲突、不确定性和文字缺口。成果供我评阅，不代表已经获得认可。')
        if os.getenv('METHODATLAS_REVIEW_CONVERSATION'):
            prompt += ' 上次调用中断，请复用本对话保存的原文证据，补齐未取得的材料与核对后完成交付，不必从头重复已读内容。'
        submitted = service.message(project, conversation, {'text':prompt, 'selected_paper_ids':chosen, 'client_message_id':conversation + '-' + str(time.time_ns())})
        task_id = submitted['task_id']
        print(json.dumps({'project':project, 'conversation':conversation, 'task':task_id, 'data':str(data.resolve())}), flush=True)
        last = None
        while True:
            task = service.task_view(project, task_id)
            progress = (task['status'], len(task['events']))
            if progress != last:
                print(json.dumps({'status':task['status'], 'events':progress[1], 'action':task['events'][-1]['message'] if task['events'] else ''}, ensure_ascii=False), flush=True)
                last = progress
            if task['status'] in ('succeeded','failed','interrupted'):
                break
            time.sleep(2)
        report = {'project':project, 'conversation':conversation, 'task':task_id, 'status':task['status'],
                  'error':task['error'], 'snapshot':task['snapshot'], 'coverage':task['coverage'],
                  'user_review':'pending', 'semantic_review':'pending', 'files':[], 'evidence':[]}
        report['reading_tasks'] = [{'task':r['id'], 'status':r['status'], 'coverage':json.loads(r['coverage'])}
                                  for r in service.store.all('SELECT id,status,coverage FROM tasks WHERE conversation_id=? ORDER BY created', (conversation,))]
        # Mechanical provenance checks do not assert that a quote entails a model claim.
        for citation in task['citations']:
            paper = service.store.paper(project, citation['paper_id'], citation['paper_version_id'])
            pages = json.loads(paper['pages'])
            page = pages[citation['page'] - 1]
            block = next(b for b in page['blocks'] if b['block'] == citation['block'])
            assert page['text'][citation['start']:citation['end']] == citation['quote'] == block['text']
            assert block['rect'] == citation['rect']
            assert hashlib.sha256(Path(paper['source_path']).read_bytes()).hexdigest() == paper['sha256']
            report['evidence'].append(citation)
        for file in task['files']:
            version = service.file_version(project, file['artifact_id'], file['version_id'])
            path = service.file_path(project, version)
            report['files'].append({**file, 'path':str(path), 'sha256':version['payload']['sha256']})
        destination = data / (task_id + '-review.json')
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Review record: ' + str(destination.resolve()), flush=True)
        assert task['status'] == 'succeeded', task['error']
        assert {f['kind'] for f in task['files']} == {'docx','html'}, 'Both review artifacts must exist'
        assert {c['paper_id'] for c in task['citations']} == set(chosen), 'Some selected papers have no evidence'
        print('Real artifacts saved; human content review and subsequent 20-paper validation remain pending.', flush=True)
    finally:
        service.close()


if __name__ == '__main__':
    main()
