# DevDeck engineering decisions

These decisions are intentional product boundaries, not an invitation to turn DevDeck into a generic orchestration system. [AGENTS.md](../AGENTS.md) is the agent entry point; [ARCHITECTURE.md](ARCHITECTURE.md) describes current implementation.

## D01 — Visible native terminal is the execution interface

**Decision:** Start, Shell, Pull and Codex open configured commands in PowerShell or Terminal.app. DevDeck does not silently own service processes, stream logs or kill/restart apps.

**Reason:** The developer wants a flight deck over their existing CLI workflow, not hidden magic. Terminal output, prompts and Ctrl+C remain where they started.

**Implication:** An opened terminal is *not* evidence the service started successfully.

## D02 — Observe independently of launch origin

**Decision:** Reconcile status with HTTP, TCP and process probes whether the service was launched by DevDeck, an IDE, or another shell.

**Reason:** The task is knowing which projects actually run now, not tracking what DevDeck asked to run.

**Implication:** Be candid about uncertainty: a TCP port is not project identity; ambiguous process working directories and shared-port responses can be unknown, occupied or conflict. Never report a guessed positive.

## D03 — Static, readable JSON configuration

**Decision:** A validated registry lists projects, per-OS paths/commands, health checks, FE links and combined launch profiles; optional ignored local JSON supports differing machines.

**Reason:** Deterministic explicit configuration fits a handful of complex repos with Vite/FastAPI, Angular/Fastify, background workers and optional Expo.

**Implication:** No automatic repo discovery, inferred CLI commands or browser configuration writer. Root **npm run dev** may run *multiple* services; a profile lists them all.

## D04 — Conservative launches

**Decision:** Combined profiles require every mapped service to be confirmed stopped. Start stopped excludes **autostart: false**, re-probes before acting and uses a short per-service cooldown.

**Reason:** Starting duplicate worker/backends, or colliding on a port shared by multiple repos, is worse than an extra manual check.

**Implication:** Ambiguous or unknown service status can block bulk startup. Resolve the probe or start deliberately in a regular terminal; never weaken guards by assuming unknown means stopped.

## D05 — Git modifications are explicit

**Decision:** Git badges derive from local read-only status. Pull runs **git pull --ff-only** in a visible terminal; Codex launches **codex** at repo root. No silent Git fetch, checkout, rebase, merge, commit or install.

**Reason:** Hidden mutations damage confidence and can overwrite or confuse in-progress local work.

**Implication:** Ahead/behind counts may be stale until a developer fetches; a failing pull is handled visibly.

## D06 — Local single-developer trust boundary

**Decision:** Bind the HTTP server to loopback; actions accept only registered identifiers and commands from trusted JSON. No remote machine control, network exposure or multi-user service.

**Reason:** The action server uses the developer's local OS privileges, and the existing checks are not a production remote-admin authentication system.

**Implication:** Treat config edits like executable code. Do not open the server on a LAN, introduce arbitrary shell strings from browser requests, or claim host/origin checks are comprehensive remote authentication.

## D07 — Lean but complete agent documentation

**Decision:** Maintain root **AGENTS.md**, a doc index, architecture/config/development documents and this decision record. Keep implementation and tests as behavioral truth.

**Reason:** An agent should be able to orient rapidly without inventing product constraints, yet the project is too small for an elaborate agent factory.

**Implication:** If behavior changes, update affected code, tests, README, example registry and agent docs in the same PR. Explicitly discuss deviations from these decisions with the owner before implementing them.

## Deferred unless the owner explicitly asks

Automatic repository discovery; dynamic config editing; background supervision, restart, killing or log capture; remote launch; machine-to-machine synchronization; automatic Docker/Postgres provisioning; hidden Git changes; accepting arbitrary HTTP shell commands.

Any proposal to cross one of these boundaries must explain command visibility, ownership, failure cases and trust/security implications before changing code.
