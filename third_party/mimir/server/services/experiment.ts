// Direct Mimir experiment CRUD excerpt at b9c0871; full source beside this file.
// Adaptations: imports avoid unrelated figure dependencies; caller-owned IDs. Durable job states remain in the existing job store.
import { emitEvent, PANEL_ACTOR } from '../ledger.ts'
import { rejected, success } from './common.ts'
import { randomUUID } from 'node:crypto'
import type { ResearchWikiDomain } from '../store.ts'
import type { ExperimentInput, ExperimentRecord, ResearchExperimentsResult, ResearchSaveExperimentResult } from '../types.ts'
import type { ServiceState } from './common.ts'
interface ExperimentDeps { readonly domain: ResearchWikiDomain }
function nextRecordId(state: ServiceState & {recordId?: string}, prefix: string) { return state.recordId ?? `${prefix}-${randomUUID()}` }
/** Legal experiment statuses, for the runtime guard (remote callers bypass the type). */
const EXPERIMENT_STATUSES: readonly string[] = ['running', 'success', 'failed']

/** Legal metric directions, for the runtime guard (#220). */
const METRIC_DIRECTIONS: readonly string[] = ['min', 'max', 'none']

/** First invalid-input message for one experiment upsert payload, or null when valid. */
function validateExperimentInput(input: ExperimentInput): string | null {
  if (input.name.trim().length === 0) return 'name must be non-empty'
  // Widened to string so the runtime guard is not linted away.
  const rawStatus: string = input.status
  if (!EXPERIMENT_STATUSES.includes(rawStatus)) return `unknown status: ${rawStatus}`
  if (typeof input.metrics !== 'object' || input.metrics === null || Array.isArray(input.metrics)) {
    return 'metrics must be an object keyed by metric name'
  }
  for (const [key, value] of Object.entries(input.metrics)) {
    if (key.trim().length === 0) return 'metrics keys must be non-empty'
    if (typeof value !== 'number' && typeof value !== 'string') return `metrics.${key} must be a number or a string`
  }
  if (input.metricDirections !== undefined) {
    if (typeof input.metricDirections !== 'object' || input.metricDirections === null
      || Array.isArray(input.metricDirections)) {
      return 'metricDirections must be an object keyed by metric name'
    }
    for (const [key, direction] of Object.entries(input.metricDirections)) {
      if (key.trim().length === 0) return 'metricDirections keys must be non-empty'
      if (!METRIC_DIRECTIONS.includes(direction)) return `metricDirections.${key} must be min, max, or none`
      if (!(key in input.metrics)) return `metricDirections.${key} has no matching metric`
    }
  }
  return null
}

/**
 * List experiment runs, filtered to one project when `projectId` is given.
 * @param deps - open wiki domain.
 * @param request - optional project filter; an unknown id is `project-not-found`.
 * @returns the experiment rows, most recently updated first.
 */
export function listExperiments(
  deps: ExperimentDeps,
  request: { projectId?: string },
): Promise<ResearchExperimentsResult> {
  if (request.projectId !== undefined
    && deps.domain.table('projects').get(request.projectId) === undefined) {
    return Promise.resolve(rejected({ code: 'project-not-found', projectId: request.projectId }))
  }
  const experiments = [...deps.domain.table('experiments').entries()]
    .map(([, record]) => record)
    .filter(record => request.projectId === undefined || record.projectId === request.projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return Promise.resolve(success({ experiments: Object.freeze(experiments) }))
}

/**
 * Upsert one experiment record (the panel's inline create/edit form).
 * `projectId` must name a wiki project (`project-not-found`); the name
 * must be non-empty, the status one of running/success/failed, and a
 * given `serverId` must name a remembered server (`invalid-input`). An
 * omitted `id` creates with a fresh `exp-` id; a given `id` must exist
 * (`experiment-not-found`) and replaces the mutable fields. An omitted
 * `logPath`/`serverId` is ABSENT from the record (never an
 * undefined-valued key — the gateway's JSON-safety pass rejects those),
 * and on update preserves the stored value (the form does not edit
 * logPath). Either way `updatedAt` refreshes — ExperimentRecord carries no
 * createdAt.
 * @param deps - open wiki domain.
 * @param state - per-instance counters backing the collision-safe id.
 * @param request - the full-field payload.
 * @returns the stored record after the upsert.
 */
export async function saveExperiment(
  deps: ExperimentDeps,
  state: ServiceState,
  request: { experiment: ExperimentInput },
): Promise<ResearchSaveExperimentResult> {
  const input = request.experiment
  if (deps.domain.table('projects').get(input.projectId) === undefined) {
    return rejected({ code: 'project-not-found', projectId: input.projectId })
  }
  const invalid = validateExperimentInput(input)
  if (invalid !== null) return rejected({ code: 'invalid-input', message: invalid })
  if (input.serverId !== undefined
    && deps.domain.table('servers').get(input.serverId) === undefined) {
    return rejected({ code: 'invalid-input', message: `unknown server: ${input.serverId}` })
  }
  const table = deps.domain.table('experiments')
  const now = new Date().toISOString()
  if (input.id !== undefined) {
    const existing = table.get(input.id)
    if (existing === undefined) return rejected({ code: 'experiment-not-found', id: input.id })
    const next: ExperimentRecord = {
      ...existing,
      projectId: input.projectId,
      name: input.name,
      status: input.status,
      metrics: input.metrics,
      // `...existing` preserves the stored directions; a provided map
      // replaces (the form always sends the full map, so removals stick) (#220).
      ...(input.metricDirections === undefined ? {} : { metricDirections: input.metricDirections }),
      ...(input.logPath === undefined ? {} : { logPath: input.logPath }),
      ...(input.serverId === undefined ? {} : { serverId: input.serverId }),
      updatedAt: now,
    }
    await table.put(input.id, next)
    await emitEvent(deps.domain, {
      actor: PANEL_ACTOR,
      action: 'experiments.saved',
      refs: {
        experimentId: next.id, projectId: next.projectId,
        ...(next.serverId === undefined ? {} : { serverId: next.serverId }),
      },
      payload: { name: next.name, status: next.status, created: false, metricCount: Object.keys(next.metrics).length },
    })
    return success({ experiment: next })
  }
  const created: ExperimentRecord = {
    id: nextRecordId(state, 'exp'),
    projectId: input.projectId,
    name: input.name,
    status: input.status,
    metrics: input.metrics,
    ...(input.metricDirections === undefined ? {} : { metricDirections: input.metricDirections }),
    ...(input.logPath === undefined ? {} : { logPath: input.logPath }),
    ...(input.serverId === undefined ? {} : { serverId: input.serverId }),
    updatedAt: now,
  }
  await table.put(created.id, created)
  await emitEvent(deps.domain, {
    actor: PANEL_ACTOR,
    action: 'experiments.saved',
    refs: {
      experimentId: created.id, projectId: created.projectId,
      ...(created.serverId === undefined ? {} : { serverId: created.serverId }),
    },
    payload: { name: created.name, status: created.status, created: true, metricCount: Object.keys(created.metrics).length },
  })
  return success({ experiment: created })
}
