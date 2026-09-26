"""Real search smoke check; requires search dependencies and consumes model usage."""
import os
import tempfile
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

from .discovery import discover


def check():
    assert os.getenv('DEEPSEEK_API_KEY'), 'Load backend credentials before running'
    with tempfile.TemporaryDirectory() as directory:
        store = SimpleNamespace(root=Path(directory), assert_active=lambda *_: None,
                                transaction=nullcontext, event=lambda _, __, message, ___: print(message, flush=True))
        for bounded in (True, False):
            mode = 'subscription' if bounded else 'search'
            result = discover('embodied intelligence', store, {'id':mode, 'revision':0}, bounded=bounded)
            assert not result.get('error'), result.get('error')
            assert len(result['candidates']) >= 3, result
            assert any(s.get('status') == 'succeeded' for s in result['sources']), result['sources']
            if not bounded:
                assert any(c.get('status') == 'succeeded' for c in result['usage']['calls']), result
                assert result.get('research', {}).get('learnings'), result.get('warning') or 'No research learnings'
            print(mode, 'PASS', len(result['candidates']), 'candidates', flush=True)
            print(result['sources'], flush=True)
            print('warning:', result.get('warning'), flush=True)
            for paper in result['candidates'][:3]:
                print(paper['title'], paper['url'], flush=True)


if __name__ == '__main__':
    check()
