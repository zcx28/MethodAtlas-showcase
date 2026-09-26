# Mimir modules used by MethodAtlas

Source: https://github.com/1692775560/dsh-Mimir-Academic-research
License: MIT; see LICENSE.

The rendering, writing guidance and server modules are pinned to
a568b3737819483a8c0f1dbdcbd6f2df93fb5b97. Experiment services are pinned to
b9c0871a4a3dd2f11296eae189cd45dc2678bb40.

## Included components

- metric-figure.ts: upstream chart renderer, called by backend/mimir.mjs.
- view-common.ts: upstream chart label and number-format helpers.
- meeting-render.ts: upstream slide renderer called through the Node bridge.
- writing-skills.original.ts.txt: original writing guidance used by the
  manuscript adapter. Review and research use MethodAtlas built-in methods.
- server/: adapted OpenSSH and experiment services, event ledger and SQLite
  domain adapter. The pinned upstream revisions identify the source.

MethodAtlas adapters preserve project boundaries, source versions and explicit
confirmation. They replace upstream wiki/storage interfaces with the local
project store; no second application or independent scheduler is installed.

server/transport.mjs and server/remote-runner.py add durable execution, status
recovery and selected-result retrieval. Remote execution needs an independently
configured Linux/Python host. Isolated experiment groups require usable bubblewrap;
no fallback to unrestricted execution is provided.

Node.js >=22.18 runs the TypeScript modules directly. Install the pinned Resvg and
PptxGenJS dependencies with npm ci. Python adapters validate source data, rendering
requests and artifact versions. Charts require actual input data; slide notes
preserve sources. Generated research requires review of the underlying material.
