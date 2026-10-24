# DevDeck

A local, **terminal-first flight deck** for a developer juggling multiple projects on **Windows and macOS**. DevDeck monitors what is actually running, shows each repo's local Git state, and opens the **native PowerShell or Terminal.app** for explicitly configured Start, Pull, Codex, and Shell actions. It does not take ownership of processes or silently run commands.

## Quick start

Requires **Node.js 20+**, npm, and Git. No runtime npm packages are needed.

```sh
git clone https://github.com/vokerg/DevDeck.git
cd DevDeck
npm run dev
```

Open **http://localhost:4400**. `npm run dev` watches the Node server; `npm start` runs normally and `npm test` runs the automated tests. The server binds only to `127.0.0.1`.

**First edit:** set `baseDirs.win32` and `baseDirs.darwin` in `config/projects.json` to where your repositories live on each machine. The committed configuration includes examples for DevDeck, `nba_time_machine`, `WhyISuckAtChess`, and `chess_repertoir_trainer`; it also contains unconfigured placeholders for Garmin Heatmap and Voktrader. These are *examples*, not auto-detected installations. Verify actual commands, ports and locations on each computer.

To keep machine-specific configuration out of Git, copy `config/projects.json` to `config/projects.local.json` (which is gitignored), edit it, then launch with `DEVDECK_CONFIG=config/projects.local.json npm run dev` on macOS or `$env:DEVDECK_CONFIG='config/projects.local.json'; npm run dev` in PowerShell. The dashboard does not edit configuration; changes to the JSON are picked up on the next 5-second refresh.

## Capabilities

- **Live state per service:** `running` (HTTP), `listening` (TCP only), `detected` (process), `stopped`, `occupied` (unexpected page or unhealthy endpoint), `conflict` (same unidentifiable port shared by several projects), `unknown`, or `missing`. Project summaries show running, partial, stopped, attention, missing, or unconfigured.
- **Service actions:** a single service can open its configured start command in a native terminal. `command` defaults to `npm run dev` if omitted. An occupied or unverified service cannot be started blindly. A service with **no health check at all** can be launched individually with a warning, but is excluded from bulk startup until a health check is configured.
- **Combined launch profiles:** map one command (such as `npm run dev`, `npm run dev:all`, or `python3 dev.py`) to the services that it actually launches. A group launches **only if all its services are confirmed stopped**. This prevents launching a second copy of an existing frontend/backend.
- **Start stopped:** prefers the primary launch profile, otherwise a safe smaller profile, then individual stopped services. Set `autostart: false` on optional services such as Expo/mobile, which remain manually launchable. Any required service whose status is unknown/occupied/conflicted prevents the bulk start; it will never silently push through an ambiguous state.
- **Git status:** local current branch, working-tree changes, and locally known ahead/behind counts (no `git fetch` or write operation). Git status commands have timeouts.
- **Repository actions:** **Shell**, **Pull** (`git pull --ff-only`), and **Codex** (`codex`) open visible terminals at the configured repository root.
- **Links:** Open and Copy actions for configured local frontend/API URLs. Search and active/inactive/attention filters.
- **Cross-platform:** same JSON supports OS-specific paths, commands, and launch profiles. Each machine has its own independent local status. Linux can run observation mode, but native terminal launch is intentionally disabled.

## Configuration format

All project definitions are in a **static JSON file**. No repository scanning, generated commands, or dynamic config UI.

```json
{
  "baseDirs": { "win32": "C:\\repos", "darwin": "~/repos", "linux": "~/repos" },
  "projects": [{
    "id": "my-project", "name": "My Project", "path": "my-project",
    "services": [
      { "id": "frontend", "name": "Frontend", "cwd": "frontend", "command": "npm run dev",
        "port": 5173, "url": "http://localhost:5173",
        "health": { "type": "http", "url": "http://127.0.0.1:5173/", "contains": "<title>My Project</title>" } },
      { "id": "backend", "name": "Backend", "cwd": "backend", "command": "npm run dev",
        "port": 3000, "health": { "type": "tcp", "port": 3000 } },
      { "id": "worker", "name": "Worker", "command": "npm run dev:worker",
        "health": { "type": "process", "match": "src/worker.ts", "cwd": true } }
    ],
    "launchers": [{ "id": "all", "name": "Full stack", "command": "npm run dev:all",
      "services": ["frontend", "backend", "worker"], "preferred": true }]
  }]
}
```

- `path` may be relative to `baseDirs.<OS>`, absolute, or an OS-keyed object, e.g. `{ "win32": "C:\\src\\demo", "darwin": "~/code/demo" }`.
- `command` may be a string or OS-keyed object (`win32`, `darwin`, `linux`, `default`). A missing service `command` means `npm run dev`; launcher commands are **always explicit**. If there is no command for the current OS, launch is unavailable.
- `cwd` is relative to the repository and must not escape it.
- For HTTP health, `url` **must be a loopback URL**. Optional `contains` requires a literal string in the response body. Prefer unique HTML titles for frontends so another app listening on the same port is not falsely reported as yours. HTTP 2xx/3xx without `contains` means responsive but ownership is not verified.
- TCP checks verify the listening port **only**, not the process identity; cross-project duplicates are marked ambiguous. `port` without a health object implies a TCP check.
- Process checks use a distinctive command-line substring. Optional `cwd: true` checks that the process is in the configured service directory or a descendant directory on macOS/Linux. On Windows, DevDeck can verify the process via an ancestor PowerShell window it launched itself; **workers launched elsewhere may remain Unknown** when their working directory cannot be verified. A process match *without* `cwd` is signature-only and can confuse workers in different repositories.
- `autostart: false` excludes an optional service from **Start stopped**. Individual Start still works.
- Configuration is validated on every refresh; errors are shown in the dashboard rather than making up states.

## Examples based on the actual repositories

| Repository | FE | API | Worker | Launcher | Notes |
| --- | --- | --- | --- | --- | --- |
| `nba_time_machine` | Vite `:5173` | FastAPI `:8000` | — | `python3 dev.py` on macOS | Requires Python `.venv` and frontend dependencies. Windows can start FE and API individually. |
| `WhyISuckAtChess` | Angular `:4200` | Fastify `:3000` | `npm run dev:worker` | `npm run dev:all` | `npm run dev` is a second launch profile for web+API only. |
| `chess_repertoir_trainer` | Angular `:4200` | Fastify `:3000` | `npm run dev:worker` | `npm run dev` (web+API) | Expo `npm run dev:mobile` at `:8081` is optional/manual. |

The two chess projects **share default ports**. DevDeck checks their different HTML `<title>` content to identify the web frontend, and refuses duplicate/conflicting starts. **Do not run both on the same ports** without changing their own configuration and then updating DevDeck's URLs and health checks. API URLs and ports in the shipped JSON reflect the documented defaults, not guaranteed installed settings.

## Safety model

DevDeck is for a single developer and listens only on localhost. API actions accept only project IDs and registered action names from the static JSON; requests cannot pass arbitrary shell commands. Actions require a same-origin request and an action header. Commands are run **only in visible terminals**. The 12-second cooldown prevents accidental duplicate clicks while a service starts. Commands can still fail normally because credentials, dependencies or CLI programs are missing; inspect their terminal windows.

`Pull` uses `git pull --ff-only` and never silently merges. `Codex` requires the CLI installed and authenticated. There is **no stop/kill/restart** button because running processes may have been started by another terminal, IDE, or application. DevDeck does not own those processes or their logs. Stop them with Ctrl+C in the terminal that started them.

The app does not synchronize Windows and macOS machines, expose remote execution, or automatically install/start PostgreSQL, Docker, workers, or services. Native terminal automation permissions may be requested by macOS the first time.

## Development and verification

```sh
npm test
npm run dev
# In a second terminal:
curl http://localhost:4400/api/health
curl http://localhost:4400/api/projects
```

Automated tests cover JSON validation, Git parsing, HTTP signature/port/process checks, conflict detection, launch profile selection, cooldown and CLI action dispatch. End-to-end native terminal opening must also be tested on **actual Windows and macOS hosts**; this CI/runtime environment is Linux and cannot simulate those OS GUI integrations.
