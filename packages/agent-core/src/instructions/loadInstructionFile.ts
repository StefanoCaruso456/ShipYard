import { readFile } from "node:fs/promises";
import path from "node:path";

export type LoadedInstructionFile = {
  resolvedPath: string;
  source: string;
};

export async function loadInstructionFile(
  filePath: string,
  rootDir = process.cwd()
): Promise<LoadedInstructionFile> {
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(rootDir, filePath);

  try {
    const source = await readFile(resolvedPath, "utf8");
    return {
      resolvedPath,
      source
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown instruction file read failure.";
    throw new Error(`Failed to load instruction file at ${resolvedPath}: ${message}`);
  }
}

