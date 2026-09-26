"""Paper discovery checks at the MCP / user confirmation boundary."""
import tempfile
from pathlib import Path
from unittest.mock import patch

from .app import Service
from .agent import ProjectTools
from .state import StaleRun


def legacy_wait(tools, query):
    # Retain recovery coverage for saved lists from the previous confirmation flow.
    from .state import json_text
    result = tools.call('search_papers', {'query':query})
    wait = tools.store.task_view(tools.task['id'])['waits'][-1]
    payload = wait['payload']
    payload.pop('collection',None)
    payload.pop('draft',None)
    tools.store.run('UPDATE task_waits SET payload=? WHERE id=?',(json_text(payload),result['search_id']))
    tools.store.wait_for(tools.task['id'],tools.task['revision'],wait['object_key'],payload)


def check():
    candidate = {'source':'arxiv', 'external_id':'2401.00001v1', 'title':'A real candidate',
                 'authors':['A. Author'], 'published':'2024', 'summary':'A method uses images.',
                 'url':'https://arxiv.org/abs/2401.00001v1', 'pdf_url':None}
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory, patch.object(Service, 'schedule'), patch('backend.discovery.discover', return_value={'candidates':[candidate], 'sources':[{'source':'arxiv','status':'succeeded'}]}):
        service = Service(Path(directory)/'missing', Path(directory))
        store = service.store
        project = store.projects()[0]['id']
        conversation = store.conversations(project)[0]['id']
        tid = service.message(project,conversation,{'text':'Find papers','client_message_id':'search'})['task_id']
        store.run("UPDATE tasks SET status='running' WHERE id=?", (tid,))
        tools = ProjectTools(store,store.task(tid))
        tools.call('set_scope', {'only_selected':False})
        try:
            legacy_wait(tools, 'image methods')
        except StaleRun:
            pass
        view = service.task_view(project,tid)
        assert view['status'] == 'waiting' and not store.papers(project)
        wait = view['waits'][0]
        assert len(wait['payload']['candidates']) == 1
        cid = wait['payload']['candidates'][0]['id']
        service.close()
        service = Service(Path(directory)/'missing',Path(directory))
        store = service.store
        assert service.task_view(project,tid)['waits'][0] == wait
        wrong_project = store.create_project('Other project')
        try:
            service.control(wrong_project,conversation,tid,'confirm',{'wait_id':wait['id'],'response':{'candidate_ids':[cid]}})
        except ValueError:
            pass
        else:
            raise AssertionError('Cross-project confirmation accepted')
        try:
            service.control(project,conversation,tid,'confirm',{'wait_id':wait['id'],'response':{'candidate_ids':['invented']}})
        except ValueError:
            pass
        else:
            raise AssertionError('Invented candidate accepted')
        response = {'wait_id':wait['id'],'response':{'candidate_ids':[cid]}}
        service.control(project,conversation,tid,'stop',{})
        service.control(project,conversation,tid,'confirm',response)
        assert store.task(tid)['status'] == 'stopped', 'confirmation must not undo stop'
        service.control(project,conversation,tid,'confirm',response)
        service.control(project,conversation,tid,'resume',{})
        from .discovery import import_confirmed
        store.run("UPDATE tasks SET status='running' WHERE id=?", (tid,))
        import_confirmed(store,store.task(tid))
        import_confirmed(store,store.task(tid))
        assert len(store.papers(project)) == 1
        task = store.task(tid)
        tools = ProjectTools(store,task)
        tools.set_scope(False)
        material = tools.list_materials()['materials'][0]
        assert tools.call('read_material', {'paper_id':material['id']})['evidence']
        assert material['version_id'] == store.papers(project)[0]['current_version_id']
        # Cross-source identity merges; a newer preprint keeps the old evidence readable.
        from .discovery import merge_candidates
        published = {**candidate,'source':'openalex','external_id':'https://openalex.org/W1','doi':'10.1234/test','pdf_url':'https://example.com/paper.pdf'}
        preprint = {**candidate,'doi':'https://doi.org/10.1234/test'}
        merged = merge_candidates(store,project,[preprint,published])
        assert len(merged) == 1 and len(merged[0]['versions']) == 2
        assert merged[0]['preferred']['source'] == 'openalex' and merged[0]['paper_id'] == material['id']
        old_version = material['version_id']
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(tid,))
        # One failed PDF must not suppress another candidate. Retry only the failed item.
        bad = {**candidate,'source':'pdf_url','title':'Broken PDF','external_id':'url:broken',
               'url':'https://example.com/broken.pdf','pdf_url':'https://example.com/broken.pdf','authors':[]}
        fresh = {**candidate,'external_id':'2401.00002v1','title':'Other method',
                 'url':'https://arxiv.org/abs/2401.00002v1','summary':'Another method uses depth.'}
        partial = {**fresh,'external_id':'2401.00003v1','title':'Partial source','url':'https://arxiv.org/abs/2401.00003v1','pdf_url':'https://example.com/partial.pdf'}
        with patch('backend.discovery.discover',return_value={'candidates':[preprint,published,bad,fresh,partial], 'sources':[{'source':'arxiv','status':'failed','error':'429'},{'source':'openalex','status':'succeeded'}]}):
            second = service.message(project,conversation,{'text':'More papers','client_message_id':'second'})['task_id']
            store.run("UPDATE tasks SET status='running' WHERE id=?",(second,))
            tools = ProjectTools(store,store.task(second))
            tools.set_scope(False)
            try:
                legacy_wait(tools, 'More image methods')
            except StaleRun:
                pass
        pending = service.task_view(project,second)['waits'][0]
        ids = [c['id'] for c in pending['payload']['candidates']]
        service.control(project,conversation,second,'confirm',{'wait_id':pending['id'],'response':{'candidate_ids':ids}})
        store.run("UPDATE tasks SET status='running' WHERE id=?",(second,))
        with patch('backend.literature._download_pdf',side_effect=TimeoutError('Controlled source timeout')):
            import_confirmed(store,store.task(second))
        receipts = service.task_view(project,second)['refs']['paper_imports']
        assert sorted(r['status'] for r in receipts.values()) == ['failed','failed','failed','succeeded'], receipts
        assert store.paper(project,material['id'],old_version)['version_id'] == old_version
        retry_key = next(k for k,v in receipts.items() if v['title'] == published['title'])
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(second,))
        service.control(project,conversation,second,'paper-retry',{'import_key':retry_key})
        store.run("UPDATE tasks SET status='running' WHERE id=?",(second,))
        from .check_sources import sample_pdf
        with patch('backend.literature._download_pdf',return_value=sample_pdf('Published method')):
            import_confirmed(store,store.task(second))
        after = service.task_view(project,second)['refs']['paper_imports']
        assert after[retry_key]['status'] == 'succeeded'
        assert all(after[k] == v for k,v in receipts.items() if k != retry_key)
        assert after[retry_key]['paper_id'] == material['id']
        assert after[retry_key]['version_id'] != old_version
        assert store.paper(project,material['id'],old_version)['version_id'] == old_version
        assert merge_candidates(store,project,[preprint])[0]['state'] == 'existing', 'preprint must not replace the published version'
        assert merge_candidates(store,project,[{**published,'source_version':'publishedVersion'}])[0]['state'] == 'update', 'same work ID can have a changed source version'
        # Accepted source changes need not create a new immutable content version.
        import json
        paper = store.paper(project,material['id'])
        metadata = json.loads(paper['metadata'])
        changed = {**published,'source_version':'publishedVersion'}
        with patch('backend.discovery.discover',return_value={'candidates':[changed],'sources':[]}):
            third = service.message(project,conversation,{'text':'Updated source','client_message_id':'third'})['task_id']
            store.run("UPDATE tasks SET status='running' WHERE id=?",(third,))
            tools = ProjectTools(store,store.task(third))
            tools.set_scope(False)
            try:
                legacy_wait(tools, 'Updated source metadata')
            except StaleRun:
                pass
        pending = store.task_view(third)['waits'][0]
        service.control(project,conversation,third,'confirm',{'wait_id':pending['id'],'response':{'candidate_ids':[pending['payload']['candidates'][0]['id']]}})
        store.run("UPDATE tasks SET status='running' WHERE id=?",(third,))
        raw = Path(paper['source_path']).read_bytes()
        with patch('backend.literature._download_pdf',return_value=raw):
            import_confirmed(store,store.task(third))
        assert store.paper(project,material['id'])['version_id'] == paper['version_id']
        metadata = json.loads(store.paper(project,material['id'])['metadata'])
        assert merge_candidates(store,project,[{**published,'source_version':'publishedVersion'}])[0]['state'] == 'existing'
        assert metadata['discovery_versions'][paper['version_id']] == published
        partial_key = next(k for k,v in after.items() if v['title'] == partial['title'])
        partial_id = after[partial_key]['paper_id']
        partial_version = after[partial_key]['version_id']
        store.run("UPDATE tasks SET status='succeeded' WHERE id=?",(second,))
        service.control(project,conversation,second,'paper-retry',{'import_key':partial_key})
        store.run("UPDATE tasks SET status='running' WHERE id=?",(second,))
        with patch('backend.literature._download_pdf',return_value=sample_pdf('Recovered full text')):
            import_confirmed(store,store.task(second))
        recovered = service.task_view(project,second)['refs']['paper_imports'][partial_key]
        assert recovered['status'] == 'succeeded' and recovered['paper_id'] == partial_id
        assert recovered['version_id'] != partial_version
        assert store.paper(project,partial_id,partial_version)['version_id'] == partial_version
        service.close()
    print('discovery confirmation / idempotency / exact-version read PASS')


if __name__ == '__main__':
    check()
