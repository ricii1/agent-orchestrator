# Local image previews in chat

Markdown links in chat open in a new tab. Local links point to the read-only
`/api/previews` route; only raster image bytes (PNG, JPEG, WebP, GIF) are
returned. The browser receives `nosniff` and `no-store` headers. No image is
embedded automatically and no operating-system file opener is invoked.

The preview route accepts only a workspace that is a current registered root;
task history cannot grant access after root removal. It serves files inside
that root, and absolute paths inside a related task `executionPath` only while
both the task workspace and canonical execution path remain inside the
selected current root.
Relative links resolve strictly from the selected workspace and cannot reach a
task worktree through a symlink. Private segments, symlink escapes, unsupported
file signatures, oversized files, and unreasonable dimensions are rejected.

Absolute paths containing private segments such as `.data` are intentionally
unsupported, including runtime worktree paths under `.data`. The Markdown
parser and backend both reject those paths; no opaque task-context route is
implemented. Link to files inside the registered workspace instead.

Example link for the expanded office screenshot:

```md
[Preview kantor besar](docs/ux/office-expanded/evidence/desktop-expanded.png)
```

Validation performed in this worktree:

- `node --import tsx --test tests/format.test.ts tests/artifacts.test.ts`
- `npm run check`
- `node --import tsx docs/ux/local-previews/browser-acceptance.mjs`
- Isolated TypeScript/Vite production build; outputs were written under `/tmp`.

The browser acceptance builds the UI into a temporary directory and starts the
real server against a temporary SQLite database and registered temporary
workspace. It copies the office screenshot into that workspace and runs a fake
adapter; it does not use the live database or contact a provider. Chromium and
the preinstalled Playwright module exercise chat click to new tab, image
`naturalWidth`, MIME, keyboard Enter, relative path resolution, unsafe-link
rejection, literal inline/fenced code, and readable missing/forbidden errors.
Evidence files are `chat-links.png`, `preview-tab.png`, and
`browser-evidence.json` in this directory. The source screenshot remains at
`docs/ux/office-expanded/evidence/desktop-expanded.png`.
