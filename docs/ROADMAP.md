# A small freelancer office

Implemented:

- One PM conversation per workspace/provider, resumed across requests.
- A code-drawn pixel office using Canvas 2D, without a game engine or external art assets.
- Only queued, running, or waiting freelancers appear in the office. Completed/cancelled/failed workers leave; their work and session history remain available.
- The PM sets a short role when hiring a freelancer, such as Frontend or Reviewer.
- Chat, approvals, stop/resume, worker results, and Git review remain available.
- Claude/Codex account quota with reset times, caching, refresh, and explicit unavailable/stale states.
- No agent statistics, XP, employee roster, departments, or ranking system.

Possible later improvements: more expressive sprites, richer file previews, and better direct Claude quota integration if an official stable interface becomes available. Preserve the small workflow: give the PM a goal, watch freelancers work, review the result.

Not planned for this version: permanent staff management, simulated meetings, payroll, recursive hiring, or a game economy.
