import type { ErrorReport } from "./engine";
import { escapeHtml, formatDateTime } from "./format";

function table(headers: string[], rows: Array<Array<string | number>>, empty: string): string {
  if (rows.length === 0) return `<p class="empty">${escapeHtml(empty)}</p>`;
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** تقرير الأخطاء بصيغة HTML عربية RTL قابلة للطباعة (A4). */
export function buildReportHtml(report: ErrorReport): string {
  const { stats } = report;
  const wrongRows = report.wrong.map((row, i) => [i + 1, row.orderNo, row.invoices || "—", row.code, row.count, formatDateTime(row.firstAt)]);
  const overRows = report.over.map((row, i) => [i + 1, row.orderNo, row.invoices || "—", row.code, row.expected ?? "", row.scanned ?? "", row.count, formatDateTime(row.firstAt)]);
  const shortRows = report.shortages.map((row, i) => [i + 1, row.orderNo, row.invoices || "—", row.code, row.unit || "—", row.expected, row.scanned, row.expected - row.scanned]);
  const unknownRows = report.unknown.map((row, i) => [i + 1, row.code, formatDateTime(row.at)]);

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: sans-serif; color: #11233E; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 18px 0 6px; border-bottom: 2px solid #147D73; padding-bottom: 3px; }
  .meta { color: #66758A; margin-bottom: 10px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  .stat { border: 1px solid #DFE6E1; border-radius: 8px; padding: 6px 12px; min-width: 110px; }
  .stat b { display: block; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border: 1px solid #C9D3CD; padding: 4px 6px; text-align: right; }
  th { background: #E5F3EF; }
  tr { page-break-inside: avoid; }
  .empty { color: #66758A; padding: 6px 0; }
</style></head><body>
<h1>تقرير أخطاء المسح — مِرصاد المستودع</h1>
<div class="meta">أُعدّ في ${escapeHtml(formatDateTime(report.generatedAt))}</div>
<div class="stats">
  <div class="stat"><b>${stats.total}</b>إجمالي الفواتير</div>
  <div class="stat"><b>${stats.closed}</b>المنتهية</div>
  <div class="stat"><b>${stats.posted}</b>المرحّلة بنواقص</div>
  <div class="stat"><b>${stats.remaining}</b>المتبقية</div>
  <div class="stat"><b>${report.wrong.reduce((n, r) => n + r.count, 0)}</b>أخطاء تجهيز</div>
  <div class="stat"><b>${report.over.reduce((n, r) => n + r.count, 0)}</b>تجهيز زائد</div>
</div>
<h2>أخطاء التجهيز (كود غير موجود في الفاتورة)</h2>
${table(["#", "رقم الطلب", "رقم الفاتورة", "الكود الممسوح", "عدد المرات", "وقت أول مسح"], wrongRows, "لا توجد أخطاء تجهيز.")}
<h2>التجهيز الزائد (مسح أكثر من الكمية)</h2>
${table(["#", "رقم الطلب", "رقم الفاتورة", "كود الصنف", "المطلوب", "الممسوح", "الزيادة", "وقت أول مسح"], overRows, "لا يوجد تجهيز زائد.")}
<h2>النواقص في الفواتير المرحّلة</h2>
${table(["#", "رقم الطلب", "رقم الفاتورة", "كود الصنف", "الوحدة", "المطلوب", "الممسوح", "الناقص"], shortRows, "لا توجد نواقص في فواتير مرحّلة.")}
<h2>مسحات غير مرتبطة بفاتورة</h2>
${table(["#", "الكود", "الوقت"], unknownRows, "لا توجد مسحات غير مرتبطة.")}
</body></html>`;
}

/** نص مختصر لمشاركة التقرير إذا تعذرت الطباعة. */
export function reportToText(report: ErrorReport): string {
  const lines = [`تقرير أخطاء المسح — ${formatDateTime(report.generatedAt)}`];
  lines.push(`الفواتير: ${report.stats.total} | منتهية: ${report.stats.closed} | مرحّلة: ${report.stats.posted} | متبقية: ${report.stats.remaining}`);
  lines.push("", "أخطاء التجهيز:");
  report.wrong.forEach((row) => lines.push(`- طلب ${row.orderNo}: كود ${row.code} × ${row.count}`));
  lines.push("", "التجهيز الزائد:");
  report.over.forEach((row) => lines.push(`- طلب ${row.orderNo}: كود ${row.code} (مطلوب ${row.expected}، ممسوح ${row.scanned})`));
  lines.push("", "النواقص المرحّلة:");
  report.shortages.forEach((row) => lines.push(`- طلب ${row.orderNo}: كود ${row.code} ناقص ${row.expected - row.scanned}`));
  return lines.join("\n");
}
