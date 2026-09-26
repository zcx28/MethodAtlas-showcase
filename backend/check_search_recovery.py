"""Regression for the live latest-search / collect / full-text failure."""
import json
import tempfile
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from . import literature
from .discovery import merge_candidates
from .errors import AppError, public_payload, public_error
from .state import Store


def check_old_confirmation():
    from .app import Service
    from .agent import ProjectTools
    from .discovery import import_confirmed
    from .state import json_text
    past = {'source':'openalex', 'external_id':'https://openalex.org/W1', 'title':'Confirmed paper',
            'authors':['An Author'], 'published':'2025-01-01', 'summary':'A method.', 'publication_type':'article'}
    future = {**past, 'published':str(date.today().year+1)+'-01-01'}
    for existing in (False, True):
        with tempfile.TemporaryDirectory() as directory, patch.object(Service, 'schedule'), patch.object(Service, 'schedule_downloads'), \
             patch('backend.discovery.discover', return_value={'candidates':[past], 'sources':[]}):
            service = Service(Path(directory)/'missing', Path(directory)); store = service.store
            try:
                project = store.projects()[0]['id']; conversation = store.conversations(project)[0]['id']
                tid = service.message(project, conversation, {'text':'找论文', 'client_message_id':'old'})['task_id']
                store.run("UPDATE tasks SET status='running' WHERE id=?", (tid,))
                tools = ProjectTools(store, store.task(tid)); tools.set_scope(False)
                found = tools.search_papers('robot learning'); cid = found['candidates'][0]['id']
                tools.present_papers(found['search_id'], 'A saved recommendation.', [{'candidate_id':cid, 'reason':'A method.'}])
                payload = store.task_view(tid)['waits'][0]['payload']; candidate = payload['candidates'][0]
                candidate.update(preferred=future, versions=[past, future])
                if existing:
                    pid = literature._import_abstract(store, project, past['title'], past['summary'], past, literature._availability())
                    candidate.update(paper_id=pid, version_id=store.paper(project,pid)['version_id'], state='update')
                before = store.papers(project)
                store.run('UPDATE task_waits SET payload=? WHERE id=?', (json_text(payload), found['search_id']))
                try:
                    service.control(project, conversation, tid, 'collect-papers', {'wait_id':found['search_id'], 'candidate_ids':[cid]})
                except ValueError as error:
                    assert '未来日期' in str(error)
                else:
                    raise AssertionError('Old future recommendation collected')
                assert store.papers(project) == before
                payload.pop('collection', None)
                store.run('UPDATE task_waits SET payload=?,response=? WHERE id=?', (json_text(payload), json_text({'candidate_ids':[cid]}), found['search_id']))
                import_confirmed(store, store.task(tid))
                assert store.papers(project) == before, 'Legacy import changed a confirmed version'
                assert all(r['status']=='failed' for r in store.task(tid)['refs']['paper_imports'].values())
            finally:
                service.close()


def check():
    check_old_confirmation()
    paper = {'source':'openalex', 'external_id':'https://openalex.org/W1',
             'title':'A paper', 'authors':['A Author'], 'published':date.today().isoformat(),
             'publication_type':'article'}
    with tempfile.TemporaryDirectory() as directory:
        store = Store(Path(directory)/'check.sqlite3')
        try:
            project = store.create_project('Search recovery')
            candidates = [paper, {**paper, 'external_id':'future', 'published':(date.today()+timedelta(days=1)).isoformat()},
                          {**paper, 'external_id':'dataset', 'publication_type':'dataset'},
                          {**paper, 'external_id':'software', 'publication_type':'software'},
                          {**paper, 'external_id':'future-year', 'published':str(date.today().year+1)}]
            result = merge_candidates(store, project, candidates)
            assert [v['external_id'] for g in result for v in g['versions']] == [paper['external_id']], result
        finally:
            store.close()
    metadata = {'doi':'10.1234/missing', 'discovery_sources':[{'doi':'10.1234/available'}]}
    with patch.object(literature, '_doi_metadata', side_effect=[ValueError('DOI 不存在'), {'pdf_url':'https://example.com/paper.pdf'}]), \
         patch.object(literature, '_download_pdf', return_value=b'%PDF-available'):
        assert literature._download_fulltext(metadata)[0] == b'%PDF-available', 'One DOI must not stop alternative sources'
    with patch.object(literature, '_download_pdf', side_effect=TimeoutError('private download endpoint')):
        try:
            literature._download_fulltext({'pdf_url':'https://example.com/paper.pdf'})
        except AppError as error:
            assert error.code == 'fulltext_failed'
            payload = public_payload({'error':public_error(error)['message'], 'error_info':public_error(error)})
            assert 'private download endpoint' not in json.dumps(payload)
            assert payload['error_info']['code'] == 'fulltext_failed' and '全文' in payload['error']
        else:
            raise AssertionError('Download failure needs a source-specific error')
    for metadata in ({}, {'doi':'10.1234/no-pdf'}):
        with patch.object(literature, '_doi_metadata', return_value={'pdf_url':None}):
            try:
                literature._download_fulltext(metadata)
            except AppError as error:
                assert error.code == 'fulltext_unavailable'
            else:
                raise AssertionError('Missing PDF must remain unavailable')
    message = '全文获取失败，已保留链接和摘要。目前提供的信息还不足以完成这次处理。 请检查填写内容和所选材料，调整后重新发送。'
    result = public_payload({'availability':literature._availability(fulltext='failed', error=message)})
    assert '全文' in result['availability']['error'] and '生成' not in result['availability']['error'], result
    assert public_payload(result) == result, 'Public error mapping must be idempotent'
    assert 'private download endpoint' not in json.dumps(result)
    print('PASS: future dates/datasets excluded; alternate DOI continues; source errors survive HTTP serialization')


if __name__ == '__main__':
    check()
