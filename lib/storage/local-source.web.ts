export async function archiveImportedFile(_uri: string, _fileName: string): Promise<undefined> {
  // Expo Web's file picker provides a temporary browser URL; the test surface does not archive it.
  return undefined;
}
