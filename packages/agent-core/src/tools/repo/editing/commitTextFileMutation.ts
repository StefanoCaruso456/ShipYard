import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RepoToolError } from "../types";
import type { RollbackResult, ValidationResult } from "../../../validation/types";
import type {
  EditedFileValidationFailure,
  EditedFileValidationSuccess
} from "./validateEditedFile";

type CommitTextFileMutationOptions = {
  resolvedPath: string;
  displayPath?: string;
  originalContent: string;
  nextContent: string;
  validate(updatedContent: string):
    | EditedFileValidationFailure
    | EditedFileValidationSuccess;
  rollback?(filePath: string, originalContent: string): Promise<boolean>;
};

type CommitTextFileMutationFailure = {
  ok: false;
  error: RepoToolError;
};

type CommitTextFileMutationSuccess = {
  ok: true;
  updatedContent: string;
  validation: EditedFileValidationSuccess["validation"];
  validationResult: ValidationResult;
};

export async function commitTextFileMutation(
  options: CommitTextFileMutationOptions
): Promise<CommitTextFileMutationFailure | CommitTextFileMutationSuccess> {
  const rollback =
    options.rollback ??
    (async (filePath: string, originalContent: string) =>
      restoreOriginalFile(filePath, originalContent));

  try {
    await mkdir(path.dirname(options.resolvedPath), { recursive: true });
    await writeFile(options.resolvedPath, options.nextContent, "utf8");
  } catch (error) {
    return fail(
      "write_failed",
      error instanceof Error ? error.message : "Failed to write the edited file."
    );
  }

  let updatedContent: string;

  try {
    updatedContent = await readFile(options.resolvedPath, "utf8");
  } catch (error) {
    const rollbackResult = await createRollbackResult(
      rollback,
      options.resolvedPath,
      options.originalContent,
      options.displayPath ?? options.resolvedPath,
      "Restored the original file after the edited file could not be re-read.",
      "Failed to restore the original file after the edited file could not be re-read."
    );

    return fail(
      "write_failed",
      error instanceof Error ? error.message : "Failed to re-read the edited file.",
      undefined,
      rollbackResult
    );
  }

  const validation = options.validate(updatedContent);

  if (!validation.ok) {
    const rollbackResult = await createRollbackResult(
      rollback,
      options.resolvedPath,
      options.originalContent,
      options.displayPath ?? options.resolvedPath,
      "Restored the original file after validation failed.",
      "Failed to restore the original file after validation failed."
    );

    if (!rollbackResult.success) {
      return fail(
        "rollback_failed",
        `${validation.error.message} Rollback to the original file also failed.`,
        validation.error.validationResult,
        rollbackResult
      );
    }

    return {
      ok: false,
      error: {
        ...validation.error,
        rollback: rollbackResult
      }
    };
  }

  return {
    ok: true,
    updatedContent,
    validation: validation.validation,
    validationResult: validation.validationResult
  };
}

async function restoreOriginalFile(filePath: string, originalContent: string) {
  try {
    await writeFile(filePath, originalContent, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function createRollbackResult(
  rollback: (filePath: string, originalContent: string) => Promise<boolean>,
  filePath: string,
  originalContent: string,
  displayPath: string,
  successMessage: string,
  failureMessage: string
): Promise<RollbackResult> {
  const success = await rollback(filePath, originalContent);

  return {
    attempted: true,
    success,
    path: displayPath,
    message: success ? successMessage : failureMessage
  };
}

function fail(
  code: RepoToolError["code"],
  message: string,
  validationResult?: ValidationResult,
  rollback?: RollbackResult
): CommitTextFileMutationFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      validationResult,
      rollback
    }
  };
}
