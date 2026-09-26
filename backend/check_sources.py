"""Reproducible regression checks for source import, conversion, and persistence."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import pymupdf

from . import literature
from .agent import ProjectTools, quote_is_broad
from .app import Handler, Service
from .literature import MAX_PDF_BYTES, import_pdf_files
from .state import json_text, new_id, now


def sample_pdf(title: str, second_column=True) -> bytes:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((48, 55), title, fontsize=20)
    page.insert_textbox((48, 90, 270, 260), "1. Left column\nA responsive paragraph with evidence.\n- first item", fontsize=11)
    if second_column:
        page.insert_textbox((320, 90, 550, 260), "2. Right column\nThe second column follows the first.\nFormula: x + y = z", fontsize=11)
    for y in (300, 330, 360, 390):
        page.draw_line((48, y), (550, y))
    for x in (48, 215, 382, 550):
        page.draw_line((x, 300), (x, 390))
    for x, value in zip((58,225,392),("Method","Input","Result")):
        page.insert_text((x, 322), value)
    for x, value in zip((58,225,392),("Atlas","PDF","Pass")):
        page.insert_text((x, 352), value)
    for x, value in zip((58,225,392),("Reader","Text","Pass")):
        page.insert_text((x, 382), value)
    page.insert_text((48, 430), "sin(x) = y")
    figure = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 120, 55), False)
    figure.clear_with(0x336699)
    page.insert_image((48, 455, 168, 510), pixmap=figure)
    page.insert_text((48, 528), "Figure 1. Embedded source image")
    raw = document.tobytes()
    document.close()
    return raw


def scanned_pdf() -> bytes:
    source = pymupdf.open()
    page = source.new_page()
    page.insert_text((70, 100), "Scanned page text", fontsize=24)
    image = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).tobytes("png")
    source.close()
    document = pymupdf.open()
    page = document.new_page()
    page.insert_image(page.rect, stream=image)
    raw = document.tobytes()
    document.close()
    return raw


def rotated_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=300, height=500)
    page.insert_text((45, 80), "Rotated source fragment", fontsize=16)
    page.set_rotation(90)
    raw = document.tobytes()
    document.close()
    return raw


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        root = Path(directory)
        (root / "papers").mkdir()
        service = Service(root / "papers", root / "data")
        handler = type("SourceCheckHandler", (Handler,), {"service": service})
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"

        def request(path, body=None):
            data = json.dumps(body).encode() if body is not None else None
            req = urllib.request.Request(base + path, data=data, headers={"Content-Type":"application/json", "Origin":base})
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)

        def multipart(path, files, fields=None):
            boundary = "methodatlas-" + uuid.uuid4().hex
            chunks = []
            for name, value in (fields or {}).items():
                chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()])
            for filename, raw in files:
                chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{filename}\"\r\nContent-Type: application/pdf\r\n\r\n".encode(), raw, b"\r\n"])
            chunks.append(f"--{boundary}--\r\n".encode())
            req = urllib.request.Request(base + path, data=b"".join(chunks), headers={"Content-Type":f"multipart/form-data; boundary={boundary}", "Origin":base})
            with urllib.request.urlopen(req, timeout=120) as response:
                assert response.status == 207
                return json.load(response)

        try:
            with patch("backend.literature.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("198.18.0.10", 443))]):
                with patch.dict(os.environ, {}, clear=True):
                    try:
                        literature._validate_public_url("https://example.com/paper")
                    except ValueError as exc:
                        assert "内网" in str(exc)
                    else:
                        raise AssertionError("managed proxy address must be rejected by default")
                with patch.dict(os.environ, {"METHODATLAS_ALLOW_MANAGED_PROXY":"1"}, clear=True):
                    literature._validate_public_url("https://example.com/paper")
                    try:
                        literature._validate_public_url("http://example.com/paper")
                    except ValueError as exc:
                        assert "内网" in str(exc)
                    else:
                        raise AssertionError("managed proxy compatibility must require HTTPS")

            project = request("/api/state")["projects"][0]
            project_id = project["id"]
            other_id = request("/api/projects", {"name":"Other project"})["project_id"]
            text_path = f"/api/projects/{project_id}/sources/text"
            first_text = request(text_path, {"title":"Pasted outline", "text":"# Heading\n\nParagraph kept exactly.\n\n- list item"})
            second_text = request(text_path, {"title":"Duplicate title", "text":"# Heading\n\nParagraph kept exactly.\n\n- list item"})
            assert first_text["paper_id"] == second_text["paper_id"]
            text = request(f"/api/projects/{project_id}/papers/{first_text['paper_id']}")
            assert [item["kind"] for item in text["pages"][0]["layout"]] == ["heading","paragraph","list_item"]
            conversation_id = service.store.conversations(project_id)[0]["id"]
            task_id = new_id("task")
            snapshot = [{"id":first_text["paper_id"],"title":text["title"],"version_id":text["version_id"],"pages":1,"status":"available","focus":True}]
            service.store.run("INSERT INTO tasks(id,project_id,conversation_id,message_id,prompt,selected_paper_ids,generate,status,created,updated,snapshot,refs) VALUES(?,?,?,?,?,?,0,'running',?,?,?,?)", (task_id,project_id,conversation_id,new_id("message"),"Read pasted text",json_text([first_text["paper_id"]]),now(),now(),json_text(snapshot),json_text({})))
            agent_tools = ProjectTools(service.store, service.store.task(task_id))
            agent_tools.call("set_scope", {"only_selected":True})
            agent_read = agent_tools.call("read_material", {"paper_id":first_text["paper_id"],"version_id":text["version_id"],"query":"Paragraph kept exactly"})
            assert agent_read["evidence"] and agent_read["evidence"][0]["paper_version_id"] == text["version_id"]
            assert agent_read["evidence"][0]["quote"] == "# Heading\n\nParagraph kept exactly.\n\n- list item"
            precise = agent_tools.call("select_quote", {"citation_id":agent_read["evidence"][0]["id"], "quote":"Paragraph kept exactly."})["evidence"][0]
            assert precise["quote"] == "Paragraph kept exactly."
            assert text["pages"][0]["text"][precise["start"]:precise["end"]] == precise["quote"]
            assert precise["source_citation_id"] == agent_read["evidence"][0]["id"]
            assert not quote_is_broad("Sentence one. Sentence two.")
            assert quote_is_broad("Sentence one. Sentence two. Sentence three.")
            assert quote_is_broad("x" * 421)
            try:
                agent_tools.call("write_file", {"title":"过宽引用", "kind":"html", "content":"<p>结论</p>",
                                                 "citation_ids":[agent_read["evidence"][0]["id"]], "output_key":"broad-citation"})
            except ValueError as exc:
                assert "引用范围过大" in str(exc)
            else:
                raise AssertionError("broad evidence must be refined before saving")
            precise_file = agent_tools.call("write_file", {"title":"精确引用", "kind":"html",
                "content":f'<p>结论 <button data-citation="{precise["id"]}">原文</button></p>',
                "citation_ids":[precise["id"]], "output_key":"precise-citation"})
            assert service.file_version(project_id, precise_file["artifact_id"], precise_file["version_id"])["citations"][0]["quote"] == precise["quote"]

            native, scan, rotated = sample_pdf("Layout paper"), scanned_pdf(), rotated_pdf()
            with patch("pymupdf.Page.get_textpage_ocr", side_effect=RuntimeError("OCR unavailable for fallback check")):
                upload = multipart(f"/api/projects/{project_id}/sources/files", [("layout.pdf",native),("scan.pdf",scan),("rotated.pdf",rotated),("invalid.pdf",b"not a pdf"),("parse-failure.pdf",b"%PDF-1.7\nmalformed")])
            assert upload["succeeded"] == 3 and upload["failed"] == 2
            assert {item["input"] for item in upload["items"] if item["result"] == "failed"} == {"invalid.pdf","parse-failure.pdf"}
            successful_ids = [item["paper_id"] for item in upload["items"] if item["result"] == "ok"]
            state = request(f"/api/projects/{project_id}")
            count = len(state["papers"])
            duplicate = multipart(f"/api/projects/{project_id}/sources/files", [("layout-again.pdf",native),("scan-again.pdf",scan)])
            assert all(item["duplicate"] for item in duplicate["items"])
            assert len(request(f"/api/projects/{project_id}")["papers"]) == count
            assert not request(f"/api/projects/{other_id}")["papers"]
            with patch("backend.pdf.pymupdf4llm", None):
                fallback = multipart(f"/api/projects/{other_id}/sources/files", [("native.pdf", native)])
            fallback_paper = request(f"/api/projects/{other_id}/papers/{fallback['items'][0]['paper_id']}")
            for page in fallback_paper['pages']:
                for block in page['blocks']:
                    assert page['text'][block['start']:block['end']] == block['text']

            layout_paper = request(f"/api/projects/{project_id}/papers/{successful_ids[0]}")
            layout_kinds = [item["kind"] for item in layout_paper["pages"][0]["layout"]]
            assert {"table","formula","image"} <= set(layout_kinds)
            assert layout_paper["pages"][0]["text"].index("Left column") < layout_paper["pages"][0]["text"].index("Right column")
            assert layout_paper["availability"]["conversion"]["layout_engine"] == "pymupdf4llm"
            for page in layout_paper['pages']:
                for block in page['blocks']:
                    assert page['text'][block['start']:block['end']] == block['text'], 'Citation offsets must include inter-block newlines'
            pdf_task_id = new_id("task")
            pdf_snapshot = [{"id":layout_paper["id"],"title":layout_paper["title"],"version_id":layout_paper["version_id"],"pages":layout_paper["page_count"],"status":"available","focus":True}]
            service.store.run("INSERT INTO tasks(id,project_id,conversation_id,message_id,prompt,selected_paper_ids,generate,status,created,updated,snapshot,refs) VALUES(?,?,?,?,?,?,0,'running',?,?,?,?)", (pdf_task_id,project_id,conversation_id,new_id("message"),"Read precise PDF sentence",json_text([layout_paper["id"]]),now(),now(),json_text(pdf_snapshot),json_text({})))
            pdf_tools = ProjectTools(service.store, service.store.task(pdf_task_id))
            pdf_tools.call("set_scope", {"only_selected":True})
            pdf_read = pdf_tools.call("read_material", {"paper_id":layout_paper["id"],"version_id":layout_paper["version_id"],"query":"responsive paragraph"})
            pdf_source = next(item for item in pdf_read["evidence"] if "responsive paragraph" in item["quote"])
            pdf_precise = pdf_tools.call("select_quote", {"citation_id":pdf_source["id"],"quote":"A responsive paragraph with evidence."})["evidence"][0]
            assert pdf_precise["quote"] == "A responsive paragraph with evidence."
            assert pdf_precise["rects"] and all(len(rect) == 4 for rect in pdf_precise["rects"])
            assert pdf_source["rect"][0] - 5 <= pdf_precise["rect"][0] <= pdf_precise["rect"][2] <= pdf_source["rect"][2] + 5
            assert pdf_source["rect"][1] - 5 <= pdf_precise["rect"][1] <= pdf_precise["rect"][3] <= pdf_source["rect"][3] + 5
            scan_paper = request(f"/api/projects/{project_id}/papers/{successful_ids[1]}")
            assert scan_paper["pages"][0]["layout"][0]["kind"] == "page_image"
            assert scan_paper["status"] == "needs_ocr" and scan_paper["availability"]["conversion"]["fallback_pages"] == [1]
            recovered = json.loads(json.dumps(scan_paper))
            recovered["pages"][0].update(text="Recovered scan text", blocks=[{"block":0,"start":0,"end":19,"text":"Recovered scan text","rect":None}], layout=[{"kind":"paragraph","text":"Recovered scan text"}], conversion={"source":"ocr","reliable":True,"warning":None})
            recovered["conversion"] = {"status":"parsed","readable_pages":1,"fallback_pages":[],"ocr_pages":[1]}
            with patch("backend.state.read_pdf_bytes", return_value=recovered):
                retried = multipart(f"/api/projects/{project_id}/sources/files", [("scan.pdf",scan)], {"target_paper_id":scan_paper["id"]})
                repeated = multipart(f"/api/projects/{project_id}/sources/files", [("scan.pdf",scan)], {"target_paper_id":scan_paper["id"]})
            assert retried["succeeded"] == 1 and retried["items"][0]["version_id"] != scan_paper["version_id"]
            assert repeated["items"][0]["version_id"] == retried["items"][0]["version_id"]
            assert request(f"/api/projects/{project_id}/papers/{scan_paper['id']}")["pages"][0]["text"] == "Recovered scan text"
            assert request(f"/api/projects/{project_id}/papers/{scan_paper['id']}?version_id={scan_paper['version_id']}")["pages"] == scan_paper["pages"]
            with urllib.request.urlopen(base + f"/api/projects/{project_id}/papers/{successful_ids[0]}/page?version_id={layout_paper['version_id']}&page=1") as response:
                assert response.read(8) == b"\x89PNG\r\n\x1a\n"
            rect = next(item["rect"] for item in layout_paper["pages"][0]["layout"] if item.get("rect"))
            query = "&".join(f"{name}={value}" for name,value in zip(("x0","y0","x1","y1"),rect))
            with urllib.request.urlopen(base + f"/api/projects/{project_id}/papers/{successful_ids[0]}/fragment?version_id={layout_paper['version_id']}&page=1&{query}") as response:
                assert response.read(8) == b"\x89PNG\r\n\x1a\n"
            rotated_paper = request(f"/api/projects/{project_id}/papers/{successful_ids[2]}")
            rotated_rect = rotated_paper["pages"][0]["blocks"][0]["rect"]
            rotated_query = urllib.parse.urlencode(dict(zip(("x0","y0","x1","y1"),rotated_rect)))
            with urllib.request.urlopen(base + f"/api/projects/{project_id}/papers/{successful_ids[2]}/fragment?version_id={rotated_paper['version_id']}&page=1&{rotated_query}") as response:
                fragment = pymupdf.Pixmap(response.read())
                assert fragment.height > fragment.width and min(fragment.samples) < 200, "Rotated fragment must contain the original text"

            resolver_html = b"""<html><body><div>\xe9\xa2\x98\xe5\x90\x8d\xef\xbc\x9a\xe4\xb8\xad\xe6\x96\x87\xe8\xae\xba\xe6\x96\x87\xe6\xa0\x87\xe9\xa2\x98</div><div>\xe4\xbd\x9c\xe8\x80\x85\xef\xbc\x9a\xe5\xbc\xa0\xe4\xb8\x89;\xe6\x9d\x8e\xe5\x9b\x9b;</div><div>\xe6\x9d\xa5\xe6\xba\x90\xef\xbc\x9a</div><a href=\"https://link.cnki.net/doi/10.19818/example\">CNKI</a></body></html>"""
            with patch("backend.literature._read_url", return_value=(resolver_html,"text/html","https://www.chndoi.org/Resolution/Handler?doi=10.19818/example")):
                resolver_metadata = literature._doi_metadata("10.19818/example")
            assert resolver_metadata["title"] == "\u4e2d\u6587\u8bba\u6587\u6807\u9898" and resolver_metadata["authors"] == ["\u5f20\u4e09","\u674e\u56db"]
            assert resolver_metadata["url"] == "https://link.cnki.net/doi/10.19818/example" and resolver_metadata["pdf_url"] is None
            missing_doi = urllib.error.HTTPError("https://doi.org/10.invalid/example", 404, "not found", {}, None)
            with patch("backend.literature._read_url", side_effect=missing_doi):
                try:
                    literature._doi_metadata("10.invalid/example")
                except ValueError as exc:
                    assert "不存在或拼写错误" in str(exc)
                else:
                    raise AssertionError("an unresolved DOI must not become a metadata-only paper")
            issue_responses = [
                (b"{}","application/json","https://doi.org/10.1234/issue"),
                (b"<html><body>Volume 19 Issue 2</body></html>","text/html","https://publisher.example/issue/19/2"),
            ]
            with patch("backend.literature._read_url", side_effect=issue_responses):
                try:
                    literature._doi_metadata("10.1234/issue")
                except ValueError as exc:
                    assert "期刊整期 DOI" in str(exc)
                else:
                    raise AssertionError("an issue DOI must not become a paper")
            cnki_html = """<html><body><input id="abstract_text" value="完整中文摘要"><a href="https://bar.cnki.net/bar/download/order?id=pdf">PDF下载</a><a href="https://reader.cnki.example/paper">原版阅读</a></body></html>""".encode()
            with patch("backend.literature._read_url", return_value=(cnki_html,"text/html","https://kns.cnki.net/kcms2/article/abstract?v=test")):
                cnki_metadata = literature._cnki_metadata("https://link.cnki.net/doi/10.19818/example")
            assert cnki_metadata["summary"] == "完整中文摘要"
            assert cnki_metadata["download_url"] == "https://bar.cnki.net/bar/download/order?id=pdf"
            assert cnki_metadata["reader_url"] == "https://reader.cnki.example/paper"

            link_pdf = sample_pdf("Linked PDF", False)
            def metadata(value):
                if value == "bad":
                    raise ValueError("invalid link")
                if value == "doi-no-fulltext":
                    return {"source":"doi","external_id":"doi:10.1/no-fulltext","title":"Metadata paper","summary":"Abstract only","url":"https://doi.org/10.1/no-fulltext","pdf_url":None,"doi":"10.1/no-fulltext"}
                return {"source":"pdf_url","external_id":"url:check","title":"Linked paper","summary":"","url":"https://example.org/paper.pdf","pdf_url":"https://example.org/paper.pdf"}
            with patch("backend.literature._link_metadata", side_effect=metadata), patch("backend.literature._download_pdf", return_value=link_pdf):
                links = request(f"/api/projects/{project_id}/sources/links", {"links":["direct","bad","doi-no-fulltext"]})
            assert links["succeeded"] == 2 and links["failed"] == 1
            metadata_item = next(item for item in links["items"] if item["input"] == "doi-no-fulltext")
            metadata_paper = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}")
            assert metadata_paper["status"] == "abstract_only" and metadata_paper["availability"]["fulltext"] == "unavailable"
            original_metadata_version = metadata_paper["version_id"]
            refreshed_metadata = {"source":"doi","external_id":"doi:10.1/no-fulltext","title":"Refreshed metadata paper","summary":"Updated abstract","url":"https://publisher.example/article","pdf_url":None,"doi":"10.1/no-fulltext"}
            with patch("backend.literature._doi_metadata", return_value=refreshed_metadata):
                retried = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}/retry", {})
            assert retried["paper_id"] == metadata_item["paper_id"] and retried["imported_as"] == "abstract"
            metadata_paper = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}")
            assert metadata_paper["title"] == "Refreshed metadata paper" and metadata_paper["metadata"]["url"] == "https://publisher.example/article"
            metadata_version = metadata_paper["version_id"]
            for restored, expected_version in [(metadata("doi-no-fulltext"), original_metadata_version), (refreshed_metadata, metadata_version)]:
                with patch("backend.literature._doi_metadata", return_value=restored):
                    request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}/retry", {})
                restored_paper = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}")
                assert restored_paper["version_id"] == expected_version
            original_metadata = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}?version_id={original_metadata_version}")
            assert "Abstract only" in original_metadata["pages"][0]["text"]
            metadata_task_id = new_id("task")
            metadata_snapshot = [{"id":metadata_item["paper_id"],"title":metadata_paper["title"],"version_id":metadata_version,"pages":1,"status":"abstract_only","focus":True}]
            service.store.run("INSERT INTO tasks(id,project_id,conversation_id,message_id,prompt,selected_paper_ids,generate,status,created,updated,snapshot,refs) VALUES(?,?,?,?,?,?,0,'running',?,?,?,?)", (metadata_task_id,project_id,conversation_id,new_id("message"),"Read abstract version",json_text([metadata_item["paper_id"]]),now(),now(),json_text(metadata_snapshot),json_text({})))
            metadata_tools = ProjectTools(service.store, service.store.task(metadata_task_id))
            metadata_tools.call("set_scope", {"only_selected":True})
            metadata_read = metadata_tools.call("read_material", {"paper_id":metadata_item["paper_id"],"version_id":metadata_version,"query":"Updated abstract"})
            old_citation_id = metadata_read["evidence"][0]["id"]
            supplemented = multipart(f"/api/projects/{project_id}/sources/files", [("manual-fulltext.pdf",native)], {"target_paper_id":metadata_item["paper_id"]})
            assert supplemented["succeeded"] == 1, supplemented
            assert supplemented["items"][0]["paper_id"] == metadata_item["paper_id"]
            supplemented_paper = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}")
            assert supplemented_paper["kind"] == "pdf" and supplemented_paper["availability"]["fulltext"] == "downloaded"
            assert supplemented_paper["title"] == "Refreshed metadata paper"
            assert supplemented_paper["metadata"]["source"] == "doi" and supplemented_paper["metadata"]["summary"] == "Updated abstract"
            old_metadata = request(f"/api/projects/{project_id}/papers/{metadata_item['paper_id']}?version_id={metadata_version}")
            assert old_metadata["kind"] == "text" and "Updated abstract" in old_metadata["pages"][0]["text"]
            old_citation = request(f"/api/projects/{project_id}/citations/{old_citation_id}")
            assert old_citation["paper_version_id"] == metadata_version and old_citation["quote"] == old_metadata["pages"][0]["text"]

            oversized = import_pdf_files(service.store, project_id, [("too-large.pdf", b"%PDF" + b"0" * MAX_PDF_BYTES)])
            assert oversized["failed"] == 1 and "40 MB" in oversized["items"][0]["error"]

            service.store.run("PRAGMA user_version=4")
            service.close()
            service = Service(root / "papers", root / "data")
            assert service.store.one("PRAGMA user_version")[0] == 6
            assert list((root / "data" / "backups").glob("before-tasks-v6-*.sqlite3"))
            handler.service = service
            reopened = request(f"/api/projects/{project_id}")
            assert len(reopened["papers"]) == count + 2
            for paper_id in [first_text["paper_id"], *successful_ids]:
                assert request(f"/api/projects/{project_id}/papers/{paper_id}")["version_id"]
            print("PASS: batch uploads isolate failures, deduplicate content, preserve project ownership, build responsive layout, retain scan fallback, expose source fragments, persist text/PDF versions, and report link/resource limits")
        finally:
            server.shutdown()
            server.server_close()
            service.close()


if __name__ == "__main__":
    main()
