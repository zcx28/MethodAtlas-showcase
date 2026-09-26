---
name: aesthepdf
description: >-
  Renders styled PDFs from Markdown via AesthePDF (Pandoc + Playwright).
  Five themes as primary layouts; capabilities (code highlight, math, KPIs, etc.)
  can be composed via frontmatter — do not switch theme for one feature alone.
  Use when the user asks to generate, render, or export a styled PDF with
  AesthePDF, or mentions 方案, 论文, 白皮书, 简报, 手册, 教程, aesthepdf skill.
---

# AesthePDF

Turn Markdown into **theme-styled PDFs**. Always **write Markdown → run `render.py` → deliver PDF path**. Never hand-write PDF bytes or ad-hoc HTML.

## Output directory (required)

**Never** write generated `.md` or `.pdf` files to the workspace root or the skill folder.

Always use a dedicated output folder at the **workspace (project) root**:

```
<workspace-root>/aesthepdf_output/
├── report.md
└── report.pdf
```

1. Create `aesthepdf_output/` if it does not exist (`mkdir -p aesthepdf_output` or equivalent).
2. Save drafted Markdown as `aesthepdf_output/{slug}.md`.
3. Render PDF to `aesthepdf_output/{slug}.pdf` (same basename as the `.md`).
4. Tell the user the path under `aesthepdf_output/`.

Use a short `{slug}` from the document title (e.g. `dl-report`, `weekly-brief`).

## Agent workflow

When the user asks for a styled PDF via AesthePDF (natural language or explicit skill invocation):

```
Task Progress:
- [ ] Step 1: Pick primary theme (document genre)
- [ ] Step 2: Scan content signals; layer capabilities (see composition.md)
- [ ] Step 3: Ensure dependencies (once per session)
- [ ] Step 4: Create `aesthepdf_output/` and draft Markdown
- [ ] Step 5: Render with render.py
- [ ] Step 6: Confirm PDF path; offer tweaks
```

### Step 1: Primary theme

Choose **one** theme by **document purpose / reader** — not by a single feature (code, formula, KPI, etc.).

| User says… | Primary theme | Sample |
|------------|---------------|--------|
| 方案 / 建设蓝图 / 售前 | `proposal` | `templates/eam-sample.md` |
| 论文 / 报告 / 教程 / 学习指南 / 含公式 | `academic` | `templates/academic-sample.md` |
| 白皮书 / 行业研究 / 深度长文 | `whitepaper` | `templates/whitepaper-sample.md` |
| 周报 / 月报 / 简报 | `brief` | `templates/brief-sample.md` |
| API 文档 / 纯操作手册 | `manual` | `templates/manual-sample.md` |

### Step 2: Capability composition (required for mixed docs)

Real requests are often hybrid. **Do not solve hybrids by switching theme** — compose capabilities on top of the primary theme.

**Process:** primary theme → scan draft for secondary needs → layer frontmatter / components.

| Common signal | Action |
|---------------|--------|
| Fenced code / 示例 / 入門 / 实战 | Add `code-highlight: true` (unless primary is `manual`) |
| Formulas | Primary `academic` + `$...$` / `$$...$$` |
| Theme-specific `:::` blocks | Use only when primary theme supports them (see [composition.md](composition.original.md)) |

Full decision tree, hybrid patterns, and anti-patterns: **[composition.md](composition.original.md)**.

**Quick rule:** report/tutorial layout + code → `academic` + `code-highlight: true`; whitepaper + code → `whitepaper` + `code-highlight: true`; never plain unstyled code in code-heavy docs.

### Step 3: Dependencies

Run once if missing:

```bash
pip install -r scripts/requirements.txt
python -m playwright install chromium
```

Requires **pandoc 3.x** on PATH. Verify: `python scripts/render.py --list-themes`

### Step 4: Draft Markdown

1. Ensure **`aesthepdf_output/`** exists at the workspace root.
2. Set YAML: `theme`, `cover-title`, `document-title`, `lang: zh-CN`; add capability flags per [composition.md](composition.original.md) (e.g. `code-highlight: true`).
3. Use **`## Title {.section-header label="…"}`** for every chapter. The active chapter title becomes that page's right-aligned running header; override it with `page-header="Short label"` when needed.
4. Pull component patterns from matching `templates/*-sample.md` and examples.md (upstream reference).
5. Save as **`aesthepdf_output/{slug}.md`** only.

**Academic minimum frontmatter:**

```yaml
---
theme: academic
cover-title: 基于深度学习的……技术报告
subtitle: 一句话副标题
doc-authors: 作者
doc-institution: 单位
doc-date: 2026.07
document-title: 文档页眉标题
lang: zh-CN
---
```

### Step 5: Render

From the workspace root (or use absolute paths):

```bash
python <skill-dir>/scripts/render.py aesthepdf_output/{slug}.md -o aesthepdf_output/{slug}.pdf --theme academic
```

`<skill-dir>` is wherever you installed `aesthepdf/` (user or project skills directory).

Style reference (writes into skill cwd — for inspection only):

```bash
python scripts/render.py templates/academic-sample.md -o /tmp/academic-sample.pdf --theme academic
```

### Step 6: Deliver

Tell the user the PDF path: **`aesthepdf_output/{slug}.pdf`**. If layout is off, edit the `.md` in the same folder or `themes/<id>/style.css`, then re-render.

## Pipeline (do not bypass)

```
Markdown + theme.json
  → Pandoc (math/highlight/lua filters per theme)
  → HTML + themes/<id>/style.css + assets/template.html
  → scripts/render.py (Chromium print)
  → PDF
```

**Do not** use ReportLab, fpdf, or Pandoc default PDF styling.

## Theme capabilities

| ID | 名称 | 独有能力 |
|----|------|----------|
| `proposal` | 方案建议书 | callout、tag、英中 label 章节 |
| `academic` | 学术报告 | MathML 公式、abstract、figure；+ `code-highlight: true` for manual-style code |
| `manual` | 产品手册 | 语法高亮、api 块、admonition |
| `whitepaper` | 白皮书 | lead、stats、pullquote、insight |
| `brief` | 执行简报 | KPI 卡片、timeline、action |

All five themes default to **cover + TOC** unless `--no-toc` or `cover: false`.

## CLI

```bash
python scripts/render.py --list-themes
python scripts/render.py aesthepdf_output/doc.md -o aesthepdf_output/doc.pdf --theme academic
```

| Flag | Purpose |
|------|---------|
| `--theme ID` | Theme (`proposal` default) |
| `-o PATH` | Output PDF |
| `--no-toc` | Skip table of contents |
| `--title TEXT` | Override header/footer document title |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Empty TOC | Chapters must use `## … {.section-header}` |
| TOC missing page numbers | Re-render with current `render.py`; page nums are filled from a pagination probe |
| `pandoc not found` | Install pandoc 3.x |
| Playwright errors | `pip install -r scripts/requirements.txt` && `python -m playwright install chromium` |
| Fonts wrong | Files must stay in `fonts/` (bundled with skill) |
| Code blocks plain / no colors | Add `code-highlight: true`; see [composition.md](composition.original.md) |
| Wrong theme for hybrid doc | Re-read composition: primary theme + layer, don't switch for one feature |
| Files in wrong place | All user `.md`/`.pdf` must be under `aesthepdf_output/` at workspace root |

## File map

```
aesthepdf/                  ← skill root (copy this folder)
├── SKILL.md
├── composition.md        # Hybrid docs: capability layering rules
├── examples.md
├── reference.md
├── themes/<id>/            # theme.json + style.css
├── assets/                 # base.css, code-blocks.css, template.html, filters/*.lua
├── fonts/                  # bundled fonts
├── templates/*-sample.md
└── scripts/render.py
```

## Additional resources

- [composition.md](composition.original.md) — **hybrid / mixed-capability docs**
- themes/README.md (upstream reference)
- examples.md (upstream reference)
- reference.md (upstream reference)
