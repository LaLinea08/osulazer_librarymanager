import { useState } from "react";
import {
  BookmarkPlus,
  Copy,
  Download,
  FolderPlus,
  Trash2,
  X,
} from "lucide-react";

export { ProtectedDeletionModal } from "./DeletionModal";

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
        <Trash2 size={15} /> Review deletion
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
