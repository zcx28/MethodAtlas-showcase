"""Public task check: first source visible before the slow source, zero model calls."""
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch
from .app import Service


def check():
    from .direct_search import route
    for prompt in ('找 diffusion policy 论文并总结各自贡献','找2024年之后 diffusion policy论文','找相关论文，不要综述','查找这篇论文引用的工作','找十五篇 diffusion policy 论文','找二十篇 robot learning 论文','find diffusion policy papers and explain their contributions','find diffusion policy papers by Pieter Abbeel'):
        assert route({'prompt':prompt,'refs':{}}) is None,prompt
    release = threading.Event()
    paper = {'source':'openalex','external_id':'https://openalex.org/W1','title':'Diffusion Policy',
             'authors':['A Researcher'],'doi':'10.1234/example','url':'https://doi.org/10.1234/example','summary':'Robot policy learning.'}
    def fetch(source, *args):
        if source == 'semantic_scholar':
            assert release.wait(3), 'First source must be presented while second is pending'
        return [dict(paper,source=source)],False
    with tempfile.TemporaryDirectory() as d, patch.object(Service,'schedule'):
        service=Service(Path(d)/'pdf',Path(d))
        service.research.key=''
        store=service.store;p=store.projects()[0]['id'];c=store.conversations(p)[0]['id']
        tid=service.message(p,c,{'text':'找10篇 diffusion policy 相关论文','client_message_id':'fast'})['task_id']
        with patch.object(service.research,'complete',side_effect=AssertionError('Search must not call model')),patch('backend.direct_search.fetch',side_effect=fetch):
            service.route(tid)
            assert store.task(tid)['status']=='queued',store.task(tid)['error']
            t=threading.Thread(target=service.research.run,args=(tid,));t.start()
            import time
            deadline=time.monotonic()+2
            while not store.task_view(tid)['waits'] and time.monotonic()<deadline:time.sleep(.01)
            try:
                waits=store.task_view(tid)['waits']
                assert waits and waits[0]['payload']['recommendation']['papers']
                assert t.is_alive(),'Slow source must not hold first batch'
                assert not store.papers(p),'Search must not import papers'
            finally:release.set();t.join(4)
            assert store.task(tid)['status']=='succeeded',store.task(tid)['error']
            assert sum(len(w['payload'].get('recommendation',{}).get('papers',[])) for w in store.task_view(tid)['waits'])==1,'Cross-source duplicates must be removed'
        enhanced=service.message(p,c,{'text':'找1篇 diffusion policy 论文，给简短推荐理由','client_message_id':'enhanced'})['task_id']
        service.research.key='test'
        def enrich(task,*args,**kwargs):
            waits=store.task_view(task['id'])['waits']
            assert waits and not waits[0]['payload']['draft'],'Publish before enhancement'
            return {'reasons':{p['candidate_id']:'来源摘要描述机器人控制。' for w in waits for p in w['payload']['recommendation']['papers']}}
        with patch('backend.direct_search.fetch',side_effect=fetch),patch.object(service.research,'complete',side_effect=enrich) as model:
            service.route(enhanced);assert model.call_count==0
            service.research.run(enhanced)
            assert store.task(enhanced)['status']=='succeeded',store.task(enhanced)['error']
            assert model.call_count==1
            assert store.task_view(enhanced)['waits'][0]['payload']['reasons_enhanced']
        service.close()
    print('PASS direct search: zero model, progressive source delivery, dedup, no automatic import')

def check_cache():
    import io,json
    from .direct_search import fetch,_locks
    with tempfile.TemporaryDirectory() as d:
        stop=threading.Event()
        response={'results':[{'id':'https://openalex.org/W1','title':'Policy','abstract_inverted_index':{'robot':[0],'control':[1]},'authorships':[]}]}
        with patch('backend.direct_search.urlopen',return_value=io.BytesIO(json.dumps(response).encode())) as http:
            papers,cached=fetch('openalex','robot learning',False,Path(d),stop)
            assert papers[0]['summary']=='robot control' and not cached
            from urllib.parse import urlparse,parse_qs
            assert parse_qs(urlparse(http.call_args.args[0].full_url).query)['search']==['"robot learning"']
            with _locks['openalex']:
                assert fetch('openalex','robot learning',False,Path(d),stop)==(papers,True)
            assert http.call_count==1
            stop.set()
            try:fetch('openalex','different',False,Path(d),stop)
            except InterruptedError:pass
            else:raise AssertionError('Cancelled request must not reach network')
            assert http.call_count==1
    print('PASS cache precedes pacing lock; cancelled queued request sends no HTTP')


def live():
    import json,time
    root=Path('.methodatlas-data/direct-search-validation')
    service=Service(root/'no-pdfs',root)
    reports=[]
    try:
        project=service.store.projects()[0]['id']
        for prompt in ('找10篇 diffusion policy 相关论文','找三篇具身智能论文','找5篇最新 robot learning 论文'):
            conversation=service.store.create_conversation(project)
            started=time.monotonic();first=None
            tid=service.message(project,conversation,{'text':prompt,'client_message_id':conversation})['task_id']
            while True:
                task=service.store.task_view(tid)
                if first is None and any(w['payload'].get('recommendation') for w in task['waits']):first=round(time.monotonic()-started,3)
                if task['status'] in ('succeeded','failed','interrupted'):break
                time.sleep(.05)
            report={'prompt':prompt,'task':tid,'conversation':conversation,'first_seconds':first,'seconds':round(time.monotonic()-started,3),'status':task['status'],'refs':task['refs'],'error':task['error']}
            reports.append(report);print(json.dumps(report,ensure_ascii=False),flush=True)
            (root/'report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
            assert not task['refs'].get('usage'),'Pure searches must use zero model calls'
    finally:service.close()

if __name__=='__main__':
    import sys
    if '--live' in sys.argv:live()
    else:check();check_cache()
