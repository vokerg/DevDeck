# DevDeck static configuration

The authoritative schema/validation code lives in **server/config.js**. DevDeck never auto-discovers repositories and does not edit this config through the browser.

## Per-machine setup

1. Clone the repositories and determine their actual paths, ports and startup commands.
2. Set **baseDirs.win32** and **baseDirs.darwin** in **config/projects.json**, or supply per-project OS-specific absolute paths.
3. For personal differences, copy **config/projects.json** to ignored **config/projects.local.json**, edit it, and select it before starting DevDeck:

~~~sh
# macOS — from DevDeck root:
DEVDECK_CONFIG=config/projects.local.json npm run dev
~~~

~~~powershell
# Windows PowerShell — from DevDeck root:
$env:DEVDECK_CONFIG = 'config/projects.local.json'
npm run dev
~~~

The server reads/validates the selected JSON on each relevant request. Expect the dashboard to reflect edits on the next five-second refresh. **Never commit personal credentials, .env values, or private machine paths.**

## Example (illustrative)

~~~json
{
  "baseDirs": {
    "win32": "C:\\repos",
    "darwin": "~/repos",
    "linux": "~/repos"
  },
  "projects": [
    {
      "id": "example-app",
      "name": "Example App",
      "path": "example-app",
      "description": "Web, API and worker",
      "services": [
        {
          "id": "web",
          "name": "Web",
          "role": "frontend",
          "cwd": "apps/web",
          "command": "npm run dev",
          "port": 4200,
          "url": "http://localhost:4200",
          "health": {
            "type": "http",
            "url": "http://127.0.0.1:4200/",
            "contains": "<title>Example App</title>"
          }
        },
        {
          "id": "api",
          "name": "API",
          "role": "backend",
          "command": "npm run dev:api",
          "port": 3000,
          "health": { "type": "tcp", "port": 3000 }
        },
        {
          "id": "worker",
          "name": "Worker",
          "role": "worker",
          "command": "npm run dev:worker",
          "health": { "type": "process", "match": "src/worker.ts", "cwd": true },
          "autostart": false
        }
      ],
      "launchers": [
        {
          "id": "web-api",
          "name": "Web + API",
          "command": "npm run dev",
          "services": ["web", "api"],
          "preferred": true
        }
      ]
    }
  ]
}
~~~

A **launcher** is one terminal command that starts multiple listed services; it is not a sequence of separate commands. Individual service Start stays independent.

## Field contracts

| Field | Validation and meaning |
| --- | --- |
| **baseDirs** | OS keys **win32**, **darwin**, **linux**, **default**; nonempty paths for resolving relative repo paths |
| **projects[].id** | Unique lowercase letters/digits/hyphens; used in HTTP route |
| **projects[].name** | Required display name |
| **projects[].path** | String or OS-keyed object; absolute, home-relative or relative to OS base directory |
| **services** | Required array; empty denotes unconfigured project |
| **services[].id/name** | Unique per project, required display name |
| **services[].cwd** and launcher **cwd** | Relative to repository root, default **.**; escaping/absolute cwd rejected |
| **services[].command** | String or OS-keyed object; omission defaults to **npm run dev** |
| **launchers[].command** | Required string or OS-keyed object; no implicit default |
| **launchers[].services** | Nonempty list of unique configured service IDs; list all services the command starts |
| **launchers[].preferred** | Optional boolean; at most one preferred launcher per project |
| **services[].autostart** | Optional boolean; **false** excludes it from bulk **Start stopped**, not individual Start |
| **services[].port/url** | Optional integer 1–65535 / loopback HTTP(S) URL |
| **health.type: http** | Required loopback URL; optional **contains** literal response substring |
| **health.type: tcp** | Explicit port or service port, optional loopback host; identity **not** verified |
| **health.type: process** | Distinctive match substring (minimum 5 characters); optional **cwd: true** for repo verification |

OS-keyed commands and paths can have keys **win32**, **darwin**, **linux**, **default**. A command unavailable on the current OS disables that action. HTTP URLs and health probes must be local; TCP checks may target only loopback. Config validation rejects bad shapes, duplicate IDs and launchers referring to unknown services. A service without **health** or **port** is unmonitored: it may be started individually, not by bulk Start stopped.

## Choosing probes and dealing with port conflicts

- **Frontend:** prefer **http** with a distinctive stable HTML title. Two repos can both be configured for **4200**, but only one can own it at a time.
- **Backend:** use a local endpoint when possible. A generic **200** response or TCP connection does not uniquely identify a backend on a shared port.
- **Worker:** use a process command signature and **cwd: true** when feasible; Windows may leave externally launched workers unknown because it cannot reliably inspect arbitrary process cwd.
- **Optional mobile/Expo:** use **autostart: false** and configure the actual Metro port.

The bundled registry covers **personal_context_engine** (React/Vite 4310 / Fastify API 3110 / optional worker; **npm run dev:local** combined launcher), **sportos** (Angular 4210 / API 3010 / worker; **pnpm run dev** combined launcher), **nba_time_machine** (Vite 5173 / FastAPI 8000 / macOS **python3 dev.py** combined launcher), **WhyISuckAtChess** (Angular 4200 / API 3000 / worker; **npm run dev** for web/API and **npm run dev:all** for all three) and **chess_repertoir_trainer** (Angular 4200 / API 3000 / worker; **npm run dev** for web/API, optional Expo). These values reflect the repos' documented defaults and this machine's configured local ports, not an auto-detected runtime scan. To run both chess apps together, first change their own conflicting ports and then update the DevDeck registry accordingly.

See [ARCHITECTURE.md](ARCHITECTURE.md) for status certainty and [DECISIONS.md](DECISIONS.md) for why automatic discovery/config editing is excluded.
