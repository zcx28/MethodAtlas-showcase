// Unmodified source excerpts from Mimir a568b3737819483a8c0f1dbdcbd6f2df93fb5b97; MIT, see LICENSE and README.md.
export const DECK_FONT = 'Microsoft YaHei'
/** One text bullet on a content slide. */
export interface DeckBullet {
  readonly text: string
  /** Emphasis lines render bold/accented (section headers within a slide). */
  readonly emph?: boolean
}

/** The pure slide plan: what each slide shows, before any pptxgenjs call. */
export type DeckSlide =
  | { readonly kind: 'title'; readonly title: string; readonly subtitle: string; readonly imagePath?: string | undefined }
  | { readonly kind: 'agenda'; readonly sections: readonly string[] }
  | { readonly kind: 'bullets'; readonly heading: string; readonly kicker?: string | undefined; readonly bullets: readonly DeckBullet[]; readonly imagePath?: string | undefined }
  | { readonly kind: 'figure'; readonly heading: string; readonly kicker?: string | undefined; readonly imagePath: string; readonly caption: string }
  | { readonly kind: 'closing' }

/* ── pptxgenjs render shell ─────────────────────────────────────────────── */

/* pptxgenjs 4's bundled d.ts (`export as namespace` + `export default`) does
 * not yield a constructable type under nodenext, so renderDeck casts the
 * dynamic import once onto this narrow structural surface — exactly the
 * members the render shell below uses. */

/** Loose option bag — pptxgenjs accepts far more keys than we pass. */
type PptxOptions = Record<string, unknown>

/** One text run inside a rich-text paragraph. */
interface PptxTextRun {
  readonly text: string
  readonly options?: PptxOptions
}

/** The slide surface the render shell draws on. */
interface PptxSlideSurface {
  addText(text: string | readonly PptxTextRun[], options: PptxOptions): void
  addShape(name: 'rect' | 'line', options: PptxOptions): void
  addImage(options: PptxOptions): void
}

/** The deck surface the render shell drives. */
interface PptxDeck {
  layout: string
  defineLayout(layout: { readonly name: string; readonly width: number; readonly height: number }): void
  addSlide(): PptxSlideSurface
  writeFile(options: { readonly fileName: string }): Promise<void>
}

/** Constructor signature of the pptxgenjs default export. */
type PptxDeckCtor = new () => PptxDeck

/** 16:9 canvas metrics (inches). */
const PAGE = { width: 10, height: 5.625 } as const
const ACCENT = '4F7CFF'
const INK = '17233D'
const MUTED = '64748B'
const BG = 'F7F9FC'
const CARD = 'FFFFFF'
const CARD_LINE = 'E2E8F0'

/**
 * Render one slide plan to a pptx file via pptxgenjs. House style: light
 * canvas, accent kicker + divider on content slides, images inside bordered
 * cards, and a footer carrying the deck title + page number.
 * @param slides - the plan from {@link buildDeckModel}.
 * @param outPath - absolute target path (parent must exist).
 * @param meta - footer metadata (deck title).
 * @returns resolution after the file is written.
 */
export async function renderDeck(
  slides: readonly DeckSlide[],
  outPath: string,
  meta: { readonly title?: string | undefined } = {},
): Promise<void> {
  const { default: PptxGenJS } = (await import('pptxgenjs')) as unknown as { default: PptxDeckCtor }
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'W16x9', width: PAGE.width, height: PAGE.height })
  pptx.layout = 'W16x9'

  const footer = (page: PptxSlideSurface, index: number) => {
    if (meta.title !== undefined && meta.title !== '') {
      page.addText(meta.title, { x: 0.6, y: PAGE.height - 0.32, w: 6, h: 0.25, fontFace: DECK_FONT, fontSize: 8, color: MUTED })
    }
    page.addText(`${String(index + 1)} / ${String(slides.length)}`, {
      x: PAGE.width - 1.4, y: PAGE.height - 0.32, w: 0.8, h: 0.25, fontFace: DECK_FONT, fontSize: 8, color: MUTED, align: 'right',
    })
  }
  /** Kicker + heading + accent divider shared by content slides. */
  const header = (page: PptxSlideSurface, kicker: string | undefined, heading: string) => {
    if (kicker !== undefined && kicker !== '') {
      page.addText(kicker, { x: 0.6, y: 0.24, w: PAGE.width - 1.2, h: 0.28, fontFace: DECK_FONT, fontSize: 10, bold: true, color: ACCENT, charSpacing: 2 })
    }
    page.addText(heading, {
      x: 0.6, y: 0.52, w: PAGE.width - 1.2, h: 0.6, fontFace: DECK_FONT, fontSize: 21, bold: true, color: INK,
    })
    page.addShape('line', { x: 0.6, y: 1.14, w: PAGE.width - 1.2, h: 0, line: { color: ACCENT, width: 1.5 } })
  }

  for (const [index, slide] of slides.entries()) {
    const page = pptx.addSlide()
    page.addShape('rect', { x: 0, y: 0, w: PAGE.width, h: PAGE.height, fill: { color: BG } })

    if (slide.kind === 'title') {
      page.addShape('rect', { x: 0, y: 0, w: 0.22, h: PAGE.height, fill: { color: ACCENT } })
      const hasArt = slide.imagePath !== undefined
      page.addText(slide.title, {
        x: 0.9, y: 1.5, w: hasArt ? 4.9 : PAGE.width - 1.8, h: 1.6, fontFace: DECK_FONT,
        fontSize: 30, bold: true, color: INK, align: hasArt ? 'left' : 'center', valign: 'middle',
      })
      page.addText(slide.subtitle, {
        x: 0.9, y: 3.25, w: hasArt ? 4.9 : PAGE.width - 1.8, h: 0.5, fontFace: DECK_FONT,
        fontSize: 13, color: MUTED, align: hasArt ? 'left' : 'center',
      })
      if (hasArt) {
        page.addShape('rect', { x: 6.0, y: 0.6, w: 3.6, h: 4.4, fill: { color: CARD }, line: { color: CARD_LINE, width: 1 } })
        page.addImage({ path: slide.imagePath!, x: 6.15, y: 0.75, w: 3.3, h: 4.1, sizing: { type: 'contain', w: 3.3, h: 4.1 } })
      }
      continue
    }
    if (slide.kind === 'agenda') {
      header(page, 'AGENDA', '目录')
      page.addText(
        slide.sections.flatMap((section, row) => [
          { text: `${String(row + 1).padStart(2, '0')}  `, options: { bold: true, color: ACCENT } },
          { text: section, options: { color: INK, breakLine: true } },
        ]),
        { x: 1.0, y: 1.5, w: 8, h: 3.5, fontFace: DECK_FONT, fontSize: 19, lineSpacing: 40, valign: 'top' },
      )
      footer(page, index)
      continue
    }
    if (slide.kind === 'bullets') {
      header(page, slide.kicker, slide.heading)
      const hasArt = slide.imagePath !== undefined
      page.addText(
        slide.bullets.map(bullet => ({
          text: bullet.text,
          options: { bullet: { code: '2022' }, bold: bullet.emph === true, color: bullet.emph === true ? ACCENT : INK, breakLine: true },
        })),
        { x: 0.8, y: 1.4, w: hasArt ? 5.3 : PAGE.width - 1.6, h: 3.7, fontFace: DECK_FONT, fontSize: 14, lineSpacing: 24, valign: 'top' },
      )
      if (hasArt) {
        page.addShape('rect', { x: 6.3, y: 1.4, w: 3.3, h: 3.7, fill: { color: CARD }, line: { color: CARD_LINE, width: 1 } })
        page.addImage({ path: slide.imagePath!, x: 6.45, y: 1.55, w: 3.0, h: 3.4, sizing: { type: 'contain', w: 3.0, h: 3.4 } })
      }
      footer(page, index)
      continue
    }
    if (slide.kind === 'figure') {
      header(page, slide.kicker, slide.heading)
      page.addShape('rect', { x: 0.6, y: 1.35, w: 5.9, h: 3.8, fill: { color: CARD }, line: { color: CARD_LINE, width: 1 } })
      page.addImage({ path: slide.imagePath, x: 0.78, y: 1.53, w: 5.54, h: 3.44, sizing: { type: 'contain', w: 5.54, h: 3.44 } })
      if (slide.caption !== '') {
        page.addShape('rect', { x: 6.8, y: 1.42, w: 0.05, h: 0.5, fill: { color: ACCENT } })
        page.addText(slide.caption, {
          x: 6.98, y: 1.35, w: 2.6, h: 3.8, fontFace: DECK_FONT, fontSize: 12.5, color: INK, valign: 'top', lineSpacing: 20,
        })
      }
      footer(page, index)
      continue
    }
    // closing
    page.addShape('rect', { x: 0, y: 0, w: 0.22, h: PAGE.height, fill: { color: ACCENT } })
    page.addText('下一步计划', { x: 0.9, y: 1.8, w: PAGE.width - 1.8, h: 0.8, fontFace: DECK_FONT, fontSize: 26, bold: true, color: INK, align: 'center' })
    page.addText('（现场讨论填充）', { x: 0.9, y: 2.8, w: PAGE.width - 1.8, h: 0.5, fontFace: DECK_FONT, fontSize: 14, color: MUTED, align: 'center' })
  }

  await pptx.writeFile({ fileName: outPath })
}
