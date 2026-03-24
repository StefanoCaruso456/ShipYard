export type RepoToolName =
  | "list_files"
  | "read_file"
  | "read_file_range"
  | "search_repo"
  | "edit_file_region"
  | "create_file"
  | "delete_file";

export type RepoToolErrorCode =
  | "already_exists"
  | "anchor_not_found"
  | "ambiguous_match"
  | "binary_file"
  | "command_failed"
  | "invalid_input"
  | "io_error"
  | "location_mismatch"
  | "not_found"
  | "outside_root"
  | "validation_failed"
  | "write_failed";

export type RepoToolError = {
  code: RepoToolErrorCode;
  message: string;
  path?: string;
  query?: string;
  command?: string;
};

export type RepoToolSuccess<Name extends RepoToolName, Data> = {
  ok: true;
  toolName: Name;
  data: Data;
};

export type RepoToolFailure<Name extends RepoToolName> = {
  ok: false;
  toolName: Name;
  error: RepoToolError;
};

export type ListFilesInput = {
  glob?: string;
  limit?: number;
};

export type ListFilesResult =
  | RepoToolSuccess<
      "list_files",
      {
        rootDir: string;
        glob: string | null;
        files: string[];
        totalCount: number;
        truncated: boolean;
      }
    >
  | RepoToolFailure<"list_files">;

export type ReadFileInput = {
  path: string;
};

export type ReadFileResult =
  | RepoToolSuccess<
      "read_file",
      {
        rootDir: string;
        path: string;
        content: string;
        lineCount: number;
      }
    >
  | RepoToolFailure<"read_file">;

export type ReadFileRangeInput = {
  path: string;
  startLine: number;
  endLine: number;
};

export type ReadFileRangeResult =
  | RepoToolSuccess<
      "read_file_range",
      {
        rootDir: string;
        path: string;
        startLine: number;
        endLine: number;
        totalLineCount: number;
        lines: Array<{
          lineNumber: number;
          content: string;
        }>;
        content: string;
      }
    >
  | RepoToolFailure<"read_file_range">;

export type SearchRepoInput = {
  query: string;
  glob?: string;
  limit?: number;
  caseSensitive?: boolean;
};

export type SearchRepoResult =
  | RepoToolSuccess<
      "search_repo",
      {
        rootDir: string;
        query: string;
        glob: string | null;
        caseSensitive: boolean;
        matches: Array<{
          path: string;
          lineNumber: number;
          column: number;
          lineText: string;
        }>;
        truncated: boolean;
      }
    >
  | RepoToolFailure<"search_repo">;

export type EditFileRegionInput = {
  path: string;
  anchor: string;
  currentText: string;
  replacementText: string;
};

export type EditFileRegionResult =
  | RepoToolSuccess<
      "edit_file_region",
      {
        rootDir: string;
        path: string;
        status: "success";
        anchor: string;
        validation: {
          changeApplied: true;
          unchangedOutsideRegion: true;
        };
        changedRegion: {
          startOffset: number;
          endOffset: number;
          before: string;
          after: string;
        };
      }
    >
  | RepoToolFailure<"edit_file_region">;

export type CreateFileInput = {
  path: string;
  content: string;
};

export type CreateFileResult =
  | RepoToolSuccess<
      "create_file",
      {
        rootDir: string;
        path: string;
        status: "success";
        lineCount: number;
      }
    >
  | RepoToolFailure<"create_file">;

export type DeleteFileInput = {
  path: string;
};

export type DeleteFileResult =
  | RepoToolSuccess<
      "delete_file",
      {
        rootDir: string;
        path: string;
        status: "success";
      }
    >
  | RepoToolFailure<"delete_file">;

export type RepoToolMutationResult =
  | EditFileRegionResult
  | CreateFileResult
  | DeleteFileResult;

export type RepoToolset = {
  rootDir: string;
  listFiles(input?: ListFilesInput): Promise<ListFilesResult>;
  readFile(input: ReadFileInput): Promise<ReadFileResult>;
  readFileRange(input: ReadFileRangeInput): Promise<ReadFileRangeResult>;
  searchRepo(input: SearchRepoInput): Promise<SearchRepoResult>;
  editFileRegion(input: EditFileRegionInput): Promise<EditFileRegionResult>;
  createFile(input: CreateFileInput): Promise<CreateFileResult>;
  deleteFile(input: DeleteFileInput): Promise<DeleteFileResult>;
};
