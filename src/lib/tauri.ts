// Tauri global API tipi
declare global {
  interface Window {
    __TAURI_INTERNALS__?: Record<string, unknown>;
    __TAURI_IPC__?: unknown;
  }
}

/**
 * Tauri ortam kontrolü — Tüm platform kontrollerini merkezileştirir.
 * Tauri v2, __TAURI_INTERNALS__ kullanır. Eski __TAURI_IPC__ yerine bu kontrol daha güvenilirdir.
 */
export const isTauri = (): boolean => {
  return !!(window.__TAURI_INTERNALS__ || window.__TAURI_IPC__);
};

/**
 * Dosyayı cihazın İndirilenler klasörüne kaydeder (binary — PDF vb.)
 */
export const saveFileToDownloads = async (fileName: string, data: Uint8Array): Promise<void> => {
  const { writeFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await writeFile(fileName, data, { baseDir: BaseDirectory.Download });
};

/**
 * Metin dosyasını cihazın İndirilenler klasörüne kaydeder (JSON vb.)
 */
export const saveTextFileToDownloads = async (fileName: string, content: string): Promise<void> => {
  const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(fileName, content, { baseDir: BaseDirectory.Download });
};

/**
 * İndirilenler klasöründeki yedekleme dosyalarını listeler
 */
export interface BackupFileInfo {
  name: string;
  size: number;
}

export const listBackupFiles = async (): Promise<BackupFileInfo[]> => {
  const { readDir, stat, BaseDirectory } = await import("@tauri-apps/plugin-fs");

  const entries = await readDir("", { baseDir: BaseDirectory.Download });

  const backupFiles: BackupFileInfo[] = [];
  for (const entry of entries) {
    if (entry.name && entry.name.startsWith("is_takip_backup_") && entry.name.endsWith(".json")) {
      try {
        const fileStats = await stat(entry.name, { baseDir: BaseDirectory.Download });
        backupFiles.push({
          name: entry.name,
          size: fileStats.size,
        });
      } catch {
        backupFiles.push({ name: entry.name, size: 0 });
      }
    }
  }

  // En yeni dosya en üstte
  backupFiles.sort((a, b) => b.name.localeCompare(a.name));
  return backupFiles;
};

/**
 * İndirilenler klasöründen bir metin dosyasını okur
 */
export const readTextFileFromDownloads = async (fileName: string): Promise<string> => {
  const { readTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  return await readTextFile(fileName, { baseDir: BaseDirectory.Download });
};

/**
 * İndirilenler klasöründen bir dosyayı siler.
 * `fs:allow-remove` izni gerektirir (bkz. capabilities/default.json).
 */
export const removeFileFromDownloads = async (fileName: string): Promise<void> => {
  const { remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await remove(fileName, { baseDir: BaseDirectory.Download });
};
