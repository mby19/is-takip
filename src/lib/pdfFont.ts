/** jsPDF'in yalnızca ihtiyaç duyduğumuz yüzeyi — statik import etmemek için. */
export interface FontCapableDoc {
  addFileToVFS: (fileName: string, data: string) => void;
  addFont: (fileName: string, fontName: string, fontStyle: string) => void;
}

const FONT_FILES = [
  { file: "Inter-Regular.ttf", style: "normal" },
  { file: "Inter-Bold.ttf", style: "bold" },
  { file: "Inter-Black.ttf", style: "black" },
] as const;

/** Font dosyaları bir kez indirilir, base64 olarak bellekte tutulur. */
let cache: Record<string, string> | null = null;

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/**
 * Inter fontlarını verilen jsPDF belgesine kaydeder (Türkçe karakterler için).
 *
 * Kayıt belge bazlıdır: indirme önbelleklenir ama her yeni belgeye yeniden
 * eklenir — aksi halde ikinci ve sonraki PDF'ler fontsuz kalıyordu.
 */
export async function registerTurkishFont(doc: FontCapableDoc): Promise<void> {
  if (!cache) {
    const baseUrl = window.location.origin;
    const buffers = await Promise.all(
      FONT_FILES.map(({ file }) =>
        fetch(`${baseUrl}/fonts/${file}`).then((r) => {
          if (!r.ok) throw new Error(`Font yüklenemedi: ${file}`);
          return r.arrayBuffer();
        }),
      ),
    );
    cache = Object.fromEntries(FONT_FILES.map(({ file }, i) => [file, toBase64(buffers[i])]));
  }

  for (const { file, style } of FONT_FILES) {
    doc.addFileToVFS(file, cache[file]);
    doc.addFont(file, "Inter", style);
  }
}
