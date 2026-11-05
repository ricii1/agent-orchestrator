# Verification record

Checkout utama, baseline `5caecdb49f385911ab83328977426f5e25a8ec9e`.

| Command or run | Recorded result |
| --- | --- |
| `npm run check` | exit 0 |
| `npm test` | 79 tests, 79 pass, 0 fail; completed once on merged source |
| `npx tsc --outDir /tmp/followup-merged-build/server` | exit 0 |
| `npx vite build --outDir /tmp/followup-merged-build/web` | exit 0 |
| `git diff --check` | exit 0 |
| UX/browser/PTY runs | detailed JSON evidence is linked from the parent README |

This is a persistent summary of the completed verification. The raw stdout from the original `npm test` invocation was not written to a log file, so this record does not claim to be that raw log. Tests and builds were not rerun to create this docs-only record.
