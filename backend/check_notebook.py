"""Small contract check; no paid model or live application state."""
import hashlib
import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from .notebook import OpenNotebook, matched_blocks, research_system, source_text


def main():
    pages = [{'page': 1, 'blocks': [{'block': 0, 'text': 'Sparse point clouds'},
                                   {'block': 1, 'text': 'condition a diffusion policy.'}]}]
    assert matched_blocks(pages, ['point clouds\ncondition a diffusion']) == {(1, 0): 1, (1, 1): 1}
    assert not matched_blocks(pages, ['invented quotation'])
    nul = [{'page': 1, 'blocks': [{'block': 0, 'text': 'point\x00 clouds'}]}]
    assert source_text(nul) == 'point clouds'
    assert matched_blocks(nul, ['point clouds']) == {(1, 0): 1}
    assert not matched_blocks([{'page': 1, 'blocks': [{'block': 0, 'text': 'same same'}]}], ['same'])
    with tempfile.TemporaryDirectory() as folder:
        manifest = Path(folder) / 'index.json'
        raw = 'Sparse point clouds\n\ncondition a diffusion policy.'
        manifest.write_text(json.dumps({'base': 'http://127.0.0.1:8802', 'versions': {'v1': {
            'sha256': 'original', 'text_sha256': hashlib.sha256(raw.encode()).hexdigest(),
            'notebook_id': 'notebook:one', 'source_id': 'source:one'}}}), encoding='utf-8')
        client = OpenNotebook(manifest)
        def reply(request, timeout):
            body = json.loads(request.data)
            assert body['notebook_id'] == 'notebook:one' and body['type'] == 'vector'
            assert body['limit'] == 20 and not body['search_notes']
            return io.BytesIO(json.dumps({'results': [{'id': 'source:one', 'parent_id': 'source:one',
                'matches': ['point clouds condition a diffusion']}]}).encode())
        with patch('backend.notebook.urlopen', reply):
            assert client.search('v1', {'sha256': 'original'}, pages, '三维输入如何产生动作') == {(1, 0): 1, (1, 1): 1}
            for version, sha in [('v2', 'original'), ('v1', 'changed')]:
                try:
                    client.search(version, {'sha256': sha}, pages, 'query')
                    raise AssertionError('version mismatch accepted')
                except ValueError:
                    pass
        with patch('backend.notebook.urlopen', return_value=io.BytesIO(json.dumps({'results': [
                {'id': 'source:other', 'parent_id': 'source:other', 'matches': ['point clouds']}]}).encode())):
            try:
                client.search('v1', {'sha256': 'original'}, pages, 'query')
                raise AssertionError('foreign source accepted')
            except ValueError:
                pass
    assert 'research_paper' not in research_system('old research_paper line\nkeep this')
    print('PASS: native vector request scope, immutable source mapping, cross-block citations and rejected foreign results')


if __name__ == '__main__':
    from email.parser import BytesParser
    from email.policy import default
    from .index_notebook import text_upload
    original = '中文 <task> <img>\n\n原文\n'
    body, content_type = text_upload(original, '研究标题', 'notebook:one')
    message = BytesParser(policy=default).parsebytes(('Content-Type: ' + content_type + '\r\n\r\n').encode() + body)
    uploaded = next(part for part in message.iter_parts() if part.get_filename() == 'source.txt')
    assert uploaded.get_content_type() == 'text/plain'
    assert uploaded.get_payload(decode=True).decode('utf-8') == original
    main()
