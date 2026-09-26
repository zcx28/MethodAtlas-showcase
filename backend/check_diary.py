"""Calendar scheduling, scope, version recovery and real exports at the Progress seam."""
import tempfile
from datetime import datetime
from pathlib import Path
from .state import Store
from .writing import Writing
from .progress import Progress, research_day


def main():
    with tempfile.TemporaryDirectory() as folder:
        store = Store(Path(folder) / 'methodatlas.sqlite3'); Writing(store)
        project = store.create_project('回顾检查')
        clock = [datetime.fromisoformat('2026-08-31T21:59:00+08:00')]
        store.run('UPDATE projects SET created=? WHERE id=?', (clock[0].isoformat(), project))
        class Model:
            key = 'controlled'
            calls = []
            def complete(self, task, system, context, *args):
                self.calls.append(context)
                return {'items':[{'section':context['sections'][0], 'text':'比较了两组实验设置。', 'sources':[context['activities'][0]['id']]}], 'highlights':['比较实验设置']}
        model = Model(); progress = Progress(store, model, lambda:clock[0]);store.progress=progress
        progress.record(project, {'request_id':'one','kind':'idea','text':'比较两个实验设置'})
        progress.tick();assert not model.calls
        clock[0]=clock[0].replace(hour=22)
        progress.tick();assert len(model.calls)==1
        progress.tick();assert len(model.calls)==1
        initial=progress.get(project,'2026-08-31')['versions'][-1]
        assert progress.timeline(project)['days'][0]['unread']
        progress.action(project,'2026-08-31','read',{'version_id':initial['id']})
        assert not progress.timeline(project)['days'][0]['unread']
        clock[0]=clock[0].replace(hour=23)
        progress.record(project, {'request_id':'late','kind':'question','text':'还需比较不同数据集'})
        count=len(model.calls);progress.tick();assert len(model.calls)==count, 'late records must wait until next day'
        # The next day includes the late activity and generates August's monthly review at 08:00.
        clock[0]=datetime.fromisoformat('2026-09-01T08:00:00+08:00')
        progress.tick()
        daily=progress.get(project,'2026-08-31')['versions'][-1]
        assert any(e['id']=='late' for c in model.calls if c['day']=='2026-08-31' for e in c['activities'])
        assert progress.get(project,'2026-08-01-m')['versions']
        progress.save(project,'2026-08-31',{'content':daily['body']+'\n人工判断。','base_version_id':daily['id']})
        manual=progress.latest(project,'2026-08-31')
        count=len(model.calls);progress.tick();assert len(model.calls)==count
        assert progress.latest(project,'2026-08-31')['id']==manual['id']
        progress.save(project,'2026-08-31',{'restore_version':initial['id'],'base_version_id':manual['id']})
        restored=progress.latest(project,'2026-08-31')
        assert restored['body']==initial['body'] and restored['id']!=initial['id']
        state=progress.get(project,'2026-08-31')['status']
        stale=progress.generate(project,'2026-08-31',instruction='精简',expected_base=initial['id'])
        assert stale['status']=='conflict' and progress.get(project,'2026-08-31')['status']==state
        store.run("UPDATE progress_days SET status='running' WHERE project_id=? AND day='2026-08-31'",(project,))
        assert progress.generate(project,'2026-08-31',instruction='精简',expected_base=restored['id'])['status']=='running'
        assert progress.generate(project,'2026-08-31',instruction='精简',expected_base=initial['id'])['status']=='conflict'
        assert progress.get(project,'2026-08-31')['status']=='running'
        store.run("UPDATE progress_days SET status='ready' WHERE project_id=? AND day='2026-08-31'",(project,))
        proposal=progress.generate(project,'2026-08-31',instruction='精简',expected_base=restored['id'])
        assert proposal['proposal_id'] and progress.latest(project,'2026-08-31')['id']==restored['id']
        assert progress.export(project,'2026-08-31',initial['id'],'pdf').startswith(b'%PDF')
        assert progress.export(project,'2026-08-31',initial['id'],'markdown').decode()==initial['body']
        cid=progress.action(project,'2026-08-31','chat',{})['conversation_id']
        assert progress.action(project,'2026-08-31','chat',{})['conversation_id']==cid
        progress.action(project,'2026-08-31','delete',{})
        assert progress.generate(project,'2026-08-31')['status']=='deleted'
        assert all(d['day']!='2026-08-31' for d in progress.timeline(project)['days'])
        progress.action(project,'2026-08-31','undo',{})
        assert progress.latest(project,'2026-08-31')['id']==restored['id']
        clock[0]=datetime.fromisoformat('2026-09-07T08:00:00+08:00')
        progress.tick();assert progress.get(project,'2026-08-31-w')['versions']
        for invalid in ({'daily_time':'25:00'},{'weekly_day':7},{'monthly_day':29},{'scope':[]},{'notifications':1}):
            try: progress.settings(project,invalid)
            except ValueError: pass
            else: raise AssertionError(f'accepted {invalid}')
        progress.settings(project,{'scope':['materials']})
        assert not progress.selected_events(project,'2026-08-31',progress.settings(project))
        assert research_day(datetime.fromisoformat('2026-09-01T00:00:00+08:00'))=='2026-09-01'
        store.close()
    print('PASS diary: 22:00, catch-up, week/month, manual protection, scope, delete/undo, chat, restore and PDF/MD')


if __name__ == '__main__':main()
