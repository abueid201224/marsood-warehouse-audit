import { PermissionsAndroid, Platform } from "react-native";

export type AccessState = "granted" | "not-needed" | "denied";

/**
 * يطلب إذن الوصول إلى التخزين حيث يلزم (أندرويد 12 فما دون).
 * من أندرويد 13 وما بعده يُمنح الوصول للملفات التي يختارها المستخدم عبر منتقي النظام نفسه دون إذن عام.
 * الرفض لا يمنع الاستيراد: منتقي النظام (SAF) يعمل دون الإذن، لكن نُعلم المستخدم.
 */
export async function ensureStorageAccess(): Promise<AccessState> {
  if (Platform.OS !== "android" || Number(Platform.Version) >= 33) return "not-needed";
  // نافذة الاختيار تُغلق للتو: ننتظر انتهاء إغلاقها (طلب الإذن أثناء إغلاق Modal قد لا يرجع أبداً على أندرويد)
  await new Promise((resolve) => setTimeout(resolve, 450));
  // مهلة قصوى: تعليق نافذة الإذن لا يجوز أن يمنع فتح منتقي الملفات (SAF لا يحتاج الإذن أصلاً)
  return Promise.race([requestAccess(), new Promise<AccessState>((resolve) => setTimeout(() => resolve("denied"), 8000))]);
}

async function requestAccess(): Promise<AccessState> {
  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
    if (granted) return "granted";
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE, {
      title: "السماح بالوصول إلى الملفات",
      message: "يحتاج «مرصاد» قراءة ملف Excel أو ملفات PDF التي تختارها من ذاكرة الجهاز أو من Google Drive وOneDrive.",
      buttonPositive: "سماح",
      buttonNegative: "ليس الآن",
    });
    return result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
  } catch {
    return "denied";
  }
}
