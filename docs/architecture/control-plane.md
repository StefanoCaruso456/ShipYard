# Control Plane

## Purpose

This document defines the TypeScript control plane that should govern runtime execution.

For the phase-level build summary, see [phase-10-typed-control-plane.md](/Users/stefanocaruso/Desktop/Gauntlet/shipyard/docs/architecture/phase-10-typed-control-plane.md).

The control plane is the source of truth for:

- who owns work
- what state the run is in
- what can transition next
- what was validated
- what failed
- what was retried

Prompts and skills guide behavior. The control plane governs state.

## Core Rule

The runtime should not rely on natural-language memory to decide workflow truth.

The runtime should rely on typed state objects and explicit transitions.

## Runtime Roles vs Specialist Identity

The control plane should keep coarse runtime roles explicit:

- `orchestrator`
- `production_lead`
- `specialist_dev`
- `execution_subagent`

Specialist identity should be attached as typed data, not mixed into the workflow role itself.

Current specialist agent types:

- `frontend_dev`
- `backend_dev`
- `repo_tools_dev`
- `observability_dev`
- `rebuild_dev`

This keeps workflow authority clear:

- runtime role says what part of the workflow the agent occupies
- specialist type says what domain it owns
- skill ids say which guidance documents shape its behavior

## Core Entities

### Phase

A phase groups user stories that belong to one implementation milestone.

### User Story

A story expresses a bounded requirement and its acceptance criteria.

### Task

A task is the smallest planned unit of work assigned to one owner.

### Artifact

An artifact is a durable output such as:

- requirements artifact
- user-flow spec
- data-flow spec
- story breakdown
- implementation plan
- validation result
- intervention note
- rebuild report

### Handoff

A handoff transfers responsibility for one or more tasks from one role to another.

### Intervention

An intervention records where a human had to correct, unblock, or redirect the system.

## Suggested Types

```ts
type WorkflowRole =
  | "orchestrator"
  | "production_lead"
  | "specialist_dev"
  | "execution_subagent";

type SpecialistAgentTypeId =
  | "frontend_dev"
  | "backend_dev"
  | "repo_tools_dev"
  | "observability_dev"
  | "rebuild_dev";

type WorkStatus =
  | "pending"
  | "researching"
  | "planned"
  | "delegated"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "validated"
  | "failed"
  | "completed";

type WorkArtifact = {
  id: string;
  type: "requirements" | "story" | "task" | "plan" | "validation" | "intervention" | "report";
  title: string;
  content: string;
  createdBy: WorkflowRole;
  createdAt: string;
};

type WorkTask = {
  id: string;
  title: string;
  description: string;
  ownerRole: WorkflowRole | null;
  ownerAgentTypeId: SpecialistAgentTypeId | null;
  status: WorkStatus;
  dependencies: string[];
  acceptanceCriteria: string[];
  validationTargets: string[];
  retryCount: number;
  maxRetries: number;
  artifactIds: string[];
};

type UserStory = {
  id: string;
  title: string;
  description: string;
  status: WorkStatus;
  tasks: WorkTask[];
};

type ExecutionPhase = {
  id: string;
  name: string;
  description: string;
  status: WorkStatus;
  stories: UserStory[];
};

type Handoff = {
  id: string;
  from: WorkflowRole;
  to: WorkflowRole;
  fromAgentTypeId: SpecialistAgentTypeId | null;
  toAgentTypeId: SpecialistAgentTypeId | null;
  reason: string;
  taskIds: string[];
  artifactIds: string[];
  status: "created" | "accepted" | "rejected" | "completed";
  createdAt: string;
};

type InterventionRecord = {
  id: string;
  runId: string;
  phaseId: string | null;
  storyId: string | null;
  taskId: string | null;
  reason: string;
  actionTaken: string;
  createdAt: string;
};

type RuntimeControlPlan = {
  runId: string;
  currentRole: WorkflowRole;
  currentPhaseId: string | null;
  currentStoryId: string | null;
  currentTaskId: string | null;
  phases: ExecutionPhase[];
  artifacts: WorkArtifact[];
  handoffs: Handoff[];
  interventions: InterventionRecord[];
};
```

## Required State Rules

- A task has exactly one owner at a time.
- A task cannot move to `completed` without validation evidence.
- A story cannot move to `completed` unless all of its tasks are validated or explicitly waived.
- A phase cannot move to `completed` unless all of its stories are completed.
- A handoff must record both the source role and target role.
- A handoff should also record specialist identity when specialist work is involved.
- An intervention must be recorded when a human changes plan, ownership, or execution outcome.

## Validation Gates

Validation gates should be represented in state, not implied by agent output.

Examples:

- file mutation validation
- test result validation
- acceptance criteria validation
- rebuild milestone validation

A failed gate should block progression until:

- the task is retried
- the task is reassigned
- the work is explicitly failed

## Trace Expectations

Every meaningful control-plane transition should be traceable.

At minimum trace:

- task created
- task delegated
- task started
- task blocked
- validation passed
- validation failed
- retry scheduled
- handoff created
- handoff accepted
- intervention recorded
- task completed

## Why This Matters

This model keeps the runtime objective.

Without it:

- ownership becomes vague
- agent coordination becomes prompt theater
- validation becomes subjective
- rebuild interventions are lost

With it:

- the runtime can enforce progression
- traces become useful
- the later comparative analysis can be driven by real state and intervention data
