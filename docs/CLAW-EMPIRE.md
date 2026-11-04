# Try Claw-Empire

From this project directory, run:

```sh
npm run claw -- install
```

The command clones the upstream repository into `apps/claw-empire`, installs its locked dependencies, builds the web UI, and starts a background server at **http://127.0.0.1:8790**. It needs GitHub/npm network access, Node.js 22+, pnpm, and enough disk space for dependencies. No Docker or global service installation is required.

Configuration uses loopback only. Encryption/inbox secrets are generated privately; no dashboard token is configured. Local Claude/Codex login remains provider-managed. The installer adds upstream orchestration rules only to the cloned project's `AGENTS.md`. Remotion browser bootstrap is disabled to avoid downloading a browser for unused video features; video generation may require enabling it later. Upstream dependencies and submodules are still installed.

State, logs and process metadata live in `.data/claw-empire/`. Existing prototype files, database, and daemon are kept separate. Repeating `install` does not pull updates or replace an existing clone with another repository.

```sh
npm run claw -- status
npm run claw -- logs
npm run claw -- stop
npm run claw -- start
npm run claw -- restart
```

Closing the terminal does not intentionally stop the detached process. Logout survival depends on the operating system's user-session policy. This launcher does not install boot autostart or a crash-restarting service. If an interrupted launcher leaves `control.lock`, confirm no installer/start/stop command is still running before removing that lock.

Once open, inspect provider availability in Settings and start with a disposable local test repository. **The inspected upstream launcher uses Claude's `--dangerously-skip-permissions` and Codex's `--yolo` for task execution.** Its GitHub issue #82 also reports merge/push behavior on approval. Installing or opening the UI does not itself start a model task; assigning work does. Upstream behavior has not been changed by this installer.

Installation was attempted from the restricted agent workspace, but cloning failed because `github.com` could not be resolved. The launcher is prepared, not a completed installation. Running the one command above from the laptop's normal terminal resumes the installation work.

Sources: [upstream README](https://github.com/GreenSheep01201/claw-empire), [CLI launcher](https://github.com/GreenSheep01201/claw-empire/blob/main/server/modules/workflow/core/cli-tools.ts), [approval issue #82](https://github.com/GreenSheep01201/claw-empire/issues/82).
