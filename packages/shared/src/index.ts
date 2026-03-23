export const projectBrief = {
  name: "Shipyard",
  tagline:
    "Build an autonomous coding agent that can edit code surgically, accept injected context, coordinate multiple agents, and later rebuild the Ship app as proof.",
  what: [
    "A persistent coding agent that accepts instructions without restarting.",
    "Surgical file editing instead of whole-file rewrites.",
    "Context injection, tracing, and multi-agent coordination.",
    "A Ship app rebuild used as the real integration test."
  ],
  why: [
    "The challenge rewards system design, not just fast code generation.",
    "Reliable edits and observability are what separate a useful agent from a liability."
  ],
  how: [
    "The client will become the operator surface for tasks, traces, and rebuild visibility.",
    "The server will host the agent loop, tool execution, and orchestration.",
    "Shared packages keep product intent and agent contracts consistent across the repo."
  ],
  outcome: [
    "A traceable coding agent with a documented architecture.",
    "A rebuilt version of Ship created through the agent.",
    "A clear comparative analysis of what worked, what failed, and what to change next."
  ],
  nextStep: "Complete PRESEARCH and lock the architecture before deeper implementation."
} as const;

export type ProjectBrief = typeof projectBrief;

