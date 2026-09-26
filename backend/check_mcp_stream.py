"""Run: python -m backend.check_mcp_stream; verifies long-call SSE keepalive."""
import json
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer
from .agent import MCPHandler


def check():
    release = threading.Event()
    class Tools:
        references = None
        def call(self, name, arguments):
            assert release.wait(25)
            return {'ok': True}
    server = ThreadingHTTPServer(('127.0.0.1', 0), type('Handler', (MCPHandler,), {'tools': Tools(), 'token': 'check'}))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        request = urllib.request.Request(f'http://127.0.0.1:{server.server_port}/mcp',
            data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'test'}}).encode(),
            headers={'Authorization': 'Bearer check', 'Accept': 'application/json, text/event-stream'})
        start = time.monotonic()
        with urllib.request.urlopen(request, timeout=20) as response:
            assert response.headers.get_content_type() == 'text/event-stream'
            assert response.readline() == b': waiting\n' and time.monotonic()-start < 2
            response.readline()
            assert response.readline() == b': waiting\n'
            release.set()
            payload = response.read().decode()
            assert 'event: message' in payload and '"id":1' in payload and '"result"' in payload
        print('MCP immediate headers / periodic heartbeat / final response PASS')
    finally:
        release.set()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    check()
