import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Android RELEASE İMZASI debug keystore'a düşmesin.
 *
 * Tauri v2'de Android release imzasını `tauri.conf.json`'dan yapılandıran bir
 * alan YOK — resmi yol `gen/android/app/build.gradle.kts` dosyasını düzenlemek
 * (https://v2.tauri.app/distribute/sign/android). `gen/` altındaki bu dosya
 * Tauri tarafından yeniden üretilebilir; `tauri android init` sıfır bir proje
 * kurduğunda imza bloğu sessizce gider ve release derlemesi yine debug
 * anahtarına düşer. Bu test o sessiz geri dönüşü yakalar.
 *
 * Gerçek imza üretmek yerine İMZA DEĞERLERİNİN KAYNAĞINI doğrularız:
 *   - release signingConfig ortam değişkenlerinden/keystore.properties okuyor
 *   - release buildType debug config'e DEĞİL release config'e bağlanıyor
 *   - sır yoksa GradleException fırlatılıyor (sessiz geri dönüş yok)
 *   - `.gitignore` keystore dosyalarını yanlışlıkla commit etmeyi engelliyor
 *
 * `release.yml`'deki üç secret'ın (ANDROID_KEYSTORE_BASE64 / ANDROID_KEY_ALIAS /
 * ANDROID_KEY_PASSWORD) gerçekten bu dosyada okunan adlarla eşleştiği de
 * kontrol edilir: isimler ayrışırsa CI'da imza yine sessizce oluşmaz çünkü
 * guard hata verir, ama kullanıcı nedenini anlamakta zorlanır.
 */
const androidRoot = resolve(__dirname, "../../src-tauri/gen/android");
const gradlePath = resolve(androidRoot, "app/build.gradle.kts");
const gradle = readFileSync(gradlePath, "utf8");
const workflow = readFileSync(resolve(__dirname, "../../.github/workflows/release.yml"), "utf8");

/** `getByName("release") { ... }` bloğunu, gövde blok eşleştirmesiyle çıkarır. */
function blockOf(source: string, header: string): string {
  const start = source.indexOf(header);
  expect(start, `"${header}" bulunamadı`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + header.length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`"${header}" bloğu kapanmıyor`);
}

const releaseBuildType = blockOf(gradle, 'getByName("release")');
const releaseSigningConfig = blockOf(gradle, 'create("release")');

describe("Android release imzası gerçek keystore'dan okunuyor", () => {
  it("release buildType debug signing config'e bağlanmıyor", () => {
    // BUG #1: `signingConfig = signingConfigs.getByName("debug")`. Bu satır
    // release.yml'deki ANDROID_KEYSTORE_BASE64/ALIAS/PASSWORD sırlarını hiç
    // okumuyordu; Play'e gönderilen APK gerçek bir yayın imzası taşımıyordu.
    expect(gradle).not.toMatch(/signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/);
  });

  it("release buildType, sırlar tanımlıysa release signing config'e bağlanıyor", () => {
    // Sır yokken `signingConfigs.getByName("release")` HİÇ OLUŞTURULMAZ;
    // koşulsuz `getByName` çağrısı derlemeyi patlatırdı. `findByName` +
    // guard birlikte "sır varsa imzala, yoksa net hata ver" davranışını verir.
    expect(releaseBuildType).toContain('signingConfigs.findByName("release")');
    expect(releaseBuildType).toMatch(/signingConfig\s*=\s*it/);
  });

  it("signing config dört imza alanının hepsini dolduruyor", () => {
    // Eksik alan (ör. `keyPassword`) APK'yı imzasız ya da hatalı imzalı çıkarır.
    for (const field of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
      expect(releaseSigningConfig, `${field} atanmıyor`).toMatch(new RegExp(`\\b${field}\\s*=`));
    }
  });

  it("storeFile, CI'ın verdiği yol değişkeninden okunuyor", () => {
    expect(gradle).toContain("ANDROID_KEY_BASE64_PATH");
  });

  it("alias ve parola, release.yml'in geçirdiği secret adlarıyla aynı", () => {
    // İsim ayrışırsa guard hata verir ama sebebi belirsizleşir; adları
    // burada eşitlemek, sırrın CI'da "görünmez" olmasını engeller.
    expect(gradle).toContain("ANDROID_KEY_ALIAS");
    expect(gradle).toContain("ANDROID_KEY_PASSWORD");
    for (const secret of ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
      expect(workflow, `${secret} release.yml'de yok`).toContain(secret);
    }
    // Keystore yolunu CI'a taşıyan değişken de gradle'ın okuduğu addır.
    expect(workflow).toContain("ANDROID_KEY_BASE64_PATH");
  });
});

describe("İmza sırları yoksa derleme sessizce debug imzasına düşmüyor", () => {
  it("sır yokluğunda GradleException fırlatılıyor", () => {
    expect(gradle).toContain("GradleException");
    expect(gradle).toMatch(/if \(releasePackagingRequested && !releaseSigningAvailable\)/);
  });

  it("hata mesajı hangi sırların eksik olduğunu söylüyor", () => {
    // Kullanıcı "release imzası üretilemedi" görüp hangi secret'ı
    // tanımlaması gerektiğini bilmezse çözemez; mesaj üçünü de adıyla söylüyor.
    const msg = gradle.match(/throw GradleException\(([\s\S]*?)\)\n/)?.[1] ?? "";
    for (const secret of ["ANDROID_KEY_BASE64_PATH", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
      expect(msg, `hata mesajında ${secret} geçmiyor`).toContain(secret);
    }
  });

  it("kontrol yalnızca release paketleme görevlerinde tetikleniyor", () => {
    // `whenReady` + release'a özgü görev adı filtresi: `assembleDebug` ve
    // `signingReport` sır olmadan da çalışmaya devam edebilmeli.
    expect(gradle).toContain("gradle.taskGraph.whenReady");
    expect(gradle).toMatch(/\w+\.name\.endsWith\("Release"\)/);
  });
});

describe("Keystore dosyaları sürüm kontrolüne sızmıyor", () => {
  it("keystore.properties, *.jks ve *.keystore ignore ediliyor", () => {
    const gitignore = readFileSync(resolve(androidRoot, ".gitignore"), "utf8");
    for (const pattern of ["keystore.properties", "*.jks", "*.keystore"]) {
      expect(gitignore.split(/\r?\n/), `${pattern} ignore edilmemiş`).toContain(pattern);
    }
  });
});

describe("release.yml AAB üretiyor", () => {
  it("AAB ayrı bir job olarak var", () => {
    // Play Console APK kabul etmez; yalnız `--apk` üreten bir iş AAB'yi
    // hiçbir koşuda üretmiyordu.
    expect(workflow).toContain("build-android-aab:");
    expect(workflow).toContain("npx tauri android build --aab");
  });

  it("AAB işi, APK işiyle aynı imza koşulunu kullanıyor", () => {
    // Koşullar ayrışırsa "AAB var ama imzasız" gibi yarım bir yayın durumu
    // oluşur: biri koşar, diğeri sessizce atlanır.
    const conditions = [...workflow.matchAll(/^\s+if: (\$\{\{.*\}\})$/gm)].map((m) => m[1]);
    const androidConditions = conditions.filter((c) => c.includes("ANDROID_KEYSTORE_BASE64"));
    expect(androidConditions.length, "Android işları iki tane olmalı").toBe(2);
    expect(new Set(androidConditions).size, "koşullar farklı").toBe(1);
  });

  it("AAB çıktısı gerçek üretim yolundan yükleniyor", () => {
    // cargo-mobile2 `aab_path`: `outputs/bundle/<flavor><Variant>/app-….aab`.
    // `bundle/release/` diye bir dizin YOK; yanlış glob upload'ı sessizce atlar.
    expect(workflow).toContain("app/build/outputs/bundle/**/*.aab");
    expect(workflow).not.toContain("outputs/bundle/release/*.aab");
  });
});
