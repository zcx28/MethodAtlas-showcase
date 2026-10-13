"""Deterministic regressions through the real link resolver and import pipeline."""
import json
import http.client
import io
import tempfile
import unittest
import urllib.error
import urllib.parse
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

import pymupdf

from . import literature
from .state import Store


DOI = '10.1371/journal.pone.0128066'
PAGE = 'https://publisher.example/article/one'
HTML = f'''<html><head>
<meta name="citation_title" content="Linked research paper">
<meta name="citation_author" content="Research Author">
<meta name="citation_doi" content="{DOI}">
<meta name="citation_abstract" content="The real article abstract.">
<meta name="citation_pdf_url" content="/files/paper.pdf">
</head><body><a href="/">Publisher home</a></body></html>'''.encode()


class LinkImportChecks(unittest.TestCase):
    def test_complete_pdf_with_closed_http_connection_imports(self):
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((60, 80), 'Complete public paper for link import.')
            raw = pdf.tobytes()

        class Publisher(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_):
                pass

            def do_GET(self):
                feed = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2403.03954</id><title>Public research paper</title><summary>Original abstract</summary><link title="pdf" href="https://arxiv.org/pdf/2403.03954"/></entry></feed>'
                body = feed if self.path.startswith('/api/query') else raw
                self.send_response(200)
                self.send_header('Content-Type', 'application/atom+xml' if body == feed else 'application/pdf')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(body)

        publisher = ThreadingHTTPServer(('127.0.0.1', 0), Publisher)
        worker = threading.Thread(target=publisher.serve_forever, daemon=True)
        worker.start()
        original_dns = literature.socket.getaddrinfo

        def resolve(hostname, *args, **kwargs):
            if hostname in {'publisher.example', 'export.arxiv.org', 'arxiv.org'}:
                return [(2, 1, 6, '', ('93.184.216.34', 80))]
            return original_dns(hostname, *args, **kwargs)

        def connect(request, *_):
            connection = http.client.HTTPConnection('127.0.0.1', publisher.server_port, timeout=2)
            connection.connect()
            connection._source_socket = connection.sock
            request.connections.add(connection)
            return connection

        try:
            with tempfile.TemporaryDirectory() as directory, \
                    patch.object(literature.urllib.request, 'getproxies', return_value={}), \
                    patch.object(literature.socket, 'getaddrinfo', side_effect=resolve), \
                    patch.object(literature._SourceRequest, 'connect', connect):
                store = Store(Path(directory) / 'state.sqlite3')
                try:
                    project = store.create_project('Public link import')
                    result = literature.import_links(store, project, {'links': ['http://publisher.example/paper.pdf']})
                    self.assertEqual(result['succeeded'], 1, result)
                    self.assertEqual(json.loads(store.papers(project)[0]['availability'])['fulltext'], 'downloaded')
                    project = store.create_project('arXiv link import')
                    result = literature.import_links(store, project, {'links': ['https://arxiv.org/abs/2403.03954']})
                    self.assertEqual(result['items'][0].get('imported_as'), 'pdf', result)
                    retry_project = store.create_project('Previously failed link')
                    metadata = literature._arxiv_metadata('2403.03954')
                    paper = literature._import_abstract(store, retry_project, metadata['title'], metadata['summary'], metadata,
                                                       {'fulltext': 'failed', 'parse': 'abstract', 'error': 'Old connection error'})
                    old_version = store.papers(retry_project)[0]['current_version_id']
                    retried = literature.retry_literature(store, retry_project, paper)
                    self.assertEqual(retried['paper_id'], paper)
                    self.assertNotEqual(retried['version_id'], old_version)
                    self.assertEqual(len(store.papers(retry_project)), 1)
                    self.assertEqual(json.loads(store.papers(retry_project)[0]['availability'])['fulltext'], 'downloaded')
                    self.assertIsNotNone(store.one('SELECT id FROM paper_versions WHERE id=?', (old_version,)))
                finally:
                    store.close()
        finally:
            publisher.shutdown()
            publisher.server_close()
            worker.join()

    def connection(self, wire):
        sock = Mock()
        sock.makefile.return_value = io.BytesIO(wire)
        response = http.client.HTTPResponse(sock)
        response.begin()
        connection = Mock(sock=sock, _source_socket=sock, _source_response=response)
        connection.getresponse.return_value = response
        return connection

    def test_transport_pins_dns_and_keeps_original_host(self):
        connection = self.connection(b'HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nabc')
        with patch.object(literature.urllib.request, 'getproxies', return_value={}), \
                patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]) as dns, \
                patch.object(literature._SourceRequest, 'connect', return_value=connection) as connect:
            self.assertEqual(literature._read_url('https://paper.example/a?b=1')[0], b'abc')
        dns.assert_called_once()
        connect.assert_called_once_with('paper.example', 443, '93.184.216.34', 'https')
        self.assertEqual(connection.request.call_args.args, ('GET', '/a?b=1'))
        self.assertEqual(connection.request.call_args.kwargs['headers']['Host'], 'paper.example')

    def test_transport_rechecks_redirect_destination(self):
        connection = self.connection(b'HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: https://127.0.0.1/private\r\n\r\n')
        with patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]), \
                patch.object(literature._SourceRequest, 'connect', return_value=connection) as connect:
            with self.assertRaisesRegex(ValueError, '内网'):
                literature._read_url('https://paper.example/redirect')
        self.assertEqual(connect.call_count, 1, 'private redirect must be rejected before opening a socket')

    def test_incomplete_http_retries_only_once_with_pinned_dns(self):
        for wire in (b'HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nabc',
                b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nab'):
            with self.subTest(wire=wire), \
                    patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]) as dns, \
                    patch.object(literature._SourceRequest, 'connect', side_effect=[self.connection(wire), self.connection(wire)]) as connect:
                with self.assertRaises(literature._IncompleteSource):
                    literature._read_url('https://paper.example/partial')
                self.assertEqual(connect.call_count, 2)
                dns.assert_called_once()

    def test_transport_rejects_oversized_body_and_private_ip_forms(self):
        connection = self.connection(b'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nabc')
        with patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('93.184.216.34', 443))]), \
                patch.object(literature._SourceRequest, 'connect', return_value=connection):
            with self.assertRaisesRegex(ValueError, '大小限制'):
                literature._read_url('https://paper.example/large', limit=8)
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', 'fe80::1%en0', '224.0.0.1'):
            self.assertFalse(literature._public_ip(address), address)

    def test_fake_dns_requires_verified_public_addresses(self):
        request = literature._SourceRequest(1)
        try:
            with patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('198.18.0.10', 443))]), \
                    patch.object(request, 'doh_addresses', return_value=['93.184.216.34']) as doh:
                self.assertEqual(request.public_addresses(literature._public_url_parts('https://paper.example')), ['93.184.216.34'])
                self.assertEqual(request.public_addresses(literature._public_url_parts('https://paper.example')), ['93.184.216.34'])
                doh.assert_called_once_with('paper.example')
            with patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('10.0.0.1', 443))]), \
                    patch.object(request, 'doh_addresses') as doh:
                with self.assertRaisesRegex(ValueError, '内网'):
                    request.public_addresses(literature._public_url_parts('https://private.example'))
                doh.assert_not_called()
        finally:
            request.close()

    def test_direct_tls_uses_validated_ip_and_original_hostname(self):
        request = literature._SourceRequest(1)
        request.proxies = {}
        try:
            with patch.object(literature.socket, 'socket') as sockets, patch.object(literature.ssl, 'create_default_context') as tls:
                request.connect('paper.example', 443, '93.184.216.34', 'https')
                sockets.return_value.connect.assert_called_once_with(('93.184.216.34', 443))
                self.assertEqual(tls.return_value.wrap_socket.call_args.kwargs['server_hostname'], 'paper.example')
                with self.assertRaisesRegex(ValueError, '内网'):
                    request.connect('paper.example', 443, '127.0.0.1', 'https')
                self.assertEqual(sockets.call_count, 1)
        finally:
            request.close()

    def test_doi_forms_share_identity(self):
        forms = [DOI, 'doi: ' + DOI, 'DOI:' + DOI,
                 'https://doi.org/' + DOI + '?utm_source=test#abstract',
                 'https://dx.doi.org/' + urllib.parse.quote(DOI, safe='')]
        for value in forms:
            with self.subTest(value=value), patch.object(literature, '_doi_metadata', return_value={}) as resolve:
                literature._link_metadata(value)
                resolve.assert_called_once_with(DOI)

    def test_arxiv_keeps_explicit_version(self):
        for value in ['1706.03762v1', 'https://arxiv.org/abs/1706.03762v1?context=cs',
                      'https://arxiv.org/pdf/1706.03762v1.pdf']:
            with self.subTest(value=value), patch.object(literature, '_arxiv_metadata', return_value={}) as resolve:
                literature._link_metadata(value)
                resolve.assert_called_once_with('1706.03762v1')

    def test_arxiv_web_page_recovers_from_api_failure(self):
        with patch.object(literature, '_arxiv_feed', side_effect=urllib.error.HTTPError('https://export.arxiv.org', 406, 'Unavailable', {}, None)), patch.object(literature, '_read_url', return_value=(HTML, 'text/html', 'https://arxiv.org/abs/1706.03762v1')):
            metadata = literature._arxiv_metadata('1706.03762v1')
        self.assertEqual(metadata['external_id'], '1706.03762v1')
        self.assertEqual(metadata['pdf_url'], 'https://arxiv.org/pdf/1706.03762v1')
        self.assertEqual(metadata['title'], 'Linked research paper')

    def test_extensionless_pdf_is_still_importable(self):
        url = 'https://publisher.example/download?id=paper'
        with patch.object(literature, '_read_url', return_value=(b'%PDF-', 'application/pdf', url)):
            metadata = literature._link_metadata(url)
        self.assertEqual(metadata['source'], 'pdf_url')
        self.assertEqual(metadata['pdf_url'], url)

    def test_doi_retains_article_page_and_abstract(self):
        csl = json.dumps({'title':'Linked research paper'}).encode()
        with patch.object(literature, '_read_url', side_effect=[(csl, 'application/json', PAGE), (HTML, 'text/html', PAGE)]):
            metadata = literature._doi_metadata(DOI)
        self.assertEqual(metadata['url'], PAGE)
        self.assertEqual(metadata['summary'], 'The real article abstract.')
        self.assertEqual(metadata['pdf_url'], 'https://publisher.example/files/paper.pdf')

    def test_doi_recovers_when_content_negotiation_is_blocked(self):
        def read(url, headers=None, **kwargs):
            if 'api.crossref.org/works/' in url:
                return json.dumps({'message':{'title':['Indexed paper'], 'author':[{'given':'A', 'family':'Researcher'}], 'URL':PAGE}}).encode(), 'application/json', url
            raise urllib.error.HTTPError(url, 403, 'Blocked', {}, None)
        with patch.object(literature, '_read_url', side_effect=read):
            metadata = literature._doi_metadata(DOI)
        self.assertEqual(metadata['title'], 'Indexed paper')
        self.assertEqual(metadata['doi'], DOI)

    def test_publisher_page_imports_pdf_and_deduplicates_doi(self):
        document = pymupdf.open()
        page = document.new_page()
        page.insert_text((50, 80), 'Public paper full text. Evidence survives import.')
        pdf = document.tobytes()
        document.close()

        def read(url, headers=None, **kwargs):
            if url == PAGE:
                return HTML, 'text/html', PAGE
            if url == 'https://publisher.example/files/paper.pdf':
                return pdf, 'application/pdf', url
            if url.startswith('https://doi.org/'):
                return HTML, 'text/html', PAGE
            raise AssertionError('Unexpected request: ' + url)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = Store(Path(directory) / 'data.sqlite3')
            try:
                project = store.create_project('Link regression')
                with patch.object(literature, '_read_url', side_effect=read):
                    result = literature.import_links(store, project, {'links':[PAGE, 'doi:' + DOI]})
                self.assertEqual(result['failed'], 0, result)
                self.assertEqual(len(store.papers(project)), 1)
                self.assertTrue(all(item['imported_as'] == 'pdf' for item in result['items']))
                paper = store.paper(project, result['items'][0]['paper_id'])
                self.assertIn('Evidence survives import', paper['pages'])
            finally:
                store.close()

    def test_publisher_without_pdf_is_explicitly_abstract_only(self):
        html = HTML.replace(b'<meta name="citation_pdf_url" content="/files/paper.pdf">', b'').replace(DOI.encode(), b'')
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            store = Store(Path(directory) / 'data.sqlite3')
            try:
                project = store.create_project('Abstract regression')
                with patch.object(literature, '_read_url', return_value=(html, 'text/html', PAGE)):
                    result = literature.import_links(store, project, {'links':[PAGE]})
                self.assertEqual(result['failed'], 0, result)
                self.assertEqual(result['items'][0]['imported_as'], 'abstract')
                paper = store.paper(project, result['items'][0]['paper_id'])
                self.assertEqual(paper['status'], 'abstract_only')
                self.assertEqual(json.loads(paper['availability'])['fulltext'], 'unavailable')
            finally:
                store.close()

    def test_unrelated_html_does_not_become_a_paper(self):
        with patch.object(literature, '_read_url', return_value=(b'<title>Store home</title>', 'text/html', PAGE)):
            with self.assertRaisesRegex(ValueError, '论文'):
                literature._link_metadata(PAGE)

    def test_private_url_stays_blocked(self):
        with patch.object(literature.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaisesRegex(ValueError, '内网'):
                literature._link_metadata('https://localhost/article')


if __name__ == '__main__':
    unittest.main()
