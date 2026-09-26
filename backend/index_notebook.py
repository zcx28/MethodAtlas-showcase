"""Copy explicitly selected immutable texts into native Open Notebook sources."""
import argparse
import hashlib
import json
import os
import sqlite3
import uuid
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from .notebook import source_text


def text_upload(content, title, notebook_id):
    # Native text/plain upload bypasses content-core's HTML detection in pasted text.
    boundary = uuid.uuid4().hex
    fields = {'type':'upload', 'title':title, 'notebooks':json.dumps([notebook_id]),
              'transformations':'[]', 'embed':'false', 'async_processing':'false'}
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'
             for key, value in fields.items()]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="source.txt"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{content}\r\n--{boundary}--\r\n')
    return ''.join(parts).encode('utf-8'), 'multipart/form-data; boundary=' + boundary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--base', default='http://127.0.0.1:8802')
    parser.add_argument('paper_ids', nargs='+')
    args = parser.parse_args()
    def api(path, data=None, content_type=None):
        headers = {'Content-Type': 'application/json'}
        if os.getenv('OPEN_NOTEBOOK_PASSWORD'):
            headers['Authorization'] = 'Bearer ' + os.environ['OPEN_NOTEBOOK_PASSWORD']
        if content_type:
            headers['Content-Type'] = content_type
        request = Request(args.base + '/api' + path, data if content_type else json.dumps(data).encode() if data is not None else None, headers)
        with urlopen(request, timeout=120) as response:
            return json.load(response)
    manifest = json.loads(args.manifest.read_text(encoding='utf-8')) if args.manifest.exists() else {'base': args.base, 'versions': {}}
    if manifest['base'] != args.base:
        raise ValueError('Manifest belongs to another Open Notebook instance')
    db = sqlite3.connect((args.data_dir.resolve() / 'methodatlas.sqlite3').as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    for pid in args.paper_ids:
        paper = db.execute('SELECT v.*,p.title FROM paper_versions v JOIN papers p ON p.current_version_id=v.id WHERE p.id=?', (pid,)).fetchone()
        if paper is None:
            raise ValueError('Unknown paper: ' + pid)
        if paper['id'] in manifest['versions']:
            print('Already mapped:', paper['title'])
            continue
        pages = json.loads(paper['pages'])
        content = source_text(pages)
        if not content:
            raise ValueError('No readable text: ' + pid)
        # Native search supports notebook scopes, not individual source scopes.
        name = 'MethodAtlas ' + paper['id']
        existing = [n for n in api('/notebooks') if n['name'] == name]
        notebook = existing[0] if existing else api('/notebooks', {'name': name, 'description': paper['title']})
        sources = api('/sources?' + urlencode({'notebook_id': notebook['id']}))
        if len(sources) > 1:
            raise ValueError('Version notebook has unexpected sources')
        source = api('/sources/' + sources[0]['id']) if sources else api('/sources', *text_upload(content, paper['title'], notebook['id']))
        if source['full_text'] != content:
            raise ValueError('Imported source text changed; citation mapping not published')
        manifest['versions'][paper['id']] = {'paper_id': pid, 'sha256': paper['sha256'],
            'text_sha256': hashlib.sha256(content.encode()).hexdigest(),
            'notebook_id': notebook['id'], 'source_id': source['id']}
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        temp = args.manifest.with_suffix('.tmp')
        temp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        temp.replace(args.manifest)
        print('Mapped (embedding still required):', paper['title'])
    db.close()


if __name__ == '__main__':
    main()
