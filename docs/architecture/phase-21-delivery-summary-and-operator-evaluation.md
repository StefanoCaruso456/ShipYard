# Phase 21: Delivery Summary and Operator Evaluation

## Purpose

Turn each run into both a delivery artifact and a learning artifact.

The MVP repo ends with a clear summary to the operator. Shipyard should go further by producing a
structured delivery summary plus operator-facing evaluation data that helps improve future runs.

## What We Build

- final delivery summaries with:
  - outputs
  - links
  - risks
  - follow-ups
- operator scorecards for blockers, retries, approvals, and interventions
- bottleneck and failure-pattern reporting
- summary artifacts suitable for post-run review

## Why It Matters

Without a clear close-out artifact, the operator has to reconstruct what shipped and what went
wrong.

Without evaluation, repeated failure modes stay invisible.

## How It Works

Delivery summaries should be assembled from typed runtime evidence:

- artifacts
- handoffs
- blockers
- interventions
- validation outcomes
- links to PRs and deployments

Evaluation should highlight patterns, not only replay logs.

## Outcome

After this phase:

- every completed run has a meaningful summary
- operators can review what shipped and what blocked progress
- the system gains a practical feedback loop for improvement

## What This Phase Does Not Do

This phase does not introduce new execution behavior.

It turns existing execution evidence into operational learning.

## Exit Criteria

- completed runs can produce a structured delivery summary
- operator evaluation surfaces blocker and retry patterns
- follow-up improvements can be identified without replaying traces manually
