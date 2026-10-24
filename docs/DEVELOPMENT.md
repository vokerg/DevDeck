# Development, tests and Git workflow

## Getting started

Requires **Node.js 20+**, npm and Git. DevDeck has no runtime npm package dependencies.

~~~sh
git clone https://github.com/vokerg/DevDeck.git
cd DevDeck
npm test
npm run dev
~~~

Open **http://localhost:4400** on the machine running Node. A separate shell can call:

~~~sh
curl http://localhost:4400/api/health
curl http://localhost:4400/api/projects
~~~

On Windows PowerShell use **Invoke-RestMethod http://localhost:4400/api/health** and **Invoke-RestMethod http://localhost:4400/api/projects**. Health returns **ok: true**; projects returns the current local status snapshot. Example repositories normally show **missing** until you configure their paths. **npm run dev** starts Node in watch mode; **npm start** uses ordinary Node. The server binds **127.0.0.1:4400** by default (environment **PORT** can override; update DevDeck's self-registration if you use another port).

## Change locations and tests

| Area | Code | Tests |
| --- | --- | --- |
| Static JSON parsing, path/OS resolution | **server/config.js** | **test/config.test.js** |
| Health checks and conflicts | **server/status.js** | **test/status.test.js** |
| Git status parsing | **server/git.js** | **test/git.test.js** |
| Start, launch profiles, cooldown, Git/Codex actions | **server/actions.js** | **test/actions.test.js** |
| PowerShell and macOS Terminal command construction | **server/terminal.js** | **test/terminal.test.js** |
| HTTP routing and origin boundary | **server/index.js** | **test/http.test.js** |
| Dashboard | **public/index.html**, **public/app.js**, **public/styles.css** | Add tests for new logic where practical |
| Bundled config | **config/projects.json**, **config/projects.example.json** | Keep the two examples synchronized |

Run **npm test** and record the actual pass/fail summary; don't assume a fixed historical test count. For docs changes, validate internal links and fenced JSON. For behavioral changes, test updated logic and smoke-test GET routes. Before PR, inspect **git diff --check**, **git diff --stat**, **git diff** and **git status --short** to catch whitespace, unrelated edits or secrets.

## Real-machine integration matrix

The automated tests cannot prove native GUI behavior on Linux. When the relevant machine is available, perform these checks and record results:

| Scenario | Windows | macOS |
| --- | --- | --- |
| Start DevDeck | **npm run dev**; self status on **:4400** | Same |
| Service Start | Visible PowerShell, correct repo/cwd and command | Visible Terminal.app, correct repo/cwd and command; automation permission may be required |
| Combined profile | One CLI starts mapped FE/API/worker and blocks duplicate profile | Same |
| Start stopped | Safe subset only; respects **autostart: false** | Same |
| Worker | External worker may stay **unknown** if cwd cannot be verified | Confirm command + cwd checks when available |
| Shell, Codex, Pull | Opens native terminal rooted at repo; Pull runs **git pull --ff-only** | Same |
| Port conflicts | Wrong service on configured port is not treated as target | Same |
| Shutdown | Ctrl+C in originating terminal; DevDeck does not kill it | Same |

Use **disposable repositories** when testing Git Pull or commands with side effects. A successful terminal-open API response does not guarantee an app started; read terminal output. Do not claim Windows/macOS integration was tested when running only in Linux/CI. Record the tested OS and observed behavior.

## Feature branch → PR → authorized squash merge

1. Inspect current **git status**, existing branches and any open PR for the task; never discard someone else's changes.
2. Safely update local main with **git pull --ff-only** as appropriate, create **feat/topic**, **fix/topic** or **docs/topic**. Do not implement on main.
3. Make a coherent scoped change, including tests and relevant documentation. Preserve all rules in [DECISIONS.md](DECISIONS.md) unless the owner approves an explicit revision.
4. Run tests and smoke checks; complete the OS manual matrix if available. Self-review the **entire diff** for hidden commands, quoting issues, misleading health certainty, credentials and unexpected changes.
5. Push and open a PR against main. Include change summary, commands and *observed* test results, risks, manual checks completed, and checks that could not be run.
6. **Leave the PR unmerged** unless the owner explicitly delegates the merge. When authorized, **squash merge**, verify the merged commit, and report the PR/commit link.

Do not rewrite main history or claim work is done without evidence.

## Handoff to the next local agent

Include the current branch, working tree status, linked issue/PR, completed changes, exact test output, remaining risks, any deferred native platform checks and the next safe action. If blocked, leave state recoverable rather than masking partial work.

See [AGENTS.md](../AGENTS.md) for the quick-start agent protocol and [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries to protect during refactors.
