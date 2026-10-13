"""Temporary test data, including deeply nested Windows Harness dependencies."""
import os
import shutil
import stat
import tempfile
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def temporary_directory():
    parent = Path(tempfile.gettempdir()).resolve()
    root = Path(tempfile.mkdtemp(prefix='methodatlas-check-', dir=parent)).resolve()
    assert root.parent == parent
    try:
        yield str(root)
    finally:
        path = str(root)
        if os.name == 'nt':
            path = '\\\\?\\UNC\\' + path[2:] if path.startswith('\\\\') else '\\\\?\\' + path
        def remove_readonly(operation, target, error):
            # Like Python 3.13 rmtree: a child that already disappeared is cleaned up.
            if isinstance(error, FileNotFoundError) and target != path:
                return
            if not isinstance(error, PermissionError):
                raise error
            os.chmod(target, stat.S_IWRITE | stat.S_IREAD)
            operation(target)
        shutil.rmtree(path, onexc=remove_readonly)


if __name__ == '__main__':
    with temporary_directory() as directory:
        nested = str(Path(directory) / ('a' * 90) / ('b' * 90) / ('c' * 90))
        if os.name == 'nt':
            nested = '\\\\?\\' + nested
        Path(nested).mkdir(parents=True)
        fixture = Path(nested) / 'fixture.txt'
        fixture.write_text('fixture', encoding='utf-8')
        fixture.chmod(stat.S_IREAD)
    assert not Path(directory).exists()
    print('PASS: deep temporary files removed without ignoring cleanup errors')
