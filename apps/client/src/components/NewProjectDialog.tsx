import type { FormEvent } from "react";

type NewProjectDialogProps = {
  open: boolean;
  projectName: string;
  folderName: string | null;
  pickerSupported: boolean;
  error: string | null;
  onProjectNameChange: (value: string) => void;
  onPickFolder: () => Promise<void>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function NewProjectDialog({
  open,
  projectName,
  folderName,
  pickerSupported,
  error,
  onProjectNameChange,
  onPickFolder,
  onClose,
  onSubmit
}: NewProjectDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <div>
            <h3 id="new-project-title">Create project</h3>
            <p>Bind a sidebar project to a local folder in this browser before you start threads.</p>
          </div>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close project dialog">
            <CloseIcon />
          </button>
        </div>

        <form className="dialog__body" onSubmit={onSubmit}>
          <label className="dialog__field">
            <span>Project name</span>
            <input
              type="text"
              value={projectName}
              onChange={(event) => onProjectNameChange(event.target.value)}
              placeholder="My local workspace"
              autoFocus
            />
          </label>

          <div className="dialog__field">
            <span>Local folder</span>
            <div className="dialog__folder-row">
              <button
                type="button"
                className="dialog__folder-button"
                onClick={() => void onPickFolder()}
                disabled={!pickerSupported}
              >
                <FolderIcon />
                <span>{folderName ? "Reconnect folder" : "Choose folder"}</span>
              </button>
              <div className="dialog__folder-status">
                <strong>{folderName ?? "No folder selected"}</strong>
                <span>
                  {pickerSupported
                    ? folderName
                      ? "Connected in this browser session."
                      : "Use the browser folder picker to bind this project."
                    : "This browser does not support local folder connections."}
                </span>
              </div>
            </div>
          </div>

          {error ? <p className="dialog__error">{error}</p> : null}

          <div className="dialog__actions">
            <button type="button" className="dialog__secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="dialog__primary-button" disabled={!folderName}>
              Create project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M3.5 6.5h4l1.2 1.6h7.8v6.2a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2V7.7a1.2 1.2 0 0 1 1.2-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6 6 14 14M14 6l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
