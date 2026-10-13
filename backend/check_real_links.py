"""Optional network smoke test through the production URL guard and import path."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from .literature import import_links
from .state import Store


SAMPLES = [
    "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    "https://arxiv.org/abs/1706.03762v1?context=cs",
    "doi:10.1371/journal.pone.0128066",
    "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0128066",
]


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        store = Store(Path(directory) / "methodatlas.sqlite3")
        try:
            project_id = store.create_project("Real link smoke test")
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
            print("PASS: real PDF URL, versioned arXiv, DOI and publisher page; production URL checks remained active")
        finally:
            store.close()


if __name__ == "__main__":
    main()
