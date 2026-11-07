import * as DocumentPicker from "expo-document-picker";
import { EncodingType, StorageAccessFramework, copyAsync, deleteAsync, documentDirectory, makeDirectoryAsync, readAsStringAsync } from "expo-file-system/legacy";
import { base64ToBytes } from "../core/base64";
import { buildIndex, fileNameFromUri } from "./names";
import type { PrintFileEntry } from "../core/engine";

/** يفتح منتقي مجلدات أندرويد ويطلب صلاحية دائمة للمجلد؛ يعيد رابط المجلد أو null عند الإلغاء. */
export async function pickPdfFolder(): Promise<string | null> {
  const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  return result.granted ? result.directoryUri : null;
}

export async function listFolderFiles(folderUri: string): Promise<Array<{ name: string; uri: string }>> {
  const uris = await StorageAccessFramework.readDirectoryAsync(folderUri);
  return uris.map((uri) => ({ uri, name: fileNameFromUri(uri) }));
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  return base64ToBytes(base64);
}

const PDF_DIR = `${documentDirectory ?? ""}pdfs/`;

/** اسم آمن للتخزين المحلي مع الحفاظ على الاسم الأصلي المطلوب للبحث. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * يفتح منتقي النظام (يدعم الذاكرة وGoogle Drive وOneDrive) لاختيار عدة ملفات PDF،
 * وينسخها إلى مساحة التطبيق (لتبقى متاحة دون اتصال) ويعيد فهرسها بحسب الاسم.
 * الملفات التي لا تطابق الصيغة تُحصى وتُتجاهل.
 */
export async function importPdfFiles(): Promise<{ entries: PrintFileEntry[]; ignored: number; failed: string[] } | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/octet-stream"], multiple: true, copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;
  await makeDirectoryAsync(PDF_DIR, { intermediates: true }).catch(() => undefined);
  const copied: Array<{ name: string; uri: string }> = [];
  const failed: string[] = [];
  for (const asset of picked.assets) {
    try {
      const target = `${PDF_DIR}${safeName(asset.name)}`;
      await deleteAsync(target, { idempotent: true });
      await copyAsync({ from: asset.uri, to: target });
      copied.push({ name: asset.name, uri: target });
    } catch (cause) {
      failed.push(`${asset.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  const entries = buildIndex(copied);
  return { entries, ignored: copied.length - entries.length, failed };
}

export async function deleteCopiedPdfs(): Promise<void> {
  await deleteAsync(PDF_DIR, { idempotent: true });
}
