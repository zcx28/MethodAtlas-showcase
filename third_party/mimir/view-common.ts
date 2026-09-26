// Unmodified source excerpts from Mimir a568b3737819483a8c0f1dbdcbd6f2df93fb5b97; MIT, see LICENSE and README.md.
export interface MetricChartRow {
  readonly id: string
  readonly name: string
  readonly status: ExperimentStatus
  readonly value: number
}

export interface BarSpan {
  /** Left edge of the bar (0–100). */
  readonly leftPct: number
  /** Width of the bar (0–100). */
  readonly widthPct: number
  /** True for a negative value: the bar extends LEFT of the zero line. */
  readonly negative: boolean
}

/**
 * Bar geometry (percentages) for one chart's values on a ZERO baseline
 * (#220): the lane spans [min(0, values), max(0, values)], so negative bars
 * extend left of the zero line and positive bars right. An all-zero chart
 * yields zero-width bars. Both the panel chart and the exported SVG figure
 * consume this one rule, so they can never disagree.
 */
export function barSpans(values: readonly number[]): BarSpan[] {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo
  if (span <= 0) return values.map(() => ({ leftPct: 0, widthPct: 0, negative: false }))
  return values.map(value => ({
    leftPct: ((Math.min(value, 0) - lo) / span) * 100,
    widthPct: (Math.abs(value) / span) * 100,
    negative: value < 0,
  }))
}

/**
 * Zero-line position (percent of the bar lane) for one chart's values, or
 * null when every value is non-negative (the lane's left edge IS the zero
 * line, which both renderers already draw).
 */
export function zeroLinePct(values: readonly number[]): number | null {
  if (!values.some(value => value < 0)) return null
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo
  return span <= 0 ? null : ((0 - lo) / span) * 100
}

/**
 * Index of a chart's best run under the metric's direction (#220): the
 * smallest value for `min`, the largest for `max`, and null for `none`
 * (unordered metric — no best exists). Ties keep the earliest row.
 */
export function bestRowIndex(rows: readonly MetricChartRow[], direction: MetricDirection): number | null {
  if (direction === 'none' || rows.length === 0) return null
  let best = 0
  rows.forEach((row, index) => {
    const top = rows[best]
    if (top !== undefined && (direction === 'min' ? row.value < top.value : row.value > top.value)) best = index
  })
  return best
}
const CHART_LABEL_LINE_UNITS = 22

/** Half-width-unit width of one code point: CJK/fullwidth glyphs count double. */
function charUnits(char: string): number {
  return /[⺀-鿿豈-﫿＀-￯]/.test(char) ? 2 : 1
}

/**
 * One run name wrapped to at most two chart-label lines so the bar charts stay
 * readable without ellipsizing mid-word. The wrap budget is in half-width
 * units (see {@link CHART_LABEL_LINE_UNITS}); the first line fills greedily
 * and breaks at the last colon or space inside the budget, and a name still
 * too long ellipsizes its second line (the full name rides the SVG `<title>`).
 */
export function chartNameLines(name: string): readonly [string] | readonly [string, string] {
  const chars = [...name]
  const unitsOf = (list: readonly string[]): number =>
    list.reduce((sum, char) => sum + charUnits(char), 0)
  if (unitsOf(chars) <= CHART_LABEL_LINE_UNITS) return [name]
  let units = 0
  let cut = 0
  let boundary = -1
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index] ?? ''
    const next = units + charUnits(char)
    if (next > CHART_LABEL_LINE_UNITS) break
    units = next
    cut = index + 1
    if (char === '：' || char === ':' || char === ' ') boundary = index + 1
  }
  const first = (boundary > 0 ? chars.slice(0, boundary) : chars.slice(0, cut)).join('').trimEnd()
  const restText = chars.slice(boundary > 0 ? boundary : cut).join('').trimEnd()
  let tail = [...restText]
  while (tail.length > 0 && unitsOf(tail) + 1 > CHART_LABEL_LINE_UNITS) tail = tail.slice(0, -1)
  const trimmed = tail.join('').trimEnd()
  return [first, trimmed === restText ? restText : `${trimmed}…`]
}

/**
 * Compact display form of one metric value: strings pass through, integers
 * print as-is, other numbers keep at most four significant digits.
 */
export function formatMetricValue(value: number | string): string {
  if (typeof value === 'string') return value
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(4)))
}

