import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Playwright testleri CommonJS olarak derlendiği için __dirname kullanılır.
const repoRoot = resolve(__dirname, "../..");

/**
 * Rust migration'larındaki SQL bloklarını sırayla çıkarır.
 *
 * Şemayı burada elle tekrarlamak yerine tek kaynaktan (db.rs) okuyoruz;
 * aksi halde test şeması gerçek şemadan sessizce ayrışır.
 */
export function migrationSql(): string {
  const rust = readFileSync(resolve(repoRoot, "src-tauri/src/db.rs"), "utf8");
  const blocks = [...rust.matchAll(/sql:\s*"([\s\S]*?)"\s*,\s*\n\s*kind:/g)].map((m) => m[1]);

  if (blocks.length === 0) {
    throw new Error("db.rs içinde migration bulunamadı — regex güncellenmeli.");
  }
  return blocks.join("\n");
}
