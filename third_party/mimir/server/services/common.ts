/** Shared result helpers and job counter for the adapted Mimir services. */

import type {
  ResearchFailure,
  ResearchRejected,
  ResearchSuccess,
} from '../types.ts'

/** Mutable job counter shared by the adapted services. */
export interface ServiceState {
  jobSeq: number
}

/** Build a frozen success branch. */
export function success<T>(value: T): ResearchSuccess<T> {
  return Object.freeze({ ok: true, value })
}

/** Build a frozen business-failure branch. */
export function rejected<E extends ResearchFailure>(error: E): ResearchRejected<E> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}
