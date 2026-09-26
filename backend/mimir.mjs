// JSON/file bridge only; rendering stays in the pinned Mimir modules.
import { readFile, writeFile } from 'node:fs/promises'
import { renderDeck } from '../third_party/mimir/meeting-render.ts'
import { metricFigureSvg } from '../third_party/mimir/metric-figure.ts'
import { chartNameLines, formatMetricValue } from '../third_party/mimir/view-common.ts'
import { Resvg } from '@resvg/resvg-js'

const [input, output] = process.argv.slice(2)
const request = JSON.parse(await readFile(input, 'utf8'))
if (request.kind === 'svg') {
  await writeFile(output, new Resvg(request.svg, { fitTo: { mode: 'width', value: 1600 }, font: { defaultFontFamily: 'Microsoft YaHei' } }).render().asPng())
} else if (request.kind === 'pptx') {
  await renderDeck(request.slides, output, { title: request.title })
} else if (request.kind === 'bar') {
  // Upstream overlaps negative value/category labels, truncates long labels,
  // and rounds to four significant digits.
  // Signal incompatibility so Python can use the existing general plotter.
  if (request.rows.some(row => row.value < 0 || formatMetricValue(row.value).length > 8 || chartNameLines(row.name).join('').includes('…') || Number(formatMetricValue(row.value)) !== row.value)) {
    process.exitCode = 2
  } else {
    const svg = metricFigureSvg(request.title, request.rows)
    await writeFile(output, new Resvg(svg, { fitTo: { mode: 'width', value: 1600 }, font: { defaultFontFamily: 'Microsoft YaHei' } }).render().asPng())
  }
} else {
  throw new Error('Unsupported Mimir rendering request')
}
