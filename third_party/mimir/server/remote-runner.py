"""MethodAtlas remote transport extension for Mimir (Linux + Python >=3.9).

Legacy jobs execute exactly confirmed commands. Group jobs use an existing Linux
bubblewrap sandbox, with only a fresh group workspace writable. No key forwarding.
"""
import base64
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import stat


def write(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def identity(pid):
    return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]


def state(folder):
    if (folder / 'outcome.json').exists():
        return json.loads((folder / 'outcome.json').read_text())
    if (folder / 'process.json').exists():
        process = json.loads((folder / 'process.json').read_text())
        try:
            if identity(process['pid']) == process['birth']:
                return {'status': 'running', 'exitCode': None}
        except (OSError, ValueError):
            pass
    return {'status': 'unknown', 'exitCode': None}


def _supervise(folder, spec):
    cancelled = [False]
    def stop(*_):
        cancelled[0] = True
    signal.signal(signal.SIGTERM, stop)
    write(folder / 'process.json', {'pid': os.getpid(), 'birth': identity(os.getpid())})
    def read_command(args):
        try:
            result = subprocess.run(args, cwd=spec['directory'], capture_output=True, timeout=5)
            return result.stdout[:4000].decode('utf-8', 'replace').strip() if result.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None
    provenance = {'code_version': read_command(['git', 'rev-parse', 'HEAD']),
                  'code_dirty': read_command(['git', 'status', '--porcelain']),
                  'supervisor_python': sys.version, 'host_kernel': read_command(['uname', '-sr']),
                  'configuration': spec.get('configuration') or None,
                  'configuration_source': 'user declaration; not independently verified'}
    scope = spec.get('sandbox')
    group_folder, work = None, None
    if scope:
        group_folder, work, _ = group_paths(spec,scope['group_id'],scope['digest'])
        code_snapshot(work,folder,'code-before.json')
        provenance['source_code_version'] = provenance.pop('code_version')
        provenance['source_code_dirty'] = provenance.pop('code_dirty')
        actual = subprocess.run(sandbox_command(spec,'git -c core.fsmonitor=false rev-parse HEAD'),capture_output=True,timeout=5)
        provenance['code_version'] = actual.stdout.decode('utf-8','replace').strip()[:100] if actual.returncode==0 else None
        provenance['code_snapshot_api'] = 'read_experiment(snapshot=before|after)'
        provenance['workspace'] = str(work)
        provenance['code_snapshot'] = str(folder/'code-before.json')
        provenance['isolation'] = 'bubblewrap'
    write(folder / 'provenance.json', provenance)
    try:
        with (folder / 'log').open('ab', buffering=0) as log:
            if cancelled[0]:
                write(folder / 'outcome.json', {'status': 'cancelled', 'exitCode': None})
                return
            command = sandbox_command(spec) if scope else ['/bin/sh', '-c', spec['command']]
            process = subprocess.Popen(command, cwd=spec['directory'],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            checked_at, limit_reason = 0, None
            while process.poll() is None:
                if scope and time.monotonic()-checked_at >= 1:
                    checked_at = time.monotonic()
                    if scope.get('deadline') and time.time() >= scope['deadline']:
                        limit_reason = 'experiment group deadline reached'
                    if scope.get('max_storage_mb') and group_storage(spec,group_folder) >= scope['max_storage_mb']*1024*1024:
                        limit_reason = 'sampled storage guard reached (not a hard filesystem quota)'
                if cancelled[0] or limit_reason:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                        # Do not reap the leader before escalation: keeping its PID
                        # reserved prevents a reused process group becoming a target.
                        # Children may ignore TERM even when the shell exits promptly.
                        time.sleep(5)
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    break
                time.sleep(0.1)
            code = process.wait()
        if scope:
            code_snapshot(work,folder,'code-after.json')
        write(folder / 'outcome.json', {'status': 'cancelled' if cancelled[0] else 'failed' if limit_reason else 'succeeded' if code == 0 else 'failed',
                                      'limitReason':limit_reason, 'exitCode': code, 'finishedAt': datetime.now(timezone.utc).isoformat()})
    except Exception as error:
        write(folder / 'outcome.json', {'status': 'failed', 'exitCode': None, 'error': type(error).__name__})


def supervise(folder,spec):
    try:
        _supervise(folder,spec)
    except Exception as error:
        write(folder/'outcome.json',{'status':'failed','exitCode':None,'error':type(error).__name__,
                                   'finishedAt':datetime.now(timezone.utc).isoformat()})


def group_paths(spec, ident, digest, create=False):
    if not re.fullmatch(r'group_[a-f0-9]{32}',ident):
        raise ValueError('Invalid experiment group')
    root = Path(spec['directory'])
    if not root.is_absolute() or root.resolve() != root or not root.is_dir():
        raise ValueError('Authorized source directory must exist without symlinks')
    parent = root / '.methodatlas-groups'
    folder = parent / ident
    if parent.is_symlink() or folder.is_symlink():
        raise ValueError('Group directory must not be a symlink')
    if create:
        parent.mkdir(mode=0o700,exist_ok=True)
        jobs=root/'.methodatlas-jobs'
        if jobs.is_symlink():
            raise ValueError('Job directory must not be a symlink')
        jobs.mkdir(mode=0o700,exist_ok=True)
        folder.mkdir(mode=0o700,exist_ok=True)
    manifest = folder / 'authorization.json'
    if create and not manifest.exists():
        # Exclusive creation makes a different authorization fail closed.
        with manifest.open('x') as stream:
            json.dump({'spec':spec,'digest':digest},stream)
    record = json.loads(manifest.read_text())
    if record['digest'] != digest or create and record['spec'] != spec:
        raise ValueError('Group authorization changed')
    work = folder / 'work'
    if work.is_symlink():
        raise ValueError('Workspace must not be a symlink')
    if create:
        work.mkdir(mode=0o700,exist_ok=True)
    return folder, work, record['spec']


def sandbox_command(spec, command=None):
    """Use the installed Linux sandbox; never silently fall back to unrestricted shell."""
    import shutil
    runtime = shutil.which('bwrap')
    if not runtime:
        raise ValueError('Autonomous experiments require existing bubblewrap (bwrap); no software was installed')
    scope = spec['sandbox']
    folder, work, authorized = group_paths(spec,scope['group_id'],scope['digest'])
    if scope['network'] != authorized['network'] or scope['gpu_devices'] != authorized['gpu_devices']:
        raise ValueError('Sandbox permissions do not match authorization')
    args = [runtime,'--die-with-parent','--unshare-all','--new-session','--cap-drop','ALL','--clearenv']
    if authorized['network']:
        args += ['--share-net']
    for location in ('/usr','/bin','/sbin','/lib','/lib64'):
        if Path(location).exists():
            args += ['--ro-bind',location,location]
    for location in ('/etc/ld.so.cache','/etc/resolv.conf','/etc/hosts','/etc/ssl/certs','/etc/localtime'):
        if Path(location).exists():
            args += ['--ro-bind',location,location]
    args += ['--proc','/proc','--dev','/dev','--tmpfs','/tmp',
             '--ro-bind',spec['directory'],'/source','--tmpfs','/source/.methodatlas-groups',
             '--tmpfs','/source/.methodatlas-jobs','--bind',str(work),'/work','--chdir','/work',
             '--setenv','HOME','/work','--setenv','PATH','/work/.venv/bin:/usr/local/bin:/usr/bin:/bin',
             '--setenv','LANG','C.UTF-8','--setenv','PYTHONNOUSERSITE','1',
             '--setenv','GIT_CONFIG_NOSYSTEM','1','--setenv','GIT_TERMINAL_PROMPT','0']
    if authorized.get('max_storage_mb') and group_storage(spec,folder)>=authorized['max_storage_mb']*1024*1024:
        raise ValueError('Experiment group storage guard reached; no new command started')
    devices = authorized['gpu_devices']
    if devices:
        for name in ['nvidiactl','nvidia-uvm','nvidia-uvm-tools']+[f'nvidia{d}' for d in devices]:
            path = '/dev/'+name
            if Path(path).exists():
                args += ['--dev-bind',path,path]
        args += ['--setenv','CUDA_VISIBLE_DEVICES',','.join(map(str,devices))]
    return args + ['/bin/sh','-c',spec['command'] if command is None else command]


def group_request(request):
    import difflib
    import fcntl
    spec, ident, digest = request['spec'],request['id'],request['digest']
    folder, work, authorized = group_paths(spec,ident,digest,create=request['action']=='group-check')
    if request['action']=='group-check':
        sandbox = {'group_id':ident,'digest':digest,'network':spec['network'],'gpu_devices':spec['gpu_devices']}
        check = subprocess.run(sandbox_command({**spec,'sandbox':sandbox},'true'),capture_output=True,timeout=8)
        if check.returncode:
            raise ValueError('bubblewrap isolation unavailable: '+check.stderr.decode('utf-8','replace')[-400:])
        return {'sandbox':'bubblewrap','workspace':str(work),'source':'/source (read-only)',
                'storage_policy':'sampled guard, not filesystem quota'}
    with (folder / 'workspace.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        # Busy jobs may change files: avoid mutable reads/CAS races with execution.
        jobs = Path(spec['directory']) / '.methodatlas-jobs'
        if jobs.exists():
            for entry in jobs.iterdir():
                manifest = entry/'spec.json'
                if entry.is_symlink() or not manifest.is_file():
                    continue
                item = json.loads(manifest.read_text())
                if item.get('sandbox',{}).get('group_id')==ident and state(entry)['status'] not in ('succeeded','failed','cancelled'):
                    raise ValueError('Group has an active or uncertain run')
        relative = request.get('path','.')
        if not isinstance(relative,str) or Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise ValueError('Workspace path escapes authorization')
        target = work / relative
        if target.resolve() != target or not target.is_relative_to(work):
            raise ValueError('Workspace symlinks are not writable/readable through the file adapter')
        operation = request['operation']
        if operation=='list':
            names = sorted(target.iterdir())
            return {'entries':[{'name':p.name,'directory':p.is_dir(),'symlink':p.is_symlink()} for p in names[:200]],'truncated':len(names)>200}
        if operation not in ('read','write'):
            raise ValueError('Unknown workspace action')
        if target.exists() and (not target.is_file() or target.stat().st_size>65536):
            raise ValueError('Only regular text files up to 64 KiB are supported; use command tools for larger selected inputs')
        before = target.read_bytes() if target.exists() else None
        before_hash = hashlib.sha256(before).hexdigest() if before is not None else ''
        if operation=='read':
            if before is None:
                return {'exists':False,'content':'','sha256':''}
            return {'exists':True,'content':before.decode('utf-8'),'sha256':before_hash}
        content = request.get('content')
        if not isinstance(content,str) or len(content.encode('utf-8'))>65536 or '\0' in content:
            raise ValueError('Invalid text content')
        if request.get('before_sha256') != before_hash:
            raise ValueError('File changed or already exists; re-read before writing')
        raw = content.encode('utf-8')
        scope={'group_id':ident}
        if authorized.get('max_storage_mb') and group_storage({**spec,'sandbox':scope},folder)+len(raw)*2+(len(before) if before else 0)>authorized['max_storage_mb']*1024*1024:
            raise ValueError('Experiment group storage guard reached; no file written')
        changed = hashlib.sha256(raw).hexdigest()
        history = folder/'changes'
        history.mkdir(exist_ok=True)
        if before is not None:
            (history/before_hash).write_bytes(before)
        (history/changed).write_bytes(raw)
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary = history/'new-file'
        temporary.write_bytes(raw)
        if target.exists():
            temporary.chmod(stat.S_IMODE(target.stat().st_mode))
        temporary.replace(target)
        diff = ''.join(difflib.unified_diff((before or b'').decode('utf-8').splitlines(True),content.splitlines(True),fromfile=relative,tofile=relative))
        return {'path':relative,'before_sha256':before_hash,'sha256':changed,'diff':diff,'history':str(history)}


def code_snapshot(work, folder, name):
    """Small code/config snapshots outside writable sandbox; large binaries stay in workspace."""
    # Design limit: code/config snapshots cap at 2 MiB/2000 files; use content-addressed archives for larger runs.
    records, total = [], 0
    for base, dirs, files in os.walk(work,followlinks=False):
        dirs[:] = [d for d in dirs if d not in ('.git','.venv','node_modules','__pycache__')]
        for filename in files:
            path = Path(base)/filename
            if path.is_symlink() or path.suffix not in ('.py','.sh','.json','.toml','.yaml','.yml','.txt'):
                continue
            if len(records)>=2000:
                records.append({'missing':'snapshot capped at 2000 code/config files'})
                write(folder/name,records)
                return
            try:
                descriptor=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
                with os.fdopen(descriptor,'rb') as stream:
                    info=os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode):
                        continue
                    if info.st_size>65536 or total+info.st_size>2*1024*1024:
                        records.append({'path':str(path.relative_to(work)),'missing':'snapshot size limit'})
                        continue
                    raw=stream.read(65537)
                    if len(raw)>65536:
                        records.append({'path':str(path.relative_to(work)),'missing':'file changed during snapshot'})
                        continue
            except OSError:
                records.append({'path':str(path.relative_to(work)),'missing':'file unavailable during snapshot'})
                continue
            total += len(raw)
            records.append({'path':str(path.relative_to(work)),'sha256':hashlib.sha256(raw).hexdigest(),
                            'content':raw.decode('utf-8','replace')})
    write(folder/name,records)


def storage_bytes(root):
    total = 0
    for base, _, files in os.walk(root,followlinks=False):
        for filename in files:
            try:
                total += (Path(base)/filename).lstat().st_size
            except FileNotFoundError:
                pass
    return total

def group_storage(spec,folder):
    total=storage_bytes(folder)
    for job in (Path(spec['directory'])/'.methodatlas-jobs').iterdir():
        if job.is_symlink():
            continue
        try:
            saved=json.loads((job/'spec.json').read_text())
            if saved.get('sandbox',{}).get('group_id')==spec['sandbox']['group_id']:
                total+=storage_bytes(job)
        except (OSError,ValueError):
            continue
    return total


def handle(request):
    if sys.platform != 'linux' or sys.version_info < (3, 9):
        raise ValueError('Requires existing Linux and Python >=3.9; nothing was installed')
    if request['action'] in ('group-check','workspace'):
        return group_request(request)
    ident, spec = request['id'], request['spec']
    if not re.fullmatch(r'exp_[a-f0-9]{32}', ident):
        raise ValueError('Invalid remote identity')
    root = Path(spec['directory'])
    if not root.is_absolute() or root.resolve() != root or not root.is_dir():
        raise ValueError('Authorized directory must exist and be canonical, without symlinks')
    parent = root / '.methodatlas-jobs'
    folder = parent / ident
    if parent.is_symlink() or folder.is_symlink():
        raise ValueError('Remote identity directory is a symlink')
    manifest = folder / 'spec.json'
    action = request['action']
    if action == 'submit':
        # Refuse a launch on kernels where the promised safe termination is unavailable.
        descriptor = os.pidfd_open(os.getpid())
        os.close(descriptor)
        parent.mkdir(mode=0o700, exist_ok=True)
        if spec.get('sandbox'):
            sandbox_command(spec)  # Validate isolation availability before reserving an identity.
        repair = spec.get('repair')
        if repair and not folder.exists():
            previous = parent / spec['parent_id']
            if not re.fullmatch(r'exp_[a-f0-9]{32}', spec['parent_id']) or previous.is_symlink() or state(previous)['status'] != 'failed':
                raise ValueError('Repair parent has no confirmed failure')
            if not 1 <= spec['attempt'] <= 2:
                raise ValueError('Repair attempt limit reached')
            target = root / repair['path']
            if target.resolve() != target or not target.is_relative_to(root) or target.suffix not in ('.py', '.sh') or '.methodatlas-jobs' in target.relative_to(root).parts:
                raise ValueError('Repair target escapes the authorized script scope')
            if hashlib.sha256(target.read_bytes()).hexdigest() != repair['before_sha256']:
                raise ValueError('Script changed after repair preview; not overwritten')
        try:
            folder.mkdir(mode=0o700)
        except FileExistsError:
            pass  # Never relaunch an existing identity, even after an uncertain launch.
        else:
            write(manifest, spec)
            if repair:
                # The exact new bytes have their own user confirmation. No automatic
                # widening of a previous command's authorization is inferred.
                temporary = folder / 'repair-script'
                temporary.write_text(repair['content'], encoding='utf-8')
                temporary.chmod(stat.S_IMODE(target.stat().st_mode))
                temporary.replace(target)
            # -c source is this fixed adapter, not code supplied by the model.
            source = request['runner']
            subprocess.Popen([sys.executable, '-c', source, str(folder)], stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    if not manifest.exists():
        return {'status': 'unknown', 'exitCode': None, 'reason': 'No durable manifest; do not guess whether execution started'}
    if json.loads(manifest.read_text()) != spec:
        raise ValueError('Remote identity belongs to different authorization content')
    if action == 'cancel' and state(folder)['status'] == 'running':
        process = json.loads((folder / 'process.json').read_text())
        # pidfd binds the signal to the observed process; PID reuse cannot target another job.
        descriptor = os.pidfd_open(process['pid'])
        try:
            if identity(process['pid']) != process['birth']:
                raise ValueError('Process identity changed; termination refused')
            signal.pidfd_send_signal(descriptor, signal.SIGTERM)
        finally:
            os.close(descriptor)
    if action in ('log', 'result', 'snapshot'):
        offset = request.get('offset', 0)
        if type(offset) is not int or not 0 <= offset <= 2**53 - 1:
            raise ValueError('Invalid byte offset')
        target = folder / 'log'
        if action == 'snapshot':
            if request.get('snapshot') not in ('before','after'):
                raise ValueError('Select before or after snapshot')
            target=folder/('code-'+request['snapshot']+'.json')
        if action == 'result':
            if spec.get('sandbox'):
                _, root, _ = group_paths(spec,spec['sandbox']['group_id'],spec['sandbox']['digest'])
            relative = request.get('path', '')
            if not relative or Path(relative).is_absolute() or '..' in Path(relative).parts:
                raise ValueError('Select a relative result path inside the authorized directory')
            target = (root / relative).resolve()
            if not target.is_relative_to(root) or '.methodatlas-jobs' in target.relative_to(root).parts:
                raise ValueError('Result escapes the authorized directory')
        if not target.exists() and action == 'log':
            return {'data': '', 'offset': offset, 'next_offset': offset, 'size': 0, 'path': str(target)}
        descriptor=os.open(target,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
        with os.fdopen(descriptor,'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError('Only regular result files may be read')
            stream.seek(offset)
            raw = stream.read(65536)
            file_stat = os.fstat(stream.fileno())
            size = file_stat.st_size
        return {'data': base64.b64encode(raw).decode(), 'offset': offset, 'next_offset': offset + len(raw),
                'size': size, 'path': str(target), 'signature': [file_stat.st_dev, file_stat.st_ino, size, file_stat.st_mtime_ns],
                'sha256_chunk': hashlib.sha256(raw).hexdigest()}
    provenance = json.loads((folder / 'provenance.json').read_text()) if (folder / 'provenance.json').exists() else None
    return {**state(folder), 'provenance': provenance, 'remotePath': str(folder), 'logPath': str(folder / 'log')}


if __name__ == '__main__':
    if len(sys.argv) > 1:
        directory = Path(sys.argv[1])
        supervise(directory, json.loads((directory / 'spec.json').read_text()))
    else:
        try:
            print(json.dumps(handle(json.load(sys.stdin))))
        except Exception as error:
            print(json.dumps({'error': str(error)}))
