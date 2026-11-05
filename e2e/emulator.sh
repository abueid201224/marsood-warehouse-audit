#!/usr/bin/env bash
set -x
APK=$(ls android/app/build/outputs/apk/release/*.apk | head -1)
adb install -r "$APK"
adb shell mkdir -p /sdcard/Download
adb push marsood-sample.xlsx /sdcard/Download/marsood-sample.xlsx
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/marsood-sample.xlsx
adb shell settings put secure show_ime_with_hard_keyboard 0
python3 e2e/run_e2e.py
