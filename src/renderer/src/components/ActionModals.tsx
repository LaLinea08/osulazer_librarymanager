import { useState } from "react";
import {
  AlertTriangle,
  BookmarkPlus,
  Copy,
  Download,
  FolderPlus,
  ShieldX,
  Trash2,
  X,
} from "lucide-react";
import type { BeatmapDifficulty } from "../../../shared/contracts";
import { formatBytes } from "../lib/format";

interface BulkToolbarProps {
  selectedCount: number;
  selectedAllFiltered: boolean;
  onClear: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onInvert: () => void;
}

export function BulkToolbar({
  selectedCount,
  selectedAllFiltered,
  onClear,
  onCopy,
  onDelete,
  onInvert,
}: BulkToolbarProps): React.JSX.Element {
  return (
    <div className="bulk-toolbar">
      <div className="bulk-count">
        <strong>{selectedCount.toLocaleString()}</strong>
        <span>
          {selectedAllFiltered
            ? "matching difficulties selected"
            : "difficulties selected"}
        </span>
      </div>
      <div className="bulk-divider" />
      <button disabled title="Collection writes are unavailable" type="button">
        <FolderPlus size={15} /> Add to collection
      </button>
      <button
        disabled
        title="Export reconstruction is not yet verified"
        type="button"
      >
        <Download size={15} /> Export
      </button>
      <button onClick={onCopy} type="button">
        <Copy size={15} /> Copy metadata
      </button>
      <button onClick={onInvert} type="button">
        Invert loaded
      </button>
      <div className="spacer" />
      <button className="danger-action" onClick={onDelete} type="button">
        <Trash2 size={15} /> Delete
      </button>
      <button
        aria-label="Clear selection"
        className="icon-button"
        onClick={onClear}
        type="button"
      >
        <X size={17} />
      </button>
    </div>
  );
}

interface DeleteSafetyModalProps {
  open: boolean;
  selectedCount: number;
  filteredSets: number;
  logicalBytes: number;
  filterLabels: string[];
  examples: BeatmapDifficulty[];
  onClose: () => void;
}

export function DeleteSafetyModal({
  open,
  selectedCount,
  filteredSets,
  logicalBytes,
  filterLabels,
  examples,
  onClose,
}: DeleteSafetyModalProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="delete-preview-title"
        aria-modal="true"
        className="modal safety-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal-header danger-header">
          <div className="danger-modal-icon">
            <AlertTriangle size={23} />
          </div>
          <div>
            <span className="eyebrow">Operation preview</span>
            <h2 id="delete-preview-title">
              Deletion is blocked by the safety layer
            </h2>
            <p>
              The selection is summarized below, but this build cannot safely
              modify osu!lazer.
            </p>
          </div>
          <button
            aria-label="Close preview"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={19} />
          </button>
        </header>
        <div className="modal-content">
          <div className="preview-summary">
            <div>
              <span>Selected difficulties</span>
              <strong>{selectedCount.toLocaleString()}</strong>
            </div>
            <div>
              <span>Matching sets</span>
              <strong>{filteredSets.toLocaleString()}</strong>
            </div>
            <div>
              <span>Logical set resources</span>
              <strong>{formatBytes(logicalBytes)}</strong>
            </div>
          </div>
          <section className="preview-section">
            <h3>Filters responsible</h3>
            {filterLabels.length ? (
              <div className="preview-chips">
                {filterLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            ) : (
              <p>No filters — items were selected manually.</p>
            )}
          </section>
          <section className="preview-section">
            <h3>Representative difficulties</h3>
            <div className="preview-examples">
              {examples.slice(0, 5).map((record) => (
                <div key={record.id}>
                  <strong>
                    {record.artist} – {record.title}
                  </strong>
                  <span>
                    {record.difficultyName} · {record.mapper}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <div className="blocked-explanation">
            <ShieldX size={21} />
            <div>
              <strong>Why this cannot continue</strong>
              <p>
                osu!lazer stores resources as shared SHA-256 blobs and manages
                deletion through Realm lifecycle rules. There is no supported
                external mutation API, so moving blobs or editing Realm would
                risk corruption.
              </p>
            </div>
          </div>
        </div>
        <footer className="modal-footer">
          <button className="secondary-button" onClick={onClose} type="button">
            Close preview
          </button>
          <div className="spacer" />
          <button className="danger-button" disabled type="button">
            <Trash2 size={15} /> Delete unavailable
          </button>
        </footer>
      </section>
    </div>
  );
}

interface SaveSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

export function SaveSearchModal({
  open,
  onClose,
  onSave,
}: SaveSearchModalProps): React.JSX.Element | null {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError("Enter a name for this saved filter.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this filter.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-modal="true"
        className="modal save-search-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="modal-header">
          <div className="save-icon">
            <BookmarkPlus size={20} />
          </div>
          <div>
            <span className="eyebrow">Saved filter</span>
            <h2>Name this library view</h2>
            <p>Saved filters update dynamically after every successful scan.</p>
          </div>
          <button
            aria-label="Close"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-content">
          <label className="field-label">
            Name
            <input
              autoFocus
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="e.g. Old 4★ Maps"
              value={name}
            />
          </label>
          {error && <div className="inline-error">{error}</div>}
        </div>
        <footer className="modal-footer">
          <div className="spacer" />
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void submit()}
            type="button"
          >
            Save filter
          </button>
        </footer>
      </section>
    </div>
  );
}
