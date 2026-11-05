# Chat realtime recovery patch

Baseline: `91b73e5a0f10b8855d6d48ba6ecaa0260250c7af` in the isolated task worktree. This patch keeps SSE as the live transport.

## Changes

- Transcript cache stores raw per-ID events and inserts out-of-order IDs without changing chunk identity. It bounds the live cache to 300 transcript events and 24,000 total text characters. Adjacent deltas are combined only by the renderer. Completed messages remove deltas from their own turn across tool events; later turns remain intact.
- Transcript fetch merges by ID through the same bounded cache. The renderer suppresses deltas superseded by a final message, covering fetch/SSE overlap.
- Additive `/api/tasks/:id/events?sync=1` returns the latest persisted turn/message boundary. Catch-up starts immediately before that boundary, then reads `/events?after=N` in ordered pages of up to 500 persisted task events, including text. Its cursor advances only after a successful page, never from the sparse non-text tail or global SSE high-water. It catches up on task/workspace selection, every five seconds while visible, after stream failure/reconnect, and on return to a visible tab. Hidden tabs do not poll.
- Visibility return aborts the prior SSE reader and serializes the new reader after the old reader exits. No send or provider resume is triggered.

Existing non-text `tail=1` and `before` history contracts remain unchanged. The new sync endpoint is read-only and task-scoped; no schema change was needed.

## Verification

`repro.mjs` runs the actual app, server, SQLite store, fake adapters that throw if invoked, and cached Playwright/Chrome against temporary directories. It writes the evidence below in this folder.

- Healthy fixture: emit → SSE reader **2 ms**, reader → DOM **7 ms** in the main-source run (millisecond wall-clock resolution, local fixture only).
- Dropped text followed by a higher status ID was recovered by catch-up; replay accepted a lower text ID than the non-text tail.
- Half-open fixture recovered on visible transition. CDP visibility emulation was unavailable, so the test dispatched `visibilitychange` with synthetic `document.hidden`; OS/browser background throttling is not covered.
- Closed-stream replay rendered the new text once. Visibility recovery observed one active browser SSE reader.
- Workspace switch recovered deliberately dropped text ID 4 after a non-text tail at ID 609. A delayed transcript fetch racing a second workspace switch did not contaminate the selected transcript.
- Idle catch-up made one request in the 5.2 second observation and preserved scroll position, composer focus, and selection.
- Backend incremental route test traversed 505 events, including text, in 500 + 5 pages; sync boundary stayed behind the sparse status tail.
- Unit tests cover ID order `1,3,2`, duplicate replay after 1,100 chunks, event/text bounds, multiple final messages, tool interleaving, and turn boundaries.
- `npm run check`, `npm test` (68 tests), isolated backend TypeScript/Vite builds under `/tmp`, and all eight browser scenarios passed on main source.

See `runtime-evidence.json` and PNG screenshots for fixture timings and visual state. No provider/model CLI, credentials, user tab, production `.data`, daemon, or main checkout was used. No live incident payload was examined; this patch does not establish the cause of any individual incident.

## Limits

The browser harness does not exercise Apache itself, OS-level background throttling, or very large single provider delta payloads. Catch-up is selected-task only and resumes after its last successful task cursor; initial sync starts at the latest turn/message boundary instead of replaying old task history. The live cache retains at most 300 events and 24,000 total text characters unless the user expands history.
