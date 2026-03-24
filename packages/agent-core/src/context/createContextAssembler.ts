import type { AgentInstructionRuntime, AgentRole } from "../instructions/types";
import { buildExecutorContext } from "./buildExecutorContext";
import { buildPlannerContext } from "./buildPlannerContext";
import { buildSharedRoleContext } from "./buildSharedRoleContext";
import { buildVerifierContext } from "./buildVerifierContext";
import type {
  ContextAssembler,
  ContextAssemblerRunInput,
  ProjectRulesDocument,
  RuntimeContextPrecedenceLayer
} from "./types";

export const runtimeContextPrecedence: readonly RuntimeContextPrecedenceLayer[] = [
  "runtime/system contract",
  "task objective and current task input",
  "project rules",
  "skill/runtime behavior guidance",
  "live execution context",
  "rolling summary / prior step state"
] as const;

type CreateContextAssemblerOptions = {
  instructionRuntime: AgentInstructionRuntime;
  projectRules: ProjectRulesDocument;
};

export function createContextAssembler(
  options: CreateContextAssemblerOptions
): ContextAssembler {
  return {
    projectRules: options.projectRules,
    precedence: runtimeContextPrecedence,
    buildRolePayload(role: AgentRole, input: ContextAssemblerRunInput) {
      const shared = buildSharedRoleContext({
        instructionRuntime: options.instructionRuntime,
        projectRules: options.projectRules,
        role,
        run: input.run,
        runtimeStatus: input.runtimeStatus
      });

      switch (role) {
        case "planner":
          return buildPlannerContext(shared);
        case "executor":
          return buildExecutorContext(shared);
        case "verifier":
          return buildVerifierContext(shared);
      }
    }
  };
}
