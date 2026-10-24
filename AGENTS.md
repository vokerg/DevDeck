# DevDeck — agent entry point

DevDeck is a **local, terminal-first development flight deck** for Windows and macOS. It observes registered services independently of how they were started and launches explicit CLI commands in native visible terminals. This is the canonical entry point for Codex, Claude Code, and other coding agents opened at the repository root.

## Required reading (in order)

1. [README.md](README.md) — user goal, quick start, existing capabilities and limitations.
2. [docs/README.md](docs/README.md) — documentation map and sources of truth.
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module boundaries, HTTP API, status model and launch flow.
4. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — JSON configuration, platform handling and repository examples.
5. [docs/DECISIONS.md](docs/DECISIONS.md) — non-negotiable behavior and explicit non-goals.
6. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — testing, native OS validation, PR workflow.
7. The relevant implementation and tests under **server/**, **public/**, **config/** and **test/**.

Treat executable code and tests as the current behavioral authority. If documentation conflicts, verify behavior and fix the relevant docs in the same PR; don't silently redesign from outdated prose.

## Product and safety invariants

- **Observe reality, not launch history.** Services started in an IDE or separate shell must be discoverable by configured health checks.
- **Visible native terminals only.** Start, Pull, Shell and Codex launch PowerShell on Windows or Terminal.app on macOS. Do not silently run, kill, restart or supervise project processes; stopping belongs in their original terminals.
- **Static trusted JSON.** Registered roots, commands, health checks, URLs and launch profiles come from validated configuration. No automatic repo detection, browser-supplied shell command or write-back configuration UI.
- **Conservative health.** An open TCP port does not prove identity. Wrong HTTP response means occupied; unverifiable worker means unknown; ambiguous shared ports mean conflict. Do not reinterpret uncertainty as stopped.
- **Safe launch planning.** Combined launch profiles declare every service one CLI command starts. Never start a profile unless all included services are confirmed stopped. Preserve per-service autostart opt-out, status re-checks and the 12-second cooldown.
- **Default start convention.** DevDeck itself runs with **npm run dev**. A service with an omitted command defaults to **npm run dev**; launch-profile commands must be explicit.
- **Git is explicit.** Display local Git branch/dirty/ahead/behind via read-only status (no implicit fetch). Pull means visible **git pull --ff-only** and Codex means visible **codex**.
- **Local trust boundary.** Keep the Node action API bound to loopback; POST actions must resolve registered IDs to commands defined in JSON. Maintain host/origin and action-header checks. Treat edits to configuration as edits to executable scripts.
- **No secrets.** Keep tokens, real credentials, .env files, private machine paths and ignored **config/projects.local.json** out of commits.

## Work protocol

1. **Orient:** Inspect current branch, git status, open work/PRs, relevant code and tests. Do not delete uncommitted work.
2. **Scope:** State the goal, files and acceptance criteria. Prefer the documented defaults when sufficient.
3. **Branch:** Start from up-to-date main where safe, and work on **feat/topic**, **fix/topic** or **docs/topic**. Never implement directly on main.
4. **Implement:** Keep changes small and modules focused. Update tests and docs whenever behavior changes.
5. **Verify:** Run **npm test** and appropriate local HTTP smoke checks. Validate CLI/GUI interactions on actual Windows/macOS when available; don't claim OS testing if only Linux was available.
6. **Self-review:** Inspect full diff, commands, URLs, status ambiguity, launch safeguards, secrets and accidental scope changes. Fix problems before PR.
7. **PR:** Open a pull request targeting main, with summary, test output, risks and *unverified* manual checks. **Do not merge unless the owner explicitly instructs it.** When authorized, use squash merge and verify the result.

## Commands

From the repository root:

~~~sh
npm test
npm run dev
# In another terminal:
curl http://localhost:4400/api/health
curl http://localhost:4400/api/projects
~~~

PowerShell supports **Invoke-RestMethod http://localhost:4400/api/health**. Running status checks is safe; clicking Start/Pull/Codex is not a passive smoke test and may perform configured side effects.

## Completion standard

The branch is reviewable, tests and docs match behavior, no hidden/destructive automation was introduced, manual platform checks were done or their absence disclosed, and a PR/handoff includes links plus the next safe action. **Never claim an unobserved test, PR, merge or deployment succeeded.**
