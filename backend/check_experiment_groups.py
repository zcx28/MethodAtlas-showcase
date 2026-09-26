"""Issue 79 public HTTP checks; actual Mimir, controlled external SSH peer."""
import json
import os
from pathlib import Path
import tempfile
import threading
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from .app import Service, Handler
from .check_remote import fixture


def harness_loop(service, project, conversation, server, folder):
    """Drive the actual Harness and observer continuation with a controlled model endpoint."""
    from http.server import BaseHTTPRequestHandler
    import time
    group=service.remote.groups.prepare(project,{'conversation_id':conversation,'server_id':server['id'],
        'directory':'/work/experiment','title':'自主baseline对照','plan':'固定数据，真实结果，保存分析',
        'steps':['baseline','对照'],'network':False,'gpu_devices':[]})
    ident=group['id']
    (folder/'failed').unlink(missing_ok=True)
    (folder/'complete').touch()
    calls=[]; stage=[0]; restart_ready=threading.Event(); restarted=False
    # Three Harness turns: submit baseline → record/submit contrast → record/report/finish.
    actions=[('read_experiment_group',{'group_id':ident}),
             ('run_experiment_group',{'group_id':ident,'step':0,'command':'python3 baseline.py','request_id':'baseline'}),None,
             ('record_experiment_result',{'group_id':ident,'result_path':'result.csv','summary':'baseline=0.75，待比较'}),
             ('complete_experiment_step',{'group_id':ident,'step':0,'summary':'baseline已完成'}),
             ('run_experiment_group',{'group_id':ident,'step':1,'command':'python3 contrast.py','request_id':'contrast'}),None,
             ('record_experiment_result',{'group_id':ident,'result_path':'result.csv','summary':'对照=0.75，未显示优势'}),
             ('write_file',{'kind':'docx','title':'实验组结果分析','content':'baseline和对照均为0.75。未显示优势，不支持优于baseline的主张。真实服务器数据尚未验收。','citation_ids':[]}),
             ('complete_experiment_step',{'group_id':ident,'step':1,'summary':'对照完成，负结果保留'}),None]
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*_):
            pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(body)
            assert body.get('tools'), 'Continuation must use the actual Agent, not RAG routing'
            action=actions[stage[0]]; stage[0]+=1
            if action:
                name,args=action;args=dict(args)
                if name=='record_experiment_result':
                    args['experiment_id']=service.remote.groups.get(project,ident)['runs'][-1]['id']
                message={'role':'assistant','tool_calls':[{'index':0,'id':'loop-'+str(stage[0]),'type':'function',
                    'function':{'name':'mcp__methodatlas__'+name,'arguments':json.dumps(args)}}]}
            else:
                message={'role':'assistant','content':'已按确认计划提交并保留记录；由工作台继续观察。'}
            if stage[0]==3:
                restart_ready.set()
                time.sleep(3)  # close the host while the first Agent turn has not finished
            chunks=[{'id':'group-check','choices':[{'index':0,'delta':message,'finish_reason':None}]},
                    {'id':'group-check','choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if action else 'stop'}],
                     'usage':{'prompt_tokens':100,'completion_tokens':30,'total_tokens':130}}]
            raw=(''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n').encode()
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    provider=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    service.research.key='controlled-model';service.research.base_url=f'http://127.0.0.1:{provider.server_port}'
    try:
        # Trusted user text confirms the sole draft in this conversation.
        confirmation=service.message(project,conversation,{'text':'按你判断执行','client_message_id':'group-chat-confirm'},schedule=True)
        assert service.remote.groups.get(project,ident)['status']=='active'
        for _ in range(450):
            if restart_ready.is_set() and not restarted:
                data_root=service.store.root
                service.close()
                os.environ['DEEPSEEK_API_KEY']='controlled-model'
                os.environ['DEEPSEEK_BASE_URL']=f'http://127.0.0.1:{provider.server_port}'
                service=Service(folder/'papers',data_root)
                assert service.store.task(confirmation['task_id'])['status']=='interrupted'
                restarted=True
            service.remote.groups.tick()
            current=service.remote.groups.get(project,ident)
            task=service.store.task(current['last_task']) if current.get('last_task') else None
            if task and task['status']=='failed':
                raise AssertionError(task['error'])
            if current['status']=='completed' and task['status']=='succeeded':
                break
            time.sleep(.2)
        assert restarted
        assert current['status']=='completed',(current,task)
        assert len(current['runs'])==2 and current['completed_steps']==[0,1]
        assert all(r.get('evidence',{}).get('version_id') for r in current['runs'])
        chart=service.remote.groups.chart(project,ident,'score')
        assert '<svg' in chart and '0.75' in chart
        assert any(a['title']=='实验组结果分析' for a in service.store.artifacts(project))
        assert len(calls)==len(actions),(len(calls),stage)
        print(f'PASS actual Harness: trusted chat authorization → baseline → host restart → observer wake → contrast → fixed metrics → DOCX → completed ({len(calls)} controlled calls, real provider calls 0)')
    finally:
        service.research.key=''
        provider.shutdown();provider.server_close()
    return service

def main():
    saved = dict(os.environ)
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        fixture(folder)
        os.environ['REMOTE_FIXTURE_PORT'] = '22'
        service = Service(folder / 'papers', folder / 'data')
        http = ThreadingHTTPServer(('127.0.0.1', 0), type('GroupCheck', (Handler,), {'service': service}))
        threading.Thread(target=http.serve_forever, daemon=True).start()
        base = f'http://127.0.0.1:{http.server_port}'
        def api(path, body=None):
            request = Request(base + path, data=None if body is None else json.dumps(body).encode(),
                              headers={'Content-Type':'application/json', 'Origin':base})
            with urlopen(request, timeout=45) as response:
                return json.load(response)
        def reject(path, body):
            try:
                api(path, body)
            except HTTPError as error:
                assert error.code == 400, error.read()
                return
            raise AssertionError('unsafe request accepted')
        try:
            project = service.store.create_project('实验组')
            conversation = service.store.conversations(project)[0]['id']
            server = api('/api/remote/servers/save', {'name':'Fixture','host':'fixture','port':22})['server']
            root = f'/api/projects/{project}/remote/groups'
            draft = api(root+'/prepare', {'conversation_id':conversation,'server_id':server['id'],
                'directory':'/work/experiment','title':'baseline 与对照','plan':'比较固定数据与指标，不更换判定标准',
                'steps':['baseline','对照'], 'resources':'CPU','network':False, 'gpu_devices':[]})
            assert draft['status'] == 'awaiting_confirmation'
            assert api(root+'/'+draft['id'])['spec']['steps'] == ['baseline','对照']
            reject(root+'/'+draft['id']+'/confirm', {'digest':'wrong'})
            other = service.store.create_project('另一项目')
            reject(f'/api/projects/{other}/remote/groups/'+draft['id']+'/confirm', {'digest':draft['digest']})
            assert len(api(f'/api/projects/{project}/remote')['groups']) == 1
            confirmed = api(root+'/'+draft['id']+'/confirm', {'digest':draft['digest']})
            assert confirmed['status'] == 'active'
            from .agent import ProjectTools
            tools = ProjectTools(service.store, {'id':'group-check','project_id':project,'conversation_id':conversation})
            run = tools.run_experiment_group(draft['id'], step=0, command='python3 baseline.py', request_id='baseline-1')
            duplicate = tools.run_experiment_group(draft['id'], step=0, command='python3 baseline.py', request_id='baseline-1')
            assert duplicate['id'] == run['id']
            paused = api(root+'/'+draft['id']+'/pause', {'digest':draft['digest']})
            assert paused['status'] == 'paused'
            try:
                tools.run_experiment_group(draft['id'], step=1, command='python3 contrast.py',request_id='contrast-1')
            except ValueError:
                pass
            else:
                raise AssertionError('paused group executed')
            api(root+'/'+draft['id']+'/resume', {'digest':draft['digest']})
            (folder/'complete').touch()
            api(f'/api/projects/{project}/remote/{run["id"]}/observe',{})
            record=tools.record_experiment_result(draft['id'],experiment_id=run['id'],result_path='result.csv',summary='单次得分0.75，待对照')
            assert record['record']['metrics']['score']==0.75
            assert record['evidence']['version_id']
            try:
                tools.record_experiment_result(draft['id'],experiment_id=run['id'],result_path='different/result.csv',summary='must reject')
            except ValueError:
                pass
            else:
                raise AssertionError('same basename confused different result paths')
            assert tools.complete_experiment_step(draft['id'],0,'已记录baseline')['completed_steps']==[0]
            (folder/'complete').unlink()
            (folder/'failed').touch()
            failed=tools.run_experiment_group(draft['id'],step=1,command='python3 contrast.py',request_id='contrast')
            assert failed['status']=='failed'
            for attempt in range(3):
                failed=tools.run_experiment_group(draft['id'],step=1,command='python3 contrast.py',request_id='repair-'+str(attempt),kind='repair',repair_of=failed['id'])
                assert failed['status']=='failed'
            try:
                tools.run_experiment_group(draft['id'],step=1,command='python3 contrast.py',request_id='repair-extra',kind='repair',repair_of=failed['id'])
            except ValueError:
                pass
            else:
                raise AssertionError('repair limit bypassed')
            assert api(root+'/'+draft['id'])['status']=='paused'
            reject(f'/api/projects/{project}/remote/{failed["id"]}/confirm', {'digest':failed['digest']})
            service=harness_loop(service,project,conversation,server,folder)
            print('PASS group draft, authorization digest and project isolation over HTTP')
        finally:
            http.shutdown(); http.server_close(); service.close()
            os.environ.clear(); os.environ.update(saved)


if __name__ == '__main__':
    main()
