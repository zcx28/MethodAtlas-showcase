"""Real Linux/bubblewrap lifecycle and boundary checks. No SSH/GPU claim."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

RUNNER=Path(__file__).resolve().parents[1]/'third_party/mimir/server/remote-runner.py'


def main():
    if sys.platform!='linux':
        print('NOT RUN: experiment sandbox needs Linux with usable bubblewrap/user namespaces')
        return
    with tempfile.TemporaryDirectory() as temporary:
        root=Path(temporary).resolve()
        (root/'original.py').write_text('print("original")\n')
        group='group_'+'a'*32
        spec={'directory':str(root),'network':False,'gpu_devices':[], 'steps':['baseline']}
        digest=hashlib.sha256(json.dumps(spec).encode()).hexdigest()
        def request(value):
            result=subprocess.run([sys.executable,str(RUNNER)],input=json.dumps(value),text=True,capture_output=True,timeout=20)
            assert result.returncode==0,result.stderr
            return json.loads(result.stdout)
        def workspace(operation,path,**body):
            return request({'action':'workspace','id':group,'spec':spec,'digest':digest,'operation':operation,'path':path,**body})
        check=request({'action':'group-check','id':group,'spec':spec,'digest':digest})
        assert check.get('sandbox')=='bubblewrap',check
        created=workspace('write','train.py',content='import json\nfrom pathlib import Path\nPath("metrics.json").write_text(json.dumps({"score":0.75}))\nprint("finished")\n',before_sha256='')
        assert created.get('sha256'),created
        assert workspace('write','train.py',content='changed',before_sha256='').get('error')
        assert workspace('read','../authorization.json').get('error')
        work=root/'.methodatlas-groups'/group/'work'
        import os
        os.mkfifo(work/'metrics.txt')
        (work/'escape').symlink_to(root/'original.py')
        assert workspace('read','escape').get('error')
        ident='exp_'+'b'*32
        run_spec={'directory':str(root),'command':'python3 -m venv --without-pip .venv && .venv/bin/python train.py',
                  'sandbox':{'group_id':group,'digest':digest,'network':False,'gpu_devices':[],'deadline':None,'max_storage_mb':None}}
        def job(action,**body):
            return request({'action':action,'id':ident,'spec':run_spec,**body})
        job('submit',runner=RUNNER.read_text())
        job('submit',runner=RUNNER.read_text())
        for _ in range(150):
            result=job('observe')
            if result['status'] in ('succeeded','failed'):
                break
            time.sleep(.1)
        assert result['status']=='succeeded',(result,job('log'))
        assert json.loads((work/'metrics.json').read_text())=={'score':0.75}
        assert (root/'.methodatlas-jobs'/ident/'code-before.json').exists()
        assert (root/'.methodatlas-jobs'/ident/'code-after.json').exists()
        assert job('snapshot',snapshot='before')['size']>0
        selected=job('result',path='metrics.json')
        assert selected['size']>0,selected
        ident='exp_'+'c'*32
        run_spec={**run_spec,'command':'(echo destroyed > /source/original.py); test ! -e /source/.methodatlas-groups/'+group+'/authorization.json'}
        job('submit',runner=RUNNER.read_text())
        for _ in range(100):
            result=job('observe')
            if result['status'] in ('succeeded','failed'):
                break
            time.sleep(.1)
        assert (root/'original.py').read_text()=='print("original")\n'
        assert result['status']=='succeeded',(result,job('log'))
        ident='exp_'+'d'*32
        run_spec={**run_spec,'command':'sleep 30','sandbox':{**run_spec['sandbox'],'deadline':time.time()+1}}
        job('submit',runner=RUNNER.read_text())
        for _ in range(120):
            result=job('observe')
            if result['status']=='failed':
                break
            time.sleep(.1)
        assert result['limitReason']=='experiment group deadline reached',result
        print('PASS real Linux: bubblewrap, CAS/code history, source protection, group identity hiding, venv, execution, metrics, detached idempotency, deadline')


if __name__=='__main__':
    main()
