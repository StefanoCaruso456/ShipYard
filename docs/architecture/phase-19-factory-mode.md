# Phase 19: Factory Mode

## Purpose

Package Shipyard's runtime into a higher-level greenfield factory workflow.

The MVP repo is compelling because it offers a simple story: ticket in, app out. Shipyard should be
able to offer that experience too, but as a product layer built on the typed runtime instead of a
replacement for it.

## What We Build

- a greenfield request intake flow
- repo bootstrap support
- staged implementation flow from planning to PR
- deploy handoff support
- delivery summary generation for factory runs

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

It adds a product workflow for repo creation, staged execution, and delivery output.

## Outcome

After this phase:

- Shipyard can run an end-to-end greenfield workflow
- repo, PR, and deployment artifacts are part of the run record
- operators get a coherent factory experience on top of the existing runtime

## What This Phase Does Not Do

This phase does not yet solve every parallel merge conflict or evaluation need.

Those concerns are hardened in the next phases.

## Exit Criteria

- Shipyard can execute a greenfield factory run from intake to delivery output
- repo and deployment artifacts are attached to the run
- factory mode uses the typed runtime rather than bypassing it
