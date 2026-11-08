import * as FS from "expo-file-system/legacy";
import { nameFromUri, sortSyncFiles, type SyncFile } from "./select";

export const SYNC_FOLDER_KEY = "sync:folder";
export const SYNC_PROCESSED_KEY = "sync:processed";

/** يفتح منتقي مجلدات أندرويد ويطلب إذناً دائماً للمجلد. */
export async function pickSyncFolder(): Promise<string | null> {
  const result = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
  return result.granted ? result.directoryUri : null;
}

/** يسرد ملفات الجداول في المجلد (الأحدث أولاً) مع الحجم وتاريخ التعديل إن أمكن. */
export async function listSyncFiles(folderUri: string): Promise<SyncFile[]> {
  const uris = await FS.StorageAccessFramework.readDirectoryAsync(folderUri);
  const files: SyncFile[] = [];
  for (const uri of uris) {
    const file: SyncFile = { uri, name: nameFromUri(uri) };
    try {
      const info = await FS.getInfoAsync(uri);
      if (info.exists) {
        file.size = (info as { size?: number }).size ?? null;
        file.modified = (info as { modificationTime?: number }).modificationTime ?? null;
      }
    } catch {
      // بعض المزودات لا تعطي معلومات؛ يُكتفى بالاسم
    }
    files.push(file);
  }
  return sortSyncFiles(files);
}
