# Model Strategy

## Decision

Use Vercel AI SDK as the model abstraction layer and Anthropic Claude as the primary coding model.

## Why

- Vercel AI SDK keeps provider access behind one integration surface.
- Claude is the initial primary model for coding and reasoning-heavy agent work.
- The runtime should remain provider-agnostic at the SDK layer even if Claude is the default.

## Design Rules

- Do not wire core runtime logic directly to one provider SDK.
- Keep model selection behind a small runtime adapter layer.
- Make prompts and instruction assembly model-agnostic where possible.
- Builder-agent prompts stay separate from runtime prompts.

## Provider Strategy

### Primary

- Anthropic Claude

### Abstraction

- Vercel AI SDK

### Later Options

- secondary providers through the same SDK layer
- routing or gateway strategy if cost, latency, or fallback needs justify it

## Not Doing Yet

- multi-provider routing on day one
- cost-optimization infrastructure before the base runtime is stable
- provider-specific prompt forks unless a real model gap appears

