# Implementation Status

## Purpose

This document tracks actual implementation status separately from the roadmap.

Use [roadmap.md](/private/tmp/shipyard-status-dashboard/docs/architecture/roadmap.md) for build
order, goals, and exit criteria.

Use this document for:

- what is merged into `main`
- what is still missing
- which PR or commit delivered a phase

## Snapshot

As of **March 26, 2026**:

- complete on `main`: Phases `8-13`, `15-21`
- still missing: **Phase 14**
- no roadmap phases exist after Phase 21, but the roadmap is **not fully complete** because Phase 14
  is still open

## Phase Dashboard

| Phase | Status | Merged PR / Commit | Date | Notes |
|---|---|---|---|---|
| 8. End-to-End Tooling | Complete | milestone PR [#26](https://github.com/StefanoCaruso456/ShipYard/pull/26) / `02703ab` | 2026-03-24 | Early repo-tool/runtime hardening landed across the initial session-workflow sequence. |
| 9. External Context Injection | Complete | [#27](https://github.com/StefanoCaruso456/ShipYard/pull/27) / `b8bb82d` | 2026-03-24 | Explicit coordination/context layer shipped. |
| 10. Typed Runtime Control Plane | Complete | [#48](https://github.com/StefanoCaruso456/ShipYard/pull/48) / `89065fe` | 2026-03-26 | Implementation docs landed in [#50](https://github.com/StefanoCaruso456/ShipYard/pull/50). |
| 11. Specialist Agent Registry + Skills | Complete | [#54](https://github.com/StefanoCaruso456/ShipYard/pull/54) / `6e58dee` | 2026-03-26 | Specialist identity, registry, and skill loading are in `main`. |
| 12. Production Lead Delegation Flow | Complete | [#55](https://github.com/StefanoCaruso456/ShipYard/pull/55) / `0fe228c` | 2026-03-26 | Production-lead delegation flow is merged. |
| 12.5. Memory and Context Hardening | Complete | [#56](https://github.com/StefanoCaruso456/ShipYard/pull/56) / `619abfe` | 2026-03-26 | The roadmap previously said "In progress", but the implementation is merged. |
| 13. Ship Rebuild Framework | Complete | [#52](https://github.com/StefanoCaruso456/ShipYard/pull/52) / `6ab26eb` | 2026-03-26 | Ship rebuild workflow tracking and intervention logs are in `main`. |
| 14. Comparative Analysis | Missing | None | - | No comparative analysis report generator from rebuild evidence is merged yet. |
| 15. Operator Workflow Foundation | Complete | [#59](https://github.com/StefanoCaruso456/ShipYard/pull/59) / `94629df` | 2026-03-26 | Operator stage view and run journal are merged. |
| 16. Human Approval Gates | Complete | [#67](https://github.com/StefanoCaruso456/ShipYard/pull/67) / `7eb73c6` | 2026-03-26 | Runtime pause/resume approval gates are merged. |
| 17. Orchestrator Artifacts and Structured Decomposition | Complete | [#71](https://github.com/StefanoCaruso456/ShipYard/pull/71) / `e055100` | 2026-03-26 | Mainline Phase 17 artifact restore. Planning visibility add-on landed in [#72](https://github.com/StefanoCaruso456/ShipYard/pull/72). |
| 18. External Record Sync | Complete | [#73](https://github.com/StefanoCaruso456/ShipYard/pull/73) / `a210e80` | 2026-03-26 | External mirror/sync flow is merged. |
| 19. Factory Mode | Complete | [#76](https://github.com/StefanoCaruso456/ShipYard/pull/76) / `c6ec6de` | 2026-03-26 | Explicit task-vs-factory mode shipped. |
| 20. Merge and Conflict Governance | Complete | [#77](https://github.com/StefanoCaruso456/ShipYard/pull/77) / `ea0646a` | 2026-03-26 | Conflict records and production-lead merge governance are merged. |
| 21. Delivery Summary and Operator Evaluation | Complete | [#78](https://github.com/StefanoCaruso456/ShipYard/pull/78) / `5562f74` | 2026-03-26 | Structured closeout summary and evaluation are merged. |

## Usage Notes

- If the roadmap and this dashboard disagree, trust this dashboard for merge status.
- If a phase was delivered across multiple earlier PRs, the table points to the clearest merged
  milestone rather than every supporting PR.
- When a new phase is proposed, add it to the roadmap first and then add it here once real
  implementation work starts.
