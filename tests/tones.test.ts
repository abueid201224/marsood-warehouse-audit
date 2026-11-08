import { describe, expect, it } from "vitest";
import { bytesToBase64, base64ToBytes } from "../lib/core/base64";
import { ALERT_TONES, SAMPLE_RATE, buildWav } from "../lib/tones";

describe("نغمات التنبيه", () => {
  it("ملف WAV صالح بالطول المتوقع", () => {
    const steps = ALERT_TONES.wrong;
    const wav = buildWav(steps);
    const view = new DataView(wav.buffer);
    const text = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    const samples = steps.reduce((sum, [, ms]) => sum + Math.round((SAMPLE_RATE * ms) / 1000), 0);
    expect(view.getUint32(40, true)).toBe(samples * 2);
    expect(wav.length).toBe(44 + samples * 2);
  });
  it("كل أنواع التنبيه تُنتج صوتاً غير صامت", () => {
    for (const kind of Object.keys(ALERT_TONES) as Array<keyof typeof ALERT_TONES>) {
      const wav = buildWav(ALERT_TONES[kind]);
      const view = new DataView(wav.buffer);
      let peak = 0;
      for (let o = 44; o < wav.length; o += 2) peak = Math.max(peak, Math.abs(view.getInt16(o, true)));
      expect(peak).toBeGreaterThan(20000);
    }
  });
  it("ترميز Base64 يعكس فكّه لأي طول", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });
});
