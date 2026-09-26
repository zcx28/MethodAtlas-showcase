"""Public subscription lifecycle; deterministic sources plus a separate live UI check."""
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from .state import Store
from .progress import Progress
from .subscriptions import Subscriptions
from .writing import Writing


def main():
    with tempfile.TemporaryDirectory() as directory:
        store = Store(Path(directory) / 'state.sqlite3')
        Writing(store)
        project = store.create_project('系统综述')
        progress = Progress(store, None)
        moment = [datetime.fromisoformat('2026-09-20T08:59:00+08:00')]
        class Model:
            key = 'test'
            def complete(self, task, prompt, context, *args, **kwargs):
                if 'candidates' in context:
                    papers = [{'candidate_id':c['id'], 'reason':'摘要涉及系统综述文献筛选。'} for c in context['candidates'][:5]]
                    return {'papers':papers + papers[:1]}
                return {'query':'systematic review screening', 'focus':'系统综述筛选', 'prompt':'仅推荐系统综述筛选的新论文；排除社论。'}
            def cancel(self, *args):
                pass
        service = Subscriptions(store, Model(), progress, lambda: moment[0])
        first = service.create(project, {'name':'综述追踪','requirements':'文献筛选','time':'09:00'})
        second = service.create(project, {'name':'另一条','requirements':'证据提取','time':'10:00'})
        assert first['id'] != second['id'] and len(service.get(project)['subscriptions']) == 2
        def paper(n, published='2026-09-19'):
            return {'source':'arxiv','external_id':f'2609.{n:05}v1','title':f'Systematic review screening {n}', 'authors':['Author'], 'published':published,'summary':'Screening in systematic reviews.', 'url':f'https://arxiv.org/abs/2609.{n:05}v1'}
        old_preprint = {**paper(5),'source':'openalex','external_id':'W5','aliases':['https://arxiv.org/abs/2501.11840'],'published':'2026-09-17'}
        result = {'candidates':[paper(1),paper(2),paper(3,'2020-01-01'),paper(4,'2026-09-21'),old_preprint], 'sources':[{'source':'arxiv','status':'succeeded'},{'source':'openalex','status':'succeeded'}]}
        with patch('backend.discovery.discover', return_value=result) as search:
            enabled = service.execute(project, 'enable', subscription_id=first['id'])
            assert enabled['settings']['enabled'] and not search.called
            assert enabled['runs'][0]['wait_id'] is None
            service.tick(); assert not search.called, 'creation searched before scheduled time'
            enabled = service.execute(project, subscription_id=first['id'])
            run = enabled['runs'][0]
            assert run['status'] == 'succeeded' and run['count'] == 2, run
            assert not store.papers(project), 'pending candidates became research materials'
            assert search.call_args.kwargs['quick']['from_date'] == '2026-09-13'
            assert service.settings(project, subscription_id=first['id'])['next_run'].startswith('2026-09-20T09:00')
            wait = run['wait_id']; a,b = run['payload']['candidates']
            service.choose(project, {'wait_id':wait,'candidate_id':a['id'],'choice':'rejected'})
            service.choose(project, {'wait_id':wait,'candidate_id':b['id'],'choice':'collected'})
            service.choose(project, {'wait_id':wait,'candidate_id':b['id'],'choice':'collected'})
            assert len(store.papers(project)) == 1
            pid = store.papers(project)[0]['id']
            service.choose(project, {'wait_id':wait,'candidate_id':b['id'],'choice':'removed'})
            assert not store.papers(project)
            # Simulate a PDF already in flight finishing after removal, through the real import boundary.
            import pymupdf
            pdf = pymupdf.open(); page = pdf.new_page(); page.insert_text((50,50),'Systematic review screening: full text finishes after removal.')
            raw = pdf.tobytes(); pdf.close()
            store.import_pdf_bytes(project,raw,'Screening PDF',target_paper_id=pid)
            assert not store.papers(project), 'download resurrected removed material'
            service.choose(project, {'wait_id':wait,'candidate_id':b['id'],'choice':'collected'})
            assert len(store.papers(project)) == 1 and store.papers(project)[0]['id'] == pid
            result['candidates'][0]['external_id'] = '2609.00001v2'
            result['candidates'][0]['updated'] = '2026-09-20'
            service.execute(project, 'enable', subscription_id=second['id'])
            service.execute(project, subscription_id=second['id'])
            assert service.get(project)['runs'][0]['count'] == 0, 'cross-subscription/version duplicate'
            service.choose(project, {'wait_id':wait,'candidate_id':a['id'],'choice':'pending'})
            assert next(r for r in service.get(project)['runs'] if r['wait_id'] == wait)['payload']['candidates'][0]['choice'] == 'pending'
            other = store.create_project('Other')
            try:
                service.settings(other, {'enabled':True}, first['id'])
                assert False, 'cross-project edit accepted'
            except ValueError:
                pass
            moment[0] = datetime.fromisoformat('2026-09-20T09:00:00+08:00')
            service.tick(); count = search.call_count
            service.tick(); assert search.call_count == count, 'duplicate scheduler tick'
            restored = Subscriptions(store, Model(), progress, lambda: moment[0])
            restored.tick(); assert search.call_count == count, 'restart repeated completed slot'
            overdue = restored.settings(project, subscription_id=first['id'])['next_run']
            restored.settings(project, {'name':'改名但不改时间','time':'09:00'}, first['id'])
            assert restored.settings(project, subscription_id=first['id'])['next_run'] == overdue

            moment[0] = datetime.fromisoformat('2026-09-23T07:00:00+08:00')
            restored.tick(); assert search.call_count == count + 2, 'offline catchup before next daily time missed'
            result['sources'] = [{'source':'arxiv','status':'failed','error':'timeout'}]
            before = restored.settings(project, subscription_id=first['id'])['last_success']
            failed = restored.execute(project, subscription_id=first['id'])['runs'][0]
            assert failed['status'] == 'failed'
            assert restored.settings(project, subscription_id=first['id'])['last_success'] == before
            restored.settings(project, {'enabled':False}, first['id'])
            assert progress.settings(project)['enabled']
            # Public pause + concurrent calls must fence a source result arriving late.
            entered, release = threading.Event(), threading.Event()
            def held_search(*args, **kwargs):
                entered.set(); assert release.wait(10)
                return {'candidates':[paper(8)],'sources':[{'source':'arxiv','status':'succeeded'}]}
            search.side_effect = held_search
            with ThreadPoolExecutor(1) as pool:
                future = pool.submit(restored.execute,project,subscription_id=first['id'])
                assert entered.wait(10)
                concurrent = restored.execute(project,subscription_id=second['id'])
                assert sum(r['status']=='running' for r in concurrent['runs']) == 1
                busy_created = restored.create(project, {'name':'检索期间创建'})
                restored.execute(project, 'enable', subscription_id=busy_created['id'])
                assert restored.settings(project,subscription_id=busy_created['id'])['enabled'], 'busy project swallowed enable'
                restored.settings(project, {'enabled':False}, busy_created['id'])
                refreshed = restored.settings(project, {'requirements':'运行期间更新研究方向'}, first['id'])
                assert not refreshed['strategy'].get('needs_refresh'), 'requirements did not refresh during a run'
                restored.settings(project,{'enabled':False},first['id'])
                release.set()
                assert next(r for r in future.result()['runs'] if r['id'] == next(r['id'] for r in concurrent['runs'] if r['status'] == 'running'))['status'] == 'failed'
            search.side_effect = None
            quota_project = store.create_project('额度验证')
            quota = restored.create(quota_project, {'name':'额度','time':'09:00'})
            result['sources'] = [{'source':'arxiv','status':'succeeded'}]
            result['candidates'] = [paper(i,'2026-09-22') for i in range(20,23)]
            assert restored.execute(quota_project,subscription_id=quota['id'])['runs'][0]['count'] == 3
            result['candidates'] = [paper(i,'2026-09-22') for i in range(23,27)]
            assert restored.execute(quota_project,subscription_id=quota['id'])['runs'][0]['count'] == 2, 'model overflow was not safely capped'
            count = search.call_count
            restored.execute(quota_project,subscription_id=quota['id'])
            assert search.call_count == count
            invalid_project = store.create_project('模型候选边界')
            invalid = restored.create(invalid_project, {'name':'无效ID','time':'09:00'})
            original_complete = restored.research.complete
            def invalid_id(task,prompt,context,*args,**kwargs):
                selected = original_complete(task,prompt,context,*args,**kwargs)
                if 'candidates' in context:
                    selected['papers'].append({'candidate_id':'invented','reason':'not real'})
                return selected
            with patch.object(restored.research,'complete',side_effect=invalid_id):
                filtered = restored.execute(invalid_project,subscription_id=invalid['id'])['runs'][0]
                assert filtered['status'] == 'partial' and filtered['count'] == 4
                assert all(c['id'] != 'invented' for c in filtered['payload']['candidates'])
                assert not restored.settings(invalid_project,subscription_id=invalid['id'])['last_success']
            for item in restored.get(project)['subscriptions']:
                restored.settings(project,{'enabled':False},item['id'])
            retry_project = store.create_project('重试验证')
            retry = restored.create(retry_project, {'name':'重试','time':'09:00'})
            moment[0] = datetime.fromisoformat('2026-09-24T07:00:00+08:00')
            result['sources'] = [{'source':'arxiv','status':'failed','error':'controlled timeout'}]
            restored.execute(retry_project,'enable',subscription_id=retry['id'])
            restored.execute(retry_project,subscription_id=retry['id'])
            for clock_time in ('07:15','07:30','07:45','09:00'):
                moment[0] = datetime.fromisoformat('2026-09-24T'+clock_time+':00+08:00')
                restored.tick()
            assert sum(r['automatic'] for r in restored.get(retry_project)['runs']) == 3
            assert restored.settings(retry_project,subscription_id=retry['id'])['next_run'].startswith('2026-09-25T09:00')
            from .agent import ProjectTools
            from .state import json_text
            scope_project = store.create_project('固定订阅策略')
            chosen = store.paste(scope_project, '选中论文', 'Selected research paper about systematic review screening.')
            store.paste(scope_project, '未选论文', 'Unselected unrelated paper about computer graphics.')
            chosen_paper = store.paper(scope_project, chosen)
            snapshot = [{'id':chosen, 'version_id':chosen_paper['version_id'], 'title':chosen_paper['title']}]
            task = Writing(store).task(scope_project, '创建每日订阅，基于选中论文和研究日报，每天北京时间08:00', 'running')
            store.run('UPDATE tasks SET selected_paper_ids=?,snapshot=? WHERE id=?', (json_text([chosen]),json_text(snapshot),task['id']))
            store.subscriptions = restored
            agent = ProjectTools(store, store.task(task['id']))
            searches = search.call_count
            with patch.object(restored.research, 'complete', wraps=restored.research.complete) as model:
                created = agent.paper_subscription('create')
                item = created['subscriptions'][0]
                fixed_strategy = item['strategy']
                assert item['enabled'] and item['time'] == '08:00' and item['materials'] == snapshot
                assert not created['subscription_report_available'] and search.call_count == searches
                assert item['next_run'].startswith('2026-09-25T08:00')
                assert model.call_count == 1 and model.call_args.args[2]['materials'] == snapshot
                assert len(agent.paper_subscription('create')['subscriptions']) == 1 and model.call_count == 1
                restored.settings(scope_project, {'time':'10:00'}, item['id'])
                assert model.call_count == 1 and restored.settings(scope_project,subscription_id=item['id'])['strategy']['query'] == fixed_strategy['query']
                restored.settings(scope_project, {'requirements':'关注证据提取'}, item['id'])
                assert model.call_count == 2 and search.call_count == searches
                assert model.call_args.args[2]['materials'] == snapshot
                strategy = restored.settings(scope_project,subscription_id=item['id'])['strategy']
                result['sources'] = [{'source':'arxiv','status':'succeeded'}]
                result['candidates'] = []
                moment[0] = datetime.fromisoformat('2026-09-25T10:00:00+08:00')
                restarted = Subscriptions(store, restored.research, progress, lambda: moment[0])
                restarted.execute(scope_project, automatic=True, subscription_id=item['id'])
                assert search.call_count == searches + 1 and model.call_count == 2
                assert restarted.settings(scope_project,subscription_id=item['id'])['strategy'] == strategy
                assert restarted.settings(scope_project,subscription_id=item['id'])['materials'] == snapshot
                restarted.settings(scope_project, {'enabled':False}, item['id'])
                restarted.execute(scope_project, 'enable', subscription_id=item['id'])
                assert search.call_count == searches + 1 and model.call_count == 2
                assert restarted.settings(scope_project,subscription_id=item['id'])['next_run'].startswith('2026-09-26T10:00')
                for bad_materials in ([{'id':chosen,'version_id':'wrong','title':'bad'}], snapshot):
                    try:
                        restarted.create(other, {'name':'越界'}, materials=bad_materials)
                        assert False, 'cross-project/version material accepted'
                    except ValueError:
                        pass
        store.db.close()
    print('PASS: deferred enable, fixed selected versions/strategy, time and requirement edits, busy create, multi-subscription, consent, dedup, restart, catchup, failures')

if __name__ == '__main__':
    main()
