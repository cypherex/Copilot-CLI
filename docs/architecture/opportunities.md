# Opportunities (Auto-maintained)

This file is intended to make improvement ideas obvious and actionable.

## How it’s maintained
- `copilot-lab report opportunities` generates a markdown report from the lab SQLite DB.
- `copilot-lab publish opportunities` commits that report into a branch (and can be used to open a PR).

## What this should contain
1. **Metrics snapshot** (last N runs)
2. **Top recurring failures** (task/verify errors)
3. **High-cost patterns** (tool-call explosions, long runtimes)
4. **Lowest rubric scores** (readability/minimality/etc.)
5. **Suggested experiments** (which strategy to try next)

> Note: If you are editing this manually, keep changes minimal—prefer updating the generating report logic.
