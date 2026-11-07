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

/** مدة بالثواني بصيغة مختصرة بالعربية (45 ث، 3 د 20 ث، 1 س 05 د). */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total} ث`;
  if (total < 3600) return `${Math.floor(total / 60)} د ${String(total % 60).padStart(2, "0")} ث`;
  return `${Math.floor(total / 3600)} س ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")} د`;
}

export function formatRate(value: number | null | undefined, unit: string): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value * 10) / 10} ${unit}`;
}

export function formatPercent(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

export const PRINT_STATUS_LABELS = {
  pending: "بانتظار الطباعة",
  printing: "جارية",
  done: "طُبعت",
  failed: "فشلت",
  missing: "الملف غير موجود",
} as const;
export const PRINT_KIND_LABELS = { invoice: "الفاتورة", label: "البوليصة" } as const;
