# Realtime transcript integration

Integrated the final realtime delta from worktree `95a52ba6-d2eb-4ce8-952d-4f681d93d27f`, based on snapshot `91b73e5a0f10b8855d6d48ba6ecaa0260250c7af`, into the current dirty main source. Only realtime hunks were applied to existing files; the preview, office expansion, review highlight, terminal, and multi-workspace changes were retained. The separate diagnosis remains in `docs/ux/chat-realtime/`; the source delta and its fixtures remain in `docs/ux/chat-realtime-fix/`.

## Integrated behavior

- Raw transcript events are merged immutably by per-task event ID, including out-of-order replay. Live cache bounds are 300 events and 24,000 text characters; adjacent text chunks are combined at render time.
- The additive task-scoped `GET /api/tasks/:id/events?sync=1` returns `{after}` at the latest created/user/turn/final-message boundary. Existing `tail=1`, `before=`, and `after=` behavior remains available. The frontend catches up in pages of at most 500, advancing only on successful task-scoped pages.
- Catch-up runs on selected task/workspace, visible five-second polling, stream recovery, and visible-tab return. Hidden tabs do not poll. SSE readers are aborted and serialized across visibility restarts. No prompt is resent and no provider resume is triggered.
- Final messages suppress only preceding deltas in their turn; tool events and later turns remain in order.

## Verification record

Validation on the integrated main source:

- `npm run check` passed.
- `npm test` passed: 68 tests, including the three added cache/render tests and pagination/sync-boundary route coverage.
- Isolated backend TypeScript output: `npx tsc --outDir /tmp/orchestrator-realtime-backend --declaration false`; isolated Vite output: `npx vite build --outDir /tmp/orchestrator-realtime-vite --emptyOutDir`.
- `node --import tsx docs/ux/chat-realtime-fix/repro.mjs`: all 8 browser scenarios passed (2 ms emit-to-receive, 7 ms receive-to-DOM in this fixture; max one active SSE reader). This run refreshed the fixture screenshots and `runtime-evidence.json` in `chat-realtime-fix/`.
- `node --import tsx docs/ux/local-previews/browser-acceptance.mjs`: 6 checks passed; images loaded at 1425 × 1768 and unsafe/missing links were rejected/readably reported.
- `node --import tsx docs/ux/office-expanded/capture.mjs`: 7 checks passed, no page errors. `node --import tsx docs/ux/review-highlight/capture.mjs` against `/tmp/review-highlight-dist`: review list/status/focus/mobile checks passed; no resume/API action occurred. Their generated screenshots and logs are copied under `evidence/`; original feature evidence files were restored byte-for-byte.

The realtime browser harness uses the real source app/server and SQLite with temporary directories, fake adapters that throw if invoked, and local Playwright/Chromium. Preview acceptance uses a temporary database/workspace and fixture screenshot. Office/review checks use isolated UI builds and fixture APIs. No provider, credential, live DB, user tab, terminal, daemon restart, or deployment is part of these checks.

Activation is separate: after review, build the matching backend and frontend together with `npm run build`, then restart the service while idle. This integration has not been activated; do not restart during an active task.

## Rollback

Before editing, copies and SHA-256 hashes of the six existing source/test targets were saved under `/tmp/orchestrator-realtime-backup/`. To revert only this integration while preserving the prior dirty main changes, restore these six copies: `src/store.ts`, `src/server.ts`, `web/app.ts`, `web/chat.ts`, `tests/core.test.ts`, and `tests/chat.test.ts`. Remove the integration-added files `web/transcript-cache.ts`, `tests/transcript-cache.test.ts`, `docs/ux/chat-realtime-fix/`, and this `docs/ux/realtime-integration/` directory. The backups are local to this machine and are not a durable archive.
