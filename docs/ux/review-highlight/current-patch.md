# Current review-highlight patch

## Source delta

- `web/model.ts`: added `needsReview(task, workspace, tasks)`, `reviewReason(task)`, and sorted `reviewTasks(tasks, workspace)`. Both the CTA count and attention list now consume `reviewTasks`.
- `web/app.ts`: CTA opens `historyDialog(true)`; history has all/review filters and labels rows that satisfy the shared predicate; review details include the same reason. State refresh repaints open review dialogs and restores keyboard focus after row replacement/removal.
- `web/review.css`: new review-only stylesheet with textual status, icon, border and background treatment, focus treatment, and narrow viewport layout.
- `tests/review-model.test.ts`: checks workspace scoping, parent-only eligibility, status inclusion/exclusion, predicate/list count consistency, and reasons.

## Runtime evidence

Exact generated UI build output was isolated under `/tmp/review-highlight-dist`. `capture.mjs` serves a local fake API and captures original PNGs. Browser checks verified 2 review items initially, 1 after an SSE transition, focus recovery to the review filter, keyboard entry into the remaining item's detail, no resume request, and no horizontal overflow at 320 px. The fixture's only task mutations remain in memory.

Source-wide diffs are intentionally not included here because the checkout had concurrent unstaged work in `web/app.ts` and `web/model.ts`; combining those diffs would incorrectly attribute other changes to this task.
