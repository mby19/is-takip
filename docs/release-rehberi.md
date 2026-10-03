# Release Rehberi (is-takip)

Bu rehber, projeyi GitHub'da **public** olarak paylaştıktan sonra kullanıcılara
dağıtılabilir hale getirmek için gereken adımları anlatır. Sıra önemlidir:
sürüm → imzalama anahtarı → GitHub secret'ları → push tag → yayın.

## 0. Nerede duruyoruz (kısa özet)

| Konu                  | Durum                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sürüm senkronizasyonu | `package.json`, `tauri.conf.json`, `Cargo.toml` eşit; `src/__tests__/tauriVersions.test.ts` kontrol ediyor |
| Updater               | **Kapalı** — config kaldırıldı, entegrasyon yok; aşağıdaki bölüm ileri tarihli not                         |
| macOS notarization    | CI'a secret'lar bağlandı, **secret'lar henüz tanımlı değil**                                               |
| Windows kod imzalama  | CI'a secret bağlandı, **secret henüz tanımlı değil**                                                       |
| Android               | `ANDROID_KEYSTORE_BASE64` varsa otomatik koşar                                                             |

---

## 1. Sürümü yükseltme

Üç dosyada **aynı** sürüm olmalı:

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`

Otomatik senkron (build script) yerine **test** var:
`npm test` içindeki "Uygulama sürümü senkron" bloğu üçü eşit değilse kırmızıya
döner. Sürümü `v` öneki olmadan yaz (`0.2.0`), çünkü git tag'i `v0.2.0` olacak.

```bash
npm version 0.2.0 --no-git-tag-version   # package.json + package-lock.json
# tauri.conf.json ve Cargo.toml'u elle 0.2.0 yap
npm test                                  # senkron testi yeşil mi
```

## 2. Otomatik güncelleme (updater) — İLERİ TARİHLİ, şimdilik kapalı

> **Neden kapalı:** Updater'ın çalışması için beş parça gerekiyor — npm paketi,
> Rust bağımlılığı, `lib.rs` kaydı, capability yetkisi ve arayüzde `check()`
> çağrısı. Beşi de yok. Yarım bırakılmış haliyle (`"active": true`, imzalı
> artifact üretimi) release hattını **kırardı**: derleme imza anahtarı ister,
> ama kimse güncelleme bildiremez.
>
> Bu yüzden `tauri.conf.json`'dan `plugins.updater` bloğu ve
> `bundle.createUpdaterArtifacts` kaldırıldı. Bugün güncelleme **yok** —
> kullanıcı yeni sürümü [Releases sayfasından](https://github.com/mby19/is-takip/releases)
> elle indirir. İlk birkaç sürüm için bu normaldir.
>
> **Ne zaman açılır:** Birkaç sürüm yayınlayıp, kullanıcı geri bildirimiyle
> otomatik güncellemenin gerçekten gerekli olduğunu gördüğünde. Aşağıdaki
> adımlar o gün için hazır.

### Adım 1 — imzalama anahtarı

Updater, indirilen paketin **değiştirilmediğini** doğrulayan bir imza
(küçük anahtar çifti) ile çalışır. Anahtarı bir kez üretirsin, sonu her yerde
aynıdır.

```bash
cd src-tauri
npx tauri signer generate -w ~/.tauri/is-takip.key -p ""   # parola: boş bırakılabilir
```

Çıktı iki parça verir:

- `~/.tauri/is-takip.key` → **private key**. Sadece CI'da, secret olarak. Kaybolursa
  bundan sonraki tüm güncellemeleri başka anahtarla imzalamak zorunda kalırsın.
- `Public key: dW50cn...` (64 karakter) → `src-tauri/tauri.conf.json` içindeki
  `plugins.updater.pubkey` değerine yapıştırılır.

```bash
# private key'i tek satırlık yap (newlines CI'da bozulur)
cat ~/.tauri/is-takip.key | tr -d '\n'
```

### Adım 2 — updater arayüzü (React)

Bu adım yapılana kadar **güncelleme çalışmaz** — sadece config yeterli değil.
Tauri'nin güncelleme mantığı Rust tarafındadır; kullanıcı "güncelle" butonuna
basmalıdır. Bunun için paket kurulmalıdır (bu repo hazır geldiği için
`npm install` çalıştırılmamıştı):

```bash
npm i @tauri-apps/plugin-updater
cd src-tauri && cargo add tauri-plugin-updater
```

Rust tarafında (`src-tauri/src/lib.rs`):

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
```

`src-tauri/capabilities/default.json` izinlerine:

```json
"updater:default",
"process:allow-restart"
```

React tarafında (örn. `src/components/UpdateChecker.tsx`):

```tsx
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function kontrolEtGuncelleme() {
  const guncelleme = await check();
  if (!guncelleme) return null; // güncelleme yok
  await guncelleme.downloadAndInstall();
  await relaunch(); // kurulumdan sonra yeniden başlat
  return guncelleme.version;
}
```

Bunu bir "Ayarlar" ekranındaki bir butona bağla ve sürümden eski olan
kullanıcılara uygulama açılışında `dialog: true` zaten pencere gösterecek —
o pencere yalnızca **Rust eklentisinin** işini yapar; yukarıdaki React katmanı
eklenmeden güncelleme sessizce olur.

> `dialog: true` için `tauri-plugin-dialog` zaten projede kurulu, ek kurulum
> gerekmez.

## 4. GitHub secret'ları

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret                                       | Nereden gelir                                                |
| -------------------------------------------- | ------------------------------------------------------------ |
| ~~`TAURI_SIGNING_PRIVATE_KEY`~~              | **Gerekli değil** — updater kapalı (§2)                      |
| `APPLE_ID`                                   | Apple Developer hesabının e-postası                          |
| `APPLE_APP_SPECIFIC_PASSWORD`                | appleid.apple.com → Sign-In Security → üretilen kod          |
| `APPLE_TEAM_ID`                              | developer.apple.com → Membership → Team ID (10 karakter)     |
| `TAURI_SIGNING_WINDOWS_CERTIFICATE`          | `.pfx`/`.pem` dosyasının **içeriği** (base64 veya PEM metni) |
| `TAURI_SIGNING_WINDOWS_CERTIFICATE_PASSWORD` | Sertifika parolası                                           |
| `ANDROID_KEYSTORE_BASE64`                    | `base64 -i keystore.jks` çıktısı                             |
| `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`  | Keystore içindeki alias ve parolası                          |

İki secret'ın **adını değiştirme**: `release.yml` bu adları okuyor.

---

## 5. macOS imzalama ve notarization

macOS'ta **notarization zorunludur**. İmzasız (veya imzalı ama notarize
edilmemiş) bir uygulama, kullanıcı çift tıkladığında Gatekeeper'da
"Uygulama açılamıyor" hatası verir; sağ tık → Aç da yetmez.

### 5.1 Ücretsiz Apple Developer ID sertifikasını al

1. <https://developer.apple.com/account> hesabına gir (ücretsiz hesap da olur).
2. **Certificates, Identifiers & Profiles → Certificates → +** tıkla.
3. **Developer ID Application** seç → Continue → sertifika CSR'ı üret →
   **Keychain** uygulaması açılır, kaydet → dosyayı `.cer` olarak kaydet.
4. Sertifika "Notarization için sertifika (2)" bölümüne takılır.

Anahtar çiftini `Keychain Access → Çift Tıkla → Gelişmiş → Özel Anahtar →
"Keychain'a erişim kontrol et" → "Tüm uygulamalar"a izin ver\*\* yap. CI'da
notarization çalışması için anahtar dışa aktarılabilir olmalı.

### 5.2 Apple ID uygulamasına özel parola üret

1. <https://appleid.apple.com> → **Sign-In and Security**.
2. **App-specific passwords → Generate** → adı `is-takip` yaz → üretilen
   16 karakterlik `xxxx-xxxx-xxxx-xxxx` kodu kopyala. Bu `APPLE_APP_SPECIFIC_PASSWORD`.

### 5.3 Lokal test (macOS'ta, kendi makinende)

```bash
export APPLE_ID="ornek@eposta.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
npm run tauri build          # dmg + .app.tar.gz (imzalı artifact) üretir
```

Bu değişkenler tanımlı değilse build **hata vermez**, sadece imzasız üretir —
sessiz geçilen tek kritik nokta budur. Doğrulama:

```bash
codesign -dv --verbose=4 "src-tauri/target/release/bundle/macos/is-takip.app" 2>&1 | grep Authority
xcrun stapler validate "src-tauri/target/release/bundle/dmg/is-takip_0.2.0_aarch64.dmg"
```

`Authority` satırında `Developer ID Application: <adını> (<Team ID>)` ve
stapler "The validate action worked!" demeli.

### 5.4 CI'da

`release.yml`'de `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
secret'ları zaten bağlı. GitHub'ın macOS runner'ı imzalama sertifikasını da
kendi imzalar, senin ek bir iş yapmana gerek yok.

### 5.5 minimumSystemVersion

`tauri.conf.json` → `bundle.macOS.minimumSystemVersion: "11.0"` (Big Sur).

Gerekçe: macOS 10.15 Catalina artık güvenlik güncellemesi almıyor; Tauri v2
üzerinde 10.15'i desteklemek ek bir kırılganlık. 11.0, hem Apple Silicon
kullanıcılarının tamamını (ilk Apple Silicon Mac 11.0 ile geldi) hem de
2020 sonrası alınan her Intel Mac'i kapsar ve SQLite/WebKit davranışı açısından
test edilmiş bir tabandır. iOS'taki `IPHONEOS_DEPLOYMENT_TARGET 15.0` ile de
tutarlı bir "modern cihazlar" politikası.

---

## 6. Windows kod imzalama

İmzasız `.exe` indiren kullanıcı **SmartScreen** uyarısı görür:
"Windows korumanız bilinmeyen uygulamayı engelledi" — kurulum denemeleri
çoğunlukla burada bırakılır. İmza, bu ekranı tamamen kaldırır.

### 6.1 Sertifika nereden

- **Kod imzalama sertifikası (Authenticode)** alınmalı; ücretsiz değil.
  Seçenekler: Sectigo, DigiCert, GlobalSign (yıllık ~70–400 $).
  **Self-signed sertifika** (Windows'ta ücretsiz üretilebilir) SmartScreen'i
  kaldırmaz — yalnız kendi makinende test için işe yarar.
- Faturalandırma için **Extended Validation (EV)** kod imzalama sertifikası
  gerekiyor; SmartScreen'de o listede çıkmak için bile sertifika şart.

### 6.2 PFX'i CI'ye koy

Sertifikayı `.pfx` olarak dışa aktar (parolayı unutma). CI'de Tauri **PEM
içeriğini** bekler, PFX'i de kabul eder; en güvenlisi PEM'e çevirmek:

```bash
openssl pkcs12 -in sertifika.pfx -out sertifika.pem -nodes
# içeriği olduğu gibi TAURI_SIGNING_WINDOWS_CERTIFICATE secret'ına yapıştır
```

Parolayı `TAURI_SIGNING_WINDOWS_CERTIFICATE_PASSWORD` olarak tanımla.

### 6.3 Doğrulama

```bash
signtool verify /pa "src-tauri/target/release/bundle/nsis/is-takip_0.2.0_x64-setup.exe"
```

## 7. Updater için release'in doğru şekilde hazırlanması

1. Üç dosyada sürümü aynı yükselt (1. adım), testleri yeşil bırak.
2. `pubkey`'yi gerçek değerle değiştir (2. adım).
3. Secret'ları tanımla (4. adım).
4. Commit + push, sonra:
   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```
5. `release.yml` koşar: 4 platformda build → tek birleşik `latest.json` →
   draft release'e artifact'ları yükler.
6. **Draft release'i GitHub'da yayınla** (Publish). `latest` etiketi
   `latest.json` uç noktasını `releases/latest/download/latest.json` üzerinden
   sunar; draft yayınlanmadan updater hiçbir şey görmez.

Not: macOS güncellemesi `.app.tar.gz` üzerinden çalışır; `.dmg` değil.
Windows'ta `.exe` (NSIS) güncellenir, `.msi` güncellenmez — güncelleme diyaloğu
NSIS paketini indirip kurar.

## 8. CI maliyeti (ci.yml)

`ci.yml` **PR'larda yalnız `lint` + `test` + `e2e` koşuyor.** 4 platformda tam
`tauri build` işi (`build-tauri`) `if: github.event_name == 'push'` koşuluyla
yalnız push olaylarında — yani main'e push'ta — çalışıyor
(`.github/workflows/ci.yml:127`). PR'larda native derleme yapılmadığı için
fork'lardan gelen kod imzalama sırlarına da hiç yaklaşmıyor. Maliyet notu
dosyanın içinde de aynı şekilde gerekçelendirilmiş.

Geriye dönük seçenekler (karar senin):

- PR'da tek bir platformda (`ubuntu-22.04`, en ucuzu) `cargo check`
  yeterli — gerçek bağlama (link) hataları zaten main build'inde yakalanır.
- `concurrency` zaten var, aynı branch'e ikinci push gelince önceki koşu
  iptal ediliyor; bu doğru korunmalı.

Mevcut durum makul: push'ta 4 platform derleniyor, PR'da native derleme
yok. Daha pahalı bir seçeneğe geçmek için `ci.yml`'de ayrı bir iş gerekir.
