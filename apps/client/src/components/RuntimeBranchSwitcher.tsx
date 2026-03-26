import { useEffect, useMemo, useRef, useState } from "react";

import type { RuntimeRepoBranchSnapshot } from "../types";

type RuntimeBranchSwitcherProps = {
  snapshot: RuntimeRepoBranchSnapshot | null;
  loading: boolean;
  switchingBranchName: string | null;
  error: string | null;
  onRefresh: () => Promise<void>;
  onSwitchBranch: (branchName: string) => Promise<void>;
};

export function RuntimeBranchSwitcher({
  snapshot,
  loading,
  switchingBranchName,
  error,
  onRefresh,
  onSwitchBranch
}: RuntimeBranchSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setQuery("");
    void onRefresh();

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onRefresh]);

  const filteredBranches = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase();

    if (!trimmedQuery) {
      return snapshot?.branches ?? [];
    }

    return (snapshot?.branches ?? []).filter((branch) =>
      branch.name.toLowerCase().includes(trimmedQuery)
    );
  }, [query, snapshot?.branches]);

  async function handleSwitchBranch(branchName: string) {
    if (branchName === snapshot?.currentBranch || switchingBranchName) {
      setIsOpen(false);
      return;
    }

    await onSwitchBranch(branchName);
    setIsOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className={`runtime-branch-switcher ${isOpen ? "is-open" : ""}`}
    >
      <button
        type="button"
        className="runtime-branch-switcher__trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Switch branch"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={`Switch branch${snapshot?.currentBranch ? ` (${snapshot.currentBranch})` : ""}`}
      >
        <GitBranchIcon />
      </button>

      {isOpen ? (
        <div className="runtime-branch-switcher__panel" role="dialog" aria-label="Switch branch">
          <div className="runtime-branch-switcher__header">
            <strong>Branches</strong>
            <span>{loading ? "Refreshing..." : snapshot?.currentBranch ?? "Runtime repo"}</span>
          </div>

          <label className="runtime-branch-switcher__search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search branches"
              autoFocus
            />
          </label>

          {error ? (
            <p className="runtime-branch-switcher__notice runtime-branch-switcher__notice--danger">
              {error}
            </p>
          ) : null}

          {!error && snapshot?.blockingReason ? (
            <p className="runtime-branch-switcher__notice">{snapshot.blockingReason}</p>
          ) : null}

          <div className="runtime-branch-switcher__list">
            {filteredBranches.length > 0 ? (
              filteredBranches.map((branch) => {
                const disabled =
                  Boolean(switchingBranchName) ||
                  (!snapshot?.canSwitch && !branch.current);

                return (
                  <button
                    key={branch.name}
                    type="button"
                    className={`runtime-branch-switcher__item ${branch.current ? "is-current" : ""}`}
                    onClick={() => void handleSwitchBranch(branch.name)}
                    disabled={disabled}
                  >
                    <span className="runtime-branch-switcher__item-name">
                      <GitBranchIcon />
                      <span>{branch.name}</span>
                    </span>
                    {switchingBranchName === branch.name ? (
                      <span className="runtime-branch-switcher__item-status">Switching...</span>
                    ) : branch.current ? (
                      <CheckIcon />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <p className="runtime-branch-switcher__empty">
                {loading ? "Loading branches..." : "No branches match this search."}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GitBranchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="6" cy="4.75" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="15.25" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="14" cy="9.75" r="1.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.75 4.75h1.1a3.4 3.4 0 0 1 3.4 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12.25 11.5v.55a3.2 3.2 0 0 1-3.2 3.2H7.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M6 6.5v7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.7" cy="8.7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12.8 12.8l3.4 3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 10.2l3 3 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
