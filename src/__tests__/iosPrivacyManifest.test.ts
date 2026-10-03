import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * iOS gizlilik beyanları kalıcı olsun.
 *
 * İki ayrı zorunluluk var ve ikisi de "build'de üretilen ama sürüm kontrolünde
 * olmayan" dosyalara yazılırsa sessizce kaybolur:
 *
 *  1. `ITSAppUsesNonExemptEncryption` — App Store Connect her yüklemede ihracat
 *     uyumluluğu sorularını elle cevaplamayı istiyor.
 *  2. `PrivacyInfo.xcprivacy` — Apple 2024'ten beri zorunlu; eksik/geçersiz
 *     manifest yüklemeleri reddediliyor (ITMS-91053).
 *
 * İkisi için de kalıcı yer Tauri'nin "kaynak tarafı":
 *   - `src-tauri/Info.ios.plist` → Tauri her `tauri ios build`'de
 *     üretilen Info.plist ile BİRLEŞTİRİR (tauri-cli `merge_plist`).
 *   - `src-tauri/PrivacyInfo.xcprivacy` + `tauri.conf.json → bundle.iOS.template`
 *     → XcodeGen şablonu dosyayı Copy Bundle Resources'a ekler.
 *
 * `bundle.resources` BİR SEÇENEK DEĞİL: Tauri o yolu `inject_resources` ile
 * `gen/apple/assets/` klasörüne kopyalar, XcodeGen de `assets` dizinini bir
 * "folder reference" olarak ekler — sonuç `is-takip.app/assets/PrivacyInfo.xcprivacy`
 * olur. Apple ise iOS uygulamalarında dosyanın bundle KÖKÜNDE olmasını şart
 * koşuyor. Bu yüzden `bundle.iOS.template` tek geçerli yol.
 */
const tauriDir = resolve(__dirname, "../../src-tauri");
const conf = JSON.parse(readFileSync(resolve(tauriDir, "tauri.conf.json"), "utf8"));
const iosPlist = readFileSync(resolve(tauriDir, "Info.ios.plist"), "utf8");
const manifestPath = resolve(tauriDir, "PrivacyInfo.xcprivacy");
const manifest = readFileSync(manifestPath, "utf8");
const template = readFileSync(resolve(tauriDir, "apple-project.yml"), "utf8");

/** Açılan/kapanan `<dict>` sayıları eşleşmiyorsa Tauri merge sırasında patlar. */
function expectBalancedPlist(source: string, label: string) {
  const opens = (source.match(/<dict>/g) ?? []).length;
  const closes = (source.match(/<\/dict>/g) ?? []).length;
  expect(opens, `${label}: <dict> sayısı`).toBe(closes);
  expect(source.trimEnd().endsWith("</plist>"), `${label} </plist> ile bitmiyor`).toBe(true);
}

describe("İhracat uyumluluğu beyanı (ITSAppUsesNonExemptEncryption)", () => {
  it("Info.ios.plist'te false olarak beyan edilmiş", () => {
    // Anahtar yoksa App Store Connect her yüklemede soruyu elle sorar.
    expect(iosPlist).toContain("<key>ITSAppUsesNonExemptEncryption</key>");
    expect(iosPlist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });

  it("Info.ios.plist geçerli bir plist olarak kapanıyor", () => {
    // Tauri bu dosyayı `merge_plist` ile birleştiriyor; eksik `</dict>`
    // bütün Info.plist üretimini kırar.
    expectBalancedPlist(iosPlist, "Info.ios.plist");
  });

  it("mevcut deep-link URL şeması korunuyor", () => {
    // Aynı dosya `CFBundleURLTypes` için de kullanılıyor; privacy manifest
    // eklenirken bu kaybolursa `istakip://bugun` derin bağlantısı ölür.
    expect(iosPlist).toContain("CFBundleURLTypes");
    expect(iosPlist).toContain("<string>istakip</string>");
  });
});

describe("PrivacyInfo.xcprivacy bundle köküne giriyor", () => {
  it("manifest dosyası sürüm kontrolünde, gen/ dışında", () => {
    // gen/ altındaki her şey Tauri tarafından yeniden üretilebilir.
    expect(manifestPath.includes("/gen/")).toBe(false);
  });

  it("manifest Apple'ın beklediği kök anahtarları içeriyor", () => {
    for (const key of [
      "NSPrivacyTracking",
      "NSPrivacyTrackingDomains",
      "NSPrivacyCollectedDataTypes",
      "NSPrivacyAccessedAPITypes",
    ]) {
      expect(manifest, `${key} eksik`).toContain(`<key>${key}</key>`);
    }
  });

  it("veri toplama ve takip kapalı beyan edilmiş", () => {
    // Kayıt/analitik SDK'sı yok; Sentry yalnızca DSN tanımlıysa açılıyor ve
    // `sendDefaultPii: false` ile IP/header göndermiyor.
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\s*\/>/);
  });

  it("kullanılan required reason API'leri gerekçeleriyle bildirilmiş", () => {
    // `stat()` (yedek dosyalarını listeleme) ve WebView'in UserDefaults erişimi
    // bildirilmemişse yükleme ITMS-91053 alır.
    expect(manifest).toContain("NSPrivacyAccessedAPICategoryFileTimestamp");
    expect(manifest).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    for (const reason of ["C617.1", "CA92.1"]) {
      expect(manifest, `${reason} gerekçesi eksik`).toContain(`<string>${reason}</string>`);
    }
  });

  it("geçerli bir plist olarak kapanıyor", () => {
    expectBalancedPlist(manifest, "PrivacyInfo.xcprivacy");
  });

  it("tauri.conf.json, XcodeGen şablonunu gösteriyor", () => {
    // Bu bağ olmadan şablon hiç kullanılmaz; PrivacyInfo.xcprivacy
    // Copy Bundle Resources'a girmez ve Apple kök konumunu görmez.
    //
    // Yol PROJE KÖKÜNE GÖRE çözülür, `src-tauri/`'ye göre değil:
    // tauri-cli `mobile/ios/project.rs` içinde şablonu doğrudan
    // `std::fs::read_to_string(template_path)` ile okuyor — erişilen
    // `std::fs::read_to_string` PathBuf'i olduğu gibi işler, hiçbir yerde
    // `tauri_dir.join(...)` ile birleştirilmez. `tauri ios init` de
    // `set_current_dir` çağırmaz (ios `build`/`dev` çağırır, `init` çağırmaz),
    // dolayısıyla çalışma dizini kullanıcının `npx tauri ios init` çalıştırdığı
    // proje köküdür. `"apple-project.yml"` yazmak "No such file or directory"
    // ile init'i düşürür; doğrulandı.
    expect(conf.bundle?.iOS?.template).toBe("src-tauri/apple-project.yml");
  });

  it("şablon dosyası gerçekten var ve handlebars şablonu", () => {
    expect(template).toContain("{{app.name}}");
    expect(template).toContain("targets:");
  });

  it("şablon, manifesti Copy Bundle Resources'a ekliyor", () => {
    // XcodeGen'de `buildPhase: resources` olmadan dosya target'a bağlanmaz.
    // Arama, dosya adı geçen satırdan SONRAKİ iki satıra bakmalı: handlebars
    // şablonunda `buildPhase` girdiden sonraki satırda gelir.
    const lines = template.split("\n");
    const entry = lines.findIndex((l) => l.includes("PrivacyInfo.xcprivacy"));
    expect(entry, "şablonda PrivacyInfo.xcprivacy kaydı yok").toBeGreaterThan(-1);
    expect(
      lines.slice(entry + 1, entry + 3).join("\n"),
      "PrivacyInfo kaydında buildPhase: resources yok",
    ).toContain("buildPhase: resources");
  });

  it("şablon, Tauri'nin varsayılan proje yapısını koruyor", () => {
    // Şablon Tauri'nin kendi varsayılan şablonudur; eksik bir hedef ya da
    // sources kaydı Xcode üretimini bozar (build yine "başarılı" görünür).
    // Not: `CFBundleIdentifier` gibi XcodeGen'in ÜRETTİĞİ alanlar şablonda
    // bulunmaz; yalnız şablonun kopyaladığı yapı parçaları kontrol edilir.
    for (const required of [
      "LaunchScreen.storyboard",
      "Assets.xcassets",
      "Build Rust Code",
      "entitlements",
      "Info.plist",
    ]) {
      expect(template, `şablonda "${required}" yok`).toContain(required);
    }
  });

  it("şablonun göreli yolu doğru", () => {
    // project.yml `gen/apple/` altında üretilir; `../../` oradan src-tauri'ye
    // gider. Yanlış ön ek, XcodeGen'in "path does not exist" hatası verir.
    expect(template).toContain("../../PrivacyInfo.xcprivacy");
  });
});
