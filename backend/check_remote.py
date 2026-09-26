"""Remote experiments through the public service; no real server is implied."""
import tempfile
import json
import os
import shutil
import socketserver
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .state import Store
from .remote import Remote
from .app import Handler, Service


def fixture(folder):
    """Replace only the external ssh process; production Mimir/bridge stays real."""
    script = Path(__file__).with_name('remote_fixture.py')
    if os.name == 'nt':
        compiler = shutil.which('gcc')
        if not compiler:
            raise RuntimeError('Windows SSH peer fixture needs the installed gcc')
        source = folder / 'ssh.c'
        source.write_text('#include <process.h>\n#include <stdlib.h>\nint main(int n,char **a){char **v=calloc(n+3,sizeof(char*));v[0]=getenv("REMOTE_FIXTURE_PYTHON");v[1]=getenv("REMOTE_FIXTURE_SCRIPT");for(int i=1;i<n;i++)v[i+1]=a[i];return _spawnv(_P_WAIT,v[0],(const char* const*)v);}\n')
        subprocess.run([compiler, str(source), '-o', str(folder / 'ssh.exe')], check=True, capture_output=True)
    else:
        target = folder / 'ssh'
        target.write_text(f'#!{sys.executable}\nimport runpy\nrunpy.run_path({str(script)!r},run_name="__main__")\n')
        target.chmod(0o700)
    os.environ.update(REMOTE_FIXTURE_ROOT=str(folder), REMOTE_FIXTURE_PYTHON=sys.executable, REMOTE_FIXTURE_SCRIPT=str(script))
    os.environ['PATH'] = str(folder) + os.pathsep + os.environ['PATH']


def public_flow(folder):
    peer = socketserver.TCPServer(('127.0.0.1', 0), socketserver.BaseRequestHandler)
    threading.Thread(target=peer.serve_forever, daemon=True).start()
    os.environ['REMOTE_FIXTURE_PORT'] = str(peer.server_address[1])
    service = Service(folder / 'no-pdfs', folder / 'data')
    project = service.store.create_project('远程实验边界')
    service.progress.settings(project, {'enabled': False})
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), type('CheckHandler', (Handler,), {'service': service}))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{httpd.server_port}'
    def api(path, body=None):
        request = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                          headers={'Content-Type':'application/json', 'Origin':base})
        with urlopen(request, timeout=45) as response:
            return json.load(response)
    prefix = f'/api/projects/{project}/remote'
    try:
        server = api('/api/remote/servers/save', {'name':'Fixture','host':'fixture','port':22,'username':''})['server']
        probe = api('/api/remote/servers/check', {'id':server['id']})
        assert probe['ssh'] == 'connected' and probe['gpu'] == 'none', probe
        (folder / 'probe').write_text('auth')
        assert api('/api/remote/servers/check', {'id':server['id']})['ssh'] == 'authentication_failed'
        (folder / 'probe').write_text('bad')
        assert api('/api/remote/servers/check', {'id':server['id']})['gpu'] == 'probe_error'
        draft = api(prefix+'/prepare', {'server_id':server['id'],'directory':'/work/experiment','command':'run baseline','resources':'CPU'})
        path = prefix+'/'+draft['id']
        assert api(path)['status'] == 'awaiting_confirmation'
        first = api(path+'/confirm', {'digest':draft['digest']})
        assert first['status'] == 'unknown', 'lost submit reply must not become failed'
        again = api(path+'/confirm', {'digest':draft['digest']})
        assert again['status'] == 'running'
        result = api(path+'/result', {'path':'result.csv'})
        assert result['text'] == 'launches,score\n1,0.75\n', 'ambiguous retry launched a duplicate'
        log = api(path+'/log', {'offset':0})
        assert log['next_offset'] == 65536 and log['size'] > 65536
        rest = api(path+'/log', {'offset':log['next_offset']})
        assert rest['next_offset'] == rest['size']
        (folder / 'offline').touch()
        assert api(path+'/observe', {})['status'] == 'unknown'
        (folder / 'offline').unlink()
        (folder / 'complete').touch()
        assert api(path+'/observe', {})['status'] == 'succeeded'
        fetched = api(path+'/fetch', {'path':'result.csv'})
        assert fetched['paper_id'] and fetched['version_id']
        assert api(path+'/fetch', {'path':'result.csv'})['id'] == fetched['id']
        with urlopen(base+prefix+'/results/'+fetched['id']) as response:
            assert response.read() == b'launches,score\n1,0.75\n'
        before = len(service.progress.events(project))
        api(path+'/observe', {})
        assert len(service.progress.events(project)) == before, 'duplicate sync produced daily activity'
        assert any(e['kind']=='experiment' and e['data']['status']=='succeeded' for e in service.progress.events(project))
        other = service.store.create_project('隔离')
        for suffix, body in [('',None),('/confirm',{'digest':draft['digest']}),('/log',{}),('/fetch',{'path':'result.csv'})]:
            try:
                api(f'/api/projects/{other}/remote/{draft["id"]}'+suffix,body)
            except HTTPError as error:
                assert error.code == 400
            else:
                raise AssertionError('cross-project experiment access')
        try:
            api(path+'/result',{'path':'../secret'})
        except HTTPError as error:
            assert error.code == 400
        else:
            raise AssertionError('result escaped authorized directory')
        from .agent import ProjectTools
        # The Agent's actual read interface sees the same durable state.
        tools = ProjectTools(service.store, {'id':'check','project_id':project,'conversation_id':'check'})
        assert tools.list_experiments()['experiments'][0]['status'] == 'succeeded'
        assert tools.read_experiment(draft['id'], path='result.csv')['evidence']['text'] == result['text']
        assert not any(t[0] in ('confirm_experiment','cancel_experiment') for t in tools.definitions)
        service.remote.close()
        restarted = Remote(service.store)
        assert restarted.get(project,draft['id'])['results'][0]['sha256'] == fetched['sha256']
        assert restarted.observe(project,draft['id'])['status'] == 'succeeded'
        analyze_and_report(service, project, draft['id'], api, fetched['paper_id'])
        (folder / 'complete').unlink()
        (folder / 'failed').touch()
        failed=api(prefix+'/prepare', {'server_id':server['id'],'directory':'/work/experiment','command':'sh run.sh','resources':'CPU'})
        assert api(prefix+'/'+failed['id']+'/confirm',{'digest':failed['digest']})['status']=='failed'
        script=api(prefix+'/'+failed['id']+'/result',{'path':'run.sh'})
        repair={'path':'run.sh','before_sha256':script['sha256_chunk'],'content':'exit 0\n','reason':'修复运行脚本'}
        first_repair=api(prefix+'/'+failed['id']+'/repair',repair)
        assert first_repair['status']=='awaiting_confirmation'
        assert api(prefix+'/'+failed['id']+'/repair',repair)['id']==first_repair['id'], 'same parent created sibling retries'
        bad={**repair,'path':'../outside.sh'}
        try:
            api(prefix+'/'+failed['id']+'/repair',bad)
        except HTTPError as error:
            assert error.code==400
        else:
            raise AssertionError('repair escaped authorized directory')
        def compete(action, payload):
            try:
                return api(prefix+'/'+(failed['id'] if action=='repair' else first_repair['id'])+'/'+action,payload)
            except HTTPError as error:
                assert error.code==400
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            replacing=pool.submit(compete,'repair',{**repair,'content':'exit 0\n# revised draft\n'})
            confirming=pool.submit(compete,'confirm',{'digest':first_repair['digest']})
            replacing.result();confirming.result()
        first_repair=api(prefix+'/'+first_repair['id'])
        if first_repair['status']=='awaiting_confirmation':
            first_repair=api(prefix+'/'+first_repair['id']+'/confirm',{'digest':first_repair['digest']})
        assert first_repair['job']['spec']==first_repair['spec'], 'confirmation executed a different repair draft'
        second_repair=api(prefix+'/'+first_repair['id']+'/repair',repair)
        api(prefix+'/'+second_repair['id']+'/confirm',{'digest':second_repair['digest']})
        try:
            api(prefix+'/'+second_repair['id']+'/repair',repair)
        except HTTPError as error:
            assert error.code==400
        else:
            raise AssertionError('retry limit bypassed')
        (folder / 'failed').unlink()
        running=api(prefix+'/prepare', {'server_id':server['id'],'directory':'/work/experiment','command':'sleep 30','resources':'CPU'})
        api(prefix+'/'+running['id']+'/confirm',{'digest':running['digest']})
        assert api(prefix+'/'+running['id']+'/cancel',{'digest':running['digest'],'confirm':True})['status']=='cancelled'
    finally:
        httpd.shutdown(); httpd.server_close(); service.close(); peer.shutdown(); peer.server_close()


def analyze_and_report(service, project, ident, api, paper):
    calls, steps = [], [0]
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(body)
            system = '\n'.join(str(m.get('content','')) for m in body['messages'] if m['role']=='system')
            if '根据真实研究活动生成简短研究回顾' in system:
                context=json.loads(next(m['content'] for m in reversed(body['messages']) if m['role']=='user'))
                sources=[a['id'] for a in context['activities'] if a['kind'] in ('experiment','experiment_result','version')]
                answer={'items':[{'section':context['sections'][0],'text':'远程实验执行成功，结果已取回并分析；科学主张仍待验证。','sources':sources or [context['activities'][0]['id']]}], 'highlights':['结果已回收，科学主张待验证']}
                message={'role':'assistant','content':json.dumps(answer,ensure_ascii=False)}
            elif not body.get('tools'):
                message={'role':'assistant','content':json.dumps({'intent':'research','mode':'explore','reason':'分析远程实验真实记录','only_selected':False,'skills':['research-result-to-claim']})}
            else:
                assert 'Supported' in system or '支持' in system
                plan=[('set_scope',{'only_selected':False}), ('read_experiment',{'experiment_id':ident,'path':'result.csv'}),
                      ('write_file',{'kind':'docx','title':'远程结果分析','content':'远程执行成功，记录 score=0.75。缺少对照与统计验证，科学主张仍待验证。','citation_ids':[]})]
                index=steps[0]; steps[0]+=1
                if index < len(plan):
                    name,args=plan[index]
                    message={'role':'assistant','tool_calls':[{'index':0,'id':f'check-{index}','type':'function','function':{'name':'mcp__methodatlas__'+name,'arguments':json.dumps(args)}}]}
                else:
                    assert any('0.75' in str(m.get('content','')) for m in body['messages'] if m['role']=='tool')
                    message={'role':'assistant','content':'已保存真实结果分析；执行成功，科学主张仍待验证。'}
            finish='tool_calls' if message.get('tool_calls') else 'stop'
            chunks=[{'id':'remote-check','choices':[{'index':0,'delta':message,'finish_reason':None}]},
                    {'id':'remote-check','choices':[{'index':0,'delta':{},'finish_reason':finish}], 'usage':{'prompt_tokens':100,'completion_tokens':30,'total_tokens':130}}]
            raw=(''.join('data: '+json.dumps(chunk)+'\n\n' for chunk in chunks)+'data: [DONE]\n\n').encode()
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    provider=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    service.research.key='controlled-peer'; service.research.base_url=f'http://127.0.0.1:{provider.server_port}'
    try:
        conversation=service.store.conversations(project)[0]['id']
        response=api(f'/api/projects/{project}/conversations/{conversation}/messages',{'text':f'分析远程实验 {ident} 并保存报告','client_message_id':'remote-analysis','selected_paper_ids':[paper]})
        task_id=response['task_id']
        for _ in range(600):
            task=service.store.task(task_id)
            if task['status'] in ('succeeded','failed','waiting','stopped'):
                break
            time.sleep(.1)
        assert task['status']=='succeeded', (task['status'],task.get('error'))
        assert any('research-result-to-claim' in str(c['messages']) for c in calls)
        report=api(f'/api/projects/{project}/progress/generate',{})
        assert report['status']=='ready',report
        timeline=api(f'/api/projects/{project}/progress')
        daily=api(f'/api/projects/{project}/progress/'+timeline['today'])
        assert '科学主张仍待验证' in daily['versions'][-1]['body']
        assert any(e['kind']=='version' and e['data']['title']=='远程结果分析' for e in daily['events'])
        print(f'PASS actual Harness + controlled HTTP: remote analysis → DOCX → generated daily report ({len(calls)} controlled calls; real provider calls 0)')
    finally:
        provider.shutdown();provider.server_close()


def rejects(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError('invalid request accepted')


def main():
    with tempfile.TemporaryDirectory() as folder:
        store = Store(Path(folder) / 'state.sqlite3')
        project = store.create_project('remote')
        remote = Remote(store)
        server = remote.servers('save', {'name': 'Test', 'host': '127.0.0.1', 'port': 1, 'username': 'research'})['server']
        assert remote.servers('list')['servers'][0]['id'] == server['id']
        rejects(lambda: remote.servers('save', {'name': 'Bad', 'host': '-oProxyCommand=evil', 'port': 22}))
        rejects(lambda: remote.prepare(project, {'server_id': server['id'], 'directory': '../escape', 'command': 'true', 'resources': ''}))
        draft = remote.prepare(project, {'server_id': server['id'], 'directory': '/tmp/experiment', 'command': 'true', 'resources': 'CPU'})
        assert draft['status'] == 'awaiting_confirmation'
        assert remote.get(project, draft['id'])['spec']['command'] == 'true'
        other = store.create_project('other')
        rejects(lambda: remote.get(other, draft['id']))
        rejects(lambda: remote.confirm(project, draft['id'], {'digest': 'changed'}))
        server['name'] = 'Edited'
        remote.servers('save', {k: server[k] for k in ('id', 'name', 'host', 'port', 'username')})
        rejects(lambda: remote.confirm(project, draft['id'], {'digest': draft['digest']}))
        store.db.close()
    print('PASS remote configuration, authorization and project isolation')
    saved = dict(os.environ)
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
            fixture(Path(folder))
            public_flow(Path(folder))
    finally:
        os.environ.clear(); os.environ.update(saved)
    print('PASS public HTTP → actual Mimir → controlled SSH: auth, reconnect, idempotency, bounded log, result versions, Agent and daily activities')


if __name__ == '__main__':
    main()
