"""Run: python -m backend.check_fulltext (no network)."""
from unittest.mock import patch
import json
import tempfile
from pathlib import Path
from . import literature
from .check_sources import sample_pdf
from .state import Store


def check():
    alternate = {'source': 'arxiv', 'external_id': '2303.04137v1',
                 'pdf_url': 'https://arxiv.org/pdf/2303.04137v1'}
    metadata = {'pdf_url': 'https://example.com/blocked.pdf', 'discovery_sources': [alternate]}
    with patch.object(literature, '_download_pdf', side_effect=[TimeoutError(), b'%PDF-content']) as download:
        raw, source = literature._download_fulltext(metadata)
        assert raw == b'%PDF-content' and source == alternate
        assert download.call_count == 2
    with patch.object(literature, '_download_pdf', return_value=b'%PDF-content'):
        assert literature._download_fulltext({'discovery_sources': [alternate]})[1] == alternate
    indexed = {'results': [{'id': 'oa:1', 'title': 'Matched title', 'authorships': [{'author': {'display_name': 'A Author'}}],
                'locations': [{'pdf_url': alternate['pdf_url'], 'version': 'submittedVersion'}]}]}
    with patch.object(literature, '_read_url', return_value=(json.dumps(indexed).encode(), 'application/json', 'https://api.openalex.org/works')), patch.object(literature, '_download_pdf', return_value=b'%PDF-content'):
        _, source = literature._download_fulltext({'title': 'Matched title', 'authors': ['A Author'], 'doi': '10.1234/example'})
        assert source['external_id'] == 'oa:1' and source['source_version'] == 'submittedVersion'
    assert literature._https_url('http://example.com:80/p.pdf') == 'https://example.com/p.pdf'
    with patch.object(literature, '_read_url', return_value=(sample_pdf('Real pages'), 'application/pdf', 'https://example.com/a.pdf')):
        assert literature._download_pdf('https://example.com/a.pdf').startswith(b'%PDF')
    with patch.object(literature, '_read_url', return_value=(b'%PDF-broken', 'application/pdf', 'https://example.com/a.pdf')):
        try:
            literature._download_pdf('https://example.com/a.pdf')
            raise AssertionError('Broken PDF accepted')
        except Exception as exc:
            assert not isinstance(exc, AssertionError)
    for url in ('http://127.0.0.1/a', 'http://user:pass@example.com/a'):
        try:
            literature._validate_public_url(literature._https_url(url))
            raise AssertionError('Unsafe destination accepted')
        except ValueError:
            pass
    with tempfile.TemporaryDirectory() as directory:
        store = Store(Path(directory)/'test.sqlite3')
        project = store.create_project('Version check')
        paper_id = store.import_pdf_bytes(project, sample_pdf('Downloaded'), 'Paper', metadata={'fulltext_source': alternate})
        first = store.paper(project, paper_id)['version_id']
        store.import_pdf_bytes(project, sample_pdf('User supplement'), 'Paper', metadata={'filename': 'upload.pdf'}, target_paper_id=paper_id)
        paper = store.paper(project, paper_id)
        bindings = json.loads(paper['metadata'])['discovery_accepted']
        assert bindings[first] == alternate and paper['version_id'] not in bindings
        store.close()
    print('fulltext alternate / missing preferred / source version / HTTPS safety PASS')


if __name__ == '__main__':
    check()
