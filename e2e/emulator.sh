#!/usr/bin/env bash
set -x
APK=$(ls android/app/build/outputs/apk/release/*.apk | head -1)
adb install -r "$APK"
adb shell mkdir -p /sdcard/Download
adb push marsood-sample.xlsx /sdcard/Download/marsood-sample.xlsx
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/marsood-sample.xlsx
python3 - <<'PY'
def pdf(text):
    body = "BT /F1 18 Tf 56 760 Td (%s) Tj ET" % text
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            "<< /Length %d >>\nstream\n%s\nendstream" % (len(body), body), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out = "%PDF-1.4\n"; offs = []
    for i, o in enumerate(objs):
        offs.append(len(out)); out += "%d 0 obj\n%s\nendobj\n" % (i + 1, o)
    x = len(out); out += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs: out += "%010d 00000 n \n" % o
    out += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return out.encode()
import os
os.makedirs("pdfs", exist_ok=True)
open("pdfs/5550001112223_b_Invoice.pdf", "wb").write(pdf("Invoice 1"))
open("pdfs/5550001112223_c_Label.pdf", "wb").write(pdf("Label 1"))
open("pdfs/INV-3_b_Invoice.pdf", "wb").write(pdf("Invoice 3"))
open("pdfs/notes.txt", "w").write("ignored")
PY
adb shell mkdir -p /sdcard/Documents/marsood-pdfs
for f in pdfs/*; do adb push "$f" /sdcard/Documents/marsood-pdfs/; done
adb shell settings put secure show_ime_with_hard_keyboard 0
python3 e2e/run_e2e.py
