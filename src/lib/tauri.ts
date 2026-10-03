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
  /**
   * true ise bu dosya geri yükleme öncesi otomatik üretilmiş güvenlik
   * yedeğidir. Arayüz bunu etiketlemek için kullanır — kullanıcı bu
   * dosyanın kendi yedeği değil, uygulamanın kendi güvenlik kopyası
   * olduğunu bilmelidir.
   */
  isAutomatic: boolean;
}

/** Yedek dosyası adı önekleri. `backup.ts` bunları buradan alır. */
export const MANUAL_BACKUP_PREFIX = "is_takip_backup_";
export const AUTOMATIC_BACKUP_PREFIX = "is_takip_otomatik_yedek_";
export const BACKUP_FILE_PREFIXES = [MANUAL_BACKUP_PREFIX, AUTOMATIC_BACKUP_PREFIX] as const;

export const isBackupFileName = (name: string): boolean =>
  name.endsWith(".json") && BACKUP_FILE_PREFIXES.some((prefix) => name.startsWith(prefix));

export const isAutomaticBackupFileName = (name: string): boolean =>
  name.startsWith(AUTOMATIC_BACKUP_PREFIX) && name.endsWith(".json");

/**
 * İndirilenler klasöründeki yedekleme dosyalarını listeler.
 *
 * Hem kullanıcının aldığı `is_takip_backup_` dosyaları hem de geri yükleme
 * öncesi otomatik üretilen `is_takip_otomatik_yedek_` dosyaları listelenir;
 * otomatik yedekleri gizlemek kullanıcıyı "yedeklerim kayboldu" izlenimine
 * sokuyordu.
 */

export const listBackupFiles = async (): Promise<BackupFileInfo[]> => {
  const { readDir, stat, BaseDirectory } = await import("@tauri-apps/plugin-fs");

  const entries = await readDir("", { baseDir: BaseDirectory.Download });

  const backupFiles: BackupFileInfo[] = [];
  for (const entry of entries) {
    if (entry.name && isBackupFileName(entry.name)) {
      try {
        const fileStats = await stat(entry.name, { baseDir: BaseDirectory.Download });
        backupFiles.push({
          name: entry.name,
          size: fileStats.size,
          isAutomatic: isAutomaticBackupFileName(entry.name),
        });
      } catch {
        backupFiles.push({
          name: entry.name,
          size: 0,
          isAutomatic: isAutomaticBackupFileName(entry.name),
        });
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

/**
 * Kullanıcıya kaydetme yeri seçtirir ve dosyayı oraya yazar.
 *
 * Neden gerekli: `BaseDirectory.Download` Android'de telefonun gerçek
 * İndirilenler klasörü değil, `Android/data/<paket>/files/Download` altıdır.
 * Orası Android 11+ ile dosya yöneticisinden gezilemez ve uygulama silinince
 * birlikte silinir. Kaydetme diyaloğu (SAF) ise gerçek İndirilenler, Google
 * Drive ve telefondaki diğer hedefleri sunar.
 *
 * Kullanıcı vazgeçerse `null` döner.
 */
export const saveFileWithPicker = async (
  fileName: string,
  data: Uint8Array | string,
): Promise<string | null> => {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");

  const extension = fileName.split(".").pop() || "";
  const target = await save({
    defaultPath: fileName,
    filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : undefined,
  });

  if (!target) return null;

  if (typeof data === "string") {
    await writeTextFile(target, data);
  } else {
    await writeFile(target, data);
  }
  return target;
};
