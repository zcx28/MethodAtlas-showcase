"""Opt-in real-model cold/hot benchmark, isolated from the user's library."""
import argparse
import json
import sqlite3
import time
from pathlib import Path

from .app import Service


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=Path('.methodatlas-data/methodatlas.sqlite3'))
    parser.add_argument('--task',required=True,help='Existing task whose selected materials are benchmarked')
    parser.add_argument('--data',type=Path,required=True,help='New isolated directory; must not contain a database')
    args=parser.parse_args()
    args.data.mkdir(parents=True,exist_ok=True)
    path=args.data/'methodatlas.sqlite3'
    if path.exists():raise SystemExit('Use a new isolated data directory for a cold-cache measurement')
    with sqlite3.connect(f'file:{args.source.resolve()}?mode=ro',uri=True) as source, sqlite3.connect(path) as target:
        source.backup(target)
        target.execute("UPDATE tasks SET status='interrupted' WHERE status IN ('running','routing','queued','waiting')")
        target.execute('UPDATE progress_settings SET enabled=0')
        target.execute('UPDATE subscriptions SET enabled=0')
        for table in ('paper_extractions','claim_checks','model_usage'):
            if target.execute('SELECT 1 FROM sqlite_master WHERE name=?',(table,)).fetchone():target.execute('DELETE FROM '+table)
    service=Service(args.data/'no-pdfs',args.data)
    try:
        original=service.store.task(args.task)
        if not original or not original['selected_paper_ids']:raise ValueError('Source task must select benchmark papers')
        report=[]
        for phase in ('cold','hot'):
            conversation=service.store.create_conversation(original['project_id'])
            started=time.monotonic()
            result=service.message(original['project_id'],conversation,{'text':'仅基于勾选论文，'+original['prompt'],'selected_paper_ids':original['selected_paper_ids'],'client_message_id':conversation})
            task_id=result['task_id'];last=None
            while True:
                task=service.store.task(task_id);events=service.store.events(task_id)
                if events and events[-1]['seq']!=last:
                    last=events[-1]['seq'];print(phase,round(time.monotonic()-started,1),events[-1]['message'],flush=True)
                if task['status'] in ('succeeded','failed','interrupted'):break
                time.sleep(1)
            item={'phase':phase,'task':task_id,'conversation':conversation,'seconds':round(time.monotonic()-started,2),'status':task['status'],'error':task['error'],'usage':task['refs'].get('usage',[]),'route':task['checkpoint'].get('route')}
            report.append(item)
            (args.data/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
            print(json.dumps(item,ensure_ascii=False),flush=True)
            assert task['status']=='succeeded',task['error']
            cards=task['checkpoint']['research_flow']['cards']
            assert {c['paper_id'] for c in cards}==set(original['selected_paper_ids']),'Benchmark silently omitted a source'
            if phase=='hot':assert not any(u['role']=='paper' and u.get('calls',0) for u in item['usage']),'Warm cache reread full text'
    finally:service.close()

if __name__=='__main__':main()
