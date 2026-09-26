"""Daily progress through the public service, with a controlled clock/provider."""
import tempfile
import json
import os
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .state import Store
from .writing import Writing
from .progress import Progress
from .agent import Research, ProjectTools


def rejects(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError('invalid request accepted')


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        store = Store(Path(directory) / 'state.sqlite3')
        writing = Writing(store)
        project = store.create_project('日报')
        progress = Progress(store, None, clock=lambda: datetime.fromisoformat('2026-09-14T23:59:00+08:00'))
        assert progress.timeline(project)['today'] == '2026-09-14'
        assert progress.generate(project)['status'] == 'empty'
        progress.clock = lambda: datetime.fromisoformat('2026-09-15T00:00:00+08:00')
        assert progress.timeline(project)['today'] == '2026-09-15'
        clock = [datetime.fromisoformat('2026-09-14T23:59:00+08:00')]
        progress.clock = lambda: clock[0]
        progress.record(project, {'request_id':'d1','kind':'decision','text':'采用按任务拆分的评估，旧结果保留。'})
        other = store.create_project('隔离')
        # Catch-up starts at project creation, which must precede the simulated clock.
        store.run('UPDATE projects SET created=? WHERE id IN (?,?)', (clock[0].isoformat(), project, other))
        rejects(lambda: progress.record(other, {'request_id':'x','kind':'overturned','text':'不能跨项目','supersedes':'d1'}))
        assert progress.generate(project)['status'] == 'failed', 'missing provider must not mean no progress'

        calls, behavior = [], ['normal']
        entered, release = threading.Event(), threading.Event()
        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                assert not request.get('tools')
                context = json.loads(next(m['content'] for m in reversed(request['messages']) if m['role']=='user'))
                calls.append(context)
                if behavior[0] == 'wait':
                    entered.set(); assert release.wait(30)
                if 'known_reason' in context:
                    result = {'explanation':'这次没有取得完整内容，请调整整理范围后发送新请求。'}
                else:
                    source = context['activities'][0]['id']
                    result = {'items':[{'section':context['sections'][0],'text':'明确了评估方式，并保留研究历史。','sources':[source]}], 'highlights':['明确评估方式']}
                    if behavior[0] == 'bad':
                        result['items'][0]['sources'] = ['foreign-project-event']
                    if behavior[0] == 'decision':
                        result['items'][0]['section'] = '关键决策'
                chunk = {'id':'progress-check','object':'chat.completion.chunk','created':0,'model':request['model'],'choices':[{'index':0,'delta':{'role':'assistant','content':json.dumps(result,ensure_ascii=False)},'finish_reason':None}]}
                end = {**chunk,'choices':[{'index':0,'delta':{},'finish_reason':'stop'}],'usage':{'prompt_tokens':100,'completion_tokens':20,'total_tokens':120}}
                raw = ('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode()
                self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
        provider = ThreadingHTTPServer(('127.0.0.1',0), Provider)
        threading.Thread(target=provider.serve_forever,daemon=True).start()
        research = Research(store)
        research.key, research.base_url = 'local-check', f'http://127.0.0.1:{provider.server_port}'
        progress.research = research
        store.progress = progress
        try:
            assert progress.generate(project)['status'] == 'ready'
            first = progress.get(project,'2026-09-14')['versions'][0]
            path = Path(directory) / 'workspaces' / project / 'progress/2026-09-14.md'
            assert path.read_text('utf-8') == first['body']
            assert first['payload']['sources'] == ['d1']
            assert '## 原始依据' not in first['body'] and '#activity-' not in first['body']
            assert 'd1' in first['payload']['sources']
            progress.generate(project)
            assert len(calls) == 1, 'repeated request invoked model'
            progress.save(project,'2026-09-14',{'base_version_id':first['id'],'content':first['body']+'\n人工核对：尚需实验。'})
            manual = progress.get(project,'2026-09-14')['versions'][-1]
            rejects(lambda: progress.save(project,'2026-09-14',{'base_version_id':first['id'],'content':'过期改动'}))
            assert progress.generate(project,instruction='进一步精简')['status'] == 'ready'
            item = progress.get(project,'2026-09-14')
            assert item['versions'][-1]['id'] == manual['id'] and item['proposal']
            body = {'proposal_id':item['proposal']['id'],'action':'accept'}
            store.run("CREATE TRIGGER fail_progress_accept BEFORE UPDATE OF proposal ON progress_days BEGIN SELECT RAISE(ABORT,'controlled commit failure'); END")
            before = path.read_bytes()
            try:
                progress.decide(project,'2026-09-14',body)
                raise AssertionError('controlled storage failure did not fire')
            except sqlite3.DatabaseError:
                pass
            assert path.read_bytes() == before
            assert len(progress.get(project,'2026-09-14')['versions']) == 2
            assert not progress.get(project,'2026-09-14')['proposal'].get('decision')
            store.run('DROP TRIGGER fail_progress_accept')
            progress.decide(project,'2026-09-14',body); progress.decide(project,'2026-09-14',body)
            assert len(progress.get(project,'2026-09-14')['versions']) == 3
            path.write_bytes('# 外部人工修订\n保留真实原稿。'.encode('utf-8'))
            external = progress.get(project,'2026-09-14')['versions'][-1]
            assert external['body'] == path.read_text('utf-8') and external['payload']['author'] == 'file'
            task = writing.task(project,'继续研究','running',store.create_conversation(project))
            tools = ProjectTools(store,task)
            tools.set_scope(False)
            assert any(f['id']==external['artifact_id'] for f in tools.list_files()['files'])
            assert tools.read_file(external['artifact_id'],external['id'])['body'] == path.read_text('utf-8')
            assert Path(directory,'workspaces',project,first['payload']['filename']).read_text('utf-8') == first['body']
            path.unlink()
            missing = progress.get(project,'2026-09-14')
            assert missing['error'] and missing['versions'][-1]['id'] == external['id']
            assert tools.list_files(True)['files'] and tools.read_file(external['artifact_id'],external['id'],True)['body'] == external['body']
            progress.save(project,'2026-09-14',{'base_version_id':external['id'],'content':external['body'],'restore_file':True})
            assert path.read_bytes().decode() == external['body']
            rejects(lambda: progress.get(other,'2026-09-14'))

            clock[0] = datetime.fromisoformat('2026-09-15T00:00:00+08:00')
            progress.record(project, {'request_id':'d2','kind':'overturned','text':'推翻原评估决定，改为逐任务加失败分析。','supersedes':'d1'})
            assert [e['id'] for e in progress.events(project,'2026-09-14') if e['kind']=='decision'] == ['d1']
            assert [e['id'] for e in progress.events(project,'2026-09-15')] == ['d2']
            behavior[0] = 'wait'
            with ThreadPoolExecutor(1) as pool:
                future = pool.submit(progress.generate,project)
                assert entered.wait(15)
                assert progress.generate(project)['status'] == 'running'
                progress.settings(project, {'archived':True})
                release.set()
                assert future.result()['status'] == 'failed', 'archived project accepted late result'
            assert not progress.get(project,'2026-09-15')['versions']
            progress.settings(project, {'archived':False})
            behavior[0] = 'bad'
            assert progress.generate(project)['status'] == 'failed'
            behavior[0] = 'normal'
            assert progress.generate(project)['status'] == 'ready'
            clock[0] = datetime.fromisoformat('2026-09-17T00:00:00+08:00')
            progress.tick()
            assert all(d['settled'] for d in progress.timeline(project)['days'] if d['day'] < '2026-09-17')
            assert not (path.parent/'2026-09-16.md').exists(), 'empty day produced a file'
            count = len(calls)
            progress.tick(); assert len(calls) == count

            # Real workspace file snapshots, never arbitrary computer directories.
            note = path.parent.parent/'experiment.txt'
            note.write_text('run 1',encoding='utf-8')
            modified = datetime.fromisoformat('2026-09-14T23:59:00+08:00').timestamp()
            os.utime(note,(modified,modified)); progress.scan_files(project)
            assert any(e['data'].get('path')=='experiment.txt' for e in progress.events(project,'2026-09-14')), 'late scan lost 03:59 activity'
            note.write_text('run 2',encoding='utf-8')
            # File mtimes must use the same simulated timeline as deletion's clock.
            os.utime(note,(modified + 120,modified + 120)); progress.scan_files(project)
            assert any(e['data'].get('text')=='run 2' for e in progress.events(project,'2026-09-15'))
            note.unlink(); progress.scan_files(project)
            assert [e['kind'] for e in progress.events(project) if e['data'].get('path')=='experiment.txt'] == ['file_changed','file_changed','file_deleted']
            note.write_bytes(b'\xff\xfe')
            progress.tick()
            assert any(d['error'] and '活动读取失败' in d['error'] for d in progress.timeline(project)['days'])
            assert progress.timeline(other)['days'], 'bad file prevented another project catch-up'
            note.unlink()
            progress.settings(project, {'enabled':False})
            progress.tick(); assert len(calls) == count
            research.close(); store.close()
            store = Store(Path(directory)/'state.sqlite3')
            Writing(store)
            progress = Progress(store,None,clock=lambda:clock[0])
            assert progress.get(project,'2026-09-14')['versions'][-1]['body'] == '# 外部人工修订\n保留真实原稿。'
            assert not progress.settings(project)['enabled']
        finally:
            research.close(); provider.shutdown(); provider.server_close()
        store.close()
    print('progress checks passed')


if __name__ == '__main__':
    main()
