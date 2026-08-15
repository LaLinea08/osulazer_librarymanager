import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  Database,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  DeletionPreview,
  DeletionResult,
  LibraryQuery,
  SerializableSelection,
} from "../../../shared/contracts";
import { formatBytes } from "../lib/format";

interface ProtectedDeletionModalProps {
  open: boolean;
  query: LibraryQuery;
  selection: SerializableSelection;
  filterLabels: string[];
  onClose: () => void;
  onMutation: (result: DeletionResult) => Promise<void>;
}

function resultTitle(result: DeletionResult): string {
  if (result.status === "restored") return "Queued deletion restored";
  if (result.status === "failed") return "Protected operation failed";
  if (result.status === "finalized")
    return "Automatic restore is no longer available";
  if (result.status === "queued")
    return "Deletion queued with a verified backup";
  return "Recovery checkpoint created";
}

function resultHeading(result: DeletionResult): string {
  if (result.status === "restored") return "DeletePending cleared";
  if (result.status === "failed") return "Protected write failed";
  if (result.status === "finalized") return "osu!lazer cleanup finalized";
  if (result.status === "queued")
    return result.affectedSets.toLocaleString() + " sets queued";
  return "Recovery backup prepared";
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "at an unavailable time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

export function ProtectedDeletionModal({
  open,
  query,
  selection,
  filterLabels,
  onClose,
  onMutation,
}: ProtectedDeletionModalProps): React.JSX.Element | null {
  const confirmationHintId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [result, setResult] = useState<DeletionResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"delete" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.libraryManager
      .previewDeletion(query, selection)
      .then((nextPreview) => {
        if (!cancelled) setPreview(nextPreview);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "The deletion preview could not be prepared.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, reloadToken, selection]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => previouslyFocused?.focus();
  }, []);

  if (!open) return null;

  const execute = async (): Promise<void> => {
    if (
      !preview ||
      !preview.canExecute ||
      confirmation !== preview.confirmationPhrase
    )
      return;
    setBusy("delete");
    setError(null);
    try {
      const nextResult = await window.libraryManager.executeDeletion(
        preview.previewId,
        confirmation,
      );
      setResult(nextResult);
      setConfirmation("");
      try {
        await onMutation(nextResult);
      } catch (caught) {
        setError(
          "Deletion completed, but the interface could not refresh: " +
            (caught instanceof Error ? caught.message : "unknown error"),
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Deletion could not run.",
      );
    } finally {
      setBusy(null);
    }
  };

  const restore = async (): Promise<void> => {
    if (!result?.canRestore) return;
    setBusy("restore");
    setError(null);
    try {
      const restored = await window.libraryManager.restoreQuarantine(
        result.operationId,
      );
      setResult(restored);
      try {
        await onMutation(restored);
      } catch (caught) {
        setError(
          "Restore completed, but the interface could not refresh: " +
            (caught instanceof Error ? caught.message : "unknown error"),
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Restore could not run.",
      );
    } finally {
      setBusy(null);
    }
  };

  const close = (): void => {
    if (!busy) onClose();
  };

  const handleDialogKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={close} role="presentation">
      <section
        aria-busy={loading || Boolean(busy)}
        aria-describedby="delete-preview-description"
        aria-labelledby="delete-preview-title"
        aria-modal="true"
        className="modal safety-modal protected-delete-modal"
        onKeyDown={handleDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header className="modal-header danger-header">
          <div className="danger-modal-icon">
            <AlertTriangle size={23} />
          </div>
          <div>
            <span className="eyebrow">
              {result ? "Recovery checkpoint" : "Protected write"}
            </span>
            <h2 id="delete-preview-title">
              {result ? resultTitle(result) : "Review whole-set deletion"}
            </h2>
            <p id="delete-preview-description">
              {result
                ? result.message
                : "Nothing changes until every safety check passes and you enter the exact confirmation phrase."}
            </p>
          </div>
          <button
            aria-label="Close deletion review"
            className="icon-button"
            disabled={Boolean(busy)}
            onClick={close}
            type="button"
          >
            <X size={19} />
          </button>
        </header>

        <div className="modal-content">
          {loading && (
            <div className="delete-preview-loading" role="status">
              <LoaderCircle className="spin" size={24} />
              <strong>Building an exact deletion plan</strong>
              <span>
                Rechecking the fresh index, protected sets, and backup size.
              </span>
            </div>
          )}

          {!loading && error && !preview && !result && (
            <div className="deletion-error" role="alert">
              <AlertTriangle size={20} />
              <div>
                <strong>Preview unavailable</strong>
                <p>{error}</p>
              </div>
              <button
                className="secondary-button small"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setReloadToken((value) => value + 1);
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          )}

          {result && (
            <div className="deletion-result">
              <div
                className={
                  "result-banner " +
                  (result.status === "restored" ? "restored" : result.status)
                }
                role="status"
              >
                {result.status === "failed" ? (
                  <AlertTriangle size={24} />
                ) : result.status === "restored" ? (
                  <RotateCcw size={24} />
                ) : (
                  <CheckCircle2 size={24} />
                )}
                <div>
                  <strong>{resultHeading(result)}</strong>
                  <span>{result.message}</span>
                </div>
              </div>
              <div className="preview-summary four">
                <div>
                  <span>Affected sets</span>
                  <strong>{result.affectedSets.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Difficulties</span>
                  <strong>
                    {result.affectedDifficulties.toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span>Logical resources</span>
                  <strong>{formatBytes(result.logicalBytes)}</strong>
                </div>
                <div>
                  <span>Recovery backup</span>
                  <strong>{formatBytes(result.uniqueBackupBytes)}</strong>
                </div>
              </div>
              <section className="preview-section recovery-section">
                <h3>Recovery location</h3>
                <div className="recovery-path">
                  <code>{result.backupPath}</code>
                  <button
                    aria-label="Copy recovery path"
                    className="icon-button subtle"
                    onClick={() =>
                      void window.libraryManager.copyText(result.backupPath)
                    }
                    title="Copy recovery path"
                    type="button"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <p>
                  Keep this backup until osu!lazer has started normally and you
                  have verified the remaining library.
                </p>
              </section>
              {result.canRestore ? (
                <div className="restore-window-note">
                  <ArchiveRestore size={20} />
                  <div>
                    <strong>Undo is still available</strong>
                    <span>
                      Restore now, before osu!lazer starts and processes its
                      queued cleanup.
                    </span>
                  </div>
                </div>
              ) : (
                result.restoreBlockedReason && (
                  <div className="deletion-blockers compact">
                    <AlertTriangle size={18} />
                    <span>{result.restoreBlockedReason}</span>
                  </div>
                )
              )}
            </div>
          )}

          {preview && !result && (
            <>
              <div className="preview-summary four">
                <div>
                  <span>Selected difficulties</span>
                  <strong>
                    {preview.selectedDifficulties.toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span>Whole-set difficulties</span>
                  <strong>
                    {preview.affectedDifficulties.toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span>Affected sets</span>
                  <strong>{preview.affectedSets.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Logical resources</span>
                  <strong>{formatBytes(preview.logicalBytes)}</strong>
                </div>
              </div>

              {preview.affectedDifficulties > preview.selectedDifficulties && (
                <div className="deletion-expansion">
                  <AlertTriangle size={19} />
                  <div>
                    <strong>Selection expands to whole beatmap sets</strong>
                    <span>
                      osu!lazer deletes at set level. This adds{" "}
                      {(
                        preview.affectedDifficulties -
                        preview.selectedDifficulties
                      ).toLocaleString()}{" "}
                      difficulties that share the selected sets.
                    </span>
                  </div>
                </div>
              )}

              {preview.blockers.length > 0 && (
                <div className="deletion-blockers" role="alert">
                  <AlertTriangle size={20} />
                  <div>
                    <strong>Deletion is blocked</strong>
                    <ul>
                      {preview.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <section className="preview-section">
                <h3>Verified recovery backup</h3>
                <div className="backup-estimate">
                  <Database size={20} />
                  <div>
                    <strong>{formatBytes(preview.uniqueBackupBytes)}</strong>
                    <span>
                      Conservative estimate for the Realm copy, verified blob
                      copies, and importable .olz archives.
                    </span>
                  </div>
                </div>
              </section>

              <section className="preview-section">
                <h3>Representative beatmap sets</h3>
                <div className="preview-examples">
                  {preview.examples.map((example, index) => (
                    <div
                      key={
                        String(example.beatmapSetId ?? "local") + "-" + index
                      }
                    >
                      <strong>
                        {example.artist} - {example.title}
                      </strong>
                      <span>
                        {example.difficultyCount.toLocaleString()} difficulties
                        {" / "}
                        {formatBytes(example.logicalBytes)} / mapped by{" "}
                        {example.mapper}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="preview-section">
                <h3>Filters responsible</h3>
                {filterLabels.length ? (
                  <div className="preview-chips">
                    {filterLabels.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                ) : (
                  <p>No filters - items were selected manually.</p>
                )}
              </section>

              <div className="mutation-explanation">
                <ShieldCheck size={21} />
                <div>
                  <strong>How the protected write works</strong>
                  <p>
                    The app first verifies a recovery copy, then sets
                    osu!lazer&apos;s official <code>DeletePending</code> flag in
                    one Realm transaction. It never deletes or moves source
                    blobs. osu!lazer performs reference-aware cleanup on its
                    next start.
                  </p>
                </div>
              </div>

              <label className="confirmation-field">
                <span>Type the exact phrase to enable deletion</span>
                <code>{preview.confirmationPhrase}</code>
                <input
                  aria-describedby={confirmationHintId}
                  autoComplete="off"
                  disabled={!preview.canExecute || Boolean(busy)}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={preview.confirmationPhrase}
                  spellCheck="false"
                  value={confirmation}
                />
                <small id={confirmationHintId}>
                  Preview expires {formatExpiry(preview.expiresAt)}. A final
                  native confirmation follows.
                </small>
              </label>
            </>
          )}

          {error && (preview || result) && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="modal-footer">
          {result ? (
            <>
              {result.canRestore && (
                <button
                  className="secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => void restore()}
                  type="button"
                >
                  {busy === "restore" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <ArchiveRestore size={15} />
                  )}
                  Undo queued deletion
                </button>
              )}
              <div className="spacer" />
              <button
                className="primary-button"
                disabled={Boolean(busy)}
                onClick={close}
                type="button"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                autoFocus
                className="secondary-button"
                disabled={Boolean(busy)}
                onClick={close}
                type="button"
              >
                Cancel
              </button>
              <div className="spacer" />
              <button
                className="danger-button"
                disabled={
                  !preview?.canExecute ||
                  confirmation !== preview.confirmationPhrase ||
                  Boolean(busy)
                }
                onClick={() => void execute()}
                type="button"
              >
                {busy === "delete" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                Back up and queue deletion
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
