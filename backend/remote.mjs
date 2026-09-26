// JSON bridge into the pinned, adapted Mimir server domain. SQLite implements
// its existing table interface; no competing wiki or job scheduler is started.
import { metricFigureSvg } from '../third_party/mimir/metric-figure.ts'
import { DatabaseSync } from 'node:sqlite'
import { listServers, saveServer, deleteServer, checkServer, submitJob, listJobs, recoverInterruptedJobs } from '../third_party/mimir/server/services/server.ts'
import { listExperiments, saveExperiment } from '../third_party/mimir/server/services/experiment.ts'
import { durableObserve, remoteCall, probeTarget, isLocalTarget } from '../third_party/mimir/server/transport.mjs'
let input = ''
for await (const chunk of process.stdin) input += chunk
const request = JSON.parse(input)
const db = new DatabaseSync(process.argv[2])
db.exec('PRAGMA busy_timeout=20000; CREATE TABLE IF NOT EXISTS records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id))')
const domain = {table(kind) { return {
  get(id) { const row = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.value) : undefined },
  entries() { return db.prepare('SELECT id,value FROM records WHERE kind=?').all(kind).map(row => [row.id, JSON.parse(row.value)]) },
  async put(id, value) { db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind, id, JSON.stringify(value)) },
  async delete(id) { db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id) },
} }}
const deps = {domain}
const state = {jobSeq: 0}
let result
try {
  switch (request.action) {
    case 'metric-chart': result={ok:true,value:metricFigureSvg(request.body.metric,request.body.rows)}; break
    case 'experiment-list': {
      // Project identity comes from the owning Python store, not a competing wiki.
      await domain.table('projects').put(request.body.projectId, {id:request.body.projectId})
      result = await listExperiments(deps, request.body); break
    }
    case 'experiment-save': {
      const input = request.body
      await domain.table('projects').put(input.projectId, {id:input.projectId})
      const existing = domain.table('experiments').get(input.id)
      if (existing && existing.projectId !== input.projectId) throw new Error('Project mismatch')
      state.recordId = input.id
      result = await saveExperiment(deps, state, {experiment:{...input, ...(existing ? {} : {id:undefined})}})
      break
    }
    case 'group-check': case 'workspace': {
      result = {ok:true, value:await remoteCall(request.body.spec.server, {...request.body, action:request.action})}; break
    }
    case 'resolve': result = {ok:true,value:await probeTarget(request.body)}; break
    case 'list': result = await listServers(deps); break
    case 'save': result = await saveServer(deps, {server: request.body}); break
    case 'delete': result = await deleteServer(deps, {id: request.body.id}); break
    case 'check': {
      const server = domain.table('servers').get(request.body.id)
      if (server && isLocalTarget(server)) {
        let online = true
        try { await probeTarget(server) } catch { online = false }
        result = {ok:true,value:{state:online ? 'online' : 'offline',gpus:[],checkedAt:new Date().toISOString(),tcp:'not_applicable',ssh:'not_used',gpu:'none',message:online ? '本机 Docker · 离线 CPU' : '本机 Docker 不可用；请检查专用容器与后台配置'}}
        await domain.table('probes').put(request.body.id,result.value)
        break
      }
      result = await checkServer(deps, request.body)
      if (result.ok) {
        const view = result.value
        const message = view.message || ''
        result.value.tcp = view.state === 'offline' ? 'unreachable' : 'reachable'
        result.value.ssh = view.stage === 'tcp' ? 'unknown' : view.stage === 'ssh' ? /Permission denied|Authentication failed/i.test(message) ? 'authentication_failed' : 'error' : 'connected'
        result.value.gpu = view.gpus.length ? 'available' : view.stage === 'gpu' && !message ? 'none' : 'probe_error'
        result.value.message = view.message ? `${result.value.tcp} / ${result.value.ssh} / ${result.value.gpu}` : null
        await domain.table('probes').put(request.body.id, result.value)
      }
      break
    }
    case 'probes': result = {ok:true, value:Object.fromEntries(domain.table('probes').entries())}; break
    case 'submit': result = await submitJob(deps, state, request.body); break
    case 'recover': await recoverInterruptedJobs(deps); result = await listJobs(deps, {}); break
    case 'jobs': result = await listJobs(deps, {}); break
    case 'observe': {
      const job = domain.table('jobs').get(request.body.id)
      if (!job) throw new Error('Job not found')
      result = {ok: true, value: {job: await durableObserve(deps, job)}}
      break
    }
    case 'log': case 'result': case 'snapshot': case 'cancel': {
      const job = domain.table('jobs').get(request.body.id)
      if (!job) throw new Error('Job not found')
      result = {ok: true, value: await remoteCall(job.spec.server, {...request.body, action: request.action, spec: job.spec})}
      break
    }
    default: throw new Error('Unknown remote action')
  }
  console.log(JSON.stringify(result))
} catch (error) {
  console.log(JSON.stringify({ok:false, error:{message:['group-check','workspace'].includes(request.action) ? String(error.message).slice(0,500) : '远程操作未完成；请检查本机 SSH、主机身份和远端 Linux/Python 环境；任务状态未被推断为失败'}}))
} finally { db.close() }
