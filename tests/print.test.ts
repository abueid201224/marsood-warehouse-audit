import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEngine } from "../lib/core/engine";
import type { ImportRow } from "../lib/core/importer";
import { buildIppMessage, getPrinterInfo, IPP_TAGS, parseIppMessage, parsePrinterUrl, printPdf, type IppTransport } from "../lib/print/ipp";
import { buildIndex, fileNameFromUri, parsePdfName } from "../lib/print/names";
import { buildTestPdf } from "../lib/print/pdf";
import { isPdf, processPrintQueue, type PrintDeps } from "../lib/print/queue";
import { makeEngine } from "./helpers/sqlite";

const ORDER_A = "12345678901234";
const ORDER_B = "98765432109876";
let n = 0;
const row = (orderNo: string, invoiceNo: string, itemCode: string, qty: number): ImportRow => ({ orderNo, invoiceNo, itemCode, unit: "قطعة", qty, sourceRow: ++n });

describe("أسماء ملفات PDF", () => {
  it("يتعرف على الفاتورة والبوليصة", () => {
    expect(parsePdfName("12345_b_Invoice.pdf")).toEqual({ kind: "invoice", ref: "12345" });
    expect(parsePdfName("12345_c_Label.PDF")).toEqual({ kind: "label", ref: "12345" });
    expect(parsePdfName("INV_9_b_invoice.pdf")).toEqual({ kind: "invoice", ref: "INV_9" });
    expect(parsePdfName("12345.pdf")).toBeNull();
    expect(parsePdfName("_b_Invoice.pdf")).toBeNull();
  });
  it("يستخرج الاسم من رابط SAF", () => {
    expect(fileNameFromUri("content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments%2Fpdfs%2F123_b_Invoice.pdf")).toBe("123_b_Invoice.pdf");
  });
  it("يبني الفهرس ويتجاهل غير المطابق ويوحّد الأصفار البادئة", () => {
    const idx = buildIndex([
      { name: "0012_b_Invoice.pdf", uri: "u1" },
      { name: "12_c_Label.pdf", uri: "u2" },
      { name: "readme.txt", uri: "u3" },
    ]);
    expect(idx).toHaveLength(2);
    expect(idx.every((e) => e.refKey === "12")).toBe(true);
  });
});

describe("IPP", () => {
  it("يرمّز ويفك الرسائل", () => {
    const bytes = buildIppMessage(0x000b, [{ tag: IPP_TAGS.operation, attrs: [{ tag: IPP_TAGS.keyword, name: "requested-attributes", values: ["a", "b"] }, { tag: IPP_TAGS.integer, name: "x", values: [7] }] }], 5);
    const msg = parseIppMessage(bytes);
    expect(msg.code).toBe(0x000b);
    expect(msg.requestId).toBe(5);
    expect(msg.groups[0].attrs[0].values).toEqual(["a", "b"]);
    expect(msg.groups[0].attrs[1].values).toEqual([7]);
  });
  it("يفسر عناوين الطابعة", () => {
    expect(parsePrinterUrl("192.168.1.50")?.httpUrl).toBe("http://192.168.1.50:631/ipp/print");
    expect(parsePrinterUrl("ipp://p.local/ipp/print")?.httpUrl).toBe("http://p.local:631/ipp/print");
    expect(parsePrinterUrl("http://10.0.2.2:8631/x")?.httpUrl).toBe("http://10.0.2.2:8631/x");
    expect(parsePrinterUrl("")).toBeNull();
  });

  let server: http.Server;
  let url = "";
  const received: Array<{ code: number; docLen: number; name: string }> = [];
  let mode: "ok" | "fail" = "ok";
  const transport: IppTransport = async (u, body) => {
    const res = await fetch(u, { method: "POST", headers: { "Content-Type": "application/ipp" }, body: body as unknown as BodyInit });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  beforeEach(async () => {
    received.length = 0;
    mode = "ok";
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = new Uint8Array(Buffer.concat(chunks));
        const msg = parseIppMessage(body);
        const name = String(msg.groups[0].attrs.find((a) => a.name === "job-name")?.values[0] ?? "");
        let end = 8;
        // طول الجزء الإداري: نبحث عن علامة النهاية 0x03 بعد التحليل البسيط
        end = body.indexOf(0x03, 8);
        received.push({ code: msg.code, docLen: body.length - end - 1, name });
        const status = mode === "fail" && msg.code === 2 ? 0x0505 : 0x0000;
        const attrs = msg.code === 0x000b
          ? [{ tag: IPP_TAGS.printer, attrs: [
              { tag: IPP_TAGS.nameNoLang, name: "printer-name", values: ["Mock"] },
              { tag: IPP_TAGS.mime, name: "document-format-supported", values: ["application/pdf", "image/jpeg"] },
              { tag: IPP_TAGS.enum, name: "printer-state", values: [3] },
            ] }]
          : [{ tag: IPP_TAGS.job, attrs: [{ tag: IPP_TAGS.integer, name: "job-id", values: [42] }] }];
        const out = buildIppMessage(status, [{ tag: IPP_TAGS.operation, attrs: [{ tag: IPP_TAGS.charset, name: "attributes-charset", values: ["utf-8"] }] }, ...attrs], msg.requestId);
        res.writeHead(200, { "Content-Type": "application/ipp" });
        res.end(Buffer.from(out));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ipp/print`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it("يرسل PDF ويقرأ رقم المهمة", async () => {
    const pdf = buildTestPdf(["hello"]);
    expect(isPdf(pdf)).toBe(true);
    const result = await printPdf(transport, url, pdf, "doc1");
    expect(result.jobId).toBe(42);
    expect(received[0]).toMatchObject({ code: 2, name: "doc1", docLen: pdf.length });
  });
  it("يرفع خطأً مفهوماً عند رفض الطابعة", async () => {
    mode = "fail";
    await expect(printPdf(transport, url, buildTestPdf(["x"]), "d")).rejects.toThrow("مشغولة");
  });
  it("اختبار الاتصال يكشف دعم PDF", async () => {
    const info = await getPrinterInfo(transport, url);
    expect(info).toMatchObject({ name: "Mock", state: "جاهزة", pdfSupported: true });
  });
});

describe("طابور الطباعة والمؤشرات", () => {
  let engine: AuditEngine;
  let sent: Array<{ printer: string; job: string }>;
  let files: Array<{ name: string; uri: string }>;
  let failPrinter: string | null;
  let deps: PrintDeps;
  const pdfBytes = buildTestPdf(["p"]);

  beforeEach(async () => {
    engine = await makeEngine();
    await engine.importRows([row(ORDER_A, "INV-1", "1001", 1), row(ORDER_B, "INV-2", "2001", 1)], "s.xlsx");
    sent = [];
    failPrinter = null;
    files = [
      { name: `${ORDER_A}_b_Invoice.pdf`, uri: "uri:a-inv" },
      { name: `${ORDER_A}_c_Label.pdf`, uri: "uri:a-lbl" },
      { name: "INV-2_b_Invoice.pdf", uri: "uri:b-inv" },
    ];
    deps = {
      listFolder: async () => files,
      readFile: async () => pdfBytes,
      sleep: async () => undefined,
      transport: async (u, body) => {
        if (failPrinter && u.includes(failPrinter)) throw new Error("down");
        const msg = parseIppMessage(body);
        sent.push({ printer: u, job: String(msg.groups[0].attrs.find((a) => a.name === "job-name")?.values[0]) });
        return buildIppMessage(0, [{ tag: IPP_TAGS.operation, attrs: [{ tag: IPP_TAGS.charset, name: "attributes-charset", values: ["utf-8"] }] }], msg.requestId);
      },
    };
    await engine.setSetting("pdf_folder", "content://folder");
    await engine.setSetting("printer_invoice", "10.0.0.1");
    await engine.setSetting("printer_label", "10.0.0.2");
  });

  async function finishOrder(order: string, code: string, ref: string = order) {
    await engine.handleScan(ref);
    await engine.handleScan(code);
    return engine.finishCurrent("close");
  }

  it("إغلاق الطلب يضع مهمتين منفصلتين ثم تُطبعان صامتتين", async () => {
    expect(await finishOrder(ORDER_A, "1001")).toMatchObject({ ok: true, outcome: "closed" });
    expect((await engine.printSummary()).pending).toBe(2);
    await processPrintQueue(engine, deps);
    expect(await engine.printSummary()).toMatchObject({ done: 2, pending: 0, failed: 0 });
    expect(sent.map((s) => s.printer.split("/")[2]).sort()).toEqual(["10.0.0.1:631", "10.0.0.2:631"]);
    expect(sent.map((s) => s.job).sort()).toEqual([`${ORDER_A}_b_Invoice.pdf`, `${ORDER_A}_c_Label.pdf`]);
  });

  it("يبحث بالرقم الممسوح ويقبل رقم الفاتورة مرجعاً", async () => {
    await finishOrder(ORDER_B, "2001", "INV-2");
    await processPrintQueue(engine, deps);
    const log = await engine.printLog();
    expect(log.find((l) => l.kind === "invoice")?.status).toBe("done");
    expect(log.find((l) => l.kind === "label")?.status).toBe("missing");
  });

  it("ملف مفقود لا يوقف المهمة الأخرى، وإعادة المحاولة تنجح بعد إضافته", async () => {
    await finishOrder(ORDER_B, "2001", "INV-2");
    await processPrintQueue(engine, deps);
    files.push({ name: "INV-2_c_Label.pdf", uri: "uri:b-lbl" });
    expect(await engine.retryPrints()).toBe(1);
    await processPrintQueue(engine, deps);
    expect(await engine.printSummary()).toMatchObject({ done: 2, missing: 0 });
  });

  it("فشل طابعة البوليصة لا يمنع طباعة الفاتورة", async () => {
    failPrinter = "10.0.0.2";
    await finishOrder(ORDER_A, "1001");
    await processPrintQueue(engine, deps);
    const log = await engine.printLog();
    expect(log.find((l) => l.kind === "invoice")?.status).toBe("done");
    expect(log.find((l) => l.kind === "label")).toMatchObject({ status: "failed" });
  });

  it("ملف غير PDF يفشل بسبب واضح", async () => {
    deps.readFile = async () => new Uint8Array([1, 2, 3]);
    await finishOrder(ORDER_A, "1001");
    await processPrintQueue(engine, deps);
    expect((await engine.printSummary()).failed).toBe(2);
  });

  it("تعطيل الطباعة لا يضع مهاماً، وإعادة الطباعة اليدوية تعمل", async () => {
    await engine.setSetting("print_enabled", "0");
    await finishOrder(ORDER_A, "1001");
    expect(await engine.printSummary()).toMatchObject({ pending: 0, done: 0 });
    await engine.requeuePrint((await engine.listInvoices({ status: "closed" }))[0].order_key);
    await processPrintQueue(engine, deps);
    expect((await engine.printSummary()).done).toBe(2);
  });

  it("الاستدعاء المتزامن لا يطبع مرتين", async () => {
    await finishOrder(ORDER_A, "1001");
    await Promise.all([processPrintQueue(engine, deps), processPrintQueue(engine, deps), processPrintQueue(engine, deps)]);
    expect(sent).toHaveLength(2);
  });

  it("المهام العالقة بحالة «جارية» تعود للانتظار عند إعادة التشغيل", async () => {
    await finishOrder(ORDER_A, "1001");
    expect(await engine.nextPrintJob()).not.toBeNull();
    await engine.init();
    expect((await engine.printSummary()).pending).toBe(2);
  });

  it("مؤشرات الأداء: دقة المسح وFPY وباريتو والمشغّل", async () => {
    await engine.setSetting("operator", "أحمد");
    await engine.handleScan(ORDER_A);
    await engine.handleScan("9999");
    await engine.handleScan("1001");
    await engine.finishCurrent("close");
    await finishOrder(ORDER_B, "2001");
    const k = await engine.getKpis();
    expect(k.acceptedUnits).toBe(2);
    expect(k.accuracy).toBeCloseTo(66.7, 1);
    expect(k.firstPassYield).toBe(50);
    expect(k.pareto[0]).toMatchObject({ code: "9999", kind: "wrong", count: 1 });
    expect(k.remainingUnits).toBe(0);
    const report = await engine.errorReport();
    expect(report.wrong[0].operator).toBe("أحمد");
    expect(report.kpis.acceptedUnits).toBe(2);
    expect(report.printLog.length).toBeGreaterThan(0);
  });

  it("resetAll يحفظ الإعدادات وفهرس PDF ويحذف مهام الطباعة", async () => {
    await engine.replacePrintIndex(buildIndex(files));
    await finishOrder(ORDER_A, "1001");
    await engine.resetAll();
    expect(await engine.getSetting("printer_invoice")).toBe("10.0.0.1");
    expect((await engine.printIndexCounts()).invoices).toBe(2);
    expect((await engine.printSummary()).pending).toBe(0);
  });
});
