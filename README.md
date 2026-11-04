# Kantor — a PM and temporary freelancers

Chat with one PM. It hires Claude Code or Codex workers only when a task needs them. Freelancers appear in a small pixel office while working and leave when finished. Their results stay in history. There are no departments, employee stats, XP, or permanent worker rosters.

## Open the office

Requires Linux, Node.js 22+, npm, Git, and existing local Claude Code / Codex CLI login.

```sh
npm install
npm run office
```

Open **http://127.0.0.1:4317**. There is no dashboard login/token. Use **+** beside Workspace or **Pilih folder workspace** to browse local folders and activate a workspace, then chat with the PM. The same picker is available under **Pengaturan → Pilih folder…**, alongside manual path entry. The PM and default freelancer providers can be chosen there; blank model fields use provider defaults.

`npm run office` builds the current source and starts the daemon in the background. It also restarts an idle older daemon or the installed user service, so new UI assets and API code stay together. It refuses to restart while work is active. The launcher verifies the recorded PID belongs to this checkout before signaling it. From another directory:

```sh
npm --prefix /path/to/orchestrator-agent run office
```

```sh
npm run office -- status
npm run office -- stop
```

For foreground use, run `npm run build && npm start`. To survive logout and start automatically, use the optional systemd user service described below. Closing the browser does not stop the daemon or its workers; pending questions/permissions wait for your return. Laptop sleep/shutdown interrupts execution. The background launcher alone does not install boot autostart or guarantee survival of every OS logout policy.

## How it works

- **PM chat:** one persistent provider conversation per workspace/provider; no model requests while idle. Changing the default PM provider opens that provider's separate conversation for the workspace.
- **Freelancers:** PM assigns a focused task and role. Only active workers are shown in the office. Use a character, the buttons below the office, or the **Percakapan** selector to open each worker’s live chat/log. Instructions from PM, published replies, and collapsible command/tool output are shown. Worker logs are read-only; send new directions through PM. Finished workers remain selectable, and **Riwayat** opens their saved transcript. Older messages can be loaded with **Muat pesan sebelumnya**. New tool outputs are recorded after updating/restarting the backend; older sessions only show data previously recorded. Failure/interruption is surfaced for attention; past work is in **Riwayat**.
- **Live updates:** approvals and task state update over SSE, reconcile on reconnect or returning to the tab, and use a five-second state check while the page is visible. Unchanged state does not redraw the UI.
- **Controls:** stop the PM (including its active children), stop individual workers, explicitly resume interrupted work, and answer questions/permissions in the chat pane. Permission cards show the exact terminal command, folder, and one-time Allow/Reject actions. Protocol metadata stays under Detail teknis; optional notes are collapsed. Questions show readable text/options and require an answer. Fieldless MCP confirmation forms need a click, not typed JSON; the UI sends the empty object automatically, including to an older running backend. An ask_user permission previews the upcoming question, which is answered separately after permission is granted. PM messages support bold, inline code, and fenced code blocks using DOM text nodes.
- **Workspace:** workers use Git worktrees where available; non-Git writes to overlapping directories serialize. Up to three workers run by default. Advanced settings can adjust the limit.
- **Schedules:** retained under **Pengaturan → Jadwal pekerjaan**, without a separate management dashboard.
- **History:** results, events, sessions, and worktrees are kept. A freelancer leaving the office does not delete its files or make past work unrecoverable.

The office uses original code-drawn furniture/sprites on Canvas 2D. It respects reduced motion and pauses animation when the tab is hidden. The accessible worker buttons duplicate character selection. The frontend uses no UI framework or game engine.

## Account quota

The sidebar shows Claude and Codex subscription usage windows and their reset times. These are account-wide quota readings, including usage outside this app, not per-agent scores or estimated bills.

- **Codex:** official `account/read` and `account/rateLimits/read` app-server methods using existing CLI login. Reading quota does not create a thread or invoke a model. API-key-only accounts may not expose subscription limits.
- **Claude:** read-only OAuth quota endpoint used by Claw-Empire, with the access token read server-side from `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json`. This is not a documented stable quota API. Unsupported accounts, expired sessions, and network failures display an explanation instead of a fabricated zero.
- Quota responses are cached for 60 seconds and concurrent requests share one read. Manual refresh has a 15-second minimum interval. The UI only polls while visible. Last successful quota values are marked stale on a later network failure.
- Credentials are never returned to the browser, copied into the database, or logged by the quota reader. The app does not refresh Claude credentials itself; the CLI manages its login.

Sources: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Claw-Empire quota integration](https://github.com/GreenSheep01201/claw-empire/blob/main/server/modules/workflow/agents/providers/usage-cli-tools.ts).

## Background service

```sh
npm run build
npm run service -- print
npm run service -- install
npm run service -- status
journalctl --user -u agent-office.service -f
```

The installer writes `~/.config/systemd/user/agent-office.service`, enables it, and starts it. If a verified launcher daemon already runs, the service waits for it to exit and then starts a supervised replacement, preserving active work during installation. Explicit service stop/restart also stops that daemon; wait until work is idle before using these commands. Reinstall after moving the checkout or removing its Node installation. For survival after logout/start before login, enable linger according to your system's policy, for example `loginctl enable-linger "$USER"`.

Optional **http://kantor.test** routing through Apache is described in [deployment notes](deploy/README.md). Laptop-specific installation evidence and rollback records remain local and are excluded from Git.

Remove with `npm run service -- uninstall`. Device sleep/shutdown, network loss, and provider limits still interrupt progress.

Environment: `PORT` (4317), `ORCHESTRATOR_DATA_DIR` (`.data`), `CLAUDE_BIN`, `CODEX_BIN`, and optional `CLAUDE_CONFIG_DIR` for quota credentials. Logs, task state, and worktrees are private files under `.data/`. Event history can contain task content; retention cleanup is manual.

## Permissions, files, and recovery

The server binds only to `127.0.0.1`, validates host/origin, and requires JSON for mutation requests. Internal MCP control still uses per-run task capabilities so workers cannot control unrelated work. These are internal credentials, not a dashboard login.

Workspace registration admits tasks to specific directories; it is not complete filesystem confidentiality. Codex uses provider sandboxing and untrusted command approval. Claude uses restricted mode, a sandboxed shell, and an MCP permission host. Neither adapter enables global permission bypass. Explicitly approving an arbitrary shell command still needs care; this is not container isolation. API-key environment variables are stripped from worker processes to avoid silently changing CLI login to API billing.

Git workers start from committed HEAD, without copying uncommitted source-checkout changes. Repositories need an initial commit. Review shows changes from the worker's base commit plus bounded text previews for untracked files. Approving a merge stages/commits worker edits and runs `git merge --no-ff --no-commit` in the clean original checkout. Review and commit the integration yourself; conflicts and worktrees are retained. Use `git merge --abort` to abandon an integration.

After a crash, active tasks become interrupted and old permission requests expire. Review and explicitly resume them; stored provider session IDs are reused. Cancel terminates the provider process group. There is no automatic retry of a failed task or provider failover. Scheduled missed minutes are skipped, and a schedule does not overlap an active/interrupted earlier run. Numeric five-field cron and a timezone are supported.

## Validation

```sh
npm run check
npm test
npm run build
npm run smoke -- claude
npm run smoke -- codex
```

Tests include PM persistence/concurrent initial messages, temporary-worker visibility/history, task queues, scoped capabilities, approvals/recovery, Git worktrees, scheduling, quota parsing/caching/credential handling, and both CLI protocol fixtures. Real-provider smoke tests use a tiny initial/resume exchange and may consume subscription usage.

See [validation limits](docs/VALIDATION.md) and [the current product direction](docs/ROADMAP.md).
