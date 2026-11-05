# Validation record

Validated in the restricted Linux workspace on 2026-11-04, using Node.js 22.18.0.

- Backend and frontend TypeScript checks passed.
- Production Vite build passed. Frontend: approximately 14.5 KB JavaScript + 4.9 KB CSS compressed, without a game engine or UI framework.
- 35 automated tests passed. Worker transcript tests additionally cover instructions, result deduplication, tool-output chunks, archive selection and task-scoped older-history pagination; protocol fixtures check Claude tool results and Codex command output. New coverage includes persistent PM creation under concurrent messages, freelancer role assignment, active-only office visibility, archive retention, 10-seat canvas/reduced-motion/departure behavior, local folder browsing/canonicalization and HTTP validation, quota parsing (including genuine zero and absent data), credential handling, CLI account-limit requests, cache coalescing, manual-refresh cooldown, and stale readings.
- A DOM smoke test with fixture API/SSE data passed: initial PM chat, account quota, no statistics, worker departure after completion, archived results, a follow-up sent to the PM endpoint, and folder navigation/selection that registers and activates a new workspace. It used JSDOM already present in the separately installed Claw checkout; the application has no runtime dependency on Claw or JSDOM.
- Worker-chat DOM smoke passed: PM/worker switching, live SSE replies, visible command/output details, expanded activity preservation, PM draft retention, and opening a completed worker from Riwayat.
- [Office preview](office-preview.svg) is generated from the real canvas drawing commands with a fixture PM and one freelancer. It is an illustration of the office renderer, not a screenshot of a live account.
- Approval UI validation additionally checks exact command visibility, collapsed metadata/notes, preserved drafts after SSE updates, one-shot allow/reject payloads, and double-click suppression. Provider decision tests cover accepting once and rejecting via cancel when decline is not offered. Empty-form confirmation tests check click-only approval, automatic empty-object replies compatible with an older backend, rejection, and preservation of real structured forms/URL flows. Markdown tests and a DOM fixture verify bold domain text, inline code, literal code content, and HTML-like strings staying inert text.
- Live approval regression coverage checks that completing the incoming request does not detach an open SSE response, that new approval events still arrive, and that response closure removes the subscription. A DOM fixture also passed missed-event recovery through the five-second state sync, reconnect reconciliation without new events, and draft retention. Real browser/network recovery remains an operational check.
- The background launcher passed Node syntax checking. Its real daemon/service restart could not be exercised from the sandbox.

Environment limitations:

- Opening a localhost port is forbidden (`EPERM`), so HTTP tests invoke the actual server handler with stream fixtures.
- Chromium was attempted for a browser smoke test, but the sandbox rejected its process startup (`sandbox_host_linux.cc`, operation not permitted). DOM interactions were checked instead; a full browser visual/layout acceptance test remains to be done on the laptop.
- Live quota retrieval cannot be established as successful here: it depends on provider network access and normal CLI filesystem permissions. Failed quota reads return explicit unavailable/login states; fixture tests verify parsing and cache behavior without exposing credentials.
- Earlier real agent inference smoke tests were unsuccessful in this environment: Codex could not initialize state in the read-only `~/.codex` directory, and Claude exceeded the 25-second timeout. Successful real model turns, delegation, and interactive provider approvals remain unverified here.
- Dependency registry access was unavailable during initial setup. Dependencies were provisioned locally; exact top-level versions and the dependency tree are recorded in package.json/package-lock.json.

Operational acceptance from a normal terminal:

1. `npm run office`, then open http://127.0.0.1:4317. Add a workspace and check the account quota/reset indicators. No dashboard token is required.
2. Chat with the PM and request a small task delegated to the other provider. Check the freelancer appears and its result returns to PM.
3. Switch **Percakapan** between PM and the active worker; inspect a command/output and return to PM with its draft preserved. Confirm the freelancer leaves on completion and the result remains under Riwayat. The PM conversation should remain available for the next request.
4. Trigger a question/approval, close/reopen the browser, and answer it. Stop/resume a task and confirm recovery keeps its session.
5. `npm run office` should rebuild/restart an idle daemon and refuse to interrupt active work. Optional systemd setup and real quota refresh should be checked outside the sandbox.

Nested-worker regression (2026-11-04): workers, archived chats and pending approvals are grouped under their parent PM workspace even when their execution workspace is a subdirectory. The UI reports which agent needs approval. TypeScript, production build and 31 tests passed; a DOM smoke check against a read-only snapshot of the affected session displayed its pending Git command and opened its worker chat. No live approval or Git action was submitted.

Provider-specific approval update: TypeScript/build and 35 tests pass, including exact Codex decision payloads, unavailable/forged choice rejection, Claude suggestion suppression and unchanged permission updates, audit persistence, and Claude rule replay across session/workspace/user scopes. A JSDOM fixture checks distinct provider buttons, rule previews, submitted choice IDs and duplicate-click suppression. Live CLI persistence is not verified in the restricted environment. Codex types were checked against the installed CLI generated schema; Claude updates follow its documented permission suggestions. MCP elicitation confirmation remains one-shot; this change does not implement its optional persistence metadata.

Interactive terminal / compact update (2026-11-04):

- TypeScript and production build pass; 39 tests pass. A real local PTY test verifies TTY detection, interactive reads, hidden mock-password input, Ctrl+C, resize, reconnect, output cursors, workspace validation and explicit shutdown. No sudo elevation or live login was performed.
- Provider fixtures verify Codex native `thread/compact/start` and Claude `/compact` on resume. Engine coverage checks overlap prevention, preserving previous answers, and delivering messages queued during compaction. Live provider inference/compaction remains unverified in this restricted environment.
- A DOM fixture verifies `/compact` endpoint routing, local `/help`, `!command` routing to a mocked terminal panel, and rejection of unsupported slash commands. Full xterm browser rendering, real sudo/login and full-screen CLI visual acceptance remain laptop checks.
- Initial frontend bundle is approximately 16.8 KB JavaScript + 5.1 KB CSS compressed. The terminal is a lazy chunk (approximately 74 KB JavaScript + 1.7 KB CSS compressed). Its portable local dependency archives were installed successfully in an isolated temporary directory with npm offline.

Permission mode update (2026-11-04): TypeScript, production build and 40 tests pass. Coverage verifies per-provider automatic one-time approval, persisted audit flags, live application to pending requests, unavailable decisions and unsupported sandbox expansion denial, question preservation, API mode validation, and permission-only settings changes while agents run. A DOM fixture verifies independent Claude/Codex selectors, default Manual mode, the dedicated Save permissions payload and preservation of unrelated settings. Existing native adapter policies are unchanged; real provider execution under this policy has not been verified here.
