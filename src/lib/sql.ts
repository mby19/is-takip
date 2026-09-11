/**
 * SQL literal yardımcıları.
 *
 * Neden gerekli: `@tauri-apps/plugin-sql` altta bir bağlantı havuzu (pool)
 * kullanıyor. Ayrı ayrı yapılan `execute` çağrıları farklı bağlantılara
 * düşebileceği için `BEGIN` / `COMMIT` çağrılarını ayrı ayrı göndermek
 * güvenilir bir transaction sağlamaz. Bunun yerine birden çok ifadeyi tek bir
 * `execute` çağrısında, tek bir metin olarak gönderiyoruz — bu tek bir
 * bağlantıda çalışır ve gerçek atomiklik sağlar.
 *
 * Tek metin gönderdiğimiz için bağlama parametresi (`?`) kullanılamıyor;
 * değerleri literal olarak gömmek zorundayız. SQLite metin literallerinde
 * ters bölü kaçışı yoktur — tek tırnağı ikiye katlamak eksiksiz ve güvenli
 * bir kaçış yöntemidir.
 */

/** SQLite metin literalindeki tek tırnakları ikiye katlar. */
export const escapeSqlString = (value: string): string => value.replace(/'/g, "''");

/**
 * Herhangi bir JS değerini güvenli bir SQLite literaline çevirir.
 * Sayı olmayan sayılar (NaN, Infinity) ve NUL karakteri reddedilir.
 */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";

  if (typeof value === "boolean") return value ? "1" : "0";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Geçersiz sayısal değer: ${String(value)}`);
    }
    return String(value);
  }

  const text = String(value);
  if (text.includes("\0")) {
    throw new Error("Metin alanı geçersiz karakter (NUL) içeriyor.");
  }
  return `'${escapeSqlString(text)}'`;
}

/**
 * İfade listesini tek bir transaction betiğine çevirir.
 * Her ifade noktalı virgülle biter; `BEGIN IMMEDIATE` ile `COMMIT` arasına alınır.
 *
 * ÖNEMLİ: SQLite'ta bir kısıt ihlali varsayılan olarak YALNIZCA o ifadeyi geri
 * alır; transaction açık kalır ve sonraki COMMIT önceki ifadeleri kalıcı yapar.
 * Bu yüzden betikteki yazma ifadeleri `INSERT OR ROLLBACK` / `UPDATE OR ROLLBACK`
 * biçiminde üretilir — böylece herhangi bir ihlal tüm transaction'ı geri alır.
 */
export function buildTransactionScript(statements: string[]): string {
  const body = statements
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(";") ? s : `${s};`))
    .join("\n");

  return `BEGIN IMMEDIATE;\n${body}\nCOMMIT;`;
}
