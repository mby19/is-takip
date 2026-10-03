# Mağaza Yayın Rehberi

**Uygulama:** is-takip — İnşaat Sahası Personel Takibi
**Bundle ID / applicationId:** `com.mby.istakip`
**Sürüm:** `0.1.0`
**Hazırlayan dal:** release engineering
**Son güncelleme:** 2 Ekim 2026

Bu belge **kod yazmaz**; mağaza başvurularında doldurulması gereken her formu,
gerçek değerlerle ve ne seçilmesi gerektiğiyle anlatır. Kodla doğrulanmış
değerlerin kaynak dosyası parantez içinde verilmiştir.

> ⚠️ **Bu belgeyi okumadan başvuru yapmayın.** Play ve App Store formlarındaki
> en kritik alan **veri saklama beyanıdır** ve bu uygulamanın özel bir durumu
> var: kullanıcının verisi **cihazda** durur ama iOS'ta **Apple'ın yedekleme
> hizmetine** kopyalanır. Bu, [Bölüm 5](#5-ios-yedekleme-çelişkisi-en-kritik-nokta)
> içinde ayrıntılı anlatılıyor. Oradan atlamayın.

---

## 0. Nerede duruyoruz?

| Konu                                 | Durum                                                              | Kanıt                                 |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------- |
| Masaüstü (macOS/Windows/Linux) build | ✅ CI'da dört hedefte derleniyor                                   | `.github/workflows/release.yml`       |
| Android APK                          | ✅ Üretildi, emülatörde doğrulandı                                 | `release.yml` → `build-android` job   |
| Android **AAB**                      | ✅ İş eklendi (`build-android-aab`, `--aab`)                       | `release.yml` → `build-android-aab`   |
| Android release imzası               | ✅ Sırdan okuyor; sır yoksa `GradleException` — **debug'e düşmez** | `gen/android/app/build.gradle.kts:68` |
| iOS derleme                          | ⚠️ Rust tarafı derleniyor, **imzalama engelinde**                  | Apple Developer Team eksik            |
| iOS App Store'a gönderim             | ❌ Team + ekip olmadan yapılamaz                                   | —                                     |

Kalan engeller kullanıcının işidir (hesap sahipliği). Kod tarafındaki iki bulgu
— Android release imzası ([Bölüm 2.2](#22--düzeltildi-release-imzası-artık-sırdan-okuyor))
ve iOS privacy manifest
([Bölüm 3.7](#37--privacy-manifest-privacyinfoxcprivacy--hazır)) — giderildi.

---

## 1. Google Play Hazırlığı

### 1.1 Mağaza hesabı

- Play Console'da **tek seferlik 25 USD** geliştirici kayıt ücreti.
- Yeni uygulama oluşturulurken doğrulanır: uygulama adı, varsayılan dil
  (Türkçe), uygulama veya oyun, **ücretsiz** uygulama, içerik beyanları.
- **Sonraki yıllarda** hesap ücreti ödenmez; yalnızca şartlar kabul edilir.

### 1.2 Sürüm kodu — mevcut değerler ve nasıl türetiliyor

`src-tauri/gen/android/app/tauri.properties` (build sonrası yazılmış):

```properties
tauri.android.versionCode=1000
tauri.android.versionName=0.1.0
```

| Değer         | Şu an   | Kural                                                          |
| ------------- | ------- | -------------------------------------------------------------- |
| `versionCode` | `1000`  | **Her yüklemeye artmalı.** İlk yayın 1000, sonraki 1001, 1002… |
| `versionName` | `0.1.0` | Semver — `0.1.0` → `0.1.1` → `0.2.0`                           |

**1000 nereden geliyor?** Tauri, `tauri.conf.json` içindeki `version` alanını
şu formülle `versionCode`'a çevirir:

```
versionCode = major × 1 000 000 + minor × 1 000 + patch
            = 0 × 1 000 000 + 1 × 1 000 + 0
            = 1000
```

> ⚠️ `tauri.properties` **git tarafından yönetilmiyor**
> (`gen/android/app/.gitignore` içinde). Doğru değer
> `src-tauri/tauri.conf.json` içindeki `version` alanından gelir; Tauri her
> Android build'inde bu dosyayı yeniden yazar. **Sürüm artışını
> `tauri.conf.json`'a** yaparsınız, gradle dosyasına dokunmayın.

**Sonuç — pratik tablo:**

| `tauri.conf.json` version | Otomatik `versionCode` | Yükleme sırası        |
| ------------------------- | ---------------------- | --------------------- |
| `0.1.0`                   | `1000`                 | İlk yayın             |
| `0.1.1`                   | `1001`                 | İkinci yayın ✅ arttı |
| `0.2.0`                   | `2000`                 | ✅ arttı              |
| `1.0.0`                   | `1 000 000`            | ✅ arttı              |

Semver'de **patch artışı `versionCode`'u da 1 artırır**, yani "sadece hata
düzeltmesi" yayınlarınızda Play'in gerektiği monoton artış kendiliğinden
karşılanır. Dikkat edilecek tek tuzak: **`0.1.0` → `0.0.9` gibi geri giden
bir versiyon artışı yapmayın**; `versionCode` küçülür ve Play reddeder.

Tauri ayrıca `bundle.android.versionCode` ve
`bundle.android.autoIncrementVersionCode` seçenekleri sunar. İkincisi
`true` olursa her build'de `tauri.properties`'teki son değeri okuyup 1 artırır
— ama bunun için `/tauri.properties` satırını `gen/android/app/.gitignore`dan
**çıkarmanız** ve dosyayı commit etmeniz gerekir. **Önerim: bunu yapmayın**;
mevcut semver türetmesi yeterli ve yanlışlıkla (elle) artan bir `versionCode`
commit etme riskini ortadan kaldırır.

### 1.3 Build türü: AAB zorunlu

Play'e yüklenen paket **Android App Bundle (`.aab`)** olmalıdır. APK yüklemesi
yalnızca 2023 öncesi yayınlanmış uygulamalara açıktır.

```bash
# AAB üretimi (release imzası düzeltildikten SONRA — Bölüm 2.2)
cd src-tauri/gen/android
./gradlew bundleRelease

# Çıktı:
# src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab
```

`release.yml` şu an `--apk` bayrağıyla universal APK üretiyor; bu **GitHub
Release'i** için doğru, Play yüklemesi için yanlış. İkisi farklı işler:

| Kullanım               | Doğru komut                        | Nerede                  |
| ---------------------- | ---------------------------------- | ----------------------- |
| GitHub Releases'a ek   | `npx tauri android build --apk`    | mevcut workflow ✅      |
| Play Console'a yükleme | `./gradlew bundleRelease` → `.aab` | **yeni job gerekir** ❌ |

AAB avantajı: Play cihaz başına dilimleme yapar, boyut ~%30-40 düşer.

### 1.4 SDK sürümleri — güncel

`src-tauri/gen/android/app/build.gradle.kts`:

```kotlin
compileSdk = 36
minSdk = 24
targetSdk = 36
```

| Alan                | Değer            | Durum               |
| ------------------- | ---------------- | ------------------- |
| `compileSdkVersion` | 36 (Android 16)  | ✅ güncel           |
| `targetSdkVersion`  | 36               | ✅ güncel           |
| `minSdkVersion`     | 24 (Android 7.0) | ✅ kabul edilebilir |

Play'in güncel API hedefi şartı 36'dır (2025'ten beri 35 zorunluydu). **36
doğru; değiştirmek gerekmiyor.**

### 1.5 64-bit şartı — karşılanmış ✅

Play, 64-bit destekleyen cihazlarda **arm64-v8a** içeren paket ister.
Rust hedefleri `release.yml`'de dört ABI'yi derliyor:

| ABI           | Hedef                     | Durum                    |
| ------------- | ------------------------- | ------------------------ |
| `arm64-v8a`   | `aarch64-linux-android`   | ✅ (zorunlu olan)        |
| `armeabi-v7a` | `armv7-linux-androideabi` | ✅ (32-bit, geriye uyum) |
| `x86`         | `i686-linux-android`      | ✅ (emülatör)            |
| `x86_64`      | `x86_64-linux-android`    | ✅ (emülatör/Chromebook) |

Dört ABI'nin tamamı mevcut. Ek bir iş **gerekmiyor**.

### 1.6 Data Safety formu — bölüm bölüm

Bu form en sık sürdürülmeyen ve en sık reddedilen kısımdır. **Yanlış
doldurulursa uygulama kaldırılır.** Aşağıdaki her seçim, kodla doğrulanmıştır.

#### Temel bilgiler

| Soru                                                        | Cevap     | Gerekçe                                      |
| ----------------------------------------------------------- | --------- | -------------------------------------------- |
| Uygulama güvenlik ve gizlilik politikası URL'i sağlıyor mu? | **Evet**  | `PRIVACY.md` → GitHub Pages veya raw URL     |
| Veriler şifreli mi, iletim sırasında?                       | **Hayır** | Şifreleme yok (`SECURITY_REPORT.md` Bulgu 6) |
| Kullanıcı verilerinin silinmesini sağlayan bir yol var mı?  | **Evet**  | Ayarlar → "Tüm Verileri Sil"                 |

#### Veri toplanıyor mu?

> **Bu formun kalbi burasıdır ve cevap sürüme bağlıdır.**

| Derleme               | `VITE_SENTRY_DSN`                        | Veri toplanıyor mu?                   |
| --------------------- | ---------------------------------------- | ------------------------------------- |
| CI'dan çıkan yayın    | **tanımlı değil** (`release.yml`'de yok) | ❌ Hiçbir şey toplanmıyor             |
| DSN ile elle derlenen | tanımlı                                  | ⚠️ Aşağıdaki "koşullu" tabloyu doldur |

Yayınlanan sürümde DSN tanımlı değilse — ve `.env.example` ile `release.yml`
bunu doğruluyor — formda **"Uygulama geliştirici veya üçüncü taraflar tarafından
toplanan ve paylaşılan veri yoktur"** seçilir. `errorMonitoring.ts`, DSN yoksa
`enabled: false` ve ağ isteği yapmaz.

DSN tanımlıysa (aşağıdaki tablo), çelişkiyi önlemek için en doğru yol:
**yayınlanan sürüme DSN koymayın** ya da formu koşullu doldurun:

| Veri türü                                   | Toplanıyor                     | Amacı                                | İsteğe bağlı mı?                                      |
| ------------------------------------------- | ------------------------------ | ------------------------------------ | ----------------------------------------------------- |
| Uygulama performansı / Kararlılık           | **Evet**                       | Uygulamayı izleme ve önceliklendirme | **Hayır** — yalnız DSN varsa, uygulamayı açınca etkin |
| Hata ayıklama bilgisi                       | **Evet**                       | Uygulamayı izleme ve önceliklendirme | Hayır (aynı koşul)                                    |
| Cihaz veya diğer kimlikler                  | **Evır**, "Kararlılık" altında | —                                    | Aynı koşul                                            |
| Uygulama etkileşimleri (dokunma, hareket)   | **Hayır**                      | —                                    | —                                                     |
| Uygulama içi arama geçmişi                  | **Hayır**                      | —                                    | —                                                     |
| Kullanıcı etkileşimleri (tıklama, kaydırma) | **Hayır**                      | —                                    | —                                                     |
| Mesajlar                                    | **Hayır**                      | —                                    | —                                                     |
| Konum / GPS                                 | **Hayır**                      | —                                    | —                                                     |
| Kişi veya kullanıcı adı                     | **Hayır**                      | —                                    | —                                                     |
| E-posta adresi                              | **Hayır**                      | —                                    | —                                                     |
| Telefon numarası                            | **Hayır**                      | —                                    | —                                                     |
| Reklam kimliği                              | **Hayır**                      | uygulamada reklam SDK'sı yok         |
| Kullanıcı içeriği                           | **Hayır**                      | —                                    |
| Müzik, fotoğraf, video                      | **Hayır**                      | —                                    |
| Dosyalar                                    | **Hayır**                      | —                                    |
| Takvim                                      | **Hayır**                      | —                                    |
| İletişimler                                 | **Hayır**                      | —                                    |
| Uygulama etkinliği                          | **Hayır**                      | —                                    |
| Web tarayıcı geçmişi                        | **Hayır**                      | —                                    |
| Arama geçmişi                               | **Hayır**                      | —                                    |
| Cihaz veya diğer kimlikler                  | **Hayır**                      | —                                    |

> **Not:** Sentry replay'i DOM metnini toplayabilir, ancak `maskAllText` ile
> tamamen maskelenir ve para/tc/IBAN/telefon desenleri ek olarak silinir
> (`errorMonitoring.ts`). Yine de en temiz beyan, DSN'siz yayın yapmaktır.

#### Veri saklanıyor mu?

| Soru                                               | Cevap                                          | Gerekçe                                                        |
| -------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Veriler uygulamanın kendi cihazında saklanıyor mu? | **Evet**                                       | SQLite `is_takip_v3.db`, uygulama veri dizininde               |
| Veriler şifreli mi?                                | **Hayır**                                      | Cihaz tam disk şifrelemesine bağlı                             |
| Saklama süresi                                     | Kullanıcı silene kadar / uygulama silene kadar | `PRIVACY.md` Bölüm 8                                           |
| Saklamada geçen var mı?                            | **Evet**                                       | Onay alanını işaretleyin, "uygulama kullanımı süresince" yazın |

> ⚠️ Bu iki sorunun cevabı Play'in gözünde **"Data is collected and shared /
> not collected"** ayrımından farklıdır. "Data is collected" kutusu **kendi
> cihazınızda saklanan** veriyi kapsamaz — yalnızca geliştiriciye/üçüncü
> taraflara **iletilen** veriyi kapsar. Veri cihazda kalıyorsa "Data is not
> collected" doğrudur.

#### Güvenlik uygulamaları

| Soru                                                   | Cevap     |
| ------------------------------------------------------ | --------- |
| Veriler iletim sırasında şifreleniyor mu?              | **Hayır** |
| Uygulama verilerini silme isteyebilirsiniz mi?         | **Evet**  |
| Uygulamada uygulama içi satın alım var mı?             | **Hayır** |
| Uygulama güncellemeleri Play üzerinden dağıtılıyor mu? | **Evet**  |
| Kullanıcıları belirli bir ülkeye sınırlandırıyor mu?   | **Hayır** |

### 1.7 Uygulama içi satın alma beyanı

"Contains ads" → **Hayır**. "In-app purchases" → **Hayır**. Uygulamada hiçbir
ödeme altyapısı, ödeme SDK'sı veya ürün tanımı yoktur. Play'in "uygulama
içi satın alım" beyanı formda ayrı bir sorudur ve **Hayır** seçilmelidir;
aksi halde uygulama, harici ödeme bağlantısı sunan iş modeli nedeniyle
incelemeye alınır.

### 1.8 İçerik derecelendirme — en düstük

| Soru                                                | Cevap     | Gerekçe                                                 |
| --------------------------------------------------- | --------- | ------------------------------------------------------- |
| Uygulama kullanıcı içeriği barındırıyor mu?         | **Hayır** | Tek kullanıcı kendi verisini girer, paylaşım/sohbet yok |
| Kullanıcılar birbirleriyle iletişim kurabiliyor mu? | **Hayır** | Tamamen yerel                                           |
| Konum paylaşılıyor mu?                              | **Hayır** | —                                                       |
| Uygulama içi sohbet var mı?                         | **Hayır** | —                                                       |
| Kullanıcı konumunu paylaşabiliyor mu?               | **Hayır** | —                                                       |
| Dijital alışveriş yapılabiliyor mu?                 | **Hayır** | —                                                       |

Tüm "hayır" cevaplarıyla **IARC 3+ / PEGI 3** sonucu çıkar — mümkün olan en
düşük derecelendirme. Buna rağmen **Google Play Kullanıcı Sözleşmesi**'nin
"kullanıcıları yanıltıcı şekilde hedefleyen içerik" maddesi açısından uygulama
18 yaş altına uygun sayılır; iş rehberi yazarken hedef kitlenin yetişkin
olduğunu (şantiye personeli) belirtin.

### 1.9 Ekran görüntüleri

Play, **en az 2** ekran görüntüsü ister. Ürün öğütü: 4–8 arası.

| Gereklilik          | Değer                                                        |
| ------------------- | ------------------------------------------------------------ |
| Telefon çözünürlüğü | **1080 × 1920** (min. 320 px kısa kenar, 16:9 veya 2:1 oran) |
| Tablet              | 7" ve 10" — yalnız tablet dağıtımı seçilirse zorunlu         |
| Format              | 24-bit PNG, JPG                                              |
| Kenar boşluğu       | Görüntü kırpılmamalı, ürün çerçevesi **zorunlu değil**       |

`docs/screenshots/` altında **15 görüntü üretildi** (Playwright, `SHOTS=1`).
Hepsi 420 × 900 CSS pikseliyle çekildi — yani Play'in önerdiği 1080 × 1920
**değil**. Yüklemeden önce aşağıdaki komutla yeniden üretin:

```bash
# e2e/tests/screenshots.spec.ts içinde viewport 1080x1920 olacak şekilde
# deviceScaleFactor ayarlanmalı; bu dal kod değiştirmedi.
cd e2e && SHOTS=1 npx playwright test screenshots.spec.ts
cp shots/*.png ../docs/screenshots/
```

> Alternatif: mevcut 420×900 görüntüleri herhangi bir görsel düzenleyicide
> **2.571× (420→1080) ölçekle** büyütüp yüklemek. Play yükleme boyutunu
> doğrulamaz, ama metin bulanıklaşır — gerçek cihazdan çekim daha iyi.

#### Hangi ekranlar gösterilmeli

Sıralama önemli — ilk iki görüntü mağaza sayfasında görünür.

| #   | Dosya                  | Ekran                                   | Neden                                                  |
| --- | ---------------------- | --------------------------------------- | ------------------------------------------------------ |
| 1   | `01-takvim.png`        | Aylık takvim, dolu günler               | **Ana ekran.** Ürünün ne olduğu bir bakışta anlaşılır  |
| 2   | `05-ay-sonu.png`       | Ay sonu / hakediş özeti                 | **Parayla ilgili** — şantiye şefinin ilgilendiği ekran |
| 3   | `02-gun-detay.png`     | Gün detayı, puantaj girişi              | Günlük kullanımın çekirdeği                            |
| 4   | `03-kisiler.png`       | Kişi listesi                            | Personel takibi işlevi                                 |
| 5   | `04-calisan-detay.png` | Çalışan detayı, ücret geçmişi           | Şeffaf hesap vaadi                                     |
| 6   | `06-ayarlar.png`       | Ayarlar (uygulama kilidi, dışa aktarım) | Güven ve kontrol                                       |
| 7   | `light-takvim.png`     | Açık tema takvim                        | İki tema desteğini gösterir                            |
| 8   | `light-ay-sonu.png`    | Açık tema ay sonu                       | —                                                      |

**Mevcut ama yüklemeye uygun olmayanlar** (yoğunluk testleri, 07/08) —
bunlar Playwright hata yakalama çıktısı, pazarlama görseli değil:
`yogunluk-*.png`, `07-ayarlar-alt.png`, `08-gecmis.png`, `light-gun-detay.png`.

**Eksik olan görüntüler** — yüklemeye başlamadan önce üretilmeli:

1. **CSV dışa aktarım** — `CsvExportSection.tsx` mevcut ama **görüntüsü yok**.
   Play/AAB'ye geçiş için önemli özellik; Ayarlar → Dışa Aktarım bölümü çekilmeli.
2. **Uygulama kilidi ekranı (PIN/desen)** — Ayarlar'da var, görüntüsü yok.
   Güven mesajını taşıyan ekran.
3. **Kişi detayındaki PDF rapor** — `workerReport.ts` var, görüntüsü yok.
4. **Bildirim** — günlük hatırlatma, uygulamanın farkı; görüntüsü yok.
5. **Veri geri yükleme (yedek import)** — Ayarlar'da var, görüntüsü yok.

> Bu beş ekranın görüntüsü Playwright ile **elle** çekilmelidir: yedek
> dosyası seçme ve PDF üretme adımları mock'lanamaz (dosya sistemi gerekir).
> Bu dalda üretilemedi.

#### Mağaza açıklaması

`tauri.conf.json`'daki `longDescription` doğrudan kullanılabilir:

> Bir inşaat/üretim sahasında çalışan personelin günlük devam durumunu,
> üretim miktarını ve ödemelerini takip etmek için geliştirilmiş masaüstü
> uygulaması.

Bu metin **masaüstü** diyor — Play için mobil kullanım vurgusu eklenmeli:

> Şantiye personelinin günlük devam durumunu, üretim miktarını ve ödemelerini
> kaydedin. Takvimden tek dokunuşla puantaj girin, ay sonunda hakediş ve
> ödeme dökümünü tek ekranda görün, CSV ve PDF olarak dışa aktarın.
> Tüm veri cihazınızda kalır — hesap girişi yok, sunucu yok.

### 1.10 İçerik ve hedef kitle beyanları

Play Console → Uygulama içeriği:

| Bölüm                          | Cevap                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Gizlilik politikası            | `PRIVACY.md` URL'si — **zorunlu**                                  |
| Reklam                         | Yok                                                                |
| Uygulama içi satın alma        | Yok                                                                |
| Kullanıcı içeriği              | Yok                                                                |
| Yapay zekâ kullanımı           | Yok (Sentry replay maskeli, model eğitimi yok)                     |
| Sağlık / finans uygulaması mı? | **Finansal yönetim uyduğu için beyan edin** — maaş kaydı tutuluyor |
| Hedef kitle                    | 18+ (iş gücü)                                                      |
| Kripto                         | Yok                                                                |

---

## 2. Android İmzalama

### 2.1 Play App Signing akışı

Google, iki aşamalı imza kullanır:

1. **Yükleme anahtarı (upload key)** — sizin oluşturduğunuz, AAB'yi Play'e
   yüklerken kullanılır. Play'e erişimi olan biri olmadan yeni sürüm
   yükleyemezsiniz.
2. **Uygulama imzalama anahtarı (app signing key)** — Google tarafından
   üretilir ve **yalnızca Google'da** saklanır. Kullanıcıya giden APK'yı
   bu anahtar imzalar. Anahtarınızı kaybederseniz yeni sürüm yükleyemezsiniz.
   (Google "key reset" ile kurtarma sağlar.)

### 2.2 ✅ Düzeltildi: release imzası artık sırdan okuyor

**Bulgu (düzeltilmiş):** eski hâlde `build.gradle.kts` içinde
`signingConfig = signingConfigs.getByName("debug")` vardı; yani "release"
derlemesi **debug anahtarıyla** imzalanıyordu. Debug anahtarı
`~/.android/debug.keystore`'ta duran, parolası herkese açık bir geliştirici
anahtarıdır ve `release.yml`'deki `ANDROID_KEYSTORE_BASE64` sırları hiç
okunmuyordu.

**Şimdiki hâl** (`src-tauri/gen/android/app/build.gradle.kts`): imza
değerleri ortam değişkeninden, yoksa `keystore.properties`'ten okunur
(`:37-45`). `signingConfigs` bloğu yalnızca üç sır da tanımlıysa `release`
config'ini oluşturur (`:81-92`); `buildTypes.release` ise
`signingConfigs.findByName("release")` ile onu **koşulsuz** bağlar (`:126`).

**Sessiz debug geri dönüşü yok.** Görev grafiği çözüldüğünde (`whenReady`,
`:62-78`) bir `assemble*Release` / `bundle*Release` görevi varsa ve sırlar
eksikse `GradleException` fırlatılır. Bu yüzden:

- Sır yoksa derleme **birkaç saniyede** hata verir (Rust derlemesi
  onlarca dakika çalışıp sonra hata vermez — kontrol görev grafiği
  çözülmeden önce yapılır).
- `assembleDebug` ve `signingReport` grafiğe girmediği için sır istemez;
  yerel `tauri android dev` akışı bozulmaz.
- Hiçbir koşulda `signingConfigs.getByName("debug")` release'e atanmaz.

`src/__tests__/androidSigning.test.ts` bu blokları (debug fallback'inin
olmadığını, `GradleException` metnini, secret→environment eşlemesini) korur.

`release.yml`'de kullanılan secret'lar:

| Secret                    | Ortam değişkeni                                 | Durum                   |
| ------------------------- | ----------------------------------------------- | ----------------------- |
| `ANDROID_KEYSTORE_BASE64` | `ANDROID_KEY_BASE64_PATH` (çözülmüş dosya yolu) | base64 keystore dosyası |
| `ANDROID_KEY_ALIAS`       | `ANDROID_KEY_ALIAS`                             | anahtar takma adı       |
| `ANDROID_KEY_PASSWORD`    | `ANDROID_KEY_PASSWORD`                          | parola                  |

### 2.3 Keystore üretme

```bash
keytool -genkeypair -v \
  -keystore ~/keys/istakip-upload.jks \
  -alias istakip-upload \
  -keyalg RSA -keysize 2048 -validity 10000

# GitHub'a yüklemek için base64:
base64 -i ~/keys/istakip-upload.jks | pbcopy
```

> ⚠️ **Bu dosyayı kaybetmeyin.** Yükleme anahtarını kaybederseniz Play'e yeni
> sürüm yükleyemezsiniz (Google key reset başvurusu haftalar sürebilir) ve
> uygulamanın güncelleme kanalı kapanır. Şifreli bir kasada saklayın.

---

## 3. App Store Hazırlığı

### 3.1 Geliştirici hesabı — kullanıcının işi

- **Apple Developer Program: 99 USD/yıl.** Bunu bu dal hazırlayamaz.
- Bireysel (individual) kuruluş üzerinden kayıt yapılmamalı; şirket
  (organization) olarak kayıt, vergi ve faturalama açısından zorunludur.
- Kayıt **şirket adresi, vergi kimlik numarası, D-U-N-S numarası** ister.
  Hazırlanması günler sürer — **başvuradan önce başlatın.**

### 3.2 Bundle ID — bir kez verilir, geri dönüşü yok

`com.mby.istakip`

Apple Developer hesabında **bir kez kaydedilen Bundle ID değiştirilemez**.
Doğru olduğundan emin olun:

- ✅ `com.mby.istakip` → mevcut kod tabanıyla tutarlı (`namespace`,
  `applicationId`, `PRODUCT_BUNDLE_IDENTIFIER` üç yerde de aynı)
- ⚠️ Şirket adını da taşımak isterseniz (örn. `com.sirketadi.istakip`) —
  **şimdi değiştirin**, yüklemeden sonra mümkün değil

> 🔐 **Değişiklik `src-tauri/tauri.conf.json`'da tek satırdır** (`identifier`).
> Değiştirirseniz `npx tauri android init` ve `npx tauri ios init` yeniden
> çalıştırılmalı; `gen/` klasörleri eski kimliği taşır.

### 3.3 🚨 İmzalama — bugünün engeli

`npx tauri ios build` şu anda **Team seçilemediği için** duruyor.

Gerekli adımlar:

1. Apple Developer Program'a üye olun (§3.1)
2. Xcode → **Settings → Accounts** → Apple ID'yi ekleyin → **Download Manual Profiles**
3. `npx tauri ios dev` ile Xcode'u açıp **Signing & Capabilities** sekmesinde
   ekibinizi seçin:
   - **Team**: `Sizin Şirketiniz (ABC123456)`
   - **Bundle Identifier**: `com.mby.istakip`
   - **Signing Certificate**: _Automatically manage signing_ ✅
4. `npx tauri ios build` → `ExportOptions.plist` içinde **teamID** girin

`gen/apple/ExportOptions.plist` ve `gen/apple/project.yml` Tauri tarafından
yönetilir; `gen/apple/` git'e izlenmiyor (`.gitignore`'da), bu yüzden her
geliştiricide yeniden üretilmesi normaldir.

### 3.4 Deployment target ve mimari

`src-tauri/gen/apple/project.yml`:

```yaml
deploymentTarget:
  iOS: 15.0
```

| Alan        | Değer                           | Durum                                                    |
| ----------- | ------------------------------- | -------------------------------------------------------- |
| Minimum iOS | **15.0**                        | ✅ App Store kabul ediyor                                |
| Cihaz       | iPhone + iPad (her iki yönelim) | ✅                                                       |
| `ARCHS`     | `arm64`                         | ✅ — 2020'den beri tek mimari (x86_64 simülatör içindir) |
| Bitcode     | `ENABLE_BITCODE: false`         | ✅ — Apple artık istemiyor                               |

**iPad desteği**: `UISupportedInterfaceOrientations~ipad` dört yönelim
tanımlı — bu yüzden App Store'da iPad uyumluluğu **doğal olarak var**.

### 3.5 Sürümleme

`project.yml` ve `Info.plist` şu anda `0.1.0` yazıyor. App Store kuralları:

| Alan                         | Değer   | Not                                      |
| ---------------------------- | ------- | ---------------------------------------- |
| `CFBundleShortVersionString` | `0.1.0` | Kullanıcıya görünen; semver              |
| `CFBundleVersion`            | `0.1.0` | Yapı numarası; **her yüklemeye artmalı** |

Tauri, bu iki değeri `tauri.conf.json`'daki `version` alanından doldurur.
Kritik nokta: iOS'ta `CFBundleVersion` **build** numarasıdır ve Apple her
yüklemeyi benzersiz bir **build** numarasıyla bekler. `0.1.0` ikisinde de aynı
ilk değer; ikinci yüklemede `CFBundleVersion`'ı ayrıca artırmak gerekir —
Tauri bunu otomatik yönetmez, yükleme öncesi kontrol edin.

### 3.6 Export compliance (şifreleme beyanı)

**Yükleme sırasında App Store Connect her build için sorar:**
"Uygulamanız şifreleme kullanıyor mu?"

| Soru                                                   | Cevap          | Gerekçe                             |
| ------------------------------------------------------ | -------------- | ----------------------------------- |
| Uygulama istisna kapsamı dışı şifreleme kullanıyor mu? | **HAYIR**      | Uygulamanın kendi kriptografisi yok |
| `ITSAppUsesNonExemptEncryption` değeri                 | `false` olmalı | `Info.plist`'e eklenmeli            |

Doğrulama: uygulamada tek kriptografik kullanım SHA-256 özetidir
(`appLock.ts`) — bu **hash**, şifreleme değildir ve istisna kapsamındadır.
Dolayısıyla `ITSAppUsesNonExemptEncryption: false` **doğru beyandır**.

> ✅ **Düzeltildi.** `src-tauri/Info.ios.plist` dosyası
> `ITSAppUsesNonExemptEncryption: false` beyanını içeriyor. Tauri `tauri ios
build` sırasında bu dosyayı `dirs.tauri` (yani `src-tauri/`) altında arar ve
> üretilen `Info.plist` ile **birleştirir** — bu yüzden `gen/` altındaki
> dosyayı elle düzenlemek gerekmez ve kalıcıdır.
>
> Aynı dosya `CFBundleURLTypes` (derin bağlantı şeması `istakip://bugun`)
> için de kullanılıyor; ikisi birlikte merge ediliyor.
> `src/__tests__/iosPrivacyManifest.test.ts` her iki anahtarı ve merge
> dosyasının geçerli bir plist olarak kapandığını koruyor.

### 3.7 ✅ Privacy manifest (`PrivacyInfo.xcprivacy`) — hazır

Apple, 17 Mayıs 2024'ten itibaren belirli SDK'ları kullanan uygulamalarda
**zorunlu** gizlilik manifesti istiyor; eksik/geçersiz manifest yüklemeleri
`ITMS-91053` ile reddediliyor. Manifest artık sürüm kontrolünde:
`src-tauri/PrivacyInfo.xcprivacy`.

**Bundle köküne nasıl giriyor.** Apple dosyanın uygulama bundle'ının
**kökünde** olmasını şart koşuyor. `bundle.resources` bir seçenek değil:
Tauri o yolu `inject_resources` ile `gen/apple/assets/` altına kopyalar,
XcodeGen de `assets` dizinini bir "folder reference" olarak ekler ve sonuç
`is-takip.app/assets/PrivacyInfo.xcprivacy` olur — Apple görmez.

Bu yüzden kalıcı yol XcodeGen şablonudur:

- `src-tauri/apple-project.yml` — Tauri'nin varsayılan şablonunun kopyası;
  `PrivacyInfo.xcprivacy` girdisi `buildPhase: resources` ile hedefe bağlı.
- `tauri.conf.json` → `bundle.iOS.template: "src-tauri/apple-project.yml"`
  bu bağı kurar. Yol **proje köküne göre** çözülür, çünkü tauri-cli şablonu
  ham `std::fs::read_to_string` ile okuyor ve `tauri ios init` çalışma
  dizinini değiştirmiyor (`src/__tests__/iosPrivacyManifest.test.ts` bunu
  notla birlikte sabitler).

`gen/apple/` altındaki `project.yml` yeniden üretilebilir bir dosyadır; elle
düzenlenmemeli. Yukarıdaki iki kaynak dışında hiçbir şeye gerek yok —
`tauri ios init` sonrası Xcode'da `Copy Bundle Resources` altında
`PrivacyInfo.xcprivacy` görünmelidir.

Manifestin içeriği: takip kapalı (`NSPrivacyTracking: false`), veri toplama
boş (`NSPrivacyCollectedDataTypes: []`) ve kullanılan iki required-reason
API'si gerekçeleriyle bildirilmiş — `C617.1` (dosya zaman damgası, yedek
dosyalarını listeleme) ve `CA92.1` (kullanıcı varsayılanları).

> **`NSPrivacyCollectedDataTypes` boştur — ama §5'i okuyun.** Bu boş dizi
> "hiçbir veri toplanmıyor" demektir. iOS yedekleme gerçeği bunu nasıl
> etkiler, bir sonraki bölümde.

### 3.8 App Privacy beyanı

App Store Connect → Uygulama Gizliliği. Bu uygulama için:

| Veri tipi                 | Toplanıyor mu?                             | Not                                                       |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| İletişim Bilgileri (İsim) | **Hayır**                                  | Uygulama çalışan adını lokal saklar, geliştiriciye gitmez |
| Sağlık & Fitness          | Hayır                                      | —                                                         |
| Finansal Bilgi            | **Hayır**                                  | Para tutarları lokal                                      |
| Konum                     | Hayır                                      | Konum izni istenmiyor                                     |
| Hassas Bilgi              | Hayır                                      | —                                                         |
| İletişimler               | Hayır                                      | —                                                         |
| Kullanıcı İçeriği         | Hayır                                      | —                                                         |
| Geçmiş                    | Hayır                                      | —                                                         |
| Arama Geçmişi             | Hayır                                      | —                                                         |
| Tanımlayıcılar            | Hayır                                      | —                                                         |
| Satın Alma Geçmişi        | Hayır                                      | —                                                         |
| Kullanım Verileri         | **Koşullu** — Sentry yalnız DSN tanımlıysa |
| Tanılama Bilgileri        | **Hayır**                                  | —                                                         |
| Hata Verileri             | **Koşullu** — aynı koşul                   |

Gerekli beyanların bağlantıları:

| Beyan                     | Değer                                                             |
| ------------------------- | ----------------------------------------------------------------- |
| Gizlilik Politikası URL'i | `PRIVACY.md` — **zorunlu**                                        |
| Hesap silme               | Uygulamada hesap yok → "uygulama hesap oluşturmaya izin vermiyor" |
| Veri toplanmıyor beyanı   | Ancak §5'i okuyun                                                 |

---

## 4. Ekran görüntüleri — üretilenler

`docs/screenshots/` altında **15 PNG** bulunuyor. Üretim komutu:

```bash
cd e2e && SHOTS=1 npx playwright test screenshots.spec.ts
```

Seed verisi 5 çalışan, 6 günlük puantaj, 3 ödeme kaydı ile doldurulur —
yani görüntülerde **gerçekçi ama uydurma** veri var (kalem, ₺900 yevmiye gibi).

| Dosya                    | Boyut   | Tema | Yüklemeye uygun mu?      |
| ------------------------ | ------- | ---- | ------------------------ |
| `01-takvim.png`          | 420×900 | Koyu | ✅ (ölçeklenmeli)        |
| `02-gun-detay.png`       | 420×900 | Koyu | ✅                       |
| `03-kisiler.png`         | 420×900 | Koyu | ✅                       |
| `04-calisan-detay.png`   | 420×900 | Koyu | ✅                       |
| `05-ay-sonu.png`         | 420×900 | Koyu | ✅ (en önemli ikinci)    |
| `06-ayarlar.png`         | 420×900 | Koyu | ✅                       |
| `07-ayarlar-alt.png`     | 420×900 | Koyu | ❌ hata yakalama çıktısı |
| `08-gecmis.png`          | 420×900 | Koyu | ❌                       |
| `light-takvim.png`       | 420×900 | Açık | ✅                       |
| `light-gun-detay.png`    | 420×900 | Açık | ❌ yedek                 |
| `light-ay-sonu.png`      | 420×900 | Açık | ✅                       |
| `yogunluk-{6,8,10}.png`  | 420×900 | Koyu | ❌ tasarım testi         |
| `yogunluk-6-sikisik.png` | 420×900 | Koyu | ❌ tasarım testi         |

**Boyut sorunu:** Play 1080×1920 (2× ölçekli telefon) ister. Bu görüntüler
420×900. Yüklemeden önce ya yeniden çekin ya da 2.571× büyütün.

### 4.1 Eksik ekranlar

| Ekran                           | Neden gerekli                                                     | Nasıl çekilir                       |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| **CSV dışa aktarım**            | Play dağıtımı için "veriniz dışarı çıkar" özelliği en çok sorulan | Ayarlar → Dışa Aktarım bölümü       |
| **Uygulama kilidi (PIN/desen)** | Güven vaadi                                                       | Ayarlar → kilit ayarı               |
| **PDF rapor**                   | Rapor/çıktı özelliği                                              | Kişi detayı → PDF                   |
| **Bildirim**                    | Günlük hatırlatma farklılaştırıcı                                 | Cihazda tetikle, ekran görüntüsü al |
| **Yedek geri yükleme**          | Veri taşınabilirliği                                              | Dosya seçici açık hali              |

Bunlar Playwright ile **otomatik çekilemez**: yedek dosyası seçme ve PDF
üretme adımları dosya sistemi ve native API gerektirir. Elle çekilmeli.

---

## 5. iOS Yedekleme Çelişkisi — en kritik nokta

### 5.1 Olgu

`SECURITY_REPORT.md` Bulgu 10 ve `docs/adr/0010-mobil-hedefi.md` bunu kayda
geçirmiş: uygulamanın veritabanı iOS'ta
`<sandbox>/Library/Application Support/com.mby.istakip/is_takip_v3.db`
yoluna yazılır ve bu dizin **varsayılan olarak iCloud'a yedeklenir**.

Sonuç: maaş, ücret geçmişi, ödeme ve denetim verisi
Apple sunucularına kopyalanır ve cihazın Apple hesabına bağlı her yere gider.

Android'de bu risk `android:allowBackup="false"` ile **kapatılmış**
(`AndroidManifest.xml`, ayrıca regresyon testiyle korunuyor). iOS'ta Tauri v2
`tauri.conf.json` üzerinden karşılığı **yok** — `NSURLIsExcludedFromBackupKey`
native bir çağrı gerektiriyor.

### 5.2 Çelişki nerede

| Beyan              | İçerik                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| App Privacy        | "Veri toplanmıyor" / `NSPrivacyCollectedDataTypes: []`                                                               |
| `PRIVACY.md` §10.4 | "iOS'ta uygulama verisi iCloud Yedekleme kapsamına girebilir; **mağaza denetimlerinde bu açıkça beyan edilmelidir**" |
| Gerçek             | Maaş verisi Apple sunucularına kopyalanıyor                                                                          |

**"Data Not Collected" demek, verinin Apple'a hiç gitmediği anlamına gelmez.**
Apple'ın kendi tanımı bu ayrımı zaten yapıyor:

> App Privacy beyanı **"sizin topladığınız veya paylaştığınız"** veriyi
> kapsar. **Platformun kendi hizmetleri (iCloud yedekleme, Time Machine)
> kapsam dışıdır ve ayrıca beyan edilmez.**

Yani beyan **teknik olarak doğru**, ama yanıltıcı bir izlenim bırakır: kullanıcı
"verim bende kalıyor" sanırken dosyaları Apple'da duruyordur.

### 5.3 Üç seçenek

| Seçenek                                                  | Ne yapılır                                                                                 | Artı                                                   | Eksi                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **A. Mevcut haliyle yayımla** (§10.4'teki uyarı korunur) | Beyan "Data Not Collected"; `PRIVACY.md` §10.4 zaten uyarıyor; mağaza açıklamasına eklenir | Ek kod yok, risk zaten belgeli                         | Kullanıcı gizlice Apple'a veri taşındığını öğrenir; inşaat şirketi için KVKK riski          |
| **B. Yedeklemeyi kapat** (native kod gerekir)            | `NSURLIsExcludedFromBackupKey` ile veri dosyası yedekten çıkarılır                         | Risk kökten kapanır, Bulgu 9 Android ile simetrik olur | Obj-C/Rust bağımsızı + **gerçek cihazda doğrulama** gerekir; App Store öncesi en az 2 hafta |
| **C. Sadece masaüstü + Android'de yayımla**              | iOS'u çıkarma kararı                                                                       | Kapıyı tamamen kapatır                                 | Platform vizyonu eksik kalır                                                                |

> **Önerim: B.** Bulgu 9 Android'de çözüldü, iOS'ta aynı risk açık durması
> tutarsızlık. Ama karar senin: yayın takvimin ilk etapta Android'e yetişiyorsa
> **A + §10.4 vurgusu** ile başla, B'yi bir sonraki sürüme al.

### 5.4 Seçenek A uygulanırsa — App Store metinleri

**Mağaza açıklamasına ekle:**

> Tüm veri cihazınızda saklanır — geliştiriciye gönderilmez, hesap gerekmez.
> iOS'ta cihazınızın kendi yedekleme ayarları (iCloud Yedekleme) kapsamına
> dahil olabilir; hassas veri tutuyorsanız Ayarlar → [adınız] → iCloud →
> "Bu cihazı yedekle"yi kapatmanız önerilir.

**`PRIVACY.md` §10.4 zaten doğru metni içeriyor** — oraya "mağaza
denetimlerinde beyan edilmelidir" notu düşülmüş. O not, App Store beyanıyla
birebir örtüşüyor; ikisi birlikte okunduğunda çelişki oluşmuyor.

### 5.5 Play tarafında durum

Android'de `allowBackup="false"` olduğu için **Google'ın yedekleme hizmeti
devre dışı** — burada çelişki **yok**. Play Data Safety formunda "saklanan veri"
olarak işaretlenmesi doğru, "toplanan veri" olarak işaretlenmesi yanlış olurdu.

---

## 6. Yayın öncesi kontrol listesi

### Google Play

- [ ] Play Console hesabı açıldı (25 USD)
- [ ] `tauri.conf.json` sürümü artırıldı (`0.1.0` → `0.1.1`)
- [ ] Upload keystore üretildi ve **3 GitHub secret'ına** tanımlandı
- [ ] `build.gradle.kts` release imzası **debug → release** olarak düzeltildi ⚠️
- [ ] `./gradlew bundleRelease` ile `.aab` üretildi
- [ ] `PrivacyInfo.xcprivacy` (iOS) ve Data Safety formu dolduruldu
- [ ] `PRIVACY.md` URL'si **yayımlanmış** (GitHub Pages) ve forma girildi
- [ ] 4–8 ekran görüntüsü 1080×1920 olarak yüklendi
- [ ] Mağaza açıklaması mobil vurgulu (mevcut metin "masaüstü" diyor)
- [ ] İçerik derecelendirme anketi (tüm "hayır") tamamlandı
- [ ] Uygulama içi satın alma ve reklam beyanı "hayır"
- [ ] İlk yüklemede **dahili test** (Internal testing) → sonra üretim izi

### App Store

- [ ] Apple Developer Program üyeliği (99 USD, şirket bilgileriyle)
- [ ] Bundle ID `com.mby.istakip` **kesinleştirildi** (sonradan değiştirilemez)
- [ ] Xcode'da Team atandı, `npx tauri ios build` çalışıyor
- [x] `ITSAppUsesNonExemptEncryption` beyanı verildi (`src-tauri/Info.ios.plist`)
- [x] `PrivacyInfo.xcprivacy` sürüm kontrolünde ve şablona bağlı (§3.7)
- [ ] `CFBundleVersion` her yüklemede artıyor
- [ ] App Privacy formu dolduruldu (§5 okunarak)
- [ ] Yaş derecelendirme anketi tamamlandı
- [ ] App Store ekran görüntüleri (iPhone 6.7" ve 5.5") hazır
- [ ] Yedekleme kararı (**A / B / C**) bilinçli olarak verildi ⚠️
- [ ] TestFlight ile iç test

---

## 7. Bu dalın dokunmadıkları ve sonradan düzeltilenler

- `README.md` — ekran görüntüsü bölümü **README sahibi ajanın** işi; buraya
  yazılmadı. Eklenmesi gereken bölüm için öneri:

  ```markdown
  ## 📸 Ekran Görüntüleri

  | Ekran           | Görüntü                             |
  | --------------- | ----------------------------------- |
  | Aylık takvim    | `docs/screenshots/01-takvim.png`    |
  | Gün detayı      | `docs/screenshots/02-gun-detay.png` |
  | Ay sonu hakediş | `docs/screenshots/05-ay-sonu.png`   |
  ```

- `build.gradle.kts` — ✅ artık dokunuldu; release imzası sırdan okuyor ve
  sır yoksa `GradleException` fırlatıyor. Ayrıntı §2.2.
- `Info.plist` / `project.yml` — ✅ kalıcı yol bulundu: `Info.ios.plist` merge
  kaynağı, `apple-project.yml` ise `bundle.iOS.template` ile bağlanan XcodeGen
  şablonu. Ayrıntı §3.6 ve §3.7.
- `PRIVACY.md` — §10.4 zaten doğru metni içeriyor, değiştirilmedi.
- `.github/workflows/*` — ✅ `build-android-aab` job'ı eklendi; `build-android`
  ile aynı `ANDROID_RELEASE_ENABLED || ANDROID_KEYSTORE_BASE64` koşulunu
  kullanıyor.
