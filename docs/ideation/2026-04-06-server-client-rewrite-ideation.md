---
date: 2026-04-06
topic: server-client-rewrite
focus: rewrite as TypeScript/Rust server/client application
---

# Ideation: Server/Client Architecture Rewrite

## Codebase Context

- **Project:** UniGetUI — C#/.NET 10 WinUI 3 desktop app (~40 projects) wrapping 10+ package managers (WinGet, Scoop, Chocolatey, Pip, Npm, Cargo, Vcpkg, Dotnet, PowerShell, Homebrew)
- **Architecture:** Clean plugin architecture with IPackageManager/IPackage interfaces. Each manager is its own .csproj.
- **Existing server seed:** BackgroundApi runs Kestrel on localhost:7058 with token auth and widget endpoints
- **Cross-platform:** Experimental Avalonia port exists, proving engine is UI-framework-agnostic
- **Settings:** File-existence-as-boolean pattern (SettingsEngine.cs)
- **Serialization:** SerializablePackage/SerializableBundle provide JSON round-trip
- **Operations:** AbstractOperation with rich event model (LogLineAdded, StatusChanged, OperationSucceeded/Failed)
- **Key gap:** No server component, no remote/headless operation, no fleet management, no security/compliance features

### Stack Recommendation

- **TypeScript for UI/client layer: Yes** — right tool for cross-platform web frontend (via Tauri or browser)
- **Rust for entire backend: No** — would discard 10+ battle-tested manager implementations for zero functional gain
- **C# for daemon/server: Keep** — existing PackageEngine and manager implementations are proven
- **Rust for subprocess broker: Maybe** — earns its keep only in the privilege isolation layer
- **Architecture: Agent+Dashboard** — package managers are host-coupled by nature; containerizing a monolith is incoherent

## Ranked Ideas

### 1. Agent+Dashboard, Not Containerized Monolith
**Description:** Per-machine agent daemon (existing C# engine) + central TypeScript web dashboard for fleet management. Reframes the entire direction: package managers are host-coupled (WinGet COM, UAC, user paths), so the architecture should be agent-per-machine with centralized visibility.
**Rationale:** Embraces the host-coupling constraint as a product advantage. The agent is the existing C# engine; the dashboard is where TypeScript earns its keep.
**Downsides:** More ambitious than a single-app rewrite. Requires agent protocol, auth model, and central store.
**Confidence:** 85%
**Complexity:** High
**Status:** Explored (brainstorm 2026-04-07)

### 2. Headless Mode First (`--headless`)
**Description:** Add a --headless CLI flag that boots without GUI, runs only BackgroundApi on configurable port. Zero new stack, zero migration risk, immediately enables container/CI/scripting use cases.
**Rationale:** BackgroundApi already runs Kestrel. PackageEngine has no GUI dependency. Can be done in days. Validates API design before committing to any rewrite.
**Downsides:** Current API is thin (widget endpoints only). Still Windows-only for WinGet/Scoop/Choco.
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 3. Formalize BackgroundApi as Contract Boundary
**Description:** Version the existing Kestrel API (v3+), add OpenAPI/Swagger, define gRPC streaming for operation logs, make GUIs into HTTP clients of their own backend.
**Rationale:** IPackageManager already reads like a service contract. SerializablePackage is JSON-ready. The gap is formalization, not rewriting.
**Downsides:** Requires routing all GUI state through HTTP. Performance concerns for high-frequency operations.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 4. TypeScript Web UI via Tauri
**Description:** Replace WinUI 3 with TypeScript/React web frontend in Tauri v2 shell. C# daemon as sidecar. One web UI for all platforms, eliminating the Avalonia port.
**Rationale:** Avalonia port proves engine is UI-agnostic. Web UI runs everywhere. TypeScript's strength is UI, not subprocess management.
**Downsides:** Two runtimes. Tauri v2 still maturing. WebKitGTK on Linux can be rough.
**Confidence:** 75%
**Complexity:** High
**Status:** Unexplored

### 5. Rust Subprocess Broker
**Description:** Thin Rust binary for privilege isolation only. Handles elevated process execution, stdout/stderr streaming, signal forwarding. C# keeps all business logic.
**Rationale:** Current code detects GSudo UAC via return code 999 — fragile side-channel. Rust broker creates a real security boundary.
**Downsides:** Adds binary + build toolchain. May be overengineered if UAC isn't the primary pain point.
**Confidence:** 65%
**Complexity:** Medium
**Status:** Unexplored

### 6. Event-Sourced Operation Log
**Description:** Every operation as immutable event in SQLite. Current in-memory OperationQueue/LogList become projections. Crash recovery, audit trails, fleet aggregation.
**Rationale:** All operation history is currently lost on app close. AbstractOperation already emits structured events.
**Downsides:** Storage/schema management complexity. May be premature for single-user desktop.
**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

### 7. Settings-as-Code
**Description:** Replace file-presence booleans with typed JSON/TOML config + JSON Schema. Expose as REST resource on daemon.
**Rationale:** Hard blocker for server/client split. Web client can't read file-presence settings. Hundreds of stat calls at startup.
**Downsides:** Migration path needed. Must preserve Settings.Get() API simplicity.
**Confidence:** 80%
**Complexity:** Low-Medium
**Status:** Unexplored

### 8. Cross-Ecosystem CVE Correlation Engine
**Description:** Server-side service mapping CVE/GHSA across all 10+ ecosystems. Exploits UniGetUI's unique aggregator position for detections impossible per-ecosystem.
**Rationale:** No single-ecosystem scanner can correlate a Chocolatey Python with a Pip advisory.
**Downsides:** Cross-ecosystem identity map is hard to build and maintain.
**Confidence:** 65%
**Complexity:** High
**Status:** Unexplored

### 9. Installer Hash Notarization Ledger
**Description:** Crowd-sourced hash verification across fleet. Server accumulates hashes per {manager, package, version}; flags mismatches as potential supply chain compromise.
**Rationale:** SkipHashCheck currently just disables checking. No cross-client validation exists.
**Downsides:** Requires fleet scale. First install has no quorum. CDN regional hash differences.
**Confidence:** 60%
**Complexity:** Medium
**Status:** Unexplored

### 10. Install Approval Workflow
**Description:** Server-gated approval for high-risk installs using existing FORCE_HOLD_QUEUE. Admin approves/denies via dashboard.
**Rationale:** AbstractOperation already has hold queue and PackageTag.OnQueue. Infrastructure is 80% there.
**Downsides:** Adds latency. Requires server connectivity or fallback policy.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 11. Source URL Trust Registry
**Description:** Server-maintained registry of approved source URLs per manager. Unapproved sources generate alerts. Push revocation list for known-malicious sources.
**Rationale:** ManagerSource.Url has zero validation today. Any developer can add any source.
**Downsides:** Admin maintenance burden. Each manager's source model differs.
**Confidence:** 80%
**Complexity:** Low-Medium
**Status:** Unexplored

### 12. Pre/Post-Install Command Allowlist
**Description:** Server-signed allowlist for pre/post-install commands. Audit trail of all executed commands across fleet.
**Rationale:** Post-install scripts are a primary malware persistence vector. Current enforcement is binary (all or none).
**Downsides:** Round-trip latency. Dynamic scripts hard to hash.
**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Gist sync bus for multi-device | Too niche; low leverage relative to other directions |
| 2 | TypeScript plugin scripting (Deno/QuickJS) | Adds runtime complexity for marginal gain |
| 3 | WASM plugin isolation | Too speculative; far from server/client question |
| 4 | TypeScript manager adapter shims | Reimplements C# managers for zero functional gain |
| 5 | Fleet mode via LAN-exposed daemon | Duplicates stronger agent+dashboard reframe |
| 6 | Auto-generated TypeScript SDK | Tactic within other ideas, not standalone direction |
| 7 | Plugin-as-process isolation | Overengineered for current scale |
| 8 | SQLite state consolidation | Infrastructure, not strategic direction |
| 9 | Windows Container with existing binary | Windows containers are niche and heavy |
| 10 | Dynamic .NET assembly plugin loading | Incremental, not aligned with rewrite question |
| 11 | Cross-manager dependency graph | PackageDetails.Dependencies data too sparse in practice |
| 12 | Server-enforced SkipHashCheck override | Subsumed by approval workflow (#10) |
| 13 | Package-state drift detection | Overlaps with agent+dashboard (#1) and event log (#6) |
| 14 | Ephemeral credential broker | Too niche; most users don't use private registries |
| 15 | Package source reputation scoring | Requires fleet scale that doesn't exist yet |
| 16 | License obligation graph | Lower urgency; License data sparse across managers |
| 17 | Fleet-wide update-drift enforcement | Covered by source trust (#11) + approval workflow (#10) |
| 18 | Immutable signed operation ledger | Strengthens #6 rather than being new direction |
| 19 | Fleet-wide package allowlist/blocklist | Covered by source trust (#11) + approval workflow (#10) |

## Session Log
- 2026-04-06: Initial ideation — ~40 generated across 5 frames, 7 survived
- 2026-04-07: Security & compliance refinement — 16 generated across 2 frames, 5 new survivors (total 12)
- 2026-04-07: User selected #1 (Agent+Dashboard) for brainstorm
- 2026-04-07: Brainstorm completed → requirements doc at docs/brainstorms/2026-04-07-agent-dashboard-fleet-requirements.md
- 2026-04-07: Implementation plan completed → docs/plans/2026-04-07-001-feat-agent-dashboard-fleet-plan.md
