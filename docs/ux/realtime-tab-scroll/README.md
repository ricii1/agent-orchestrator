# Realtime tab and scroll validation

This delta is integrated into the main checkout, based on `5caecdb49f385911ab83328977426f5e25a8ec9e`, and changes the web transcript lifecycle in `web/app.ts`. No commit, restart, or deployment was performed.

The served app on `127.0.0.1:4317` returned a no-store HTML shell referencing `/assets/index-Dpte7kKw.js`. Read-only inspection of that asset found the sync catch-up endpoint, visibility listener, and “Pesan baru” control. The sync API shape was probed only with a nonexistent task ID and returned HTTP 400; no task payload was read. This establishes that realtime source is present in the served build, but does not prove the user's active browser loaded that asset or establish an individual incident's cause. Apache port 80 returned the stock Apache page.

Integrated source changes:

- Catch-up content renders with the same near-bottom follow behavior as SSE. Idle catch-up no longer performs a transcript rerender, avoiding needless scroll/focus disruption.
- A catch-up requested while another catch-up is active is coalesced into one follow-up run; hidden documents still skip catch-up.
- New content while reading older transcript sets a persistent “Pesan baru” action. Returning to the bottom clears it. Own-message submission follows the new transcript.
- Scroll restoration runs synchronously after all replacement nodes are installed, with browser scroll anchoring disabled for this transcript node. The “Pesan baru” button is positioned over the transcript without adding content height; a click removes it before measuring and scrolling to the actual bottom, without a delayed callback that could override later user input.

## Validation status

- Merged checkout isolated browser run: **15 assertions passed plus one geometry trace**; its baseline metadata and output are recorded in [follow-up integration evidence](../followup-integration/evidence/realtime-tab-scroll/runtime-evidence.json)., with no page errors. It covers the prior SSE/catch-up/replay/reconnect/workspace scenarios plus catch-up re-request coalescing, near-bottom follow, scrolled-up position and jump action, history prepend anchor, idle focus/selection, and own-send from the top. See `runtime-evidence.json`, `healthy-stream.png`, `half-open-recovered.png`, `near-bottom.png`, `scrolled-up.png`, and `own-send.png`.
- Scroll geometry at the scrolled-up assertion: document `scrollY=0`; conversation `scrollTop=0`, `scrollHeight=3746`, `clientHeight=440`; the panel is 440 px high. Position remained 0 and the button was present. History prepend kept the anchor within 0.55 px. Near-bottom was at `scrollTop=3306` for `scrollHeight=3746`, `clientHeight=440`. Final fixture SSE emit-to-reader was 2 ms and reader-to-DOM 5 ms; fixture-only timing.
- The original 13 px observation came from a fixture with only 13 px of total scroll range, below the app's 100 px near-bottom threshold. The corrected fixture creates a real scrolled-up distance and verifies the strict `scrollTop` equality assertion.
- Worker scoped run sebelumnya memakai 68 tes. Verifikasi akhir pada checkout utama menjalankan `npm run check`, Vite build ke `/tmp/followup-merged-build/web`, dan full suite `npm test` (79/79); hasil realtime gabungan berada di folder bukti integrasi.
- CDP visibility emulation reported `browserHidden=false`; opening a second Playwright page did not change the original page's native `document.visibilityState`. The synthetic visible-event recovery is separately exercised, and no synthetic event is labeled as an OS/browser tab transition. The main page observed a maximum of one active SSE reader; the fixture had two server streams while a second app page was open.

Apache behavior, OS background throttling, and the active user tab remain unverified. No user chat payload was examined.
