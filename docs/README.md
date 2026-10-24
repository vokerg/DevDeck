# DevDeck documentation map

**Agent? Start with [AGENTS.md](../AGENTS.md).** Human quick start and feature overview: [README.md](../README.md).

| Document | What it owns |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | HTTP/GUI workflow, runtime modules, health states, launch safeguards and security boundary |
| [CONFIGURATION.md](CONFIGURATION.md) | Validated static JSON schema, machine-specific paths, launch profiles and real repository examples |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Commands, testing, manual Windows/macOS checks, troubleshooting, Git/PR handoff |
| [DECISIONS.md](DECISIONS.md) | Original product decisions, invariants, deferred capabilities and change procedure |

## Source-of-truth precedence

- **Executable behavior:** the checked-out **server/** and **public/** code plus tests under **test/**.
- **Registry:** **config/projects.json**; **config/projects.example.json** is a parallel example, and **config/projects.local.json** is the ignored per-machine override.
- **Agent protocol:** root **AGENTS.md**.
- **Design intent:** these architectural and decision records.
- **Getting started:** root **README.md**.

When code, test and documentation disagree, investigate and correct the mismatch in the same PR. Do not treat a previous chat response or a README example as evidence of actual system state.

## Project scope

DevDeck observes **only the machine where its local Node server runs**. It is neither a remote admin service nor a process supervisor. Its actions open native user-visible CLI sessions. Workers, databases, installers and unrelated terminals are not owned by DevDeck.

The current application intentionally has no automatic repository discovery, no dynamic config editor, no background Git synchronization, and no stop/kill/restart button. See [DECISIONS.md](DECISIONS.md).
