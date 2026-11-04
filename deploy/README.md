# Local deployment

The application requires Linux and Node.js 22+. From the checkout, build with
`npm run build`. Preview the systemd user unit with `npm run service -- print`;
`scripts/service.mjs` generates paths for the current checkout, Node executable,
and environment. Install only when intended with `npm run service -- install`.
The generated `deploy/agent-office.service` snapshot is local evidence, not a
portable service template, and is excluded from Git.

`kantor.test.conf` is the Apache loopback proxy configuration for port 4317.
`install-local.py` is an Ubuntu/Apache administrative installer retained from the
original local setup. It still names the original account `ricii` in its linger
operations and state check; review and adapt those occurrences to the intended
account before running it on another machine. Its `/etc/apache2`, `/var/lib/systemd`,
and `/var/backups` paths assume that layout. Do not run it merely to prepare Git.
It changes hosts/Apache/linger configuration, reloads Apache, and records the
rollback backup path in the ignored `system-install-result.txt`. Preserve that
local record and the actual system backup for rollback; neither ships in Git.
For an existing installation, consult its local records before changing anything.
The installer refuses to overwrite an existing site or hosts entry.

Verification scripts are opt-in, not repository setup steps:

- `verify-live.mjs` checks the running `kantor.test` installation and registers a
  workspace through a POST request. Its workspace path refers to the original
  checkout; adapt it before using the script elsewhere.
- `verify-proxy.mjs` starts an isolated Apache/backend fixture.
- `verify-service.mjs` starts and restarts a temporary systemd service with an
  isolated database. It requires a working user service manager.

Use Node.js 22+ for these scripts. Live verification changes application state;
service verification launches processes. Run them only when those actions are
intended. Local evidence, test output, installed-unit snapshots, private `.data/`,
vendored `apps/`, and generated `public/` and `dist/` are excluded from Git.
Frontend source and code-drawn assets live in `web/`; Vite regenerates `public/`.
