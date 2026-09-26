"""Run: python -m backend.check_collection; no model or network required."""
import json
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

from .agent import ProjectTools
from .app import Service
from .check_sources import sample_pdf
from .discovery import download_collected, import_confirmed


def check():
    candidates = [{'source':'openalex','external_id':f'https://openalex.org/W{i}',
        'title':f'Image method {i}','authors':['A. Author'],'summary':f'Method {i} learns visual actions.',
        'url':f'https://doi.org/10.1234/paper{i}','pdf_url':f'https://example.com/paper{i}.pdf' if i < 2 else None}
        for i in range(8)]
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory, patch.object(Service,'schedule'), patch.object(Service,'schedule_downloads'), patch('backend.discovery.discover',return_value={'candidates':candidates,'sources':[]}):
        service = Service(Path(directory)/'missing',Path(directory))
        store = service.store
        project = store.projects()[0]['id']
        conversation = store.conversations(project)[0]['id']
        tid = service.message(project,conversation,{'text':'Find eight related papers','client_message_id':'eight'})['task_id']
        store.run("UPDATE tasks SET status='running' WHERE id=?",(tid,))
        tools = ProjectTools(store,store.task(tid)); tools.set_scope(False)
        found = tools.call('search_papers',{'query':'Find eight related papers'})
        assert len(found['candidates']) == 8 and not store.papers(project)
        assert store.task(tid)['status'] == 'running'
        ids = [c['id'] for c in found['candidates']]
        body = {'wait_id':found['search_id'],'candidate_ids':[ids[0]]}
        try:
            service.control(project,conversation,tid,'collect-papers',body)
            raise AssertionError('Draft collection allowed')
        except ValueError:
            pass
        tools.call('present_papers',{'search_id':found['search_id'],'summary':'找到八篇相关方法，均可打开原始来源。',
            'papers':[{'candidate_id':cid,'reason':'补充视觉动作学习方法的比较。'} for cid in ids]})
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(tid,))
        baseline = store.task(tid)['snapshot']
        other = store.create_project('Other')
        for pid, request in [(other,body),(project,{**body,'candidate_ids':['invented']})]:
            try:
                service.control(pid,conversation,tid,'collect-papers',request)
                raise AssertionError('Invalid collection allowed')
            except ValueError:
                pass
        service.control(project,conversation,tid,'collect-papers',body)
        service.control(project,conversation,tid,'collect-papers',body)
        assert len(store.papers(project)) == 1
        assert store.task(tid)['status'] == 'succeeded' and store.task(tid)['snapshot'] == baseline
        paper = store.papers(project)[0]; old_version = paper['current_version_id']
        assert json.loads(paper['availability'])['fulltext'] == 'pending'
        began, release = threading.Event(), threading.Event()
        def delayed(url):
            began.set(); assert release.wait(5)
            raise TimeoutError('controlled timeout')
        with patch('backend.literature._download_pdf',side_effect=delayed):
            thread = threading.Thread(target=download_collected,args=(store,project,paper['id']))
            thread.start(); assert began.wait(2)
            # Download is not holding the database lock; the UI sees metadata immediately.
            assert service.project_state(project)['papers'][0]['availability']['fulltext'] == 'pending'
            release.set(); thread.join(5); assert not thread.is_alive()
        assert json.loads(store.paper(project,paper['id'])['availability'])['fulltext'] == 'failed'
        assert store.paper(project,paper['id'])['version_id'] == old_version
        # A partial selection survives restart and does not reject the remaining candidates.
        service.close(); service = Service(Path(directory)/'missing',Path(directory)); store = service.store
        assert store.task_view(tid)['waits'][0]['response']['candidate_ids'] == [ids[0]]
        service.control(project,conversation,tid,'collect-papers',{'wait_id':found['search_id'],'all':True})
        service.control(project,conversation,tid,'collect-papers',{'wait_id':found['search_id'],'all':True})
        assert len(store.papers(project)) == 8
        assert len(store.task_view(tid)['waits'][0]['response']['candidate_ids']) == 8
        assert store.task(tid)['status'] == 'succeeded' and not store.reading_history(conversation)
        downloading = next(p for p in store.papers(project) if json.loads(p['availability'])['fulltext'] == 'pending')
        abstract_version = downloading['current_version_id']
        with patch('backend.literature._download_pdf',return_value=sample_pdf('Full text method')):
            download_collected(store,project,downloading['id'])
        assert store.paper(project,downloading['id'])['version_id'] != abstract_version
        assert store.paper(project,downloading['id'],abstract_version)['version_id'] == abstract_version
        # Legacy importer must not interpret the incremental response as an all-or-nothing choice.
        import_confirmed(store,store.task(tid))
        assert len(store.papers(project)) == 8
        next_id = service.message(project,conversation,{'text':'Compare collected papers','client_message_id':'next'})['task_id']
        assert len(store.task(next_id)['snapshot']) == 8
        store.run("UPDATE tasks SET status='running' WHERE id=?",(next_id,))
        followup = ProjectTools(store,store.task(next_id)); followup.set_scope(False)
        assert not followup.search_papers('Search again')['candidates'], 'Existing papers must not be offered again'
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(next_id,))
        next_id = service.message(project,conversation,{'text':'Find more related papers','client_message_id':'more'})['task_id']
        store.run("UPDATE tasks SET status='running' WHERE id=?",(next_id,))
        followup = ProjectTools(store,store.task(next_id)); followup.set_scope(False)
        # All means the whole turn, even when the Agent searches twice.
        searches = []
        for i in (8,9):
            extra = {**candidates[2],'external_id':f'https://openalex.org/W{i}',
                     'title':f'Additional method {i}','url':f'https://doi.org/10.1234/paper{i}'}
            with patch('backend.discovery.discover',return_value={'candidates':[extra],'sources':[]}):
                found = followup.search_papers(f'Additional query {i}')
            followup.present_papers(found['search_id'],'补充相关方法。',[{'candidate_id':found['candidates'][0]['id'],'reason':'补充不同实验路线。'}])
            searches.append(found['search_id'])
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(next_id,))
        service.control(project,conversation,next_id,'collect-papers',{'wait_id':searches[-1],'all':True})
        assert len(store.papers(project)) == 10
        # A late background result cannot replace a PDF the user supplied meanwhile.
        store.run("UPDATE papers SET availability=? WHERE id=?",(json.dumps({'fulltext':'pending'}),paper['id']))
        began.clear(); release.clear()
        def late_pdf(url):
            began.set(); assert release.wait(5)
            return sample_pdf('Late download')
        with patch('backend.literature._download_pdf',side_effect=late_pdf):
            thread = threading.Thread(target=download_collected,args=(store,project,paper['id']))
            thread.start(); assert began.wait(2)
            store.import_pdf_bytes(project,sample_pdf('User supplied version'),'User PDF',target_paper_id=paper['id'])
            user_version = store.paper(project,paper['id'])['version_id']
            release.set(); thread.join(5); assert not thread.is_alive()
        assert store.paper(project,paper['id'])['version_id'] == user_version
        service.close()
    print('incremental collection / all eight / no automatic research / restart / background failure / versions PASS')


if __name__ == '__main__':
    check()
