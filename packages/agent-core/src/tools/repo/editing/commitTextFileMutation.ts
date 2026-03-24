import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RepoToolError } from "../types";
import type {
  EditedFileValidationFailure,
  EditedFileValidationSuccess
} from "./validateEditedFile";

type CommitTextFileMutationOptions = {
  resolvedPath: string;
  originalContent: string;
  nextContent: string;
  validate(updatedContent: string):
    | EditedFileValidationFailure
    | EditedFileValidationSuccess;
};

type CommitTextFileMutationFailure = {
  ok: false;
  error: RepoToolError;
};

type CommitTextFileMutationSuccess = {
  ok: true;
  updatedContent: string;
  validation: EditedFileValidationSuccess["validation"];
};

export async function commitTextFileMutation(
  options: CommitTextFileMutationOptions
): Promise<CommitTextFileMutationFailure | CommitTextFileMutationSuccess> {
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
    await restoreOriginalFile(options.resolvedPath, options.originalContent);

    return fail(
      "write_failed",
      error instanceof Error ? error.message : "Failed to re-read the edited file."
    );
  }

  const validation = options.validate(updatedContent);

  if (!validation.ok) {
    const rollbackSucceeded = await restoreOriginalFile(
      options.resolvedPath,
      options.originalContent
    );

    if (!rollbackSucceeded) {
      return fail(
        "write_failed",
        `${validation.error.message} Rollback to the original file also failed.`
      );
    }

    return {
      ok: false,
      error: validation.error
    };
  }

  return {
    ok: true,
    updatedContent,
    validation: validation.validation
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

function fail(code: RepoToolError["code"], message: string): CommitTextFileMutationFailure {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}
