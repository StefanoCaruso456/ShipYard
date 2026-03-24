# Model Strategy

## Decision

Use Vercel AI SDK as the model abstraction layer and keep the runtime provider-agnostic.

## Why

- Vercel AI SDK keeps provider access behind one integration surface.
- The runtime should stay flexible as model needs change.
- The current server wiring already supports OpenAI through the SDK.

## Design Rules

- Do not wire core runtime logic directly to one provider SDK.
- Keep model selection behind a small runtime adapter layer.
- Make prompts and instruction assembly model-agnostic where possible.
- Builder-agent prompts stay separate from runtime prompts.

## Provider Strategy

### Current Runtime Wiring

- OpenAI through Vercel AI SDK

### Abstraction

- Vercel AI SDK

### Later Options

- additional providers through the same SDK layer
- routing or gateway strategy if cost, latency, or fallback needs justify it

## Not Doing Yet

- multi-provider routing on day one
- cost-optimization infrastructure before the base runtime is stable
- provider-specific prompt forks unless a real model gap appears
