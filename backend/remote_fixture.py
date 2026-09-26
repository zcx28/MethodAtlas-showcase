"""Controlled external SSH peer for check_remote (never used by the app)."""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(os.environ['REMOTE_FIXTURE_ROOT'])
assert 'StrictHostKeyChecking=yes' in sys.argv
assert 'PermitLocalCommand=no' in sys.argv
if '-G' in sys.argv:
    print('hostname 127.0.0.1\nport ' + os.environ['REMOTE_FIXTURE_PORT'] + '\nuser researcher\n')
    sys.exit()
if any('nvidia-smi' in arg for arg in sys.argv):
    mode = (root / 'probe').read_text() if (root / 'probe').exists() else 'none'
    if mode == 'auth':
        print('Permission denied (publickey)', file=sys.stderr)
        sys.exit(255)
    if mode == 'bad':
        print('bad GPU response')
    sys.exit()
if (root / 'offline').exists():
    sys.exit(255)
request = json.load(sys.stdin)
if request['action'] == 'group-check':
    print(json.dumps({'sandbox':'bubblewrap','workspace':'controlled-peer'}))
    sys.exit()
ident = request['id']
file = root / (ident + '.json')
spec = request['spec']
action = request['action']
if action == 'submit' and not file.exists():
    assert 'start_new_session=True' in request['runner']
    file.write_text(json.dumps({'spec': spec, 'launches': 1, 'status': 'running'}))
    if not (root / 'drop-used').exists():
        (root / 'drop-used').touch()
        sys.exit(255)  # Accepted remotely; reply was lost.
if not file.exists():
    print(json.dumps({'status':'unknown', 'exitCode':None}))
    sys.exit()
job = json.loads(file.read_text())
assert job['spec'] == spec
if action == 'cancel':
    job['status'] = 'cancelled'
elif (root / 'complete').exists():
    job['status'] = 'succeeded'
elif (root / 'failed').exists():
    job['status'] = 'failed'
file.write_text(json.dumps(job))
if action in ('log', 'result'):
    raw = ('中文日志\n' * 10000).encode() if action == 'log' else f"launches,score\n{job['launches']},0.75\n".encode()
    if action == 'result' and request.get('path') == 'run.sh':
        raw = b'exit 1\n'
    offset = request.get('offset', 0)
    print(json.dumps({'data':base64.b64encode(raw[offset:offset+65536]).decode(), 'offset':offset,
                      'next_offset':min(len(raw), offset+65536), 'size':len(raw), 'signature':[1,2,len(raw),3],
                      'sha256_chunk':hashlib.sha256(raw[offset:offset+65536]).hexdigest(),
                      'path':spec['directory']+'/'+request.get('path','log')}))
else:
    print(json.dumps({'status':job['status'], 'exitCode':0 if job['status']=='succeeded' else None,
                      'remotePath':spec['directory']+'/.methodatlas-jobs/'+ident,
                      'logPath':spec['directory']+'/.methodatlas-jobs/'+ident+'/log',
                      'provenance':{'code_version':None,'configuration':None,'platform':'controlled peer'}}))
