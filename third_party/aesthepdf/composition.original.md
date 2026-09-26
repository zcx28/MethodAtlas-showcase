# Capability Composition

Themes are **primary layouts** (genre + audience). Real documents often mix needs from several themes. **Do not re-pick the whole theme for one feature** — compose capabilities instead.

## Decision process

```
1. Primary theme   → document purpose / reader (one pick)
2. Scan content    → what secondary capabilities does the draft need?
3. Layer & override → frontmatter + components; keep primary theme
```

### Step 1 — Primary theme (genre)

| Reader / purpose | Primary theme |
|----------------|---------------|
| 客户方案、建设蓝图、售前 | `proposal` |
| 论文、实验报告、技术报告、教程、学习指南 | `academic` |
| 行业白皮书、深度研究、长文洞察 | `whitepaper` |
| 周报、月报、管理层简报 | `brief` |
| API 文档、操作手册、纯说明书 | `manual` |

Pick **one** based on *what the document is*, not a single subsection.

### Step 2 — Content signals (scan user request + outline)

| Signal in request or draft | Capability needed |
|----------------------------|-------------------|
| 代码、示例、` ``` ` 块、入門、实战、SDK | Syntax-highlighted code |
| 公式、$...$、推导、定理 | MathML formulas |
| KPI、指标卡、环比 | Brief KPI row |
| 时间线、里程碑 | Brief timeline |
| stats、数据亮点、占比 | Whitepaper stats grid |
| lead、pullquote、insight | Whitepaper editorial blocks |
| callout、tag、章节 label | Proposal components |
| API 端点、HTTP method、admonition | Manual API / admonition |

### Step 3 — Layer (do not switch theme blindly)

| Capability | How to enable on **any** primary theme | Theme-locked alternative |
|------------|----------------------------------------|---------------------------|
| Syntax-highlighted code | `code-highlight: true` in frontmatter | `manual` has it by default |
| Custom Pygments style | `syntax-highlighting: breezeDark` | — |
| MathML formulas | `theme: academic` (primary) | — |
| `::: kpis` / `::: timeline` | Primary `brief` | Use markdown table / list in other themes |
| `::: stats` / `::: lead` / `::: insight` | Primary `whitepaper` | Plain prose + tables elsewhere |
| `::: callout` / `{.tag}` | Primary `proposal` | Blockquote / bold list elsewhere |
| `::: api` / `::: admonition` | Primary `manual` | Fenced code + bold **注意** elsewhere |

**Rules:**

1. **Keep the primary theme** when only one *secondary* capability is missing — add frontmatter or plain-markdown fallback.
2. **`code-highlight: true`** whenever the draft has fenced code blocks and primary theme is not `manual`.
3. **Never ship plain unstyled code** if the doc is clearly code-heavy (教程、入門、示例、实现).
4. **Switch primary theme** only when the *main* purpose changes (e.g. API-only doc → `manual`), not because one chapter has code.
5. **Theme-locked `:::` blocks** only work with that theme's Lua filter — do not paste `::: api` into `academic`; use fenced code + `code-highlight: true` instead.

## Hybrid examples (patterns, not exhaustive)

| User intent | Primary | Layer |
|-------------|---------|-------|
| Transformer 原理 + 代码入門 | `academic` | `code-highlight: true` |
| 行业白皮书 + 参考实现代码 | `whitepaper` | `code-highlight: true` |
| 建设方案 + 少量配置示例 | `proposal` | `code-highlight: true` |
| 技术周报 + 关键指标 | `brief` | (native `::: kpis`) |
| 纯 REST API 参考 | `manual` | (native highlight + `::: api`) |
| 学术论文 + 大量公式 | `academic` | (native math) |

## Anti-patterns

| Wrong | Right |
|-------|-------|
| See code → switch entire doc to `manual` | Keep report theme + `code-highlight: true` |
| See formula → paste image of equation | Use `academic` or `$...$` / `$$...$$` |
| Mix `::: api` into non-manual theme | Fenced code block + optional `code-highlight` |
| Accept theme default when content signals a capability | Scan draft and layer overrides before render |

## Frontmatter reference

```yaml
---
theme: academic          # primary layout (required)
code-highlight: true     # manual-grade code on any theme
syntax-highlighting: breezeDark   # optional Pygments style override
cover: false             # skip cover if user wants body only
---
```
