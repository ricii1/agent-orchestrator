# Perlu ditinjau: workspace task review

CTA count, attention links, and filtered history share `reviewTasks` / `needsReview` from `web/model.ts`: child tasks in the selected workspace whose status is `failed` or `interrupted`. Parent workspace is used when available. Completed and cancelled work is excluded; pending approvals continue through their existing decision UI.

The CTA opens history in its review filter. The dialog can switch to all history, which still contains every archived session, and labels review rows with status and reason. Review rows show the task title/role, provider, model, and timestamp; opening one lands on that task's detail. The detail adds the same reason. Status updates repaint the open list and count, with focus restored to a surviving row or the review filter. No task is resumed, approved, or persistently modified by opening the flow.

## Evidence

- [CTA at 1440 px](review-cta-1440.png)
- [Filtered review list at 1440 px](review-list-1440.png)
- [Correct task detail and review reason](review-detail-1440.png)
- [Workspace at 320 px](review-320.png)
- [Browser check record](evidence.json)
- [Observed pre-change baseline](baseline.json) and [source fragments](baseline-source.md)
- [Scoped current patch record](current-patch.md)

Screenshots are original PNG captures from headless Google Chrome. `capture.mjs` builds into `/tmp/review-highlight-dist` and runs a local fake API fixture. It does not start the app daemon or invoke any provider/model. The fixture tests an SSE-driven status refresh by sending a fake SSE status event; the UI refreshes state and repaints the open dialog.

## Checks run

- `npm run check`
- `node --import tsx --test tests/review-model.test.ts`
- `npx vite build --outDir /tmp/review-highlight-dist`
- `node docs/ux/review-highlight/capture.mjs`

`baseline.json` records the behavior observed before this scoped edit. A full-file source snapshot is intentionally omitted because the shared checkout already contained unrelated in-progress changes in the same files.
