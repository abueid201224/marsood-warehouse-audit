import { codeKey, fitsItemCode, normalizeCode } from "./codes";
import type { ImportRow } from "./importer";

/* ------------------------------------------------------------------ */
/* واجهة قاعدة البيانات (expo-sqlite على Android، node:sqlite في الاختبارات) */
/* ------------------------------------------------------------------ */
export type SqlValue = string | number | null;
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ lastId: number; changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

export type InvoiceStatus = "new" | "open" | "posted" | "closed";
export type ScanKind = "ok" | "over" | "wrong" | "unknown";

export interface InvoiceRow {
  order_key: string;
  order_no: string;
  invoices: string | null;
  status: InvoiceStatus;
  opened_at: string | null;
  closed_at: string | null;
  posted_at: string | null;
  item_count: number;
  total_qty: number;
  done_qty: number;
  done_items: number;
  short_items: number;
  over_items: number;
  wrong_scans: number;
  over_scans: number;
}
export interface InvoiceView extends InvoiceRow {
  /** نسبة التقدم 0..100 بحسب الوحدات الممسوحة (بحد أقصى الكمية المسجلة) إلى إجمالي الوحدات. */
  progress: number;
}
export interface ItemRow {
  order_key: string;
  item_key: string;
  item_code: string;
  unit: string | null;
  qty: number;
  scanned: number;
}
export type ItemState = "pending" | "partial" | "done" | "over";
export function itemState(item: Pick<ItemRow, "qty" | "scanned">): ItemState {
  if (item.scanned > item.qty) return "over";
  if (item.scanned === item.qty) return "done";
  return item.scanned > 0 ? "partial" : "pending";
}

export interface Stats {
  total: number;
  closed: number;
  posted: number;
  open: number;
  fresh: number;
  /** الفواتير غير المنتهية = الإجمالي - المنتهية. */
  remaining: number;
  unknownScans: number;
  wrongScans: number;
  overScans: number;
  timeline: string[];
}

export type ScanResult =
  | { type: "empty" }
  | { type: "item"; kind: "ok" | "over" | "wrong"; code: string; orderKey: string; scanned?: number; qty?: number }
  | { type: "order-opened"; orderKey: string; orderNo: string; readonly: boolean; resumed: boolean; left?: LeftInvoice }
  | { type: "same-order"; orderKey: string }
  | { type: "order-not-found"; code: string }
  | { type: "no-invoice"; code: string }
  | { type: "locked"; code: string; orderKey: string };

export interface LeftInvoice {
  orderKey: string;
  orderNo: string;
  outcome: "closed" | "posted" | "released";
  shortItems: number;
}

export interface ImportSummary {
  inserted: number;
  orders: number;
  replaced: number;
  skippedOrders: string[];
}

export interface ErrorReportRow {
  kind: "wrong" | "over";
  orderNo: string;
  invoices: string;
  code: string;
  count: number;
  firstAt: string;
  expected: number | null;
  scanned: number | null;
}
export interface ShortageRow {
  orderNo: string;
  invoices: string;
  code: string;
  unit: string;
  expected: number;
  scanned: number;
}
export interface UnknownScanRow {
  code: string;
  at: string;
}
export interface ErrorReport {
  generatedAt: string;
  stats: Stats;
  wrong: ErrorReportRow[];
  over: ErrorReportRow[];
  shortages: ShortageRow[];
  unknown: UnknownScanRow[];
}

/* ------------------------------------------------------------------ */
/* المخطط: البيانات الخام في lines، والفواتير تُستخلص بالاستعلامات (Views) */
/* ------------------------------------------------------------------ */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER,
  src_row INTEGER,
  order_no TEXT NOT NULL,
  order_key TEXT NOT NULL,
  invoice_no TEXT NOT NULL DEFAULT '',
  invoice_key TEXT NOT NULL DEFAULT '',
  item_code TEXT NOT NULL,
  item_key TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lines_order ON lines(order_key, item_key);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON lines(invoice_key);
CREATE TABLE IF NOT EXISTS invoice_state (
  order_key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  opened_at TEXT,
  closed_at TEXT,
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_key TEXT,
  item_key TEXT,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_order ON scans(order_key, item_key, kind);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT);

DROP VIEW IF EXISTS v_invoice_stats;
DROP VIEW IF EXISTS v_item_progress;
DROP VIEW IF EXISTS v_items;
DROP VIEW IF EXISTS v_orders;

-- الطلبات/الفواتير: صف لكل رقم طلب (كما في البوليصة) مع أرقام فواتيره
CREATE VIEW v_orders AS
SELECT order_key,
       MIN(order_no) AS order_no,
       group_concat(DISTINCT NULLIF(invoice_no, '')) AS invoices
FROM lines
GROUP BY order_key;

-- بنود كل طلب: تُجمع الأسطر المتكررة لنفس الكود
CREATE VIEW v_items AS
SELECT order_key, item_key,
       MIN(item_code) AS item_code,
       group_concat(DISTINCT NULLIF(unit, '')) AS unit,
       SUM(qty) AS qty
FROM lines
GROUP BY order_key, item_key;

-- تقدم كل بند: عدد المسحات المقبولة (ok + over)
CREATE VIEW v_item_progress AS
SELECT i.order_key, i.item_key, i.item_code, i.unit, i.qty,
       COALESCE(s.scanned, 0) AS scanned
FROM v_items i
LEFT JOIN (
  SELECT order_key, item_key, COUNT(*) AS scanned
  FROM scans WHERE kind IN ('ok', 'over')
  GROUP BY order_key, item_key
) s ON s.order_key = i.order_key AND s.item_key = i.item_key;

-- إحصاءات كل فاتورة
CREATE VIEW v_invoice_stats AS
SELECT o.order_key, o.order_no, o.invoices,
       COALESCE(st.status, 'new') AS status,
       st.opened_at, st.closed_at, st.posted_at,
       COUNT(p.item_key) AS item_count,
       COALESCE(SUM(p.qty), 0) AS total_qty,
       COALESCE(SUM(MIN(p.scanned, p.qty)), 0) AS done_qty,
       COALESCE(SUM(CASE WHEN p.scanned >= p.qty THEN 1 ELSE 0 END), 0) AS done_items,
       COALESCE(SUM(CASE WHEN p.scanned < p.qty THEN 1 ELSE 0 END), 0) AS short_items,
       COALESCE(SUM(CASE WHEN p.scanned > p.qty THEN 1 ELSE 0 END), 0) AS over_items,
       (SELECT COUNT(*) FROM scans x WHERE x.order_key = o.order_key AND x.kind = 'wrong') AS wrong_scans,
       (SELECT COUNT(*) FROM scans x WHERE x.order_key = o.order_key AND x.kind = 'over') AS over_scans
FROM v_orders o
LEFT JOIN invoice_state st ON st.order_key = o.order_key
LEFT JOIN v_item_progress p ON p.order_key = o.order_key
GROUP BY o.order_key;
`;

function toView(row: InvoiceRow): InvoiceView {
  const progress = row.total_qty > 0 ? Math.round((row.done_qty / row.total_qty) * 100) : 0;
  return { ...row, progress };
}

export class AuditEngine {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** يسلسل كل العمليات لتفادي تداخل المسحات السريعة. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async tx<T>(task: () => Promise<T>): Promise<T> {
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await task();
      await this.db.exec("COMMIT");
      return result;
    } catch (error) {
      await this.db.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  init(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.exec("PRAGMA journal_mode = WAL;");
      await this.db.exec(SCHEMA);
    });
  }

  /* ----------------------------- الاستيراد ----------------------------- */

  importRows(rows: ImportRow[], fileName: string): Promise<ImportSummary> {
    return this.enqueue(() =>
      this.tx(async () => {
        const at = this.now();
        const byOrder = new Map<string, ImportRow[]>();
        for (const row of rows) {
          const key = codeKey(row.orderNo);
          const list = byOrder.get(key) ?? [];
          list.push(row);
          byOrder.set(key, list);
        }
        const imp = await this.db.run("INSERT INTO imports (file_name, imported_at, row_count) VALUES (?, ?, ?)", [fileName, at, rows.length]);
        const skippedOrders: string[] = [];
        let replaced = 0;
        let inserted = 0;
        for (const [key, list] of byOrder) {
          const started = await this.db.all<{ n: number }>(
            `SELECT (SELECT COUNT(*) FROM scans WHERE order_key = ?1)
                  + (SELECT COUNT(*) FROM invoice_state WHERE order_key = ?1 AND status <> 'new') AS n`,
            [key],
          );
          if ((started[0]?.n ?? 0) > 0) {
            skippedOrders.push(list[0].orderNo);
            continue;
          }
          const existing = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM lines WHERE order_key = ?", [key]);
          if ((existing[0]?.n ?? 0) > 0) {
            replaced += 1;
            await this.db.run("DELETE FROM lines WHERE order_key = ?", [key]);
          }
          for (let start = 0; start < list.length; start += 50) {
            const chunk = list.slice(start, start + 50);
            const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
            const params: SqlValue[] = [];
            for (const row of chunk) {
              params.push(imp.lastId, row.sourceRow, row.orderNo, key, row.invoiceNo, codeKey(row.invoiceNo), row.itemCode, codeKey(row.itemCode), row.unit, row.qty);
            }
            await this.db.run(
              `INSERT INTO lines (import_id, src_row, order_no, order_key, invoice_no, invoice_key, item_code, item_key, unit, qty) VALUES ${placeholders}`,
              params,
            );
            inserted += chunk.length;
          }
        }
        return { inserted, orders: byOrder.size - skippedOrders.length, replaced, skippedOrders };
      }),
    );
  }

  /** يمسح كل البيانات (بدء يوم/دفعة جديدة). */
  resetAll(): Promise<void> {
    return this.enqueue(() =>
      this.tx(async () => {
        for (const table of ["scans", "invoice_state", "lines", "imports", "app_state"]) {
          await this.db.run(`DELETE FROM ${table}`);
        }
      }),
    );
  }

  /* ------------------------------- القراءة ------------------------------ */

  getStats(): Promise<Stats> {
    return this.enqueue(() => this.readStats());
  }

  private async readStats(): Promise<Stats> {
    const [counts] = await this.db.all<{ total: number; closed: number; posted: number; open: number; fresh: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN COALESCE(st.status,'new') = 'closed' THEN 1 ELSE 0 END), 0) AS closed,
              COALESCE(SUM(CASE WHEN st.status = 'posted' THEN 1 ELSE 0 END), 0) AS posted,
              COALESCE(SUM(CASE WHEN st.status = 'open' THEN 1 ELSE 0 END), 0) AS open,
              COALESCE(SUM(CASE WHEN st.status IS NULL OR st.status = 'new' THEN 1 ELSE 0 END), 0) AS fresh
       FROM v_orders o LEFT JOIN invoice_state st ON st.order_key = o.order_key`,
    );
    const [errs] = await this.db.all<{ wrong: number; over: number; unknown: number }>(
      `SELECT COALESCE(SUM(kind = 'wrong'), 0) AS wrong,
              COALESCE(SUM(kind = 'over'), 0) AS over,
              COALESCE(SUM(kind = 'unknown'), 0) AS unknown
       FROM scans`,
    );
    const timeline = await this.db.all<{ at: string }>(
      "SELECT closed_at AS at FROM invoice_state WHERE status = 'closed' AND closed_at IS NOT NULL ORDER BY closed_at",
    );
    return {
      total: counts?.total ?? 0,
      closed: counts?.closed ?? 0,
      posted: counts?.posted ?? 0,
      open: counts?.open ?? 0,
      fresh: counts?.fresh ?? 0,
      remaining: (counts?.total ?? 0) - (counts?.closed ?? 0),
      wrongScans: errs?.wrong ?? 0,
      overScans: errs?.over ?? 0,
      unknownScans: errs?.unknown ?? 0,
      timeline: timeline.map((row) => row.at),
    };
  }

  listInvoices(options: { status?: "all" | "pending" | InvoiceStatus; search?: string; limit?: number } = {}): Promise<InvoiceView[]> {
    return this.enqueue(async () => {
      const where: string[] = [];
      const params: SqlValue[] = [];
      const { status = "all", search = "", limit = 500 } = options;
      if (status === "pending") where.push("status <> 'closed'");
      else if (status !== "all") {
        where.push("status = ?");
        params.push(status);
      }
      const term = normalizeCode(search);
      if (term) {
        where.push("(order_no LIKE ? OR invoices LIKE ?)");
        params.push(`%${term}%`, `%${term}%`);
      }
      const rows = await this.db.all<InvoiceRow>(
        `SELECT * FROM v_invoice_stats ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'posted' THEN 1 WHEN 'new' THEN 2 ELSE 3 END, order_no
         LIMIT ?`,
        [...params, limit],
      );
      return rows.map(toView);
    });
  }

  getInvoice(orderKey: string): Promise<{ invoice: InvoiceView; items: ItemRow[] } | null> {
    return this.enqueue(() => this.readInvoice(orderKey));
  }

  private async readInvoice(orderKey: string) {
    const [row] = await this.db.all<InvoiceRow>("SELECT * FROM v_invoice_stats WHERE order_key = ?", [orderKey]);
    if (!row) return null;
    const items = await this.db.all<ItemRow>(
      `SELECT * FROM v_item_progress WHERE order_key = ?
       ORDER BY CASE WHEN scanned < qty THEN 0 ELSE 1 END, item_code`,
      [orderKey],
    );
    return { invoice: toView(row), items };
  }

  /** آخر المسحات لفاتورة (للسجل على الشاشة). */
  recentScans(orderKey: string, limit = 8): Promise<Array<{ id: number; code: string; kind: ScanKind; at: string }>> {
    return this.enqueue(() =>
      this.db.all(
        "SELECT id, code, kind, at FROM scans WHERE order_key = ? ORDER BY id DESC LIMIT ?",
        [orderKey, limit],
      ),
    );
  }

  /* ------------------------------ الفاتورة الحالية ----------------------- */

  getCurrent(): Promise<string | null> {
    return this.enqueue(() => this.readCurrent());
  }

  private async readCurrent(): Promise<string | null> {
    const [row] = await this.db.all<{ value: string | null }>("SELECT value FROM app_state WHERE key = 'current_order'");
    const key = row?.value ?? null;
    if (!key) return null;
    const [exists] = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM v_orders WHERE order_key = ?", [key]);
    return (exists?.n ?? 0) > 0 ? key : null;
  }

  private async writeCurrent(key: string | null) {
    await this.db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('current_order', ?)", [key]);
  }

  /** فتح فاتورة من القائمة (بدلاً من مسح بوليصتها). */
  openInvoice(orderKey: string): Promise<ScanResult> {
    return this.enqueue(() => this.tx(() => this.openOrder(orderKey, null)));
  }

  /* -------------------------------- المسح -------------------------------- */

  handleScan(raw: string): Promise<ScanResult> {
    return this.enqueue(() => this.tx(() => this.processScan(raw)));
  }

  private async findOrder(key: string): Promise<string | null> {
    const [byOrder] = await this.db.all<{ order_key: string }>("SELECT order_key FROM v_orders WHERE order_key = ?", [key]);
    if (byOrder) return byOrder.order_key;
    const [byInvoice] = await this.db.all<{ order_key: string }>("SELECT order_key FROM lines WHERE invoice_key = ? LIMIT 1", [key]);
    return byInvoice?.order_key ?? null;
  }

  private async processScan(raw: string): Promise<ScanResult> {
    const code = normalizeCode(raw);
    if (!code) return { type: "empty" };
    const key = codeKey(code);
    const at = this.now();
    const currentKey = await this.readCurrent();
    const current = currentKey ? await this.readInvoice(currentKey) : null;

    // 1) فاتورة مفتوحة وقابلة للمسح: الكود القصير يُجرَّب كصنف أولاً
    if (current && current.invoice.status !== "closed" && fitsItemCode(code)) {
      const item = current.items.find((candidate) => candidate.item_key === key);
      if (item) {
        const kind = item.scanned + 1 > item.qty ? "over" : "ok";
        await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at) VALUES (?, ?, ?, ?, ?)", [current.invoice.order_key, key, code, kind, at]);
        return { type: "item", kind, code, orderKey: current.invoice.order_key, scanned: item.scanned + 1, qty: item.qty };
      }
    }

    // 2) فاتورة مغلقة معروضة للقراءة فقط: لا يُقبل مسح أصناف عليها
    if (current && current.invoice.status === "closed" && fitsItemCode(code)) {
      const isItem = current.items.some((candidate) => candidate.item_key === key);
      if (isItem) return { type: "locked", code, orderKey: current.invoice.order_key };
    }

    // 3) هل هو رقم طلب/فاتورة؟ (أي كود أطول من 10 لا يُعد صنفاً، والقصير الذي ليس في الفاتورة يُجرَّب هنا أيضاً)
    const target = await this.findOrder(key);
    if (target) {
      if (current && current.invoice.order_key === target) return { type: "same-order", orderKey: target };
      return this.openOrder(target, current?.invoice ?? null);
    }

    // 4) غير معروف
    if (current && current.invoice.status !== "closed" && fitsItemCode(code)) {
      // كود صنف غير موجود في الفاتورة => خطأ تجهيز
      await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at) VALUES (?, ?, ?, 'wrong', ?)", [current.invoice.order_key, key, code, at]);
      return { type: "item", kind: "wrong", code, orderKey: current.invoice.order_key };
    }
    await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at) VALUES (NULL, ?, ?, 'unknown', ?)", [key, code, at]);
    return fitsItemCode(code) ? { type: "no-invoice", code } : { type: "order-not-found", code };
  }

  /** يغادر الفاتورة الحالية (إن كانت مفتوحة) ثم يفتح الهدف. */
  private async openOrder(targetKey: string, leaving: InvoiceView | null): Promise<ScanResult> {
    const target = await this.readInvoice(targetKey);
    if (!target) return { type: "order-not-found", code: targetKey };
    let left: LeftInvoice | undefined;
    if (leaving && leaving.order_key !== targetKey && leaving.status === "open") {
      left = await this.releaseInvoice(leaving);
    }
    const at = this.now();
    const status = target.invoice.status;
    if (status === "closed") {
      await this.writeCurrent(targetKey);
      return { type: "order-opened", orderKey: targetKey, orderNo: target.invoice.order_no, readonly: true, resumed: false, left };
    }
    await this.db.run(
      "INSERT INTO invoice_state (order_key, status, opened_at) VALUES (?, 'open', ?) ON CONFLICT(order_key) DO UPDATE SET status = 'open', opened_at = COALESCE(opened_at, excluded.opened_at)",
      [targetKey, at],
    );
    await this.writeCurrent(targetKey);
    return { type: "order-opened", orderKey: targetKey, orderNo: target.invoice.order_no, readonly: false, resumed: status === "posted" || target.invoice.done_qty > 0, left };
  }

  /** عند ترك فاتورة: تُقفل إن اكتملت، وتُرحَّل إن بها نواقص ومسحات، وتعود "جديدة" إن لم يُمسح شيء. */
  private async releaseInvoice(invoice: InvoiceView): Promise<LeftInvoice> {
    const at = this.now();
    const touched = invoice.done_qty > 0 || invoice.wrong_scans > 0 || invoice.over_scans > 0;
    let outcome: LeftInvoice["outcome"];
    if (invoice.short_items === 0) {
      outcome = "closed";
      await this.db.run("UPDATE invoice_state SET status = 'closed', closed_at = ? WHERE order_key = ?", [at, invoice.order_key]);
    } else if (touched) {
      outcome = "posted";
      await this.db.run("UPDATE invoice_state SET status = 'posted', posted_at = ? WHERE order_key = ?", [at, invoice.order_key]);
    } else {
      outcome = "released";
      await this.db.run("UPDATE invoice_state SET status = 'new', opened_at = NULL WHERE order_key = ?", [invoice.order_key]);
    }
    return { orderKey: invoice.order_key, orderNo: invoice.order_no, outcome, shortItems: invoice.short_items };
  }

  /**
   * إنهاء الفاتورة الحالية:
   * - "close": يلزم ألا توجد نواقص.
   * - "post": ترحيل لاستكمال النواقص (إن لم توجد نواقص تُقفل).
   */
  finishCurrent(mode: "close" | "post"): Promise<{ ok: boolean; outcome?: LeftInvoice["outcome"]; reason?: string; orderNo?: string }> {
    return this.enqueue(() =>
      this.tx(async () => {
        const currentKey = await this.readCurrent();
        const current = currentKey ? await this.readInvoice(currentKey) : null;
        if (!current) return { ok: false, reason: "لا توجد فاتورة مفتوحة." };
        if (current.invoice.status === "closed") {
          await this.writeCurrent(null);
          return { ok: true, outcome: "closed" as const, orderNo: current.invoice.order_no };
        }
        if (mode === "close" && current.invoice.short_items > 0) {
          return { ok: false, reason: "توجد أصناف لم تكتمل؛ استخدم «ترحيل لاستكمال النواقص».", orderNo: current.invoice.order_no };
        }
        const left = await this.releaseInvoice(current.invoice);
        // الترحيل الصريح لا يعيد الفاتورة "جديدة" حتى لو لم يُمسح شيء
        let outcome = left.outcome;
        if (outcome === "released" && mode === "post") {
          await this.db.run("UPDATE invoice_state SET status = 'posted', posted_at = ? WHERE order_key = ?", [this.now(), current.invoice.order_key]);
          outcome = "posted";
        }
        await this.writeCurrent(null);
        return { ok: true, outcome, orderNo: current.invoice.order_no };
      }),
    );
  }

  /** إلغاء آخر مسحة على الفاتورة (مسح خاطئ بالخطأ). */
  undoLastScan(orderKey: string): Promise<{ removed: boolean; code?: string }> {
    return this.enqueue(() =>
      this.tx(async () => {
        const [last] = await this.db.all<{ id: number; code: string }>("SELECT id, code FROM scans WHERE order_key = ? ORDER BY id DESC LIMIT 1", [orderKey]);
        if (!last) return { removed: false };
        await this.db.run("DELETE FROM scans WHERE id = ?", [last.id]);
        return { removed: true, code: last.code };
      }),
    );
  }

  /* -------------------------------- التقرير ------------------------------ */

  errorReport(): Promise<ErrorReport> {
    return this.enqueue(async () => {
      const grouped = await this.db.all<{
        kind: "wrong" | "over";
        order_no: string | null;
        invoices: string | null;
        code: string;
        n: number;
        first_at: string;
        qty: number | null;
        scanned: number | null;
      }>(
        `SELECT s.kind AS kind, o.order_no AS order_no, o.invoices AS invoices, s.code AS code,
                COUNT(*) AS n, MIN(s.at) AS first_at, p.qty AS qty, p.scanned AS scanned
         FROM scans s
         LEFT JOIN v_orders o ON o.order_key = s.order_key
         LEFT JOIN v_item_progress p ON p.order_key = s.order_key AND p.item_key = s.item_key
         WHERE s.kind IN ('wrong', 'over')
         GROUP BY s.kind, s.order_key, s.item_key, s.code
         ORDER BY first_at`,
      );
      const toRow = (row: (typeof grouped)[number]): ErrorReportRow => ({
        kind: row.kind,
        orderNo: row.order_no ?? "",
        invoices: row.invoices ?? "",
        code: row.code,
        count: row.n,
        firstAt: row.first_at,
        expected: row.kind === "over" ? row.qty : null,
        scanned: row.kind === "over" ? row.scanned : null,
      });
      const shortages = await this.db.all<{ order_no: string; invoices: string | null; item_code: string; unit: string | null; qty: number; scanned: number }>(
        `SELECT o.order_no, o.invoices, p.item_code, p.unit, p.qty, p.scanned
         FROM v_item_progress p
         JOIN v_orders o ON o.order_key = p.order_key
         JOIN invoice_state st ON st.order_key = p.order_key AND st.status = 'posted'
         WHERE p.scanned < p.qty
         ORDER BY o.order_no, p.item_code`,
      );
      const unknown = await this.db.all<{ code: string; at: string }>("SELECT code, at FROM scans WHERE kind = 'unknown' ORDER BY at");
      const stats = await this.readStats();
      return {
        generatedAt: this.now(),
        stats,
        wrong: grouped.filter((row) => row.kind === "wrong").map(toRow),
        over: grouped.filter((row) => row.kind === "over").map(toRow),
        shortages: shortages.map((row) => ({ orderNo: row.order_no, invoices: row.invoices ?? "", code: row.item_code, unit: row.unit ?? "", expected: row.qty, scanned: row.scanned })),
        unknown,
      };
    });
  }
}
