"""Public tool/confirmation checks for bounded, progressive paper search; no network."""
import json
import tempfile
import time
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from .agent import ProjectTools
from .app import Service
from .discovery import discover
from .state import StaleRun


def check():
    from .discovery_worker import arxiv_query
    assert arxiv_query('diffusion policy robot') == 'all:"diffusion" AND all:"policy" AND all:"robot"'
    assert arxiv_query('"diffusion policy" robot') == 'all:"diffusion policy" AND all:"robot"'
    assert arxiv_query('ti:"diffusion policy"') == 'ti:"diffusion policy"'
    assert arxiv_query("Alzheimer's disease") == "all:\"Alzheimer's\" AND all:\"disease\""
    paper = {'source':'openalex','external_id':'https://openalex.org/W1','title':'A relevant paper',
             'authors':['An Author'],'url':'https://doi.org/10.1234/test','summary':'A robot learns actions.'}
    results = {'candidates':[paper],'sources':[{'source':'openalex','status':'succeeded'}],
               'warning':'来源覆盖不完整：arxiv 查询超时。'}
    with tempfile.TemporaryDirectory() as directory, patch.object(Service,'schedule'), patch('backend.discovery.discover',return_value=results) as retrieve:
        service = Service(Path(directory)/'missing',Path(directory))
        store = service.store
        project = store.projects()[0]['id']; conversation = store.conversations(project)[0]['id']
        task_id = service.message(project,conversation,{'text':'找5篇机器人学习论文','client_message_id':'quick'})['task_id']
        store.run("UPDATE tasks SET status='running' WHERE id=?",(task_id,))
        tools = ProjectTools(store,store.task(task_id)); tools.set_scope(False)
        first = tools.call('search_papers',{'query':'找5篇机器人学习论文','queries':['robot learning','机器人学习']})
        assert retrieve.call_args.kwargs['quick']['queries'] == ['robot learning','机器人学习']
        assert retrieve.call_args.kwargs['quick']['latest'] is False
        assert first['can_search_more'] and not store.papers(project)
        assert store.task_view(task_id)['waits'][0]['payload']['draft']
        try:
            tools.search_papers('Another query')
            raise AssertionError('Must display first batch before supplementing')
        except ValueError:
            pass
        reason = [{'candidate_id':first['candidates'][0]['id'],'reason':'以机器人动作学习为对象，可作为方法比较的起点。'}]
        tools.present_papers(first['search_id'],'找到一篇相关论文。',reason)
        tools.present_papers(first['search_id'],'找到一篇相关论文。',reason)
        view = store.task_view(task_id)
        assert view['status'] == 'running' and not view['waits'][0]['payload']['draft']
        assert '未阅读全文' in view['waits'][0]['payload']['recommendation']['summary']
        assert 'arxiv' in view['waits'][0]['payload']['warning']
        # Repeating a query reuses the same batch and does not spend another round.
        assert tools.search_papers('找5篇机器人学习论文',['robot learning','机器人学习'])['search_id'] == first['search_id']
        assert retrieve.call_count == 1
        extra = {**paper,'external_id':'https://openalex.org/W2','title':'A recent robot paper','url':'https://doi.org/10.1234/second'}
        retrieve.return_value = {**results,'candidates':[paper,extra]}
        retrieve.side_effect = StaleRun('Stopped during the final source request')
        try:
            tools.search_papers('补充最近的机器人学习论文',['robot policy learning'],latest=True)
            raise AssertionError('Expected interrupted second round')
        except StaleRun:
            pass
        retrieve.side_effect = None
        tools = ProjectTools(store,store.task(task_id)); tools.set_scope(False)
        second = tools.search_papers('补充最近的机器人学习论文',['robot policy learning'],latest=True)
        assert retrieve.call_args.kwargs['quick']['latest'] is True
        assert [p['title'] for p in second['candidates']] == ['A recent robot paper']
        assert not second['can_search_more']
        tools.present_papers(second['search_id'],'补充一篇相关论文。',[{'candidate_id':second['candidates'][0]['id'],'reason':'提供另一种机器人策略学习方法。'}])
        assert len([w for w in store.task_view(task_id)['waits'] if not w['payload']['draft']]) == 2
        assert not tools.search_papers('Third search')['can_search_more'] and retrieve.call_count == 3
        try:
            tools.search_papers('Deep robot investigation',deep=True)
            raise AssertionError('Ordinary search must not escalate itself')
        except ValueError:
            pass
        # Explicit deep research remains available, with no quick budget applied.
        store.run('UPDATE tasks SET checkpoint=? WHERE id=?',(json.dumps({'route':{'deep_search':True}}),task_id))
        tools.search_papers('Explicit deep robot investigation',deep=True)
        assert not retrieve.call_args.kwargs
        # Expiry survives a new ProjectTools instance (including task resume).
        store.run('UPDATE tasks SET refs=? WHERE id=?',(json.dumps({'paper_search':{'started':time.time()-61,'rounds':1}}),task_id))
        resumed = ProjectTools(store,store.task(task_id)); resumed.set_scope(False)
        assert not resumed.search_papers('Budget expired')['can_search_more'] and retrieve.call_count == 4
        store.run("UPDATE tasks SET status='stopped' WHERE id=?",(task_id,))
        try:
            resumed.call('search_papers',{'query':'Stopped search'})
            raise AssertionError('Stopped task must not search')
        except StaleRun:
            pass
        service.close()
    # Exercise the fixed pipeline through Research.run, including shared finalization.
    with tempfile.TemporaryDirectory() as directory, patch.object(Service,'schedule'):
        service = Service(Path(directory)/'missing',Path(directory))
        store = service.store
        project = store.projects()[0]['id']; conversation = store.conversations(project)[0]['id']
        service.research.key = 'controlled-check'
        task_id = service.message(project,conversation,{'text':'找1篇相关论文','client_message_id':'pipeline'})['task_id']
        route = {'mode':'explore','intent':'research','only_selected':False,
                 'paper_search':{'queries':['robot learning'],'latest':False,'count':1}}
        store.run('UPDATE tasks SET checkpoint=? WHERE id=?',(json.dumps({'route':route}),task_id))
        service.research.key = 'controlled-check'
        def select(task, system, context, role, *args, **kwargs):
            assert role == 'paper-select' and context['remaining_count'] == 1
            assert context['search_queries'] and 'recovered_dialogue' in context
            if not context['search']['candidates']:
                return {'papers':[], 'next_queries':['robot action learning']}
            assert context['search']['candidates'][0]['title'] == paper['title']
            return {'papers':[{'candidate_id':context['search']['candidates'][0]['id'],'reason':'机器人动作学习方法。'}],
                    'next_queries':['Must not execute after meeting count']}
        with patch('backend.discovery.discover',return_value=results) as retrieve, patch.object(service.research,'complete',side_effect=select) as model:
            service.research.run(task_id)
            assert store.task(task_id)['status'] == 'succeeded', store.task(task_id)['error']
            assert retrieve.call_count == model.call_count == 1, 'No extra search after requested count'
            assert len(store.task_view(task_id)['waits']) == 1 and not store.papers(project)
        empty_task = service.message(project,conversation,{'text':'找1篇相关论文','client_message_id':'empty-first'})['task_id']
        store.run('UPDATE tasks SET checkpoint=? WHERE id=?',(json.dumps({'route':route}),empty_task))
        with patch('backend.discovery.discover',side_effect=[{'candidates':[], 'sources':[]},results]) as retrieve, patch.object(service.research,'complete',side_effect=select):
            service.research.run(empty_task)
            assert store.task(empty_task)['status'] == 'succeeded', store.task(empty_task)['error']
            assert retrieve.call_count == 2, 'Zero candidates must still allow one rewritten query'
            assert retrieve.call_args.kwargs['quick']['queries'] == ['robot action learning']
        service.close()
    # An unfinished source cannot discard the completed source at the deadline.
    with tempfile.TemporaryDirectory() as directory:
        store = SimpleNamespace(root=Path(directory),assert_active=lambda *_:None,transaction=nullcontext,event=lambda *_:None)
        def start(command, **kwargs):
            Path(command[4]).write_text(json.dumps({'candidates':[paper],'sources':[{'source':'openalex','query':'robots','status':'succeeded'}]}))
            process = MagicMock(); process.poll.return_value = None
            return process
        with patch('backend.discovery.subprocess.Popen',side_effect=start), patch('backend.discovery.time.monotonic',side_effect=[0,13,13]):
            result = discover('robots',store,{'id':'timeout','revision':0},quick={'queries':['robots'],'latest':False,'timeout':12})
        assert result['candidates'] == [paper]
        assert result['sources'][-1]['source'] == 'arxiv' and result['sources'][-1]['status'] == 'failed'
        assert '不代表没有相关论文' in result['warning']
    from .check_direct_search import check as check_direct
    check_direct()
    check_selection_deadline()
    print('PASS: progressive batches, deduplication, consent, budgets, deep opt-in, stop and partial source timeout')


def check_selection_deadline():
    """An expired selection cannot start later; an active selection is interrupted."""
    import threading
    from .agent import Research

    for phase in ('before_start', 'during_start', 'running'):
        research = Research.__new__(Research)
        research.store = SimpleNamespace(assert_active=lambda *_:None)
        research.active = {}
        research.record_usage = lambda *_, **kwargs:None
        clock = [0.0]
        started, ran, closed = [], [], threading.Event()
        class Lock:
            def __enter__(self):
                if phase == 'before_start':
                    clock[0] = 2  # Budget expired while waiting for the lifecycle lock.
            def __exit__(self, *_):
                pass
        class Harness:
            def start_session(self, _):
                started.append(True)
                if phase == 'during_start':
                    clock[0] = 2
                return self
            def run(self, *_, **kwargs):
                ran.append(True)
                assert closed.wait(1), 'Deadline must interrupt an active model call'
                raise RuntimeError('Runtime closed')
            def close(self):
                closed.set()
        research.active_lock = threading.Lock() if phase == 'running' else Lock()
        research.runtime = lambda *args, **kwargs:Harness()
        clock_patch = nullcontext() if phase == 'running' else patch('backend.agent.time.monotonic',side_effect=lambda:clock[0])
        with clock_patch:
            try:
                research.complete({'id':'deadline','revision':0,'refs':{}},'',{},'paper-select',
                                  timeout_seconds=.02 if phase == 'running' else 1)
                raise AssertionError('Expired model selection must raise TimeoutError')
            except TimeoutError:
                pass
        assert bool(started) == (phase != 'before_start')
        assert bool(ran) == (phase == 'running')
        assert closed.is_set() and not research.active


def live():
    """Opt-in real model/API check; leaves an isolated workbench for visual review."""
    import os
    assert os.getenv('DEEPSEEK_API_KEY'), 'Load backend credentials first'
    root = Path('.methodatlas-data/fast-search-validation')
    service = Service(root/'no-input-pdfs',root)
    reports = []
    try:
        project = service.store.projects()[0]['id']
        for prompt in ('找5篇具身智能的相关论文，给简短推荐理由。',
                       '找10篇机器人 diffusion policy 相关论文，兼顾基础方法和后续工作。',
                       '找5篇最新的视觉语言动作模型机器人论文。'):
            conversation = service.store.create_conversation(project)
            started = time.monotonic()
            task_id = service.message(project,conversation,{'text':prompt,'client_message_id':conversation})['task_id']
            first = None
            while True:
                task = service.store.task_view(task_id)
                waits = [w for w in task['waits'] if w['payload'].get('recommendation')]
                if first is None and any(w['payload']['recommendation']['papers'] for w in waits):
                    first = round(time.monotonic()-started,2)
                if task['status'] in ('succeeded','failed','stopped','waiting'):
                    break
                if time.monotonic()-started > 100:
                    service.control(project,conversation,task_id,'stop',{})
                    raise AssertionError('Search exceeded live-check deadline')
                time.sleep(.2)
            report = {'query':prompt,'first_seconds':first,'total_seconds':round(time.monotonic()-started,2),
                      'task_id':task_id,'conversation_id':conversation,'status':task['status'],'error':task.get('error'),
                      'route':service.store.task(task_id)['checkpoint']['route'],'usage':task['refs'].get('usage',[]),'batches':[w['payload'] for w in waits]}
            reports.append(report)
            (root/'report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
            print(json.dumps({k:v for k,v in report.items() if k not in ('batches','route')},ensure_ascii=False),flush=True)
            assert task['status'] == 'succeeded', task.get('error')
            assert service.store.task(task_id)['checkpoint']['route'].get('paper_search'), 'Ordinary search must take the fixed path'
    finally:
        service.close()
    print('Saved isolated workbench:',root.resolve(),flush=True)


if __name__ == '__main__':
    import sys
    live() if '--live' in sys.argv else check()
