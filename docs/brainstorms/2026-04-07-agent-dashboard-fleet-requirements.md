---
date: 2026-04-07
topic: agent-dashboard-fleet
---

# UniGetUI Fleet: Agent+Dashboard Architecture

## Problem Frame

UniGetUI is a desktop app that wraps 10+ Windows package managers behind a single GUI. It runs on one machine and has no visibility into other machines. Enterprise IT teams managing Windows fleets (10-100+ machines) currently have no way to:

- See what packages are installed across all managed machines
- Push package installs, updates, or removals to multiple machines at once
- Enforce security policies (approved sources, blocked packages, hash verification) fleet-wide
- Audit what was installed, when, by whom, and whether it succeeded
- Approve or deny high-risk package operations before they execute

The existing architecture is single-machine, single-user, GUI-coupled. The package engine (IPackageManager implementations for WinGet, Scoop, Chocolatey) is sound, but it's locked inside a WinUI 3 desktop app with no remote access.

**The rewrite reframes the product:** from a desktop GUI wrapping package managers, to a fleet management system where a headless agent runs on each machine and a central web dashboard provides visibility and control.

## Architecture Overview

```
                    ┌─────────────────────────────────┐
                    │     Dashboard Server (Docker)     │
                    │  ┌───────────┐  ┌─────────────┐  │
                    │  │ Web UI    │  │ API Server  │  │
                    │  │ (React/TS)│  │             │  │
                    │  └───────────┘  └──────┬──────┘  │
                    │                        │         │
                    │  ┌─────────────────────┴──────┐  │
                    │  │  Database (PostgreSQL)      │  │
                    │  │  - Agent registry           │  │
                    │  │  - Operation audit log      │  │
                    │  │  - Policy store             │  │
                    │  │  - Fleet state snapshots     │  │
                    │  └────────────────────────────┘  │
                    └──────────┬───────────────────────┘
                               │
                    Agents connect outbound (HTTPS)
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
          ┌──────┴──────┐ ┌───┴────────┐ ┌──┴───────────┐
          │ Agent       │ │ Agent      │ │ Agent        │
          │ (Win Svc)   │ │ (Win Svc)  │ │ (Win Svc)    │
          │             │ │            │ │              │
          │ WinGet(CLI) │ │ WinGet(CLI)│ │ WinGet(CLI)  │
          │ Scoop       │ │ Chocolatey │ │ Scoop        │
          │ Chocolatey  │ │            │ │ Chocolatey   │
          └─────────────┘ └────────────┘ └──────────────┘
             Machine A      Machine B      Machine C
```

**Communication model:** Agents initiate all connections outbound to the dashboard (agent-to-server). This is critical for enterprise networks where managed machines are behind firewalls/NAT that block inbound connections. Agents maintain a persistent outbound connection (long-poll or WebSocket) to receive push operations from the dashboard. Agents report state on heartbeat and after every operation. The dashboard is the single source of truth for policy; agents enforce it locally.

## Requirements

**Agent (Headless Daemon)**

- R1. The agent runs as a Windows Service on each managed machine, with no GUI dependency. It requires a new entry point and host (e.g., `Microsoft.Extensions.Hosting.WindowsServices`) that bypasses WinUI entirely. The existing `--daemon` flag only suppresses the window; it does not skip WinUI initialization and cannot run in Session 0. The agent is a separate executable sharing the PackageEngine libraries
- R2. The agent provides a headless operations pipeline for install/upgrade/uninstall. The existing `PackageOperations.cs` layer cannot be reused directly — it has structural GUI coupling: static mutable `OperationQueue`, loader singleton mutations (`InstalledPackagesLoader.Instance.AddForeign`), `CoreTools.Translate()` in operational metadata, and interactive retry modes (`RetryMode.Retry_AsAdmin`). The agent needs a new operations orchestrator that shares the `IPackageManager` interface but owns its own lifecycle, state management, and logging
- R3. The agent receives push operations from the dashboard via its persistent outbound connection: install package, upgrade package, uninstall package, upgrade all, refresh indexes. Operation parameters originate from the package manager's own parameter-building logic — the dashboard sends structured operation descriptors (manager + package ID + options), not raw CLI arguments
- R4. The agent reports a heartbeat to the dashboard at a configurable interval (default: 5 minutes), including machine identity (unique agent UUID assigned at enrollment), agent version, and manager availability
- R5. The agent reports state snapshots (installed packages per manager, pending updates, ignored packages, configured sources) as diffs against the last-known state, with periodic full snapshots. Snapshot retention policy is defined in the dashboard
- R6. The agent streams operation logs (install/upgrade/uninstall output) back to the dashboard in real time. Log lines are stored as plaintext (never interpreted as HTML/JS), bounded to 10 MB per operation with truncation, and sanitized of ANSI escape sequences before storage
- R7. The agent enforces policies received from the dashboard: source allowlists, package blocklists, hash-skip prohibition, pre/post-operation restrictions. Policies include a TTL; if the agent cannot refresh policy within the TTL, it enters degraded mode. Blocklist violations are enforced as hard failures even under stale policy
- R8. The agent persists an immutable local operation log (SQLite) that survives restarts and can be replayed to the dashboard if connectivity was lost
- R9. The agent self-updates via a new headless update service. The existing `AutoUpdater` is GUI-bound (`Window`/`InfoBar` parameters, `DispatcherQueue`, WinUI toast notifications) and cannot run in a Windows Service. The update protocol (fetch version info, compare, download, verify SHA-256 hash + Authenticode signature) is extractable, but the orchestration must be rebuilt for headless execution. The dashboard hosts the update manifest; the agent verifies the installer against a signing certificate thumbprint pinned at enrollment time

**Dashboard Server**

- R10. The dashboard is a self-hosted web application deployed via Docker (single `docker-compose up`). Secrets (PostgreSQL password, OIDC client secret) are injected via Docker secrets or environment variable references — never hardcoded in `docker-compose.yml`
- R11. The dashboard provides a web UI (React/TypeScript) for fleet admins to manage the fleet
- R12. The dashboard authenticates admins via OAuth/OIDC (Azure AD, Okta, Google Workspace, or any OIDC provider). A local admin account with username/password is available as a fallback, with: bcrypt/Argon2 password hashing, rate-limited login endpoint, and a setting to disable local auth once OIDC is configured
- R13. The dashboard maintains a registry of enrolled agents with machine identity (UUID), hostname, last heartbeat, agent version, and status (online/offline/degraded)
- R14. The dashboard displays a fleet-wide view: all machines, installed packages across the fleet, pending updates, and compliance status
- R15. The dashboard allows authorized admins (Operator role or above) to push operations to individual machines or groups: install, upgrade, uninstall, upgrade-all
- R16. The dashboard allows admins to define and manage machine groups using tag-based assignment (string labels applied to machines). Auto-assignment rules based on machine properties are deferred to a future version
- R17. The dashboard stores a durable, queryable audit log of every operation across the fleet (who initiated, which machine, what package, outcome, full operation log). The audit table is written by a dedicated low-privilege DB user with INSERT/SELECT only (no UPDATE/DELETE)

**Dashboard Authorization (Role-Based Access)**

- R18. The dashboard supports at minimum four roles: **ReadOnly** (view fleet state and audit log), **Operator** (push operations to machines), **Approver** (approve/deny high-risk operations — cannot approve their own requests), **SecurityAdmin** (manage source allowlists, package blocklists, pre/post command allowlists, and hash policies)
- R19. An admin cannot approve an operation they initiated (no self-approval). This is enforced server-side

**Agent Enrollment**

- R20. Agent enrollment uses a one-time enrollment token generated by the dashboard. The token is single-use (consumed on first presentation), expires within a configurable window (default: 1 hour), and the enrollment endpoint enforces rate limiting per source IP
- R21. The agent is configured with the dashboard URL + token, connects outbound, authenticates once, and receives a persistent machine credential (UUID + secret). The credential is stored using DPAPI or Windows Credential Manager (consistent with the existing `CoreCredentialStore` pattern). The dashboard detects concurrent use of the same credential from different source IPs as a potential compromise
- R22. Enrolled agents appear in the dashboard within one heartbeat interval
- R23. Admins can revoke an agent's enrollment. Revocation is propagated as a priority policy change: agents re-check enrollment validity on every heartbeat, and a revoked UUID causes immediate cessation of operations regardless of general policy TTL

**Security & Compliance**

- R24. The dashboard allows SecurityAdmins to define a source trust policy: an allowlist of approved package source URLs per manager. Agents enforce this — unapproved sources are disabled or flagged
- R25. The dashboard allows SecurityAdmins to define a package blocklist: packages that cannot be installed on any managed machine. Agents reject blocked installs
- R26. The dashboard enforces a hash verification policy: SecurityAdmins can prohibit `SkipHashCheck=true` fleet-wide or per machine group
- R27. High-risk operations (configurable criteria — defaults: elevated installs, operations from non-allowlisted sources, first-time packages) require Approver authorization via the dashboard before the agent executes them. Admins can customize which criteria trigger approval and can disable the workflow entirely
- R28. The approval workflow holds the operation in the agent's local queue, sends an approval request to the dashboard via the persistent connection, and waits for Approver response (approve/deny/timeout). If the agent loses connectivity while waiting, the operation remains queued and the approval request is resent on reconnect. Approved operations that are not claimed by an agent within a configurable window expire. If the agent restarts while an approval is pending, the pending operation is recovered from the local SQLite log and the approval request is resent
- R29. Pre/post-operation commands are logged to the audit trail via the existing `PrePostOperation` abstraction. SecurityAdmins can define a command allowlist using exact-string matching (not regex). Default posture is deny — no pre/post commands execute until an allowlist entry is explicitly created. The allowlist permission is distinct from general admin
- R30. The audit log is immutable, append-only, and exportable (CSV/JSON) for SIEM integration
- R31. The agent never logs credential material (enrollment tokens, machine secrets) to disk. The existing pattern in `BackgroundApi.cs` (logging the session token in plaintext via `Logger.Info`) must not be propagated to the agent

**Agent-Dashboard Protocol**

- R32. All connections are agent-initiated outbound HTTPS. Agents authenticate with their machine credential; the dashboard presents its TLS certificate. No inbound ports are required on agent machines
- R33. The protocol supports: heartbeat, state snapshot (diff + full), operation push (via persistent connection), operation log stream, policy sync, enrollment, revocation check, and update notification
- R34. Agents operate in a degraded mode when the dashboard is unreachable: they continue running with the last-known policy (until TTL expires), queue state reports and operation logs, and replay them when connectivity is restored. In degraded mode, operations that would require approval are queued (not auto-approved). After policy TTL expires, agents refuse all new operations (not just approval-gated ones) until policy is refreshed

## Success Criteria

- An IT admin can enroll 10+ Windows machines, see their package state in the dashboard, and push a package install to all of them from the browser
- Operations are fully auditable: every install/upgrade/uninstall is logged with initiator, target, outcome, and full CLI output
- Security policies (source allowlists, package blocklists, hash enforcement) are defined once in the dashboard and enforced on every agent
- The approval workflow blocks a high-risk install until a different admin (Approver role) approves it — no self-approval
- A machine that goes offline replays its operation log when it reconnects — no data is lost
- An agent whose policy TTL expires while disconnected refuses new operations until reconnected
- An agent that restarts with a pending approval resends the request and recovers the queued operation
- The web dashboard is the primary UI for fleet management

## Scope Boundaries

- **Windows agents only** — macOS/Linux agent support is out of scope for v1
- **WinGet (CLI-only mode), Scoop, Chocolatey** — WinGet COM activation fails in Session 0 (Windows Service context); the agent uses CLI-only mode for WinGet. This is a hard constraint, not an open question
- **No SaaS hosting** — v1 is self-hosted only (Docker)
- **No CVE correlation engine** — vulnerability scanning (ideation idea #8) is deferred to a future version
- **No installer hash notarization ledger** — crowd-sourced hash verification (ideation idea #9) is deferred
- **No mobile app** — dashboard is web-only
- **Tag-based groups only** — auto-assignment rules based on machine properties are deferred
- **The existing WinUI desktop app is not modified** — it continues to work for single-machine users who prefer a native desktop experience. It is not actively maintained once the dashboard reaches feature parity, and is sunset over time. Single-machine users are not expected to run the full dashboard stack locally — the WinUI app remains the recommended path for non-fleet use
- **The Avalonia cross-platform port is paused** — the web dashboard supersedes Avalonia's cross-platform goal. The Avalonia effort is neither deleted nor continued

## Key Decisions

- **Agent is C#/.NET, separate executable**: Reuse the existing PackageEngine and manager implementations, but build a new headless executable with `Microsoft.Extensions.Hosting.WindowsServices`. The WinUI app and the agent are separate executables sharing engine libraries. A new headless operations pipeline replaces the GUI-coupled `PackageOperations` layer
- **Dashboard is for fleet management, WinUI stays for single-machine**: The dashboard is the fleet management UI. Single-machine users keep the existing WinUI desktop app — they are not expected to install Docker + PostgreSQL to manage one machine. The two products coexist, sharing the same PackageEngine
- **Agent-initiated connections**: Agents connect outbound to the dashboard. The dashboard never initiates connections to agents. This is critical for enterprise firewall compatibility
- **WinGet CLI-only in agent**: WinGet COM (WindowsPackageManager.Interop) requires an interactive session and fails in Session 0. The agent uses `BundledWinGetHelper` (CLI) exclusively
- **Role-based access with no self-approval**: Four roles (ReadOnly, Operator, Approver, SecurityAdmin). Approvers cannot approve their own requests
- **OAuth/OIDC with hardened local fallback**: Enterprise SSO from day one, with bcrypt-hashed local admin as fallback
- **Security is core, not bolted on**: Audit logging, policy enforcement, and approval workflows ship in v1
- **Self-hosted Docker deployment**: No cloud dependency. Organizations own their data
- **Agent update signing**: Agent verifies update installers against a signing certificate thumbprint pinned at enrollment. The dashboard hosts the update manifest but cannot serve unsigned/mis-signed binaries

## Dependencies / Assumptions

- Agents require .NET 10 runtime on each managed machine (already a requirement for current UniGetUI)
- WinGet, Scoop, and Chocolatey CLIs must be installed on each agent machine (same as today)
- WinGet COM activation does not work in Session 0 — agent uses CLI-only mode (hard constraint)
- The dashboard server requires Docker and a PostgreSQL-compatible database
- OAuth/OIDC requires the organization to have an identity provider, or use the local admin fallback
- Agents running as Windows Services require admin privileges for installation (standard for enterprise software)
- The existing operations layer (`PackageOperations.cs`, `AbstractOperation.cs`) requires a new headless counterpart — the GUI coupling is structural, not cosmetic

## Outstanding Questions

### Deferred to Planning
- [Affects R6][Technical] Should the persistent agent-to-dashboard connection use WebSockets, Server-Sent Events, or gRPC bidirectional streaming?
- [Affects R32][Technical] Exact protocol design — REST polling vs WebSocket vs gRPC for the persistent connection
- [Affects R10][Needs research] What's the right dashboard backend stack? Options include TypeScript fullstack (Next.js), Rust (Axum), Go, or C# (ASP.NET). Needs evaluation against the requirements
- [Affects R8][Technical] Schema design for the local SQLite operation log on the agent, including recovery of pending approvals after restart
- [Affects R21][Technical] Exact credential storage implementation — DPAPI blob vs Windows Credential Manager vs encrypted file
- [Affects R13][Technical] How to handle agent version compatibility — can a v1.0 dashboard manage a v1.2 agent?
- [Affects R2][Technical] Detailed inventory of GUI-coupled code paths in the operations layer and design of the headless operations pipeline
- [Affects R17][Technical] PostgreSQL audit table schema — separate low-privilege DB user, retention policy, and export mechanism design

## Next Steps

→ `/ce:plan` for structured implementation planning
