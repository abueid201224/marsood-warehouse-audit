const pad = (value: number) => String(value).padStart(2, "0");

/** HH:mm بتوقيت الجهاز. */
export function formatClock(time: number | string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** YYYY-MM-DD HH:mm بتوقيت الجهاز. */
export function formatDateTime(time: number | string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const STATUS_LABELS = {
  new: "لم تبدأ",
  open: "قيد المراجعة",
  posted: "مرحّلة بنواقص",
  closed: "منتهية",
} as const;
