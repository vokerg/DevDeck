# DevDeck architecture

## Control and data flow

~~~text
Browser: public/index.html + public/app.js + public/styles.css
   |  GET /api/projects every 5 seconds
   |  POST registered project/service/action IDs
   v
server/index.js — HTTP, static assets and local request boundary
   |
   +-- server/config.js  — validate/reload static JSON; paths/commands
   |
   +-- server/status.js  — HTTP/TCP/process probes; project states
   |        +-- server/git.js — local read-only Git status
   |
   +-- server/actions.js — status re-check, launch planning, cooldown
              |
              +-- server/terminal.js — visible PowerShell / Terminal.app
~~~

DevDeck **does not own** service PIDs, process lifetimes or logs. A service started outside DevDeck should still be observed by the configured health probe. A successful action response confirms a *terminal was opened*, not that its command eventually succeeded.

## Module contracts

| File | Responsibility | Keep this boundary |
| --- | --- | --- |
| **server/index.js** | Loopback HTTP server, static assets, request validation and routing | Browser submits IDs, never arbitrary commands or paths |
| **server/config.js** | Load/validate JSON, OS values, root and cwd resolution | No repo discovery, config-writing API or unsafe escaping working directories |
| **server/status.js** | Best-effort health checks, process snapshots, ambiguous-port detection and aggregate status | TCP listening is not proof of project identity |
| **server/git.js** | Read-only branch, dirty and ahead/behind via local Git status | No implicit fetch or mutations |
| **server/actions.js** | Resolve registered action, re-probe services, prefer launchers, apply 12-second cooldown | No duplicate/ambiguous bulk startups |
| **server/terminal.js** | Build shell command with path quoting and open a visible native terminal | Use PowerShell on Windows, Terminal.app on macOS |
| **public/** | Browser dashboard, links, search/filter and explicit action clicks | UI state is a snapshot, not an authority |
| **config/** | Bundled repository registry and copyable examples | Values are examples, not discovered local installations |
| **test/** | Contract tests for config, status, actions, Git, HTTP and command quoting | Actual OS GUI operation needs real-machine testing |

The dashboard uses one compact overview panel for branding, the local platform, refresh status and aggregate counts. Projects occupy the full content width below it; there is no machine navigation sidebar. Search and status filters apply to the project cards while overview counts describe the entire registry.

## HTTP routes

- **GET /api/health** returns an object with **ok: true**.
- **GET /api/projects** loads/validates the chosen JSON and responds with **projects**, **platform** and **refreshMs: 5000**. Git/probe state is derived locally.
- **POST /api/projects/:id/services/:serviceId/start** launches one service when safe.
- **POST /api/projects/:id/launchers/:launcherId/launch** launches one combined profile only if every mapped service is confirmed stopped.
- **POST /api/projects/:id/start-stopped** launches compatible profiles first, then eligible individual stopped services; respects **autostart: false**.
- **POST /api/projects/:id/pull**, **/codex**, **/shell** opens a terminal rooted at that configured repository.

POST actions require the existing **x-devdeck-action: 1** header and origin/host checks. Registered config determines commands; user-supplied commands are not accepted. These protections assume a local-only deployment, **not** a secure network-facing execution API.

## Service states

| Service state | Observation / interpretation |
| --- | --- |
| **running** | Expected HTTP endpoint responds (optional literal signature can narrow identity) |
| **listening** | TCP port is open; owning app has **not** been authenticated |
| **detected** | A matching process was found using configured command-line match (and cwd where verifiable) |
| **stopped** | Probe indicates absent service |
| **occupied** | HTTP expectation fails but its port is occupied |
| **conflict** | Active same-port configurations are ambiguous across projects |
| **unknown** | Identity/state could not be reliably established |
| **missing** | Configured repo/service working directory missing |

Aggregate project labels include **running**, **partial**, **stopped**, **attention**, **missing** and **unconfigured**; never make a launch decision from an aggregate alone.

HTTP checks allow a **contains** signature such as a unique HTML title. This is useful where two Angular projects both default to port **4200**, but a generic successful endpoint still cannot identify its owner with certainty. API port **3000** is shared by the two chess projects too. TCP only verifies listening. Worker process **cwd: true** uses best-effort cwd verification on macOS/Linux; Windows can sometimes verify ancestry for a DevDeck-opened PowerShell process, but an independently started worker may be **unknown**.

## Launch semantics

- Each service start resolves its configured per-OS command; the **service** default is **npm run dev** if omitted.
- Each combined launch profile contains an **explicit command** and a complete list of services that command starts (e.g. root **npm run dev:all**).
- Profiles only launch if all included services are confirmed **stopped**.
- **Start stopped** prefers the configured preferred profile, then compatible smaller groups, then eligible individual stopped services; optional **autostart: false** services are skipped.
- **unknown**, **occupied**, **conflict** and **missing** are never signals for blind bulk launch.
- A **12-second** per-service request cooldown mitigates double-click starts; it is **not** proof of readiness or process ownership.
- No Stop/Kill/Restart button; end the process in its terminal.

## Platform and security limits

The server binds to **127.0.0.1** by default, normally **:4400**. Terminal launching is supported on **Windows** (PowerShell with a visible console) and **macOS** (Terminal.app via AppleScript). Linux is used for observation and tests only. The commands run with the developer's existing permissions; JSON changes should be reviewed as executable changes. Never widen the HTTP listener to a public interface without redesigning authentication/authorization and the threat model.
