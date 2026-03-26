import {
  createContextAssembler,
  createFileRunStore,
  createPostgresRunStore,
  createPersistentRuntimeService,
  createRepoToolset,
  type AgentRunStore,
  type ContextAssembler,
  type PersistentAgentRuntimeService
} from "@shipyard/agent-core";

import path from "node:path";

import { bootAgentRuntime } from "./bootAgentRuntime";
import {
  createAudioTranscriber,
  resolveAudioTranscriptionConfig
} from "./createAudioTranscriber";
import { createRepoBranchService } from "./createRepoBranchService";
import { createTraceService } from "../observability/createTraceService";
import {
  resolveOpenAIExecutorConfig,
  type OpenAIExecutorConfig
} from "./createOpenAIExecutor";
import { createRuntimeExecutor } from "./createRuntimeExecutor";
import { loadProjectRules } from "./loadProjectRules";
import { resolveWorkspaceRoot } from "./resolveWorkspaceRoot";

export type BootedRuntimeService = {
  runtimeService: PersistentAgentRuntimeService;
  contextAssembler: ContextAssembler;
  openAI: OpenAIExecutorConfig;
  audioTranscriber: ReturnType<typeof createAudioTranscriber>;
  runtimeStatePath: string | null;
  runtimeStore: RuntimeStoreDescriptor;
  repoBranchService: ReturnType<typeof createRepoBranchService>;
  traceService: ReturnType<typeof createTraceService>;
  traceLogPath: string;
};

export type RuntimeStoreDescriptor = {
  kind: "file" | "postgres";
  location: string;
};

export async function bootRuntimeService(): Promise<BootedRuntimeService> {
  const rootDir = await resolveWorkspaceRoot();
  const instructionRuntime = await bootAgentRuntime(rootDir);
  const projectRules = await loadProjectRules(rootDir);
  const openAI = resolveOpenAIExecutorConfig();
  const audioTranscriber = createAudioTranscriber({
    config: resolveAudioTranscriptionConfig()
  });
  const traceLogPath = resolveTraceLogPath(rootDir);
  const traceService = createTraceService({
    logPath: traceLogPath
  });
  const repoBranchService = createRepoBranchService({
    rootDir
  });
  const repoToolset = createRepoToolset({
    rootDir
  });
  const contextAssembler = createContextAssembler({
      instructionRuntime,
      projectRules
  });
  const { store, runtimeStatePath, runtimeStore } = createConfiguredRunStore(rootDir);

  return {
    runtimeService: await createPersistentRuntimeService({
      instructionRuntime,
      contextAssembler,
      store,
      traceService,
      executeRun: createRuntimeExecutor({
        openAI,
        repoToolset
      })
    }),
    contextAssembler,
    openAI,
    audioTranscriber,
    runtimeStatePath,
    runtimeStore,
    repoBranchService,
    traceService,
    traceLogPath
  };
}

function createConfiguredRunStore(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): {
  store: AgentRunStore;
  runtimeStatePath: string | null;
  runtimeStore: RuntimeStoreDescriptor;
} {
  const mode = resolveRuntimeStoreMode(env);
  const databaseUrl = env.DATABASE_URL?.trim();

  if (mode === "postgres" || (mode === "auto" && databaseUrl)) {
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL is required when SHIPYARD_RUNTIME_STORE=postgres."
      );
    }

    const schemaName = env.SHIPYARD_RUNTIME_PG_SCHEMA?.trim() || "public";
    const tableName = env.SHIPYARD_RUNTIME_PG_TABLE?.trim() || "agent_runs";

    return {
      store: createPostgresRunStore({
        connectionString: databaseUrl,
        schemaName,
        tableName
      }),
      runtimeStatePath: null,
      runtimeStore: {
        kind: "postgres",
        location: `${schemaName}.${tableName}`
      }
    };
  }

  const runtimeStatePath = resolveRuntimeStatePath(rootDir, env);

  return {
    store: createFileRunStore({
      filePath: runtimeStatePath
    }),
    runtimeStatePath,
    runtimeStore: {
      kind: "file",
      location: runtimeStatePath
    }
  };
}

function resolveRuntimeStoreMode(env: NodeJS.ProcessEnv = process.env) {
  const configuredMode = env.SHIPYARD_RUNTIME_STORE?.trim().toLowerCase() || "auto";

  if (
    configuredMode === "auto" ||
    configuredMode === "file" ||
    configuredMode === "postgres"
  ) {
    return configuredMode;
  }

  throw new Error(
    `Unsupported SHIPYARD_RUNTIME_STORE value: ${configuredMode}. Expected auto, file, or postgres.`
  );
}

function resolveRuntimeStatePath(rootDir: string, env: NodeJS.ProcessEnv = process.env) {
  const configuredPath = env.SHIPYARD_RUNTIME_STATE_PATH?.trim();

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  if (env.NODE_ENV === "production") {
    return path.resolve("/tmp/shipyard/runtime/runs.json");
  }

  return path.resolve(rootDir, ".shipyard/runtime/runs.json");
}

function resolveTraceLogPath(rootDir: string, env: NodeJS.ProcessEnv = process.env) {
  const configuredPath = env.SHIPYARD_TRACE_LOG_PATH?.trim();

  if (configuredPath) {
    return path.resolve(configuredPath);
  }

  if (env.NODE_ENV === "production") {
    return path.resolve("/tmp/shipyard/runtime/traces.jsonl");
  }

  return path.resolve(rootDir, ".shipyard/runtime/traces.jsonl");
}
