# academic-research-graph

Source: https://github.com/watericetangcw/academic-research-graph

Pinned revision: `4ac7b913821b5fdf4c1b11bd1025eb8f2f779b23` (MIT; see LICENSE).

Retained verbatim: `academic-research-graph-skill/scripts/render_site.py`,
`scripts/validate_graph.py`, and `schemas/graph.schema.json`. The renderer includes
its SVG engine, search, zoom, pan, node dragging, reset, guides and embedded asset
processing. Unrelated example data, research forms and expansion workflows are
not mounted in the workbench.

`backend/graph.py` validates project/version/evidence membership, calls the pinned
validator and invokes the renderer CLI on normalized data. `backend/graph.js`
adapts the rendered page's controls, node/edge details, keyboard access and host
messages. It uses the upstream layout/render functions, without another engine
or dependency. Model inputs never supply scripts, URLs or resource paths.

Offline HTML embeds the exact material-version extracted text, citations, graph,
guides and application-owned scripts. It has no network dependencies; it does
not claim to be an embedded original PDF or control the workbench reader.

Check: `python -m backend.check_graph`. Deterministic checks validate the interface; generated research requires source review.
