"""Capability-bound model egress; reserve shared budgets before provider I/O."""
import copy
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, build_opener

from .auth import NoRedirect
from .errors import AppError, http_code
from .resource_limits import price_rates


class ModelGateway:
    def __init__(self, research):
        self.research, self.store = research, research.store
        self.routes = {}
        self.server = None
        self.capacity = threading.BoundedSemaphore(research.resources.global_limit)

    def bind(self, config, task=None, workspace=None):
        with self.store.lock:
            if self.server is None:
                self.server = ThreadingHTTPServer(('127.0.0.1', 0), type('BudgetHandler', (Handler,), {'gateway': self}))
                self.server.daemon_threads = True
                threading.Thread(target=self.server.serve_forever, daemon=True).start()
            config = copy.deepcopy(config)
            if task:
                self.store.assert_active(task['id'], task['revision'])
                workspace = self.research.resources.workspace(task['project_id'])
                config['rates'] = self.research.settings.for_project(task['project_id']).selected(config['id'], project=task['project_id']).get('rates')
                actor = task['refs']['initiated_by']
            else:
                actor = self.store.one('SELECT owner_id FROM workspaces WHERE id=?', (workspace,))['owner_id']
            token = secrets.token_urlsafe(32)
            self.routes[token] = {'config': config, 'task': task, 'workspace': workspace, 'actor': actor, 'error': None}
            return {**config, 'base_url': f'http://127.0.0.1:{self.server.server_port}/{token}', 'api_key': token}, token

    def attach(self, harness, token):
        harness._methodatlas_budget_error = None
        with self.store.lock:
            self.routes[token]['harness'] = harness
        close = harness.close
        def cleanup():
            self.unbind(token)
            close()
        harness.close = cleanup
        return harness

    def unbind(self, token):
        with self.store.lock:
            return self.routes.pop(token, None)

    def close(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        with self.store.lock:
            self.routes.clear()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(180)

    def do_POST(self):
        ident = None
        rates = usage = None
        sent = rejected = False
        admitted = False
        route = None
        try:
            parts = self.path.split('/')
            if len(parts) != 4 or parts[2:] != ['chat', 'completions']:
                raise PermissionError('模型请求入口无效')
            with self.gateway.store.lock:
                route = self.gateway.routes.get(parts[1])
                if not route or self.headers.get('Authorization') != 'Bearer ' + parts[1]:
                    raise PermissionError('模型请求没有有效运行授权')
                config, task = route['config'], route['task']
                if task:
                    self.gateway.store.assert_active(task['id'], task['revision'])
                else:
                    self.gateway.store.collaboration.workspace({'id': route['actor']}, route['workspace'], owner=True)
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 16 * 1024 * 1024:
                raise ValueError('模型请求大小无效')
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError('模型请求不完整')
            body = json.loads(raw)
            maximum = body.get('max_tokens', body.get('max_completion_tokens'))
            if body.get('model') != config['model'] or type(maximum) is not int or not 1 <= maximum <= config['max_output']:
                raise ValueError('模型请求与授权配置不一致')
            messages, tools = body.get('messages'), body.get('tools', [])
            if not isinstance(messages, list) or not isinstance(tools, list):
                raise ValueError('模型请求格式无效')
            # Byte-level text tokenizers cannot exceed bytes plus message framing.
            # Images reserve the configured context to avoid undercounting visual tokens.
            images = any(isinstance(m.get('content'), list) and any(c.get('type') == 'image_url' for c in m['content'] if isinstance(c, dict)) for m in messages if isinstance(m, dict))
            bound = config['context_window'] if images else min(config['context_window'], len(raw) + 512 + 128 * (len(messages) + len(tools)))
            rates = price_rates(config.get('rates'))
            # Include probes and in-flight requests whose Harness was already stopped.
            admitted = self.gateway.capacity.acquire(timeout=180)
            if not admitted:
                raise AppError('timeout', '等待模型请求容量超时')
            with self.gateway.store.transaction():
                if task:
                    self.gateway.store.assert_active(task['id'], task['revision'])
                else:
                    current = self.gateway.research.settings.for_workspace(route['workspace']).selected(config['id'])
                    if current != config:
                        raise AppError('configuration', '测试期间模型连接已变化')
                ident = self.gateway.research.resources.reserve(route['workspace'], task['project_id'] if task else None,
                                                               route['actor'], bound, maximum, rates)
            if body.get('stream'):
                body['stream_options'] = {**body.get('stream_options', {}), 'include_usage': True}
            request = Request(config['base_url'] + '/chat/completions', data=json.dumps(body).encode(),
                              headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['api_key']})
            try:
                response = build_opener(NoRedirect()).open(request, timeout=180)
            except HTTPError as error:
                rejected = error.code in (400, 401, 403, 404, 413, 422, 429)
                raise AppError('authentication' if error.code in (401, 403) else http_code(error.code), '模型供应商拒绝请求', status=error.code) from None
            with response:
                route['error'] = None
                if route.get('harness'):
                    route['harness']._methodatlas_budget_error = None
                if body.get('stream'):
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    self.close_connection = True
                    sent = True
                    terminal = []
                    terminal_size = 0
                    finishing = False
                    while True:
                        line = response.readline(4 * 1024 * 1024 + 1)
                        if not line:
                            break
                        if len(line) > 4 * 1024 * 1024:
                            raise ValueError('模型响应超出范围')
                        if line.startswith(b'data:'):
                            value = line[5:].strip()
                            if value and value != b'[DONE]':
                                event = json.loads(value)
                                if isinstance(event.get('usage'), dict):
                                    usage = event['usage']
                                finishing = finishing or any(c.get('finish_reason') is not None for c in event.get('choices', []) if isinstance(c, dict))
                        if ident and line.startswith(b'data: [DONE]'):
                            self.gateway.research.resources.settle(ident, rates, usage)
                            ident = None
                            for pending in terminal:
                                self.wfile.write(pending)
                            terminal.clear()
                        if finishing and ident:
                            terminal.append(line)
                            terminal_size += len(line)
                            if terminal_size > 4 * 1024 * 1024:
                                raise ValueError('模型响应超出范围')
                            continue
                        self.wfile.write(line)
                        self.wfile.flush()
                    if ident:
                        self.gateway.research.resources.settle(ident, rates, usage)
                        ident = None
                    for pending in terminal:
                        self.wfile.write(pending)
                    self.wfile.flush()
                else:
                    raw = response.read(16 * 1024 * 1024 + 1)
                    if len(raw) > 16 * 1024 * 1024:
                        raise ValueError('模型响应超出范围')
                    usage = json.loads(raw).get('usage')
                    self.gateway.research.resources.settle(ident, rates, usage)
                    ident = None
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(raw)))
                    self.end_headers()
                    sent = True
                    self.wfile.write(raw)
        except Exception as error:
            if route is not None and isinstance(error, AppError):
                route['error'] = error
                if route.get('harness'):
                    route['harness']._methodatlas_budget_error = error
            if not sent:
                status = 402 if isinstance(error, AppError) and error.code == 'quota' else (getattr(error, 'status', None) or (403 if isinstance(error, PermissionError) else 502))
                # Upstream diagnostics and credentials never cross this local boundary.
                raw = json.dumps({'error': {'message': 'Model request unavailable', 'type': 'request_error'}}).encode()
                try:
                    self.send_response(status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        finally:
            try:
                if ident:
                    self.gateway.research.resources.settle(ident, rates, usage, rejected=rejected)
            finally:
                if admitted:
                    self.gateway.capacity.release()
