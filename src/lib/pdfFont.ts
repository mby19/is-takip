import jsPDF from "jspdf";

let loaded = false;

/**
 * Inter fontlarını jsPDF'e kaydeder.
 * Fontlar public/fonts/ altında bulunur, Vite dev/built sunar.
 * Bu fonksiyon async'tir — PDF oluşturmadan önce çağrılmalıdır.
 */
export async function registerTurkishFont(doc: jsPDF): Promise<void> {
  if (loaded) return;

  const baseUrl = window.location.origin;

  const [regular, bold, black] = await Promise.all([
    fetch(`${baseUrl}/fonts/Inter-Regular.ttf`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/fonts/Inter-Bold.ttf`).then((r) => r.arrayBuffer()),
    fetch(`${baseUrl}/fonts/Inter-Black.ttf`).then((r) => r.arrayBuffer()),
  ]);

  const toBase64 = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  doc.addFileToVFS("Inter-Regular.ttf", toBase64(regular));
  doc.addFileToVFS("Inter-Bold.ttf", toBase64(bold));
  doc.addFileToVFS("Inter-Black.ttf", toBase64(black));

  doc.addFont("Inter-Regular.ttf", "Inter", "normal");
  doc.addFont("Inter-Bold.ttf", "Inter", "bold");
  doc.addFont("Inter-Black.ttf", "Inter", "black");

  loaded = true;
}
