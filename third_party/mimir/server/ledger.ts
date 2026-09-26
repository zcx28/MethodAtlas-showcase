/**
 * Mimir ledger adaptation: append decision events with bounded payloads and retries.
 * Query/report helpers are omitted; MethodAtlas uses backend/progress.py.
 * Upstream revision and MIT attribution are retained in ../README.md and ../LICENSE.
 */

import type { EventRecord, EventRefs, LedgerActor, LedgerJsonValue } from './types.ts'
import type { ResearchWikiDomain } from './store.ts'

/** Hard cap of one event's serialized payload (the security-style invariant of the ledger). */
export const EVENT_PAYLOAD_MAX_CHARS = 2048

/**
 * Monotonic suffix so same-millisecond events keep a stable order.
 * Module-level mutable state by exemption: a pure same-millisecond sequence
 * number — used only to keep event ordering stable, with no cross-instance
 * correctness impact (an id only needs to be unique and ordered) — so it is
 * not carried in `ServiceState`.
 */
let eventSeq = 0

/** The actor behind every workbench (Remote) call in v1; session identity arrives with P1 SSE work. */
export const PANEL_ACTOR: LedgerActor = Object.freeze({ kind: 'user', id: 'panel' })
/** The actor behind host-driven lifecycle work (job settle, compile bookkeeping). */
export const SERVICE_ACTOR: LedgerActor = Object.freeze({ kind: 'system', id: 'service' })
/** Input to one ledger append (everything except the generated id and ts). */
export interface LedgerEventInput {
  readonly actor: LedgerActor
  readonly action: string
  readonly refs?: EventRefs | undefined
  /** JSON-constrained payload persisted in the events table. */
  readonly payload?: Record<string, LedgerJsonValue> | undefined
  /** Injectable clock (tests); `new Date()` by default. */
  readonly now?: Date | undefined
}

/**
 * Truncate one payload to the ledger's cap: a payload whose JSON form fits
 * passes through unchanged (empty objects stay `{}`); an over-cap payload
 * becomes a marker object carrying the first part of its JSON form.
 * @param payload - the caller's context.
 * @returns a payload whose serialized form never exceeds the cap.
 */
export function truncatePayload(payload: Record<string, LedgerJsonValue>): Record<string, LedgerJsonValue> {
  const json = JSON.stringify(payload) ?? '{}'
  if (json.length <= EVENT_PAYLOAD_MAX_CHARS) return payload
  return Object.freeze({
    _truncated: true,
    preview: json.slice(0, 1024),
  })
}

/**
 * Build one event: the id is `ev-<time36>-<seq36>` (unique across
 * same-millisecond appends; the table key needs only uniqueness, the `ts`
 * field carries the order).
 * @param input - actor, action, refs, payload, and an optional clock.
 * @returns the full event ready to append.
 */
export function newEvent(input: LedgerEventInput): EventRecord {
  const now = input.now ?? new Date()
  eventSeq += 1
  return Object.freeze({
    id: `ev-${now.getTime().toString(36)}-${eventSeq.toString(36)}`,
    ts: now.toISOString(),
    actor: input.actor,
    action: input.action,
    refs: Object.freeze({ ...(input.refs ?? {}) }),
    payload: Object.freeze(truncatePayload(input.payload ?? {})),
  })
}

/**
 * Append one event to the wiki's `events` table.
 * @param domain - the plugin-owned open research-wiki domain.
 * @param input - actor, action, refs, payload, and an optional clock.
 * @returns the stored event (with its generated id/ts).
 */
export async function appendEvent(domain: ResearchWikiDomain, input: LedgerEventInput): Promise<EventRecord> {
  const event = newEvent(input)
  await domain.table('events').put(event.id, event)
  return event
}

/** Transient-failure retry delays for the best-effort append (R28). */
const EMIT_RETRY_DELAYS_MS: readonly number[] = [50, 200]

/**
 * Best-effort append: the call-site contract. A ledger failure is warned
 * and swallowed — the surrounding business operation must never fail
 * because the trail could not be written. Transient storage hiccups get a
 * bounded retry first (R28: a state write whose trail event landed nowhere
 * is unrecoverable from the UI, so "failed once, never retried" is the one
 * outcome this wrapper must not produce; a durable repair protocol stays
 * the planned P2 hardening).
 * @param domain - the plugin-owned open research-wiki domain.
 * @param input - actor, action, refs, payload, and an optional clock.
 */
export async function emitEvent(domain: ResearchWikiDomain, input: LedgerEventInput): Promise<void> {
  for (let attempt = 0; attempt <= EMIT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await appendEvent(domain, input)
      return
    } catch (error) {
      const delay = EMIT_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        console.warn('[mimir] ledger append failed after retries:', error)
        return
      }
      await new Promise(resolve => { setTimeout(resolve, delay) })
    }
  }
}
