/** تركيب نغمات التنبيه كملفات WAV (16-بت أحادي) دون الحاجة لملفات صوتية خارجية. */

export type AlertKind = "wrong" | "over" | "blocked" | "closed" | "ok" | "itemDone" | "invoiceClosed" | "sessionDone";
/** [التردد Hz (0 = صمت), المدة م.ث] */
export type ToneStep = readonly [number, number];

export const ALERT_TONES: Record<AlertKind, ToneStep[]> = {
  // خطأ تجهيز: نبرتان منخفضتان حادتان
  wrong: [[220, 220], [0, 80], [220, 380]],
  // تجهيز زائد: نبرتان متوسطتان
  over: [[520, 150], [0, 70], [520, 150], [0, 70], [390, 260]],
  // منع بدء مسح جديد: صفارة متناوبة
  blocked: [[900, 160], [600, 160], [900, 160], [600, 160], [900, 160], [600, 160]],
  // فاتورة سبق مراجعتها: ثلاث نبرات صاعدة
  closed: [[600, 140], [0, 50], [760, 140], [0, 50], [980, 260]],
  // مسحة صحيحة: نغمة قصيرة مريحة
  ok: [[1320, 80]],
  // اكتمال صنف (100%): نغمتان صاعدتان
  itemDone: [[880, 90], [0, 30], [1175, 150]],
  // إغلاق فاتورة: أربع نبرات صاعدة
  invoiceClosed: [[523, 100], [0, 25], [659, 100], [0, 25], [784, 100], [0, 25], [1047, 220]],
  // اكتمال كل فواتير الجلسة: ختام مميز (تصاعد ثم نبرة عالية مكررة)
  sessionDone: [[523, 110], [0, 25], [659, 110], [0, 25], [784, 110], [0, 25], [1047, 150], [0, 70], [1319, 150], [0, 40], [1568, 420]],
};

export const SAMPLE_RATE = 22050;

export function buildWav(steps: readonly ToneStep[], sampleRate = SAMPLE_RATE): Uint8Array {
  const pieces: Int16Array[] = steps.map(([freq, ms]) => {
    const n = Math.round((sampleRate * ms) / 1000);
    const out = new Int16Array(n);
    if (freq > 0) {
      const fade = Math.min(Math.round(sampleRate * 0.008), Math.floor(n / 2));
      for (let i = 0; i < n; i += 1) {
        const env = i < fade ? i / fade : i > n - fade ? (n - i) / fade : 1; // منع الطقطقة بين النبرات
        out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.9 * 32767 * env);
      }
    }
    return out;
  });
  const samples = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // أحادي
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i += 1, offset += 2) view.setInt16(offset, piece[i], true);
  }
  return bytes;
}
