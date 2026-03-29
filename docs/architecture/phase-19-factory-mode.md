# Phase 19: Factory Mode

## Purpose

Package Shipyard's runtime into a higher-level greenfield factory workflow.

The MVP repo is compelling because it offers a simple story: ticket in, app out. Shipyard should be
able to offer that experience too, but as a product layer built on the typed runtime instead of a
replacement for it.

## What We Build

- an explicit `Factory Mode` toggle alongside the normal coding workflow
- a greenfield request intake flow with typed app, repo, stack, and deploy targets
- isolated runtime workspaces under `.shipyard/factory-workspaces/`
- staged implementation flow compiled onto the existing typed runtime
- a delivery-stage production-readiness gate that verifies the generated app before handoff
- deploy handoff support and delivery summary generation for factory runs

## Why It Matters

This is the phase where Shipyard starts to feel like a complete software-factory product instead of
only an execution engine.

## How It Works

Factory mode should reuse:

- the control plane
- specialist registry
- delegation flow
- approval gates
- external record sync

It adds a product workflow for greenfield intake, isolated workspace bootstrap, staged execution,
delivery output, and a readiness checkpoint before the final handoff.

In the shipped Phase 19 path:

- `Factory Mode` off keeps the normal coding/editor workflow unchanged
- `Factory Mode` on compiles the intake into typed context, phase execution, and factory state
- the server seeds a fresh runtime workspace with `README.md`, `.gitignore`, and
  `shipyard.factory.json`
- repo-tool tasks execute against that isolated workspace instead of the Shipyard control repo
- the delivery stage blocks on a production-readiness task before the deploy handoff can complete

## Outcome

After this phase:

- Shipyard can run an end-to-end greenfield workflow
- factory repository and deployment artifacts are part of the run record
- the delivery stage can hold the run open when readiness checks are missing or failing
- operators get a coherent factory experience on top of the existing runtime

## What This Phase Does Not Do

This phase does not yet solve every parallel merge conflict or evaluation need.

Those concerns are hardened in the next phases.

## Exit Criteria

- Shipyard can execute a greenfield factory run from intake to delivery output
- repository and deployment artifacts are attached to the run
- factory mode uses the typed runtime rather than bypassing it
