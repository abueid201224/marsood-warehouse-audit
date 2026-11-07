import { EncodingType, StorageAccessFramework, readAsStringAsync } from "expo-file-system/legacy";
import { base64ToBytes } from "../core/base64";
import { fileNameFromUri } from "./names";

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
