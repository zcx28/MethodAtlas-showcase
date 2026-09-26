/**
 * Mimir server adaptation: server CRUD/probes and durable remote job submission.
 * The remote supervisor owns execution; this bridge only submits and observes.
 * Pinned upstream source and MIT attribution are documented in ../../README.md and ../../LICENSE.
 */

import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { sshArgs, probeTarget, durableSubmit } from '../transport.mjs'
import { emitEvent, PANEL_ACTOR } from '../ledger.ts'
import { isActiveJobStatus } from '../job-lifecycle.ts'
import type { ResearchWikiDomain } from '../store.ts'
import type {
  ExperimentStatus,
  JobRecord,
  ResearchCheckServerResult,
  ResearchDeleteServerResult,
  ResearchListJobsResult,
  ResearchListServersResult,
  ResearchSaveServerResult,
  ResearchSubmitJobResult,
  ServerGpuView,
  ServerInput,
  ServerRecord,
  ServerStatusView,
} from '../types.ts'
import { rejected, success } from './common.ts'
import type { ServiceState } from './common.ts'

/** Everything the Server domain functions need from the service scope. */
export interface ServerDeps {
  readonly domain: ResearchWikiDomain
}

/** TCP reachability probe timeout; part of the checkServer probe contract. */
const TCP_PROBE_TIMEOUT_MS = 4000
/** Timeout of the best-effort ssh `nvidia-smi` readout. */
const GPU_PROBE_TIMEOUT_MS = 8000
/** The remote command whose CSV output feeds the GPU table. */
const NVIDIA_SMI_QUERY = 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits'

/** Hard cap of one submitted command line (the durable record stores it verbatim). */
const JOB_COMMAND_MAX_CHARS = 4000
const execFileAsync = promisify(execFile)

/** Outcome of one TCP reachability probe. */
type TcpProbeOutcome =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly message: string }

/**
 * Connect to `host:port` once, measuring the handshake latency. The probe
 * never throws: every failure mode (refused, unreachable, timed out) settles
 * as the `ok: false` branch carrying the socket's own message.
 * @param host - server host name or address.
 * @param port - server TCP port.
 * @returns the connected latency, or the failure message.
 */
function probeTcp(host: string, port: number): Promise<TcpProbeOutcome> {
  return new Promise<TcpProbeOutcome>((settle) => {
    const startedAt = Date.now()
    let done = false
    const socket = connect({ host, port })
    const finish = (outcome: TcpProbeOutcome): void => {
      if (done) return
      done = true
      socket.destroy()
      settle(outcome)
    }
    socket.once('connect', () => { finish({ ok: true, latencyMs: Date.now() - startedAt }) })
    socket.once('error', (error) => { finish({ ok: false, message: error.message }) })
    socket.setTimeout(TCP_PROBE_TIMEOUT_MS, () => {
      finish({ ok: false, message: `tcp connect timed out after ${String(TCP_PROBE_TIMEOUT_MS)}ms` })
    })
  })
}

/** Outcome of the best-effort GPU readout over ssh. */
type GpuProbeOutcome =
  | { readonly ok: true; readonly gpus: readonly ServerGpuView[] }
  | { readonly ok: false; readonly stage: 'ssh' | 'gpu'; readonly message: string }

/**
 * Read one server's GPU table over a batch-mode ssh call. Best-effort: an ssh
 * or `nvidia-smi` failure is the `ok: false` branch, never a rejection, so the
 * caller can still report the server itself as reachable.
 * @param record - the server to probe (host, port, and login user).
 * @returns the parsed GPU rows, or the failure stage (`ssh` session vs `gpu`
 * readout) plus the failure message.
 */
async function probeGpus(record: ServerRecord): Promise<GpuProbeOutcome> {
  try {
    const { stdout } = await execFileAsync('ssh', [...sshArgs(record), NVIDIA_SMI_QUERY], { timeout: GPU_PROBE_TIMEOUT_MS })
    const gpus: ServerGpuView[] = []
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const [name, utilizationPct, memoryUsedMb, memoryTotalMb] = trimmed.split(',').map(field => field.trim())
      if (!name || [utilizationPct, memoryUsedMb, memoryTotalMb].some(v => v === undefined || v === '' || !Number.isFinite(Number(v)))) throw new Error('invalid GPU probe response')
      gpus.push({
        name: name ?? '',
        utilizationPct: Number(utilizationPct),
        memoryUsedMb: Number(memoryUsedMb),
        memoryTotalMb: Number(memoryTotalMb),
      })
    }
    return { ok: true, gpus: Object.freeze(gpus) }
  } catch (error) {
    // execFile failures carry the child's stderr; prefer it over the generic
    // "Command failed" wrapper so the panel shows the ssh client's own words.
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr).trim()
      : ''
    const message = stderr !== '' ? stderr : error instanceof Error ? error.message : 'ssh probe failed'
    // Stage classification: the ssh client exits 255 when the SESSION itself
    // failed (connect, auth, or the connect timeout); any other exit code is
    // the remote command's own status, and a timeout kill / spawn error only
    // surfaces after the 8s budget — past the 5s connect window — so both
    // land on the `gpu` stage.
    const code = (error as { code?: unknown }).code
    if (typeof code === 'number' && code !== 255 && /No devices were found/i.test(message)) return {ok: true, gpus: []}
    return { ok: false, stage: code === 255 || typeof code !== 'number' ? 'ssh' : 'gpu', message }
  }
}

/**
 * Character whitelist for the ssh login user / host: anything else
 * (whitespace, shell punctuation) is rejected, and a leading dash would make
 * the `user@host` argument look like an ssh option even under execFile.
 */
const SSH_TOKEN_RE = /^[a-zA-Z0-9._:-]+$/
const SSH_USERNAME_RE = /^[a-zA-Z0-9._-]+$/

/** First invalid-input message for one server upsert payload, or null when valid. */
function validateServerInput(input: ServerInput): string | null {
  if (input.name.trim().length === 0) return 'name must be non-empty'
  if (input.host.trim().length === 0) return 'host must be non-empty'
  if (input.host.startsWith('-') || !SSH_TOKEN_RE.test(input.host)) {
    return 'host must be a plain hostname or IP (letters, digits, dots, dashes, colons)'
  }
  if (input.username !== undefined && input.username.trim() !== ''
    && (input.username.startsWith('-') || !SSH_USERNAME_RE.test(input.username))) {
    return 'username must be a plain ssh login user (letters, digits, dots, dashes, underscores)'
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'port must be an integer between 1 and 65535'
  }
  return null
}

/**
 * List every remembered compute server, most recently updated first.
 * @param deps - open wiki domain.
 * @returns the server cards for the panel's servers view.
 */
export function listServers(deps: ServerDeps): Promise<ResearchListServersResult> {
  const servers = [...deps.domain.table('servers').entries()]
    .map(([, record]) => record)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return Promise.resolve(success({ servers: Object.freeze(servers) }))
}

/**
 * Upsert one compute server. An `id` in the payload selects the update form
 * (the existing record's `createdAt` survives; `updatedAt` refreshes); its
 * absence creates a record with a generated id. Name and host must be
 * non-empty and the port a valid TCP port — violations are `invalid-input`,
 * an unknown update id is `server-not-found`. A present `tags` list is
 * trimmed, emptied out, and deduped before it replaces the record's tags;
 * an omitted list keeps them.
 * @param deps - open wiki domain.
 * @param request - the server fields, with `id` marking the update form.
 * @returns the stored record.
 */
export async function saveServer(
  deps: ServerDeps,
  request: { server: ServerInput },
): Promise<ResearchSaveServerResult> {
  const input = request.server
  const invalid = validateServerInput(input)
  if (invalid !== null) return rejected({ code: 'invalid-input', message: invalid })
  const table = deps.domain.table('servers')
  const now = new Date().toISOString()
  // Tags are trimmed, emptied out, and deduped (the updatePaper cleaning).
  const tags = input.tags === undefined
    ? undefined
    : [...new Set(input.tags.map(tag => tag.trim()).filter(tag => tag !== ''))]
  if (input.id !== undefined) {
    const existing = table.get(input.id)
    if (existing === undefined) return rejected({ code: 'server-not-found', id: input.id })
    const next: ServerRecord = {
      ...existing,
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      note: input.note,
      tags: tags ?? existing.tags,
      updatedAt: now,
    }
    await table.put(input.id, next)
    await emitEvent(deps.domain, {
      actor: PANEL_ACTOR,
      action: 'compute.server.saved',
      refs: { serverId: next.id },
      payload: { name: next.name, host: next.host, created: false },
    })
    return success({ server: next })
  }
  const created: ServerRecord = {
    id: `srv-${randomUUID()}`,
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    note: input.note,
    tags: tags ?? [],
    createdAt: now,
    updatedAt: now,
  }
  await table.put(created.id, created)
  await emitEvent(deps.domain, {
    actor: PANEL_ACTOR,
    action: 'compute.server.saved',
    refs: { serverId: created.id },
    payload: { name: created.name, host: created.host, created: true },
  })
  return success({ server: created })
}

/**
 * Delete one remembered server; an unknown id is `server-not-found`.
 * @param deps - open wiki domain.
 * @param request - the record id.
 * @returns the deleted id.
 */
export async function deleteServer(
  deps: ServerDeps,
  request: { id: string },
): Promise<ResearchDeleteServerResult> {
  const table = deps.domain.table('servers')
  const removed = table.get(request.id)
  if (removed === undefined) {
    return rejected({ code: 'server-not-found', id: request.id })
  }
  await table.delete(request.id)
  await emitEvent(deps.domain, {
    actor: PANEL_ACTOR,
    action: 'compute.server.deleted',
    refs: { serverId: removed.id },
    payload: { name: removed.name, destructive: true },
  })
  return success({ id: request.id })
}

/**
 * Probe one remembered server. The probe is two best-effort stages: a TCP
 * connect (failure settles the view `offline`), then — only when the TCP
 * probe connected and the record names a login user — a batch-mode ssh
 * `nvidia-smi` readout whose failure downgrades the GPU table to empty
 * without flipping the state. The settled view reports the stage where the
 * probe stopped (`stage`: the failed stage on failure, the deepest completed
 * stage on success) and the per-stage latencies (`tcpLatencyMs`,
 * `gpuLatencyMs`) so the panel can say which stage hung or failed.
 * @param deps - open wiki domain.
 * @param request - the record id; an unknown id is `server-not-found`.
 * @returns the settled probe view.
 */
export async function checkServer(
  deps: ServerDeps,
  request: { id: string },
): Promise<ResearchCheckServerResult> {
  const record = deps.domain.table('servers').get(request.id)
  if (record === undefined) {
    return rejected({ code: 'server-not-found', id: request.id })
  }
  const target = await probeTarget(record)
  const tcp = await probeTcp(target.host, target.port)
  if (!tcp.ok) {
    return success<ServerStatusView>({
      state: 'offline',
      latencyMs: null,
      gpus: Object.freeze([]),
      checkedAt: new Date().toISOString(),
      message: tcp.message,
      stage: 'tcp',
    })
  }
  // MethodAtlas: an omitted user uses existing OpenSSH configuration.
  const gpuStartedAt = Date.now()
  const gpu = await probeGpus(record)
  return success<ServerStatusView>({
    state: 'online',
    latencyMs: tcp.latencyMs,
    gpus: gpu.ok ? gpu.gpus : Object.freeze([]),
    checkedAt: new Date().toISOString(),
    message: gpu.ok ? null : `gpu probe failed: ${gpu.message}`,
    stage: gpu.ok ? 'gpu' : gpu.stage,
    tcpLatencyMs: tcp.latencyMs,
    gpuLatencyMs: Date.now() - gpuStartedAt,
  })
}

/** Mark previously active jobs unknown until the remote supervisor is observed. */
export async function recoverInterruptedJobs(deps: ServerDeps): Promise<void> {
  const jobs = deps.domain.table('jobs')
  for (const [, job] of jobs.entries()) {
    if (isActiveJobStatus(job.status)) await jobs.put(job.id, {...job, status: 'unknown', exitCode: null})
  }
}

/** Validate and persist one job, then submit idempotently to the remote supervisor. */
export async function submitJob(
  deps: ServerDeps,
  state: ServiceState,
  request: {
    serverId: string
    command: string
    experimentId?: string | undefined
    jobId?: string
    spec?: object
  },
): Promise<ResearchSubmitJobResult> {
  const server = deps.domain.table('servers').get(request.serverId)
  if (server === undefined) {
    return rejected({ code: 'server-not-found', id: request.serverId })
  }
  const existing = deps.domain.table('jobs').get(request.jobId)
  if (existing) return success({ job: await durableSubmit(deps, existing) })
  const command = request.command.trim()
  if (command === '') return rejected({ code: 'invalid-input', message: 'command must be non-empty' })
  if (command.length > JOB_COMMAND_MAX_CHARS) {
    return rejected({ code: 'invalid-input', message: `command must be at most ${String(JOB_COMMAND_MAX_CHARS)} characters` })
  }
  if (request.experimentId !== undefined
    && deps.domain.table('experiments').get(request.experimentId) === undefined) {
    return rejected({ code: 'experiment-not-found', id: request.experimentId })
  }
  state.jobSeq += 1
  const job: JobRecord = {
    id: request.jobId ?? `job-${Date.now().toString(36)}-${String(state.jobSeq)}`,
    spec: request.spec,
    serverId: server.id,
    command,
    status: 'queued',
    // Absent, never `undefined`: an explicit undefined key would pollute the
    // stored record and trip the gateway's JSON boundary validation.
    ...(request.experimentId === undefined ? {} : { experimentId: request.experimentId }),
    exitCode: null,
    stdoutTail: '',
    stderrTail: '',
    createdAt: new Date().toISOString(),
  }
  await deps.domain.table('jobs').put(job.id, job)
  if (request.experimentId !== undefined) {
    await markExperiment(deps, request.experimentId, 'running', server.id)
  }
  await emitEvent(deps.domain, {
    actor: PANEL_ACTOR,
    action: 'compute.job.submitted',
    refs: {
      jobId: job.id,
      serverId: server.id,
      ...(request.experimentId === undefined ? {} : { experimentId: request.experimentId }),
    },
    payload: { command: command.slice(0, 200) },
  })
  return success({ job: await durableSubmit(deps, job) })
}

/**
 * List submitted remote jobs, most recently submitted first, optionally
 * filtered to one server (an unknown id is `server-not-found`). This is
 * the panel's polling read.
 * @param deps - open wiki domain.
 * @param request - the optional server filter.
 * @returns the job rows.
 */
export function listJobs(
  deps: ServerDeps,
  request: { serverId?: string },
): Promise<ResearchListJobsResult> {
  if (request.serverId !== undefined
    && deps.domain.table('servers').get(request.serverId) === undefined) {
    return Promise.resolve(rejected({ code: 'server-not-found', id: request.serverId }))
  }
  const jobs = [...deps.domain.table('jobs').entries()]
    .map(([, record]) => record)
    .filter(record => request.serverId === undefined || record.serverId === request.serverId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return Promise.resolve(success({ jobs: Object.freeze(jobs) }))
}

/**
 * Flip one linked experiment's status, linking the server on submit; a
 * deleted experiment is skipped.
 * @param deps - open wiki domain.
 * @param experimentId - the experiment record id.
 * @param status - the next lifecycle status.
 * @param serverId - the executing server, set on the submit flip only.
 */
async function markExperiment(
  deps: ServerDeps,
  experimentId: string,
  status: ExperimentStatus,
  serverId?: string,
): Promise<void> {
  const table = deps.domain.table('experiments')
  const existing = table.get(experimentId)
  if (existing === undefined) return
  await table.put(experimentId, {
    ...existing,
    status,
    serverId: serverId ?? existing.serverId,
    updatedAt: new Date().toISOString(),
  })
}
