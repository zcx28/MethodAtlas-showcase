"""Exercise discovery polling and progress publication without network/model calls."""
import itertools
import json
import tempfile
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from .discovery import discover
from .agent import ProjectTools


def check():
    with tempfile.TemporaryDirectory() as directory:
        events = []
        store = SimpleNamespace(root=Path(directory), assert_active=lambda *_: None,
                                transaction=nullcontext, event=lambda *args: events.append(args))
        result = {'candidates':[{'title':'Candidate'}] * 3, 'usage':{'calls':[{}]}, 'sources':[]}

        def start(command, **kwargs):
            Path(command[4]).write_text(json.dumps(result))
            process = MagicMock()
            process.poll.side_effect = [None, None, 0, 0]
            return process

        ticks = itertools.count(step=16)
        task = {'id':'check', 'revision':0, 'plan':[{'id':'search', 'status':'in_progress'}]}
        with patch('backend.discovery.subprocess.Popen', side_effect=start), patch('backend.discovery.time.monotonic', side_effect=lambda: next(ticks)), patch('backend.discovery.time.sleep'):
            assert discover('robotics', store, task) == result
        assert len(events) == 2
        assert all(e[1] == 'search_progress' and e[3] == 'search' for e in events)
        assert '3 条候选' in events[0][2] and '1 次模型调用' in events[0][2]
        assert '32 秒' in events[1][2]
        assert '已展示 3 篇推荐论文' in ProjectTools.action_label(None, 'present_papers', {}, {'presented':3})
        print('PASS: progress emitted before search completes; final recommendations labeled correctly')


if __name__ == '__main__':
    check()
