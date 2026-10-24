# DevDeck

**Local mission control for development projects.** Monitor frontends, backends, and workers; open URLs; launch services, Git pull and Codex in real native terminal windows. Designed for Windows (PowerShell) and macOS (Terminal.app).

![Node.js](https://img.shields.io/badge/Node.js-20%2B-5fa56b) ![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-7386c1)

## Getting started

Requires **Node.js 20 or newer**. No `npm install` is needed (there are no dependencies).

```sh
npm run dev
```

Open **http://localhost:4400**. The same command works on Windows and macOS. `npm start` runs without Node's development watch mode. `npm test` runs the tests.

**Important:** DevDeck can be run in a Linux environment to view status, but native terminal launching is implemented for **Windows and macOS** only.

## Configure your projects

Edit `config/projects.json` directly (no UI editor or hidden discovery). DevDeck reloads this JSON on each status request, so changes show up automatically in the dashboard. `config/projects.example.json` illustrates frontend, backend, and worker services.

Top-level `baseDirs` specify where repos live on each computer:

```json
"baseDirs": {
  "win32": "C:\\repos",
  "darwin": "~/repos"
}
```

Each project has an `id`, display `name`, repo `path` (relative to the platform's `baseDirs` or absolute), optional `description`, and `services`.

```json
{
  "id": "my-project",
  "name": "My Project",
  "path": "my-project",
  "services": [
    {
      "id": "frontend",
      "name": "Frontend",
      "cwd": "web",
      "command": "npm run dev",
      "port": 5173,
      "url": "http://localhost:5173",
      "health": { "type": "http", "url": "http://127.0.0.1:5173/" }
    }
  ]
}
```

`cwd` is relative to the repo root and must remain inside it. Use `"cwd": "."` for the root. `npm run dev` is the default *convention* for the configured start command; it is never inferred or silently executed. Configured paths and commands are trusted local configuration.

Different startup commands per operating system are supported:

```json
"command": {
  "win32": "npm run dev",
  "darwin": "npm run dev",
  "default": "npm run dev"
}
```

### Health checks

| Type | Example | Meaning |
| --- | --- | --- |
| `http` | `"health": { "type": "http", "url": "http://127.0.0.1:3000/health" }` | **Running** only for successful 2xx/3xx HTTP responses. HTTP not healthy but port open is flagged. |
| `tcp` | `"health": { "type": "tcp", "port": 3000 }` | **Listening** when the port accepts connections; process identity is not verified. |
| `process` | `"health": { "type": "process", "match": "dist/worker.js" }` | **Detected** when a process command line contains the configured text. Choose a distinctive string. |

A `port` without a `health` setting implicitly uses a TCP check. Without `health` or `port`, the service status is **Unknown**, though the configured command can still be launched. No pretend statuses: if the repository/service directory does not exist, it shows **Missing**. A project with no services shows **Unconfigured**.

For HTTP checks, use a **local-only** URL (`localhost`, `127.0.0.1`, or `::1`). A valid frontend `url` appears as an **Open** link whether or not the service is running.

### Actions

- **Start** opens PowerShell (Windows) or Terminal.app (macOS) in the service's configured `cwd` and executes exactly its configured command.
- **Start stopped** launches only services whose checks do not indicate they are running or have an occupied port. Each service gets a separate terminal. A service with no health check cannot be verified and will be launched.
- **Shell** opens an interactive native terminal in the repository root.
- **Pull** runs `git pull --ff-only` in a native terminal; no silent merges.
- **Codex** runs `codex` in a native terminal. Install and authenticate the Codex CLI separately.
- **Open** opens the service's configured URL in a new browser tab.

Terminal output stays visible in the terminal window. DevDeck **does not** stop, kill, restart, manage, or background services. It only observes configured checks, so externally started services can be detected as well.

On macOS, the first Terminal launch from DevDeck may trigger an operating system Automation permission prompt. Approve it to allow Terminal.app to receive the command.

## Security and boundaries

The server binds only to `127.0.0.1:4400`. Mutation endpoints require a custom request header and reject cross-site origins; they accept only IDs and actions registered in the local JSON file, never arbitrary commands supplied by the browser. It is a **single-user local tool**, not a server for remote access. Do not expose it on your network or through a public reverse proxy.

If you prefer a different config location, set `DEVDECK_CONFIG` before starting. The HTTP port can be overridden via `PORT`, but change the DevDeck service URL/health settings in your JSON to match.

## Current limits

- Terminal actions on Windows/macOS only.
- No built-in stop button, because DevDeck does not own processes launched outside it.
- Process matching checks the command line rather than executable ownership; make match strings distinctive.
- No cloud sync or remote-machine control. Each machine runs its own local instance with the same JSON layout.
- Edits to `config/projects.json` are manual. That's intentional for v1.
