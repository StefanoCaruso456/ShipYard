import { AsyncLocalStorage } from "node:async_hooks";

import type { TraceService, TraceSpan } from "./types";

type ActiveTraceScope = {
  runId: string;
  traceService: TraceService;
  activeSpan: TraceSpan;
};

const traceScopeStorage = new AsyncLocalStorage<ActiveTraceScope>();

export function runWithTraceScope<T>(
  scope: ActiveTraceScope,
  callback: () => T | Promise<T>
): T | Promise<T> {
  return traceScopeStorage.run(scope, callback);
}

export function getActiveTraceScope() {
  return traceScopeStorage.getStore() ?? null;
}
