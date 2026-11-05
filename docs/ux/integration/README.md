# Local preview integration

Integrated the preview worker's delta from snapshot `91b73e5a0f10b8855d6d48ba6ecaa0260250c7af` into the dirty main checkout at `61e27b43188b9b3b753f3fd67275d1158c9986ce`. No baseline merge or Git metadata operation was used. Existing office-expanded, review-highlight, terminal, and multi-workspace changes were preserved.

## Integrated files

- `src/artifacts.ts`: current registered-root authorization, canonical path and symlink checks, private-segment rejection, file-size and image-dimension bounds, and PNG/JPEG/WebP/GIF signature parsing.
- `src/server.ts`: read-only `GET /api/previews`; returns raster bytes with `no-store`, `nosniff`, and restrictive CSP headers.
- `web/format.ts`, `web/app.ts`: safe Markdown links rendered as new-tab anchors. Unsafe schemes stay plain text; inline/fenced code stays literal.
- `tests/artifacts.test.ts`, `tests/core.test.ts`, `tests/format.test.ts`: path, authority, route, and formatter coverage.
- `docs/ux/local-previews/`: worker README, acceptance harness, and screenshots/evidence.

Absolute `.data` runtime worktree paths remain unsupported as documented by the worker. Relative links resolve from the selected workspace; absolute task execution paths are served only when both the task workspace and canonical execution path remain under the selected current root. There is no automatic file opening or model invocation.

## Verification

- `npm run check`: passed.
- Full test suite: after integration, a run passed **64/64**. The later execution-path security patch was followed by a rerun that exposed one outdated fixture expectation; after correcting that fixture, the final full-suite rerun passed **64/64**. Final status: **64 passed, 0 failed**.
- Backend TypeScript and Vite production builds: passed, outputs under `/tmp/local-previews-integration-20261105`.
- Preview browser acceptance: 6/6 passed. The office-expanded example opened as a loaded PNG (1425×1768, HTTP 200), with relative-path and keyboard checks, unsafe-link/code checks, readable missing/forbidden responses, and no page errors.
- Office-expanded browser regression: 7/7 passed at 1440, 390, and 320 px; 320 px document width stayed 320 px.
- Review-highlight regression: count 2, status transition to count 1, correct detail, and 320 px document width 305 px.
- Agent-workspace toolbar control remains in the desktop capture and source. Terminal remains monospace 13 px, with its ANSI 0–15 palette and retry control; ANSI 16–255 and RGB remain supplied by the shell.

Logs and browser screenshots/check records are in `evidence/`. Build/test output logs are isolated; evidence PNGs are local browser fixtures, not live captures.

## Scoped rollback

Before editing, selected main files were copied under `/tmp/local-previews-main-backup-20261105`; their SHA-256 values and original HEAD are recorded in `evidence/main-before.sha256.txt`. To roll back only this integration, restore `src/server.ts`, `web/app.ts`, `web/format.ts`, `tests/core.test.ts`, and `tests/format.test.ts` from that backup. `web/format.ts` existed in main before integration and must be restored, never removed. Then remove only integration-added `src/artifacts.ts`, `tests/artifacts.test.ts`, and `docs/ux/local-previews/`. Keep all unrelated dirty files. The original local-previews docs folder was absent; the new local-previews and integration docs/evidence were added by this task.

No changes were staged or committed. Nothing was deployed, published, or activated in the live application.

## Realtime chat analysis (docs only)

The analysis artifacts from the analyst worktree are copied to [docs/ux/chat-realtime/ANALYSIS.md](/home/ricii/gabut/orchestrator-agent/docs/ux/chat-realtime/ANALYSIS.md), with the [five-scenario runtime evidence](/home/ricii/gabut/orchestrator-agent/docs/ux/chat-realtime/runtime-evidence.json), reproduction harness, and screenshots. The copied folder contains only analysis artifacts; no source changes were copied from that worktree. A filename/content scan found no private credentials or captured user payloads. The harness uses temporary fixtures and fake adapters; it was not rerun during this copy.

The fixture reproduced healthy SSE receive-to-DOM at 16 ms, state polling that does not catch up missed text, replay text rejected behind a newer cached non-text ID, a half-open stale stream, and successful recovery after a closed-stream reconnect. Hidden/visible was synthetic. These reproduce mechanisms only; the user's incident root cause remains unproven.

Realtime chat is not fixed by this preview integration. Analysis was completed first; the now-authorized realtime fix task `95a52...` is being handled separately in its own worktree. This integration did not modify the SSE, reconnect, cache, or source paths. Review-highlight worker deliverables were already integrated and regression checked above; no additional source rewrite was made for its final docs.
