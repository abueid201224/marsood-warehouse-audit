import * as FileSystem from "expo-file-system/legacy";

function safeName(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 90) || "invoice";
}

export async function archiveImportedFile(uri: string, fileName: string): Promise<string> {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error("مساحة مستندات التطبيق غير متاحة.");
  const directory = `${root.replace(/\/+$/, "")}/marsood-invoices/`;
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const destination = `${directory}${Date.now()}_${safeName(fileName)}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}
