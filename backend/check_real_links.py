"""Optional network smoke test for the three Issue #27 paper-link forms."""
from __future__ import annotations

import json
import tempfile
import ipaddress
import socket
import urllib.parse
from pathlib import Path

from unittest.mock import patch

from . import literature
from .literature import import_links
from .state import Store


SAMPLES = [
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    "https://arxiv.org/abs/1706.03762",
    "https://doi.org/10.1371/journal.pone.0128066",
]


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        store = Store(Path(directory) / "methodatlas.sqlite3")
        try:
            project_id = store.create_project("Real link smoke test")
            real_validate = literature._validate_public_url
            def proxy_public_dns(url):
                host = urllib.parse.urlparse(url).hostname
                if not host:
                    raise ValueError("invalid URL")
                addresses = [ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
                if all(address.is_global or address in ipaddress.ip_network("198.18.0.0/15") for address in addresses):
                    return
                real_validate(url)
            with patch("backend.literature._validate_public_url", side_effect=proxy_public_dns):
                result = import_links(store, project_id, {"links":SAMPLES})
            for item in result["items"]:
                print(item["result"].upper(), item["input"], item.get("imported_as") or item.get("error"))
            assert result["failed"] == 0, result
            assert all(item.get("paper_id") for item in result["items"])
            assert all(item.get("imported_as") == "pdf" for item in result["items"])
            for item in result["items"]:
                paper = store.paper(project_id, item["paper_id"])
                pages = json.loads(paper["pages"])
                assert paper["source_path"] and any(page["text"].strip() for page in pages)
            print("PASS: real PDF URL, arXiv page, and DOI were resolved without simulated results")
        finally:
            store.close()


if __name__ == "__main__":
    main()
