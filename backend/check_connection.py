"""Real Harness transport failures: bounded retries and a visible recovery state."""
import json
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .app import Service


def main():
    attempts = []
    recovering = False
    idle = False
    failure_status = None

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def handle(self):
            try:
                super().handle()
            except (ConnectionResetError, BrokenPipeError):
                pass  # Expected when the client cancels the deliberately idle socket.

        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            attempts.append(time.monotonic())
            if failure_status:
                self.send_response(failure_status)
                self.send_header('Content-Type','application/json')
                self.end_headers()
                self.wfile.write(b'{"error":{"message":"private_provider_function failed"}}')
                return
            if idle:
                time.sleep(11)
                self.close_connection = True
                return
            if not recovering or len(attempts) == 1:
                self.close_connection = True
                return
            answer = json.dumps({'intent':'chat','mode':'direct','only_selected':False,'answer':'你好！'})
            chunk = {'id':'connection-check','choices':[{'index':0,'delta':{'role':'assistant','content':answer},'finish_reason':'stop'}]}
            raw = ('data: ' + json.dumps(chunk) + '\n\ndata: [DONE]\n\n').encode()
            self.send_response(200)
            self.send_header('Content-Type','text/event-stream')
            self.send_header('Content-Length',str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    provider = ThreadingHTTPServer(('127.0.0.1',0),Provider)
    threading.Thread(target=provider.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        service = Service(Path(directory)/'empty',Path(directory))
        service.research.key = 'local-test'
        service.research.base_url = f'http://127.0.0.1:{provider.server_port}'
        project = service.store.projects()[0]['id']
        conversation = service.store.create_conversation(project)
        try:
            for recovering in (False,True):
                attempts.clear()
                started = time.monotonic()
                sent = service.message(project,conversation,{'text':'你好','client_message_id':str(recovering)},schedule=False)
                service.route(sent['task_id'])
                task = service.task_view(project,sent['task_id'])
                print({'recovery':recovering,'attempts':len(attempts),'seconds':round(time.monotonic()-started,2),'status':task['status']},flush=True)
                assert len(attempts) == 2, 'one retry only; do not silently wait through five retries'
                assert task['status'] == ('succeeded' if recovering else 'failed')
                assert any(e['status'] == 'connection_retry' for e in task['events'])
                assert 'llm/retry' in (service.store.root/'logs'/'errors.jsonl').read_text(), 'Recovered attempts still need diagnostics'
                assert not task['tools'] and not task['files']
                if not recovering:
                    assert task['error_info']['code'] in ('connection','timeout')
                    assert task['error_info']['action'] == 'resume' and 'HTTP' not in task['error']
            print('PASS: actual Harness bounded connection failure and recovery without research tools')
            idle = True
            attempts.clear()
            started = time.monotonic()
            sent = service.message(project,conversation,{'text':'你好','client_message_id':'idle'},schedule=False)
            service.route(sent['task_id'])
            task = service.task_view(project,sent['task_id'])
            elapsed = time.monotonic()-started
            assert len(attempts) == 2 and task['status'] == 'failed' and elapsed < 27
            assert '超时' in task['error']
            print(f'PASS: silent connection times out after one retry in {elapsed:.1f}s',flush=True)
            idle = False
            for failure_status, expected_code, count in [(401,'authentication',1),(402,'billing',1),(403,'authentication',1),(429,'rate_limit',2),(503,'unavailable',2)]:
                attempts.clear()
                sent = service.message(project,conversation,{'text':'你好','client_message_id':str(failure_status)},schedule=False)
                service.route(sent['task_id'])
                task = service.task_view(project,sent['task_id'])
                assert task['status'] == 'failed' and task['error_info']['code'] == expected_code, task['error_info']
                assert len(attempts) == count, (failure_status,len(attempts))
                assert 'HTTP' not in task['error'] and 'private_provider_function' not in task['error']
            print('PASS: authentication/billing never retried; rate limit and upstream failure bounded at one retry',flush=True)
        finally:
            service.close()
            provider.shutdown()
            provider.server_close()


if __name__ == '__main__':
    main()
