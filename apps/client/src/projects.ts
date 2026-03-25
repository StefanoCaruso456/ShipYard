import type { WorkspaceProject, WorkspaceProjectFolderStatus } from "./types";

const LOCAL_PROJECTS_STORAGE_KEY = "shipyard.local-projects.v1";
const DIRECTORY_HANDLE_DB = "shipyard-project-handles";
const DIRECTORY_HANDLE_STORE = "directories";

type PermissionMode = "read" | "readwrite";

export type BrowserWritableFileStream = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};

export type BrowserFileHandle = {
  createWritable: () => Promise<BrowserWritableFileStream>;
};

export type BrowserDirectoryHandle = {
  name: string;
  queryPermission?: (descriptor?: { mode?: PermissionMode }) => Promise<PermissionState | "granted" | "denied" | "prompt">;
  requestPermission?: (descriptor?: { mode?: PermissionMode }) => Promise<PermissionState | "granted" | "denied" | "prompt">;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<BrowserDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: PermissionMode }) => Promise<BrowserDirectoryHandle>;
};

type StoredLocalProject = WorkspaceProject & {
  kind: "local";
};

export type PickedProjectDirectory = {
  handle: BrowserDirectoryHandle;
  folderName: string;
};

export function createRuntimeProject(): WorkspaceProject {
  return {
    id: "shipyard-runtime",
    name: "Shipyard Runtime",
    code: "SR",
    environment: "Live backend",
    description: "Connected to the persistent runtime service and run registry.",
    kind: "live",
    region: "Railway / Vercel",
    branchLabel: "main",
    folder: null,
    removable: false
  };
}

export function loadStoredLocalProjects(): WorkspaceProject[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_PROJECTS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isStoredLocalProject);
  } catch {
    return [];
  }
}

export function saveStoredLocalProjects(projects: WorkspaceProject[]) {
  if (typeof window === "undefined") {
    return;
  }

  const localProjects = projects.filter(
    (project): project is StoredLocalProject => project.kind === "local"
  );

  window.localStorage.setItem(LOCAL_PROJECTS_STORAGE_KEY, JSON.stringify(localProjects));
}

export function supportsProjectDirectoryPicker() {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

export async function pickProjectDirectory(): Promise<PickedProjectDirectory> {
  if (typeof window === "undefined") {
    throw new Error("Local folder selection is only available in the browser.");
  }

  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;

  if (typeof picker !== "function") {
    throw new Error("This browser does not support local folder connections.");
  }

  const handle = await picker({ mode: "readwrite" });

  return {
    handle,
    folderName: handle.name
  };
}

export async function persistProjectDirectoryHandle(projectId: string, handle: BrowserDirectoryHandle) {
  const db = await openDirectoryHandleDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_HANDLE_STORE, "readwrite");
    const store = transaction.objectStore(DIRECTORY_HANDLE_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Failed to store project directory handle."));
    store.put(handle, projectId);
  });
}

export async function removePersistedProjectDirectoryHandle(projectId: string) {
  const db = await openDirectoryHandleDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_HANDLE_STORE, "readwrite");
    const store = transaction.objectStore(DIRECTORY_HANDLE_STORE);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Failed to remove project directory handle."));
    store.delete(projectId);
  });
}

export async function resolveStoredProjectFolderStatus(
  projectId: string
): Promise<WorkspaceProjectFolderStatus> {
  const handle = await getPersistedProjectDirectoryHandle(projectId);

  if (!handle) {
    return "needs-access";
  }

  if (typeof handle.queryPermission !== "function") {
    return "connected";
  }

  try {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    return permission === "granted" ? "connected" : "needs-access";
  } catch {
    return "needs-access";
  }
}

export function createLocalProject({
  projectId = `project-${crypto.randomUUID()}`,
  name,
  folderName
}: {
  projectId?: string;
  name: string;
  folderName: string;
}): WorkspaceProject {
  const trimmedName = name.trim();
  const resolvedName = trimmedName || prettifyFolderName(folderName);
  const now = new Date().toISOString();

  return {
    id: projectId,
    name: resolvedName,
    code: deriveProjectCode(resolvedName),
    environment: "Local folder",
    description: "Connected in this browser through the File System Access API.",
    kind: "local",
    region: "Browser workspace",
    branchLabel: null,
    folder: {
      name: folderName,
      displayPath: folderName,
      status: "connected",
      provider: "browser-file-system-access",
      lastConnectedAt: now
    },
    removable: true
  };
}

export function updateLocalProjectFolder(
  project: WorkspaceProject,
  folderName: string,
  status: WorkspaceProjectFolderStatus
): WorkspaceProject {
  if (project.kind !== "local") {
    return project;
  }

  return {
    ...project,
    folder: {
      name: folderName,
      displayPath: folderName,
      status,
      provider: "browser-file-system-access",
      lastConnectedAt: new Date().toISOString()
    }
  };
}

async function getPersistedProjectDirectoryHandle(projectId: string): Promise<BrowserDirectoryHandle | null> {
  const db = await openDirectoryHandleDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_HANDLE_STORE, "readonly");
    const store = transaction.objectStore(DIRECTORY_HANDLE_STORE);
    const request = store.get(projectId);

    request.onsuccess = () => resolve((request.result as BrowserDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to read project directory handle."));
  });
}

export async function getProjectDirectoryHandle(projectId: string) {
  return getPersistedProjectDirectoryHandle(projectId);
}

async function openDirectoryHandleDatabase() {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this browser.");
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DIRECTORY_HANDLE_DB, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(DIRECTORY_HANDLE_STORE)) {
        database.createObjectStore(DIRECTORY_HANDLE_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open project directory database."));
  });
}

function isStoredLocalProject(value: unknown): value is StoredLocalProject {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredLocalProject>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    candidate.kind === "local" &&
    typeof candidate.code === "string" &&
    typeof candidate.environment === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.region === "string" &&
    typeof candidate.removable === "boolean"
  );
}

function prettifyFolderName(folderName: string) {
  return folderName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function deriveProjectCode(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase());

  return letters.join("") || "PR";
}
