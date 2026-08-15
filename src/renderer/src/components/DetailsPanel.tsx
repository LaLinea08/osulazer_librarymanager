import {
  Copy,
  ExternalLink,
  FileAudio,
  Film,
  Image,
  ShieldCheck,
  X,
} from "lucide-react";
import type { BeatmapDifficulty } from "../../../shared/contracts";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatRelativeDate,
  titleCase,
} from "../lib/format";

interface DetailsPanelProps {
  record: BeatmapDifficulty | null;
  onClose: () => void;
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>{value ?? "Unavailable"}</dd>
    </div>
  );
}

export function DetailsPanel({
  record,
  onClose,
}: DetailsPanelProps): React.JSX.Element | null {
  if (!record) return null;
  const onlineUrl = record.beatmapId
    ? `https://osu.ppy.sh/beatmaps/${record.beatmapId}`
    : record.beatmapSetId
      ? `https://osu.ppy.sh/beatmapsets/${record.beatmapSetId}`
      : null;
  const copySummary = `${record.artist} – ${record.title} [${record.difficultyName}] by ${record.mapper}`;

  return (
    <aside aria-label="Beatmap details" className="details-panel">
      <header className={`details-hero mode-${record.mode}`}>
        <button
          aria-label="Close details"
          className="icon-button details-close"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>
        <div className="details-art" aria-hidden="true">
          <span>
            {record.mode === "unknown" ? "?" : record.mode[0]?.toUpperCase()}
          </span>
        </div>
        <div className="details-title">
          <span>{record.artist}</span>
          <h2>{record.title}</h2>
          <p>{record.difficultyName}</p>
        </div>
      </header>
      <div className="details-actions">
        <button
          className="secondary-button small"
          onClick={() => void window.libraryManager.copyText(copySummary)}
          type="button"
        >
          <Copy size={14} /> Copy title
        </button>
        <button
          className="secondary-button small"
          disabled={!onlineUrl}
          onClick={() =>
            onlineUrl && void window.libraryManager.openExternal(onlineUrl)
          }
          type="button"
        >
          <ExternalLink size={14} /> osu! page
        </button>
      </div>
      <div className="details-scroll">
        <section className="detail-section">
          <h3>Difficulty</h3>
          <dl className="detail-grid four">
            <Detail
              label="Stars"
              value={
                record.starRating === null
                  ? "Unavailable"
                  : `${record.starRating.toFixed(2)}★`
              }
            />
            <Detail
              label="BPM"
              value={
                record.bpm === null ? "Unavailable" : Math.round(record.bpm)
              }
            />
            <Detail
              label="Length"
              value={formatDuration(record.durationSeconds)}
            />
            <Detail
              label="Mode"
              value={record.mode === "unknown" ? "Unavailable" : record.mode}
            />
            <Detail
              label="AR"
              value={record.approachRate?.toFixed(1) ?? "Unavailable"}
            />
            <Detail
              label="OD"
              value={record.overallDifficulty?.toFixed(1) ?? "Unavailable"}
            />
            <Detail
              label="CS"
              value={record.circleSize?.toFixed(1) ?? "Unavailable"}
            />
            <Detail
              label="HP"
              value={record.hpDrain?.toFixed(1) ?? "Unavailable"}
            />
          </dl>
        </section>

        <section className="detail-section">
          <h3>Metadata</h3>
          <dl className="detail-list">
            <Detail label="Mapper" value={record.mapper} />
            <Detail label="Status" value={titleCase(record.status)} />
            <Detail label="Source" value={record.source || "Unavailable"} />
            <Detail label="Tags" value={record.tags || "Unavailable"} />
            <Detail
              label="Beatmap ID"
              value={
                record.beatmapId?.toLocaleString() ?? "Local / unavailable"
              }
            />
            <Detail
              label="Set ID"
              value={
                record.beatmapSetId?.toLocaleString() ?? "Local / unavailable"
              }
            />
          </dl>
        </section>

        <section className="detail-section">
          <h3>Local library</h3>
          <dl className="detail-list">
            <Detail label="Date added" value={formatDate(record.importedAt)} />
            <Detail
              label="Last played"
              value={
                record.lastPlayedAt
                  ? `${formatRelativeDate(record.lastPlayedAt)} · ${formatDate(record.lastPlayedAt)}`
                  : "Never recorded"
              }
            />
            <Detail
              label="Local scores"
              value={record.localScoreCount?.toLocaleString() ?? "Unavailable"}
            />
            <Detail
              label="Set resource size"
              value={formatBytes(record.storageBytes)}
            />
            <Detail
              label="Content hash"
              value={<code>{record.contentHash || "Unavailable"}</code>}
            />
          </dl>
          <div className="resource-flags">
            <span className={record.audioFilename ? "available" : ""}>
              <FileAudio size={15} /> Audio
            </span>
            <span className={record.hasBackground ? "available" : ""}>
              <Image size={15} /> Background
            </span>
            <span className={record.hasVideo ? "available" : ""}>
              <Film size={15} /> Video
            </span>
          </div>
        </section>

        <div className="safety-note compact">
          <ShieldCheck size={17} />
          <div>
            <strong>Read from a verified snapshot</strong>
            <span>
              No osu!lazer files were changed to display this information.
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
