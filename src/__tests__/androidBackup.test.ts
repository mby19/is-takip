import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

/**
 * Karar K12: Android yedeğini kapat.
 *
 * Uygulamanın tüm verisi (maaş, ücret, `audit_logs`) tek bir SQLite dosyasında,
 * cihaz üzerinde duruyor. Android'un varsayılanı `allowBackup=true` olduğu için
 * cihaz kaybolur/çalınırsa bu dosya Google yedeğine şifresiz kopyalanıyordu.
 *
 * Tauri v2'de `tauri.conf.json` üzerinden Android manifest'ini değiştirecek bir
 * seçenek yok; `tauri android init` yalnızca EKSİK dosyaları oluşturuyor,
 * var olan `AndroidManifest.xml`'i ezmıyor. Yani `gen/android` elle düzenlenmiş
 * hâlde tutuluyor — ve `gen/android` silinip yeniden üretilirse bu koruma
 * sessizce kaybolur. Bu test tam olarak o senaryoyu yakalar.
 *
 * Kapsanan iki Android yolu:
 *   - Android 11 ve altı → `android:fullBackupContent="false"`
 *   - Android 12+ (API 31) → `android:dataExtractionRules` (fullBackupContent burada YOK SAYILIR)
 */
const androidRoot = resolve(__dirname, "../../src-tauri/gen/android");
const manifestPath = resolve(androidRoot, "app/src/main/AndroidManifest.xml");
const xmlDir = resolve(androidRoot, "app/src/main/res/xml");

const manifest = readFileSync(manifestPath, "utf8");

/**
 * `<application ...>` açılış etiketini verir. Nitelikler tırnak içinde olduğu
 * için `[^>]*` yeterli; `${usesCleartextTraffic}` gibi placeholder'lar sorun çıkarmaz.
 * Yorum satırları etiketin dışında kaldığı için öznitelik taramasına karışmaz.
 */
const applicationTag = manifest.match(/<application\b([^>]*)>/)?.[1];
if (applicationTag === undefined) {
  throw new Error(`${manifestPath} içinde <application> etiketi bulunamadı`);
}

/** <application> etiketindeki android:* niteliklerini nesneye çevirir. */
const attrs: Record<string, string> = {};
for (const [, name, value] of applicationTag.matchAll(/android:([\w.]+)\s*=\s*"([^"]*)"/g)) {
  attrs[name] = value;
}

/** <data-extraction-rules> içindeki <cloud-backup> ve <device-transfer> blokları. */
function extractionBlocks(xml: string): Record<string, string[]> {
  const blocks: Record<string, string[]> = {};
  for (const [, name, body] of xml.matchAll(
    /<(cloud-backup|device-transfer)\b[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    blocks[name] = [...body.matchAll(/<exclude\s+domain="([^"]+)"/g)].map((m) => m[1]);
  }
  return blocks;
}

/** Hiçbir yedekleme kanalının veri taşıyamayacağı tam domain listesi. */
const ALL_DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];

/** `build/` çıktıları hariç, projedeki tüm kaynak AndroidManifest.xml dosyaları. */
function sourceManifests(): string[] {
  return readdirSync(androidRoot, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith("AndroidManifest.xml"))
    .map((rel) => resolve(androidRoot, rel))
    .filter((abs) => !relative(androidRoot, abs).split(sep).includes("build"));
}

describe("Android yedekleme kapalı (K12)", () => {
  it("allowBackup=false — platform yedeğinin ana anahtarı", () => {
    // Nitelik yoksa Android varsayılanı `true` → cihaz verisi Google yedeğine gider.
    expect(attrs.allowBackup).toBe("false");
  });

  it("Android 11 ve altı yolu: fullBackupContent=false", () => {
    // API 30 ve altında `dataExtractionRules` yok sayılır; tek bağlantı budur.
    expect(attrs.fullBackupContent).toBe("false");
  });

  it("Android 12+ yolu: dataExtractionRules bir XML kaynağına bağlı", () => {
    expect(attrs.dataExtractionRules).toBe("@xml/data_extraction_rules");
  });

  it("data extraction kuralları hem cloud yedeğini hem cihaz aktarımını kapatıyor", () => {
    const rulesPath = resolve(xmlDir, "data_extraction_rules.xml");
    const rules = readFileSync(rulesPath, "utf8");

    expect(rules).toContain("<data-extraction-rules");
    const blocks = extractionBlocks(rules);

    // İki kanal da ayrı ayrı kapatılmalı: yalnız cloud-backup yeterli değil,
    // cihazdan cihaza aktarım da aynı maaş defterini kopyalar.
    for (const channel of ["cloud-backup", "device-transfer"]) {
      expect(blocks[channel], `${channel} bloğu yok`).toBeDefined();
      for (const domain of ALL_DOMAINS) {
        expect(blocks[channel], `${channel} → ${domain} hariç tutulmamış`).toContain(domain);
      }
    }
  });

  it("compileSdk 31+ — yoksa dataExtractionRules özniteliği anlamsız kalır", () => {
    // `android:dataExtractionRules` API 31'de tanımlandı. Daha düşük compileSdk'da
    // manifest birleştirme sırasında öznitelik düşer ve Android 12+ yolu sessizce açılır.
    const gradle = readFileSync(resolve(androidRoot, "app/build.gradle.kts"), "utf8");
    const compileSdk = Number(gradle.match(/compileSdk\s*=\s*(\d+)/)?.[1]);
    expect(Number.isNaN(compileSdk)).toBe(false);
    expect(compileSdk).toBeGreaterThanOrEqual(31);
  });

  it("hiçbir kaynak manifest yedeği yeniden açmıyor", () => {
    // Bir eklenti veya ikincil manifest `allowBackup="true"` getirirse Gradle
    // birleştirmesi bizim değerimizin üzerine yazabilir. `build/` altındaki
    // merged_manifest çıktıları taranmaz: bunlar üretilmiş ve bayat artıklar.
    const offenders = sourceManifests().filter((path) =>
      /android:allowBackup\s*=\s*"true"/.test(readFileSync(path, "utf8")),
    );
    expect(offenders, "allowBackup=true getiren kaynak manifest var").toEqual([]);
  });
});
