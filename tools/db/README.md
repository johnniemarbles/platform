# Migration Numbering Policy

- Core foundation fixes: next free number in `0009–0039`.
- Extracted from expadio: keep the original number and filename if free in core; otherwise renumber into `1000+` and put `-- extracted from expadio <original filename>` on line 1.
- Net-new module work: `1000+`.
- Hub: unchanged.
- App packs: `0001+` inside the pack (their keys are prefixed with `<slug>/`, so they never collide).
- The runner refuses to start if the same filename exists in both core and hub.
