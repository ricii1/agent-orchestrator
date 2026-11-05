# Terminal color: PTY environment

Baseline checkout: `5caecdb49f385911ab83328977426f5e25a8ec9e`. This work changed only `scripts/terminal-bridge.py`, `tests/terminal.test.ts`, and this evidence directory. No `src/terminal.ts`, `web/terminal.ts`, CSS, or `web/app.ts` hunks. No staging, commit, merge, deployment, restart, or live terminal input.

## Cause and fix

The worker environment used for reproduction has `TERM=dumb`, empty `COLORTERM`, and `NO_COLOR=1`. The bridge already sets child `TERM=xterm-256color`, but it passed through `NO_COLOR`. A real PTY running `rg --color=auto` then returned plain `1:color` despite the xterm palette patch. The existing retest used an environment without `NO_COLOR`, so it missed this path. The renderer did not strip ANSI. `robbyrussell` prompt and zsh plugin suggestion still emitted colors in the affected environment; color aware command output was suppressed.

The bridge now sets `COLORTERM=truecolor` and removes inherited `NO_COLOR` **inside the PTY child** before executing the interactive shell. It does not alter the daemon environment or user dotfiles. A shell can still set `NO_COLOR` itself in its startup configuration. No global text coloring, suggestion acceptance, or new UI option was needed.

## Real keyboard and PTY proof

`node docs/ux/terminal-sol/qa.mjs before` uses the exact baseline bridge from the commit above; `... after` uses this worktree bridge. Both run `TerminalPanel` and CSS from source in Playwright Chromium, connected through the bridge to an isolated `/bin/zsh -i` PTY. The temporary `.zshrc` sources the local Oh My Zsh `robbyrussell` theme plus `git`, `zsh-autosuggestions`, and `zsh-syntax-highlighting` plugins. It contains synthetic history and a one-line sample file. The child starts with daemon-like `TERM=dumb`, empty `COLORTERM`, and `NO_COLOR=1`. HOME/ZDOTDIR, history, and workspace are temporary; no user shell session or live app was touched.

Playwright types `echo`, presses Enter, then types and executes `rg --color=auto --colors 'match:fg:red' color sample.txt` through the UI. It also types a `printf` command to read the shell's actual color environment. Assertions cover the displayed ghost suggestion, its distinct computed color, Enter not accepting it, PTY input, output ANSI, DOM output color, environment, and browser errors on 1440×1000, 390×844, and 320×640.

| Evidence | Baseline | Patched |
| --- | --- | --- |
| PTY environment | `TERM=xterm-256color COLORTERM= NO_COLOR=1` | `TERM=xterm-256color COLORTERM=truecolor NO_COLOR=unset` |
| `rg --color=auto` output | No match SGR; `1:color` foreground `rgb(228, 239, 220)` | SGR 31; `color` foreground `rgb(255, 155, 147)` |
| Input versus suggestion | `echo` green, `suggestion-demo` gray | Same distinct colors; Enter does not accept suggestion |
| Browser errors | None at all three widths | None at all three widths |

Screenshots: [before desktop output](before-1440-output.png), [after desktop output](after-1440-output.png); [before 390 output](before-390-output.png), [after 390 output](after-390-output.png); [before 320 output](before-320-output.png), [after 320 output](after-320-output.png). Keyboard suggestion screenshots: [desktop](after-1440-suggestion.png), [390](after-390-suggestion.png), [320](after-320-suggestion.png). Full DOM colors, PTY environment, and keyboard input are in [before evidence](before-evidence.json) and [after evidence](after-evidence.json).

## Checks and integration

- `npm run check`: passed.
- `node --import tsx --test --experimental-test-isolation=none tests/terminal.test.ts`: 2/2 passed.
- `tsc --outDir /tmp/terminal-sol-build.jMLj4z/server` and `vite build --outDir /tmp/terminal-sol-build.jMLj4z/web`: passed. No output went to live `dist` or `public`.
- `git diff --check`: passed.
- Baseline `scripts/terminal-bridge.py` SHA-256: `1002c599fe02e5528665ff06dd2db141a288dde60163bd918a26f6fbe3b7122e`; patched file SHA-256: `cf166341fd44a7ea115ee9698f29acbe343b1439c78947b6b2e33630c14e62c5`.
- The generated frontend terminal bundle SHA-256 is `7b746b3541a46624c9c7585503e50b88aa6769736414b0b4299e8162a62da858`, matching the live read-only comparison recorded in `docs/ux/terminal-retest/README.md`. No frontend bundle change is needed for this fix.

The bridge delta is integrated into the main checkout, but this task did not activate it in the live app. When the updated source is later used, **close the old terminal session and open a new one**: `Terminals.open()` reuses an existing session for the workspace, so hiding and reopening its panel keeps the old child environment. The server reads `scripts/terminal-bridge.py` at each new PTY spawn; this change does not require a frontend rebuild or tab reload.

This fixes inherited `NO_COLOR` suppression for programs that honor it; it cannot make unconfigured shells or programs emit colors. Individual shell themes may choose their own colors, including dim ANSI256 values. The live daemon's environment was not inspected, so the real UI proof covers the daemon-like fixture and does not assert that a live session had the same flag.
