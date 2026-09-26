"""Actual Harness image transport with a controlled HTTP endpoint; no quality claim."""
import base64
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pymupdf

from .check_vision import run_image


def main():
    requests = []

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            raw = self.rfile.read(int(self.headers['Content-Length']))
            if self.path.endswith('/files'):
                self.send_error(404)  # Exercise the SDK's native inline-image fallback.
                return
            requests.append(json.loads(raw))
            chunks = [{'id': 'vision-check', 'model': 'deepseek-flash', 'choices': [
                {'index': 0, 'delta': {'role': 'assistant', 'content': 'controlled image reply'}, 'finish_reason': None}]},
                {'id': 'vision-check', 'model': 'deepseek-flash', 'choices': [
                    {'index': 0, 'delta': {}, 'finish_reason': 'stop'}],
                 'usage': {'prompt_tokens': 10, 'completion_tokens': 3, 'total_tokens': 13}}]
            raw = (''.join('data: ' + json.dumps(c) + '\n\n' for c in chunks) + 'data: [DONE]\n\n').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

    with pymupdf.open() as doc:
        page = doc.new_page(width=64, height=64)
        page.draw_rect(page.rect, fill=(1, 0, 0), color=(1, 0, 0))
        image = page.get_pixmap().tobytes('png')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as root:
            result = run_image(image, 'Inspect the image.', Path(root), 'check-only', f'http://127.0.0.1:{server.server_port}')
        assert result['status'] == 'completed', result
        assert result['answer'] == 'controlled image reply'
        assert result['calls_with_usage'] == 1 and result['usage'][0]['inputTokens'] == 10
        assert len(requests) == 1 and not requests[0].get('tools'), requests
        blocks = [b for m in requests[0]['messages'] if isinstance(m['content'], list) for b in m['content']]
        urls = [b['image_url']['url'] for b in blocks if b['type'] == 'image_url']
        assert len(urls) == 1 and urls[0].startswith('data:image/')
        pixels = pymupdf.Pixmap(base64.b64decode(urls[0].split(',', 1)[1]))
        assert (pixels.width, pixels.height) == (64, 64)
        red, green, blue = pixels.pixel(32, 32)[:3]
        assert red > 240 and green < 15 and blue < 15, 'Actual image content did not reach provider'
        print('PASS actual Harness image admission, HTTP image pixels, Files fallback, tool isolation and usage')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    main()
