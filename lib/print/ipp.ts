/**
 * عميل IPP مختصر للطباعة الصامتة: يرسل ملف PDF مباشرة إلى طابعة شبكية (Print-Job)
 * ويستعلم عن قدراتها (Get-Printer-Attributes) دون أي نافذة طباعة.
 */

export type IppTransport = (url: string, body: Uint8Array, timeoutMs: number) => Promise<Uint8Array>;

const OP_PRINT_JOB = 0x0002;
const OP_GET_PRINTER_ATTRIBUTES = 0x000b;

const TAG = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  language: 0x48,
  mime: 0x49,
  nameNoLang: 0x42,
} as const;
export const IPP_TAGS = TAG;

export interface IppAttr {
  tag: number;
  name: string;
  values: Array<string | number | boolean>;
}
export interface IppGroup {
  tag: number;
  attrs: IppAttr[];
}
export interface IppMessage {
  version: [number, number];
  code: number;
  requestId: number;
  groups: IppGroup[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function pushU16(out: number[], n: number) {
  out.push((n >> 8) & 0xff, n & 0xff);
}
function pushU32(out: number[], n: number) {
  out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function encodeValue(tag: number, value: string | number | boolean): Uint8Array {
  if (tag === TAG.integer || tag === TAG.enum) {
    const out: number[] = [];
    pushU32(out, Number(value));
    return Uint8Array.from(out);
  }
  if (tag === TAG.boolean) return Uint8Array.of(value ? 1 : 0);
  return encoder.encode(String(value));
}

/** يبني رسالة IPP (طلباً أو استجابة؛ حقل code هو رمز العملية أو الحالة). */
export function buildIppMessage(code: number, groups: IppGroup[], requestId = 1, data?: Uint8Array): Uint8Array {
  const head: number[] = [0x01, 0x01];
  pushU16(head, code);
  pushU32(head, requestId);
  for (const group of groups) {
    head.push(group.tag);
    for (const attr of group.attrs) {
      attr.values.forEach((value, index) => {
        const bytes = encodeValue(attr.tag, value);
        head.push(attr.tag);
        const name = index === 0 ? encoder.encode(attr.name) : new Uint8Array(0);
        pushU16(head, name.length);
        for (const b of name) head.push(b);
        pushU16(head, bytes.length);
        for (const b of bytes) head.push(b);
      });
    }
  }
  head.push(TAG.end);
  const out = new Uint8Array(head.length + (data?.length ?? 0));
  out.set(head, 0);
  if (data) out.set(data, head.length);
  return out;
}

function decodeValue(tag: number, bytes: Uint8Array): string | number | boolean {
  if ((tag === TAG.integer || tag === TAG.enum) && bytes.length === 4) {
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, false);
  }
  if (tag === TAG.boolean) return bytes[0] === 1;
  return decoder.decode(bytes);
}

/** يحلل استجابة IPP. التجميعات (collections) تُتجاهل بأمان لأننا لا نحتاجها. */
export function parseIppMessage(bytes: Uint8Array): IppMessage {
  if (bytes.length < 9) throw new Error("استجابة الطابعة غير صالحة (قصيرة جداً).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const message: IppMessage = { version: [bytes[0], bytes[1]], code: view.getUint16(2, false), requestId: view.getUint32(4, false), groups: [] };
  let pos = 8;
  let group: IppGroup | null = null;
  let last: IppAttr | null = null;
  while (pos < bytes.length) {
    const tag = bytes[pos++];
    if (tag === TAG.end) break;
    if (tag <= 0x05) {
      group = { tag, attrs: [] };
      message.groups.push(group);
      last = null;
      continue;
    }
    if (pos + 2 > bytes.length) break;
    const nameLen = view.getUint16(pos, false);
    pos += 2;
    const name = decoder.decode(bytes.subarray(pos, pos + nameLen));
    pos += nameLen;
    if (pos + 2 > bytes.length) break;
    const valueLen = view.getUint16(pos, false);
    pos += 2;
    const value = decodeValue(tag, bytes.subarray(pos, pos + valueLen));
    pos += valueLen;
    if (!group) continue;
    if (nameLen === 0 && last) last.values.push(value);
    else {
      last = { tag, name, values: [value] };
      group.attrs.push(last);
    }
  }
  return message;
}

export function attrOf(message: IppMessage, name: string): Array<string | number | boolean> {
  for (const group of message.groups) {
    const found = group.attrs.find((attr) => attr.name === name);
    if (found) return found.values;
  }
  return [];
}

export interface PrinterTarget {
  /** عنوان HTTP الفعلي للإرسال. */
  httpUrl: string;
  /** قيمة printer-uri داخل الرسالة. */
  ippUri: string;
}

/** يقبل «192.168.1.50» أو «192.168.1.50:631/ipp/print» أو «ipp://…» أو «http://…». */
export function parsePrinterUrl(input: string | null | undefined): PrinterTarget | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const match = /^(?:(ipps?|https?):\/\/)?([^/:\s]+)(?::(\d{1,5}))?(\/\S*)?$/i.exec(raw);
  if (!match) return null;
  const scheme = (match[1] ?? "ipp").toLowerCase();
  const secure = scheme === "ipps" || scheme === "https";
  const host = match[2];
  const port = match[3] ?? (scheme.startsWith("http") ? (secure ? "443" : "80") : "631");
  const path = match[4] && match[4] !== "/" ? match[4] : "/ipp/print";
  const hadScheme = Boolean(match[1]);
  const effectivePort = hadScheme || match[3] ? port : "631";
  return {
    httpUrl: `${secure ? "https" : "http"}://${host}:${effectivePort}${path}`,
    ippUri: `${secure ? "ipps" : "ipp"}://${host}:${effectivePort}${path}`,
  };
}

const STATUS_HINTS: Record<number, string> = {
  0x0400: "طلب غير صالح",
  0x0401: "الطابعة رفضت الطلب (غير مصرح)",
  0x0403: "ممنوع",
  0x0404: "المسار غير موجود؛ جرّب العنوان الكامل مثل ipp://192.168.1.50/ipp/print",
  0x040a: "الطابعة لا تدعم استلام ملفات PDF مباشرة",
  0x040b: "الطابعة لا تدعم هذا الإرسال",
  0x0500: "خطأ داخلي في الطابعة",
  0x0504: "الطابعة غير متاحة",
  0x0505: "الطابعة مشغولة",
  0x0507: "الطابعة لا تقبل مهام حالياً",
};

export function statusText(code: number): string {
  return STATUS_HINTS[code] ?? `رمز الحالة 0x${code.toString(16).padStart(4, "0")}`;
}

function operationGroup(target: PrinterTarget, extra: IppAttr[]): IppGroup {
  return {
    tag: TAG.operation,
    attrs: [
      { tag: TAG.charset, name: "attributes-charset", values: ["utf-8"] },
      { tag: TAG.language, name: "attributes-natural-language", values: ["en"] },
      { tag: TAG.uri, name: "printer-uri", values: [target.ippUri] },
      ...extra,
    ],
  };
}

function mapTransportError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** يرسل PDF إلى الطابعة كمهمة طباعة صامتة. يرمي خطأ بسبب مفهوم عند الفشل. */
export async function printPdf(
  transport: IppTransport,
  printerUrl: string,
  pdf: Uint8Array,
  jobName: string,
  options: { user?: string; timeoutMs?: number } = {},
): Promise<{ jobId: number | null }> {
  const target = parsePrinterUrl(printerUrl);
  if (!target) throw new Error("عنوان الطابعة غير صالح.");
  const request = buildIppMessage(
    OP_PRINT_JOB,
    [
      operationGroup(target, [
        { tag: TAG.nameNoLang, name: "requesting-user-name", values: [options.user ?? "marsood"] },
        { tag: TAG.nameNoLang, name: "job-name", values: [jobName] },
        { tag: TAG.mime, name: "document-format", values: ["application/pdf"] },
      ]),
    ],
    Math.floor(Math.random() * 0x7fffffff) + 1,
    pdf,
  );
  let response: Uint8Array;
  try {
    response = await transport(target.httpUrl, request, options.timeoutMs ?? 45_000);
  } catch (error) {
    throw mapTransportError(error);
  }
  const message = parseIppMessage(response);
  if (message.code >= 0x0100) throw new Error(`رفضت الطابعة المهمة: ${statusText(message.code)}`);
  const jobId = attrOf(message, "job-id")[0];
  return { jobId: typeof jobId === "number" ? jobId : null };
}

export interface PrinterInfo {
  name: string;
  model: string;
  state: string;
  stateReasons: string[];
  formats: string[];
  pdfSupported: boolean;
}

const STATE_NAMES: Record<number, string> = { 3: "جاهزة", 4: "تعمل", 5: "متوقفة" };

/** اختبار الاتصال: يقرأ اسم الطابعة وحالتها وهل تقبل PDF مباشرة. */
export async function getPrinterInfo(transport: IppTransport, printerUrl: string, timeoutMs = 12_000): Promise<PrinterInfo> {
  const target = parsePrinterUrl(printerUrl);
  if (!target) throw new Error("عنوان الطابعة غير صالح.");
  const request = buildIppMessage(
    OP_GET_PRINTER_ATTRIBUTES,
    [
      operationGroup(target, [
        {
          tag: TAG.keyword,
          name: "requested-attributes",
          values: ["printer-name", "printer-make-and-model", "printer-state", "printer-state-reasons", "document-format-supported"],
        },
      ]),
    ],
    1,
  );
  const response = await transport(target.httpUrl, request, timeoutMs);
  const message = parseIppMessage(response);
  if (message.code >= 0x0100) throw new Error(`الطابعة ردّت بخطأ: ${statusText(message.code)}`);
  const formats = attrOf(message, "document-format-supported").map(String);
  const state = Number(attrOf(message, "printer-state")[0]);
  return {
    name: String(attrOf(message, "printer-name")[0] ?? ""),
    model: String(attrOf(message, "printer-make-and-model")[0] ?? ""),
    state: STATE_NAMES[state] ?? "غير معروفة",
    stateReasons: attrOf(message, "printer-state-reasons").map(String).filter((r) => r !== "none"),
    formats,
    pdfSupported: formats.some((f) => f.toLowerCase() === "application/pdf"),
  };
}
