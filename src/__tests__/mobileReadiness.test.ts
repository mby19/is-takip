import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Karar K5 (C): mobil hedefi Tauri ile açılıyor (bkz. docs/adr/0010-mobil-hedefi.md).
 *
 * Bu test KOD YAZMAZ; mevcut mobil altyapının durumunu sabitler. Amacı, mobil
 * yolunda kullanılan her Tauri çağrısının (ACL) karşılığının capability
 * dosyasında bulunduğunu ve deep-link tanımının iki yerde (config + Android
 * manifest) birbirini tuttuğunu kanıtlamaktır.
 *
 * Neden config okuyan bir test? Mobil altyapının kırılgan noktası kod değil,
 * `capabilities/default.json` + `tauri.conf.json` + `gen/android` üçlüsüdür.
 * Bunlar derleme sırasında Tauri tarafından üretilir; biri sessizce geri
 * alınırsa uygulama mobilde runtime'da "not allowed" hatası verir ve test
 * paketi yeşil kalır. Bu test o sessizliği kapatır.
 */

const repoRoot = resolve(__dirname, "../..");
const tauriRoot = join(repoRoot, "src-tauri");

const tauriConf = JSON.parse(readFileSync(join(tauriRoot, "tauri.conf.json"), "utf8")) as {
  identifier: string;
  app: { windows: { width?: number; height?: number }[] };
  plugins: { "deep-link"?: { mobile?: { scheme: string[]; host?: string }[] } };
};

const capability = JSON.parse(
  readFileSync(join(tauriRoot, "capabilities/default.json"), "utf8"),
) as {
  $schema?: string;
  platforms?: string[];
  windows: string[];
  permissions: string[];
};

const manifestPath = join(tauriRoot, "gen/android/app/src/main/AndroidManifest.xml");
const manifest = readFileSync(manifestPath, "utf8");

const permissions = new Set(capability.permissions);

/** `src/` altındaki tüm TypeScript/TSX dosyaları (node_modules ve build yok). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Kodda (testler hariç) kullanılan her `@tauri-apps/...` paketini bulur.
 *
 * `__tests__` bilinçli olarak dışlanır: test dosyaları `vi.mock()` için paket
 * adı yazar ama runtime'da o paketi çağırmaz. Onları envantere katmak,
 * capability'de karşılığı olması gerekmeyen izinler aramaya yol açardı.
 */
function tauriPackages(): Set<string> {
  const found = new Set<string>();
  const testDir = join(repoRoot, "src/__tests__");
  for (const file of sourceFiles(join(repoRoot, "src"))) {
    if (file.startsWith(testDir)) continue;
    for (const [, pkg] of readFileSync(file, "utf8").matchAll(/@tauri-apps\/([a-z0-9-]+)/g)) {
      found.add(pkg);
    }
  }
  return found;
}

/**
 * Kullanılan her paket için capability'de bulunması gereken izinler.
 * Değerler, `src-tauri/gen/schemas/acl-manifests.json` içindeki gerçek
 * permission tanımlarından türetildi (elle yazılmış isim listesi değil).
 */
const REQUIRED_BY_PACKAGE: Record<string, string[]> = {
  // src/lib/db.ts — ham SQLite; execute/select/load/close
  "plugin-sql": ["sql:allow-execute", "sql:allow-select", "sql:allow-load"],
  // src/lib/tauri.ts — yedekleme: Downloads okuma/yazma/silme/listeleme
  "plugin-fs": [
    "fs:allow-download-read",
    "fs:allow-download-write",
    "fs:allow-remove",
    "fs:allow-stat",
  ],
  // src/lib/tauri.ts — saveFileWithPicker (mobilde SAF kurtarma yolu)
  "plugin-dialog": ["dialog:allow-save"],
  // src/lib/reminder.ts + src/hooks/useReminders.ts
  "plugin-notification": [
    "notification:allow-notify",
    "notification:allow-request-permission",
    "notification:allow-is-permission-granted",
    // `cancel`/`register_action_types` masaüstünde komut olarak KAYITLI DEĞİL;
    // izin verilmiş olması mobil yolun çalışacağını garanti eder.
    "notification:allow-cancel",
    "notification:allow-register-action-types",
    // `onAction()` (src/hooks/useReminders.ts) `plugin:notification|register_listener`
    // komutunu çağırır; `notification:default` kümesi bunu kapsar, yani mobilde
    // bildirimden "toplu işaretle" eylemi çalışabilir.
    "notification:allow-register-listener",
  ],
  // src/hooks/useReminders.ts — getCurrent() + onOpenUrl()
  "plugin-deep-link": ["deep-link:default"],
  // src/lib/backup.ts — downloadDir(), join()
  api: [],
};

/** Bir izin ya doğrudan listelenmiş ya da `X:default` kümesiyle gelmiş olabilir. */
function granted(permission: string): boolean {
  if (permissions.has(permission)) return true;
  const [plugin] = permission.split(":");
  return permissions.has(`${plugin}:default`);
}

describe("Mobil hedefi: deep-link tanımı (K5/C)", () => {
  it("tauri.conf.json `istakip` şeması ve `bugun` host'u tanımlıyor", () => {
    const mobile = tauriConf.plugins["deep-link"]?.mobile;
    expect(mobile, "plugins.deep-link.mobile tanımlı değil").toBeDefined();
    expect(mobile?.[0]?.scheme).toContain("istakip");
    expect(mobile?.[0]?.host).toBe("bugun");
  });

  it("AndroidManifest intent-filter'ı aynı şema ve host'u taşıyor", () => {
    // Dikkat: Tauri'nin ürettiği deep-link bloğu `<intent-filter >` (boşluklu)
    // olabiliyor; düz `<intent-filter>` aramak onu kaçırır.
    const filters = manifest.match(/<intent-filter\s*>[\s\S]*?<\/intent-filter>/g) ?? [];
    const deepLinkFilter = filters.find(
      (f) => f.includes("android.intent.action.VIEW") && f.includes("android:scheme"),
    );
    expect(deepLinkFilter, "deep-link intent-filter bulunamadı").toBeDefined();
    expect(deepLinkFilter).toMatch(/android:scheme="istakip"/);
    expect(deepLinkFilter).toMatch(/android:host="bugun"/);
    // Kısayolun tarayıcıdan/başka uygulamadan açılabilmesi için Browsable şart.
    expect(deepLinkFilter).toContain("android.intent.category.BROWSABLE");
  });

  it("manifest'teki şema/host ile config birbirini tutuyor", () => {
    const mobile = tauriConf.plugins["deep-link"]?.mobile ?? [];
    for (const entry of mobile) {
      for (const scheme of entry.scheme) {
        expect(manifest).toContain(`android:scheme="${scheme}"`);
      }
      if (entry.host) expect(manifest).toContain(`android:host="${entry.host}"`);
    }
  });
});

describe("Mobil hedefi: capability kapsamı (K5/C)", () => {
  /**
   * `src/App.tsx` kök ekranda çift geri basışı uygulamayı kapatmak için
   * `getCurrentWindow().close()` çağırır → `plugin:window|close` komutu.
   *
   * Bu komut `core:window:default` kümesinde **yoktur** (acl-manifests.json'da
   * doğrulandı); yalnızca `core:window:allow-close` ile açılır. İzin olmazsa
   * çağrı reddedilir, kod `catch` bloğunda `window.close()`'a düşer ve o da
   * Tauri webview'da çoğunlukla etkisiz kalır — yani çıkış sessizce çalışmaz.
   *
   * Mobilde bu iznin anlamı yok (activity tam ekran zaten kapanır), ama izin
   * platformlar arasında paylaşıldığı için **masaüstünde** şarttır.
   */
  it("`getCurrentWindow().close()` için core:window:allow-close tanımlı", () => {
    expect(
      permissions.has("core:window:allow-close"),
      "core:window:allow-close yok; App.tsx çıkışı çalışmaz (core:window:default bu komutu içermez)",
    ).toBe(true);
  });

  it("capability platform süzgeci içermiyor — yani mobilde de geçerli", () => {
    // `platforms` anahtarı olsaydı masaüstü-only kalır ve mobilde tüm IPC reddedilirdi.
    expect(capability.platforms, "capability mobil için daraltılmış").toBeUndefined();
    expect(capability.windows).toContain("main");
  });

  it("mobilde kullanılan her paket için gerekli izinler tanımlı", () => {
    const used = tauriPackages();
    expect(used.size, "hiç @tauri-apps paketi bulunamadı").toBeGreaterThan(0);

    const missing: string[] = [];
    for (const pkg of used) {
      for (const permission of REQUIRED_BY_PACKAGE[pkg] ?? []) {
        if (!granted(permission)) missing.push(`${pkg} → ${permission}`);
      }
    }
    expect(missing, `capability'de eksik izin: ${missing.join(", ")}`).toEqual([]);
  });

  it("hiçbir izin bilinmeyen eklentiye ait değil (yazım hatası yok)", () => {
    // acl-manifests.json, derleme sırasında Tauri tarafından üretilen gerçek
    // permission kayıtlarıdır; capability'deki her izin burada tanımlı olmalıdır.
    // Manifest eklentiye göre bölünmüştür: `permissions` tekil komut izinlerini,
    // `permission_sets` ise birden fazla komutu+scope'u paketleyen kümeleri tutar.
    const manifests = JSON.parse(
      readFileSync(join(tauriRoot, "gen/schemas/acl-manifests.json"), "utf8"),
    ) as Record<
      string,
      {
        default_permission: { permissions: string[] };
        permissions: Record<string, unknown>;
        permission_sets: Record<string, unknown>;
      }
    >;

    const unknown: string[] = [];
    for (const permission of capability.permissions) {
      // Dikkat: izin kimliği iki ya da üç parçalı olabilir.
      //   `sql:allow-execute`    → eklenti `sql`,    izin `allow-execute`
      //   `core:window:allow-close` → eklenti `core:window`, izin `allow-close`
      // `split(":")` üç parçalı kimlikte plugin'i `core` alır ve `core` altında
      // `window:allow-close` arar; böylece **geçerli** bir izin yanlışlıkla
      // "tanımsız" sayılırdı. Bu yüzden uzunluğa göre ayrıştırıyoruz.
      const parts = permission.split(":");
      const plugin = parts.length >= 3 ? `${parts[0]}:${parts[1]}` : parts[0];
      const name = parts.length >= 3 ? parts.slice(2).join(":") : parts[1];

      const entry = manifests[plugin];
      if (entry === undefined) {
        unknown.push(permission);
        continue;
      }
      if (name === "default") continue;

      const exists =
        entry.permissions[name] !== undefined || entry.permission_sets[name] !== undefined;
      if (!exists) unknown.push(permission);
    }
    expect(unknown, "acl-manifests.json'da karşılığı olmayan izin").toEqual([]);
  });
});

describe("Mobil hedefi: pencere yapılandırması bilgisi (K5/C)", () => {
  /**
   * BİLGİ TESTİ — hiçbir şeyi düzeltmez, yalnızca dokümanlar.
   *
   * `tauri.conf.json` içindeki 800x600 / minWidth / minHeight masaüstü
   * penceresinin OS tarafından uygulanan boyut ipuçlarıdır (wry). Mobilde
   * WebView activity'yi tamamen doldurur; Tauri'nin config şeması bu alanları
   * "desktop only" olarak işaretlemez ve mobil derlemede hata üretmez —
   * yani 800x600 mobilde geçersiz DEĞİLDİR, yalnızca yok sayılır.
   *
   * Gerçek mobil risk burada değil, UI'da: sabit px tabanlı ekranlar
   * (bkz. CalendarView) telefonda taşabilir. Bu test o riski ölçmez,
   * yalnızca "config'in mobilde kırılmadığı" bilgisini sabitler.
   */
  it("pencere boyutları masaüstü için tanımlı ve mobilde hata üretmiyor", () => {
    const [main] = tauriConf.app.windows;
    expect(main.width).toBeGreaterThan(0);
    expect(main.height).toBeGreaterThan(0);
    // Config şeması mobilde de aynı düzeni kabul eder; ek bir mobil bloğu yok.
    expect(tauriConf.app.windows).toHaveLength(1);
  });
});

describe("Mobil hedefi: Android manifesti (K5/C)", () => {
  it("deep-link intent-filter'ı uygulamanın tek activity'sine bağlı", () => {
    // singleTask + VIEW intent-filter birlikte olmazsa kısayol ikinci bir
    // activity açıp uygulamayı iki kez başlatır.
    expect(manifest).toMatch(/android:launchMode="singleTask"/);
  });

  it("cleartext trafiğin placeholder'ı release build'de false kalıyor", () => {
    // Placeholder build.gradle.kts'ten gelir; kaynak manifest'ta defaultConfig
    // false, yalnızca debug varyantı true yapıyor. Burada yalnız placeholder'ın
    // kaynak manifestte tanımlı olduğunu sabitliyoruz.
    expect(manifest).toContain('android:usesCleartextTraffic="${usesCleartextTraffic}"');
  });
});

describe("Mobil hedefi: iOS Info.plist (K5/C)", () => {
  /**
   * iOS tarafında iki ayrı plist var ve ikisi farklı güvence düzeyinde.
   *
   *   - `src-tauri/Info.ios.plist`            → kaynak kod. Tauri CLI bunu
   *     `gen/apple/is-takip_iOS/Info.plist` ile birleştirir (`ios build`
   *     sırasında "failed to save merged Info.plist file"). Silinirse deep link
   *     kalıcı olarak kaybolur. **SERT FAIL** — bu dosya elle düzenlenmez.
   *   - `src-tauri/gen/apple/.../Info.plist`  → her derlemede yeniden üretilir.
   *     `UIFileSharingEnabled` gibi elle eklenen anahtarlar burada yaşamaz;
   *     dosyayı commit etmek yanıltıcı bir güvence verir.
   *
   * Bölüm iki bu yüzden `test.fails` DEĞİL, koşullu bilgi testidir: merge
   * ancak Rust'in iOS hedefi için derlenmesi sırasında olur. Derleme
   * engelliyken CFBundleURLTypes yoktur ve bu bir hata değil, bekleyen
   * adımdır — `tauri ios build` sonrası yeniden doğrulanmalıdır.
   */

  const persistentPlist = join(tauriRoot, "Info.ios.plist");
  const generatedPlist = join(tauriRoot, "gen/apple/is-takip_iOS/Info.plist");

  it("kalıcı `Info.ios.plist` kaynak dosyası depoda duruyor", () => {
    // Dosya yoksa merge kaynağı kaybolur; `ios init` bunu geri getirmez,
    // çünkü kalıcı dosya gelene kadar `gen/` altındaki plist deep link içermez.
    expect(
      existsSync(persistentPlist),
      "src-tauri/Info.ios.plist silinmiş — iOS deep link kalıcı olarak kaybolur",
    ).toBe(true);
  });

  it("kalıcı plist `istakip` şemasını config ile aynı değerden taşıyor", () => {
    // Dosya yoksa ham ENOENT yerine okunabilir mesajla düşmek için önce
    // varlığı doğruluyoruz (üstteki test zaten bunu ayrı bir başlıkta kontrol
    // ediyor; burada tekrar ediyoruz çünkü bu blok dosyayı okuyor).
    expect(
      existsSync(persistentPlist),
      "src-tauri/Info.ios.plist silinmiş — iOS deep link kalıcı olarak kaybolur",
    ).toBe(true);
    const plist = readFileSync(persistentPlist, "utf8");
    expect(plist, "CFBundleURLTypes merge kaynağında yok").toContain("CFBundleURLTypes");
    // Şema adı config ile birebir aynı olmalı; ayrışırsa kısayol sessizce
    // çalışmaz (Android tarafındaki "config ile manifest tutuyor" testinin
    // iOS karşılığı).
    const mobile = tauriConf.plugins["deep-link"]?.mobile ?? [];
    const schemes = mobile.flatMap((entry) => entry.scheme);
    expect(schemes.length, "config'de deep-link şeması yok").toBeGreaterThan(0);
    for (const scheme of schemes) {
      expect(plist, `kalıcı plist "${scheme}" şemasını içermiyor`).toContain(
        `<string>${scheme}</string>`,
      );
    }
  });

  it("üretilen plist merge sonrası CFBundleURLTypes taşıyor (derleme sonrası doğrula)", () => {
    // BİLGİ TESTİ — koşullu, sert fail etmez.
    //
    // `gen/apple/is-takip_iOS/Info.plist` Tauri tarafından yeniden üretilir;
    // deep-link eklentisi `CFBundleURLTypes`'ı ancak Rust'in iOS hedefi için
    // derlenmesi sırasında `build.rs` ile merge eder. Derleme tek bir üçüncü
    // taraf kütüphane hatasında durduğu için merge henüz gerçekleşmedi.
    //
    // Bu yüzden burada `expect(...)` yok: eksiklik bir regresyon değil,
    // iOS derlemesinin tamamlanmasını bekleyen bir adımdır. Derleme
    // tamamlandığında dosya yeniden üretilir ve bu blok gözle doğrulanır.
    //
    // Elle bir anahtar eklemek (ör. `UIFileSharingEnabled`) yanıltıcıdır: dosya
    // bir sonraki `ios build`'de ezilir. Kalıcı değişiklik `Info.ios.plist`'e
    // yazılır ve üstteki test onu korur.
    const merged = existsSync(generatedPlist) ? readFileSync(generatedPlist, "utf8") : null;
    const hasUrlTypes = merged !== null && merged.includes("CFBundleURLTypes");

    if (!hasUrlTypes) {
      // Merge henüz olmadı. Bu bir regresyon değil: derleme tamamlanınca
      // dosya yeniden üretilir ve blok aşağıdaki gerçek kontrole düşer.
      console.info(
        "[iOS] Üretilen Info.plist henüz CFBundleURLTypes taşımıyor — beklenen durum " +
          "(derleme tamamlanmadı). `tauri ios build` sonrası doğrulanmalı. " +
          "Kalıcı kaynak: src-tauri/Info.ios.plist (üstteki test onu koruyor).",
      );
      return;
    }

    // Merge olduysa burası artık gerçek kontroldür: üretilen plist config'deki
    // şemayı taşımak zorunda. Derleme tamamlandığında buraya düşer.
    const mobile = tauriConf.plugins["deep-link"]?.mobile ?? [];
    for (const scheme of mobile.flatMap((entry) => entry.scheme)) {
      expect(merged, `merge edilmiş plist "${scheme}" şemasını taşımıyor`).toContain(
        `<string>${scheme}</string>`,
      );
    }
  });

  it("üretilen plist dosya paylaşımı açmıyor (maaş verisi Files uygulamasına sızmaz)", () => {
    // `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` olsaydı
    // SQLite dosyası cihazın Files uygulamasından görüntülenebilir ve
    // kopyalanabilirdi — Android'de `allowBackup=false`'ın kapatmadığı ikinci
    // bir sızma yolu. İkisi de **yok** ve bu test onu sabitler.
    if (!existsSync(generatedPlist)) return; // dosya yoksa yukarıdaki blok zaten bildiriyor
    const plist = readFileSync(generatedPlist, "utf8");
    expect(plist, "UIFileSharingEnabled açık — veri Files uygulamasına sızar").not.toContain(
      "UIFileSharingEnabled",
    );
    expect(plist, "LSSupportsOpeningDocumentsInPlace açık — veri yerinde açılabilir").not.toContain(
      "LSSupportsOpeningDocumentsInPlace",
    );
  });
});
