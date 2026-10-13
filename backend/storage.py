"""Local ownership and atomic replacement for durable application files."""
import os
from pathlib import Path
import tempfile


def lock_directory(directory):
    # Keep the lock file: unlinking it could let another process lock a new inode.
    lease = open(directory / '.methodatlas.lock', 'a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(lease.fileno()).st_size == 0:
                lease.write(b'\0')
                lease.flush()
            lease.seek(0)
            msvcrt.locking(lease.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        lease.close()
        raise ValueError('数据目录已由另一个工作台使用，请返回已打开的窗口；不同实例须使用不同数据目录') from error
    return lease


def atomic_write(path, raw):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name + '-')
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
