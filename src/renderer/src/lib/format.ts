export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Unavailable"
    : value.toLocaleString();
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
}

export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatRelativeDate(value: string | null | undefined): string {
  if (!value) return "Never recorded";
  const date = new Date(value);
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(days / 365), "year");
}

export function titleCase(value: string): string {
  return value
    .replace(/(^|[-_\s])\w/g, (match) => match.toUpperCase())
    .replaceAll("_", " ");
}
