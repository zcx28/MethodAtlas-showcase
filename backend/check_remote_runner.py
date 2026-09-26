"""Execute the actual remote JSON protocol. Full lifecycle additionally needs Linux."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

RUNNER = Path(__file__).resolve().parents[1] / 'third_party/mimir/server/remote-runner.py'


def main():
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder).resolve()
        ident = 'exp_' + 'a' * 32
        spec = {'directory':str(root), 'command':'true', 'project_id':'check'}
        job = root / '.methodatlas-jobs' / ident
        job.mkdir(parents=True)
        (job / 'spec.json').write_text(json.dumps(spec))
        (job / 'outcome.json').write_text(json.dumps({'status':'failed','exitCode':1}))
        data = ('真实分段日志\n' * 12000).encode()
        (job / 'log').write_bytes(data)
        (root / 'result.csv').write_bytes(b'metric,value\naccuracy,0.75\n')
        def call(action, **fields):
            request = {'action':action, 'id':ident, 'spec':spec, **fields}
            # Windows executes the real protocol's portable filesystem branches.
            # This bypasses only the Linux prerequisite, never process APIs.
            command = [sys.executable, str(RUNNER)] if sys.platform == 'linux' else [sys.executable, '-c',
                'import sys,runpy;sys.platform="linux";path=sys.argv[1];sys.argv=[path];runpy.run_path(path,run_name="__main__")', str(RUNNER)]
            result = subprocess.run(command, input=json.dumps(request), text=True, capture_output=True, timeout=20)
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)
        first = call('log', offset=0)
        assert first.get('next_offset') == 65536, first
        assert base64.b64decode(first['data']) == data[:65536]
        second = call('log', offset=first['next_offset'])
        assert base64.b64decode(second['data']) == data[65536:131072]
        assert first['signature'] == second['signature']
        selected = call('result', path='result.csv')
        assert base64.b64decode(selected['data']) == b'metric,value\naccuracy,0.75\n'
        assert call('result',path='../outside')['error']
        assert call('result',path='.methodatlas-jobs/'+ident+'/spec.json')['error']
        assert call('observe')['status'] == 'failed'
        assert call('log',offset=-1)['error']
        print('PASS actual remote runner JSON: terminal state, bounded reads, byte offsets, selected results and traversal rejection')
        if sys.platform != 'linux':
            print('NOT RUN: real detached lifecycle, Linux process identity, termination and repair; requires Linux/real SSH acceptance')
            return
        ident = 'exp_' + 'b' * 32
        spec = {**spec, 'command':"sleep 1; printf done > result.txt; printf finished"}
        first = call('submit',runner=RUNNER.read_text())
        second = call('submit',runner=RUNNER.read_text())
        for _ in range(100):
            observed = call('observe')
            if observed['status'] == 'succeeded':
                break
            time.sleep(.1)
        assert observed['status'] == 'succeeded', observed
        assert call('log')['data'] == base64.b64encode(b'finished').decode()
        ident = 'exp_' + 'c' * 32
        (root / 'ignore-term.py').write_text('import signal,time,os\nfrom pathlib import Path\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nPath("child.pid").write_text(str(os.getpid()))\ntime.sleep(30)\n')
        spec = {**spec, 'command':'python3 ignore-term.py; echo done'}
        call('submit', runner=RUNNER.read_text())
        for _ in range(100):
            if call('observe')['status'] == 'running' and (root / 'child.pid').exists():
                break
            time.sleep(.1)
        child_pid = int((root / 'child.pid').read_text())
        call('cancel')
        for _ in range(100):
            observed = call('observe')
            if observed['status'] == 'cancelled':
                break
            time.sleep(.1)
        assert observed['status'] == 'cancelled', observed
        child_state = Path(f'/proc/{child_pid}/stat')
        assert not child_state.exists() or child_state.read_text().rsplit(')',1)[1].split()[0] == 'Z', 'TERM-ignoring child survived cancellation'
        script = root / 'run.sh'
        script.write_text('exit 1\n')
        ident = 'exp_' + 'd' * 32
        spec = {'directory':str(root), 'command':'sh run.sh', 'project_id':'check'}
        call('submit', runner=RUNNER.read_text())
        for _ in range(100):
            if call('observe')['status'] == 'failed':
                break
            time.sleep(.1)
        assert call('observe')['status'] == 'failed'
        previous = ident
        ident = 'exp_' + 'e' * 32
        spec = {**spec, 'parent_id':previous, 'attempt':1, 'repair':{'path':'run.sh','before_sha256':hashlib.sha256(script.read_bytes()).hexdigest(),'content':'printf repaired\n'}}
        call('submit', runner=RUNNER.read_text())
        for _ in range(100):
            observed = call('observe')
            if observed['status'] == 'succeeded':
                break
            time.sleep(.1)
        assert observed['status'] == 'succeeded', observed
        assert script.read_text() == 'printf repaired\n'
        assert base64.b64decode(call('log')['data']) == b'repaired'
        print('PASS actual Linux detached execution, repeated submit, exit state and identity-checked termination')


if __name__ == '__main__':
    main()
