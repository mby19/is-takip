# ADR-0010: Mobil Hedefi: Tauri Mobil Yolu

**Tarih:** 2026-10-02
**Statü:** Kabul Edildi
**İlgili kararlar:** [0001](0001-store-ve-db-mimarisi.md) (SQLite/Rust veri katmanı), [0004](0004-atomik-yazma-ve-yedek-uyumlulugu.md) (atomik yazma), [0008](0008-gunluk-hatirlatma-ve-kisayol.md) (`istakip://bugun`)

## Bağlam

Uygulamanın hedef platformları masaüstüyle sınırlıydı ve mobil için iki yol
belirdi:

- Ayrı bir React Native projesi kurmak — halihazırda `is-takip-kontrol` adıyla
  denenmiş bir dal vardı.
- Mevcut Tauri v2 uygulamasının mobil hedeflerini açmak
  (`tauri android init` + `tauri ios init`).

Kararın maliyeti düşüktü çünkü uygulamanın değerli olan kısmı ekran değil,
**veri katmanıdır**: para hesabı (`earningsCalculator`), tarih etkili ücret
geçmişi, dönem kilidi, denetim günlüğü ve geri alma. Bunların tamamı Rust
tarafındaki SQLite katmanında ve `src/schema/triggers.ts` içindeki 15 trigger'da
yaşar.

## Karar

Uygulamanın hedef platformları masaüstü **ve** mobil olacak. Mobil hedef, ayrı bir React Native projesiyle değil, **mevcut Tauri v2 uygulamasının mobil hedefleriyle** açılır (`tauri android init` + `tauri ios init`).

Bu kararla `is-takip-kontrol` adlı ayrı React Native projesi **terk edilir**; o yolda yazılmış kod tabana alınmaz. Mobil, ikinci bir uygulama değil, **aynı uygulamanın ikinci bir çıktısıdır**.

## Gerekçe

Uygulamanın değerli olan kısmı ekran değil, veri katmanıdır: para hesabı (`earningsCalculator`), tarih etkili ücret geçmişi, dönem kilidi, denetim günlüğü ve geri alma. Bunların tamamı Rust tarafındaki SQLite katmanında ve `src/schema/triggers.ts` içindeki 15 trigger'da yaşar.

Ayrı bir React Native codebase'i kurmanın bedeli şudur:

- Para hesabı **ikinci kez** yazılır. İki implementasyon zamanla ayrışır ve hangisinin doğru olduğunu bilmek imkânsızlaşır.
- Denetim/geri alma mantığı ikinci kez yazılır. `revert` bir hata ayıklandığında iki yerde de düzeltilmek zorunda kalır.
- Test kapsamı ikiye bölünür; e2e testleri iki farklı SQLite erişim modeliyle koşmak zorunda kalır.

Tek codebase ise şunu verir: Rust veri katmanı, denetim/geri alma ve para hesabı **bir kez** yazılır, mobil de masaüstü ile aynı ikiliyi çalıştırır. Mobilde çalışan kod, masaüstünde de çalışan koddur.

Ayrıca Tauri mobil hedefleri zaten kuruludur ve Rust kodu mobilde derlenmektedir; `src-tauri/gen/android` üretilmiş ve APK derlenebilir durumdadır. Yani mobil yolun ek maliyeti büyük ölçüde **ödenmiş** durumdadır.

## iOS durumu (2026-10-02)

Android'in ardından iOS hedefi de açıldı, ancak **derleme henüz tamamlanmadı**. Aşağıdaki kayıt, hangi adımın çalıştığını ve hangisinin kaldığını ayırır.

### Proje üretimi

`npx tauri ios init` başarıyla çalışır ve Xcode projesini üretir. Proje `src-tauri/gen/ios` **altında değil**, Tauri 2'nin Apple hedeflerini tek dizinde toplayan `src-tauri/gen/apple` altında durur; iOS hedefinin adı `is-takip_iOS`'tir.

Üretilen yapı: `is-takip.xcodeproj` (XcodeGen), `project.yml` (üretimin kaynak dosyası), `is-takip_iOS/Info.plist`, `is-takip_iOS/is-takip_iOS.entitlements`, `Assets.xcassets/AppIcon.appiconset`, `LaunchScreen.storyboard`, `Sources/is-takip/main.mm` ve `Podfile`. Ayrı bir `AppDelegate.swift` **yoktur** — deep-link açılışı Tauri çekirdeğinin `RunEvent::Opened` olayı üzerinden gelir.

`bundleIdPrefix` ve `PRODUCT_BUNDLE_IDENTIFIER` `tauri.conf.json`'daki `com.mby.istakip` ile tutarlıdır.

### Derleme ön koşulları ve ayarlanan engeller

| Engel                                            | Durum   | Ne yapıldı                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS simulator runtime yok                        | Çözüldü | `xcodebuild -downloadPlatform iOS` ile **iOS 27.0** runtime kuruldu (≈9 GB, ≈9 dk). `tauri ios build` bu olmadan başlamıyor.                                                                                                                                                                                                                                                                         |
| `IPHONEOS_DEPLOYMENT_TARGET = 14.0` reddediliyor | Çözüldü | Xcode 27 yalnız 15.0–27.0 kabul ediyor. `src-tauri/gen/apple/project.yml` içinde `options.deploymentTarget.iOS: 15.0` yapıldı ve `npx tauri ios init` ile `project.pbxproj`'e işlendi.                                                                                                                                                                                                               |
| Swift paketi iOS için derlenmiyor                | Çözüldü | `swift-rs` 1.0.7, Xcode 27'nin SwiftPM'iyle uyumsuz (host `-sdk/-target` iOS override'ının sonrasına ekleniyor). `cargo update -p swift-rs` ile 1.0.8'e geçildi — **yalnız `Cargo.lock`**, `Cargo.toml`'a dokunulmadı.                                                                                                                                                                               |
| `@_cdecl` sembolleri gizli kalıyor               | Çözüldü | swift-rs bu sembolleri `llvm-objcopy` ile globalleştiriyor; oysa `llvm-tools` bileşeni kurulu değildi. `rustup component add llvm-tools`.                                                                                                                                                                                                                                                            |
| Bozuk proc-macro dylib                           | Çözüldü | macOS 27 `ld` + Rust'in varsayılan `strip = "debuginfo"` birleşimi `__LINKEDIT`'i bozuyor; `sqlx_macros` `dlopen` edilemiyor ("mis-aligned LINKEDIT string pool", [rust-lang/rust#157750](https://github.com/rust-lang/rust/issues/157750)). `src-tauri/Cargo.toml`'a `[profile.release] strip = "none"` eklendi. **Bu, iOS'a özgü değildir; masaüstü release derlemesi de aynı şekilde düşüyordu.** |
| `Undefined symbols for architecture arm64`       | Çözüldü | `src-tauri/build.rs` arşivi `libTauri.a`'da hâlâ yerel (`t`) kalan dört swift-rs FFI sembolünü `llvm-objcopy --globalize-symbol` ile globalleştiriyor ve `cargo:rustc-link-lib=static=Tauri` ile bağlayıcıya veriyor. Ayrıntı aşağıda.                                                                                                                                                               |

Bu satır bir gün şu hatayı veriyordu (`cargo build --target
aarch64-apple-ios-sim --features tauri/custom-protocol --lib --release`):

```
Undefined symbols for architecture arm64:
  "_release_object", referenced from: swift_rs::swift::release_object
  "_retain_object", referenced from: swift_rs::swift::retain_object
  "_string_from_bytes", referenced from: <&str as From>::for &str
ld: symbol(s) not found for architecture arm64
```

Kök neden **swift-rs 1.0.8'in kendi hatasıdır**, uygulamanın koduyla ilgisi
yoktur. Xcode 27, `@_cdecl` dışa aktarımlarını statik kütüphane ürünlerinde yerel
(`t`) sembole düşürüyor; swift-rs `globalize_cdecl_symbols` ile bunları
`llvm-objcopy --globalize-symbol` ile geri açıyor, **ancak yalnız paketin kendi
member'ında** (`libTauri.a(Tauri.o)`). Bağımlılık member'ı `libTauri.a(SwiftRs.o)`
hiç taranmıyor. Doğrulama: `nm libTauri.a` içinde `_register_plugin` `T`
(düzeltilmiş), `_string_from_bytes` `t` (kalmış).

Çözüm **depoya alındı:** `src-tauri/build.rs` yalnız iOS hedefinde çalışır ve
`libTauri.a`'yı globalleştirir. Kapsam bilinçli olarak dar — her arşivde
globalleştirmek `libTauri.a`, `libtauri-plugin-dialog.a` ve
`libtauri-plugin-notification.a` içinde aynı global tanımları üretir ve Xcode
27'nin atom bağlayıcısını "malformed atom files with duplicate names" ile
bozar. Yalnız yerel (`t`) semboller hedeflenir; zaten global olanlar atlanır, bu
sayede `rerun-if-changed` derlemeler arasında öğütme yapmaz.

İkinci yarı sorun: `tauri`'nin `cargo:rustc-link-search` çıktısı bağlayıcıya
ulaşıyordu ama eşleşen `cargo:rustc-link-lib` çıktısı ulaşmıyordu — `-lTauri`
olmadan arşiv hiç aranmıyor ve semboller çözülmüyordu. `build.rs` ikisini birlikte
yeniden yayımlar.

> **Güncelleme (2026-10-02):** Bu satır ADR yazıldığında "ÇÖZÜLMEDİ — kalan tek
> engel" idi. Kök neden doğru teşhis edilmişti, çözüm yoktu. Depoya alınan
> çözüm `src-tauri/build.rs` içindedir. **Kalan tek engel imzalamadır**, aşağıdaki
> "Cihaz derlemesi ve imzalama" bölümüne bakın.

### Cihaz derlemesi ve imzalama

`xcodebuild -sdk iphoneos ... CODE_SIGNING_ALLOWED=NO` ile cihaz SDK'sına karşı derlemek **imzalama adımına takılmıyor**, ancak `tauri ios build` imzalama ayarını `project.pbxproj` içine yazdığı için Apple Developer hesabı olmadan cihaz derlemesi `Signing for "is-takip_iOS" requires a development team` ile düşüyor. **Simülatör derlemesi imzalama istemiyor**; iOS'u kanıtlamak için bu yol kullanılmalı. Simülatör, cihazla aynı Rust ikilisini ve aynı eklenti kombinasyonunu çalıştırdığı için derleme kanıtı için yeterlidir.

### Derin bağlantı

`ios init` **üretilen `Info.plist`'e `CFBundleURLTypes` yazmıyor.** Deep-link eklentisi bunu ancak Rust'in iOS hedefi için derlenmesi sırasında kendi `build.rs`'i ile yapar; proje üretimi tek başına yetmiyor.

Kalıcı çözüm `src-tauri/Info.ios.plist` dosyasıdır. Tauri CLI her `ios build`'de `src-tauri/Info.plist` ve `src-tauri/Info.ios.plist` dosyalarını üretilen `Info.plist` ile birleştirir; bu dosya **kaynak kodda** durduğu için yeniden üretimde kaybolmaz. Doğrulama (üretilen plist üzerinde):

```
"CFBundleURLTypes" => [ { "CFBundleURLName" => "com.mby.istakip",
"CFBundleURLSchemes" => [ "istakip" ] } ]
```

**Kalıcılık notu:** `src-tauri/Info.ios.plist` **kaynak kodda** duran dosyadır ve `gen/` altındaki her yeniden üretimde korunur — buna karşılık `gen/apple/is-takip_iOS/Info.plist` **her derlemede yeniden üretilir**, elle eklenen her anahtar kaybolur. Bu yüzden kalıcı dosya testle korunuyor: `src/__tests__/mobileReadiness.test.ts` silinmesi durumunda **kırmızı** olur (doğrulandı: dosya kaldırıldığında 2 test düşüyor, geri konduğunda 14 test yeşil). Merge'in gerçekleşip gerçekleşmediği ise **koşullu** bir bilgi testiyle izleniyor — merge ancak Rust'in iOS hedefi için derlenmesi sırasında olur, derleme tamamlanana kadar bu bir regresyon değil bekleyen adımdır.

### Yedekleme (K12'nin iOS karşılığı) — doğrulanmış boşluk

**iOS'ta Android'deki `allowBackup="false"` karşılığı yok ve yapılandırılmamış durumda.** Bu, kabul edilmiş bir risk değil, açık bir boşluktur. 2 Ekim 2026'da uçtan uca doğrulandı ve `SECURITY_REPORT.md`'ye **Bulgu 10** olarak işlendi.

Zincirin tamamı kaynak koddan doğrulandı:

```
src/lib/db.ts:70                                .load("sqlite:is_takip_v3.db")
  → tauri-plugin-sql-2.3.2/src/wrapper.rs:79    _app.path().app_config_dir()
  → tauri-2.11.5/src/path/desktop.rs:238        dirs::config_dir().join(identifier)
  → dirs-6.0.0/src/mac.rs:10-12                home_dir()/Library/Application Support
```

Yani veri `<sandbox>/Library/Application Support/com.mby.istakip/is_takip_v3.db` altında. Bu dizin iOS'ta varsayılan olarak **cihaz yedeğine (iCloud / Finder) dahil edilir**; `NSURLIsExcludedFromBackupKey` ile işaretlenmediği için maaş verisi bulut yedeğine gider. `tauri-plugin-sql`'ın dizin seçme seçeneği **yoktur** — `sqlite:` bağlantı dizesi göreli dosya adından ibarettir.

- `gen/apple/is-takip_iOS/Info.plist` içinde `UIFileSharingEnabled` ve `LSSupportsOpeningDocumentsInPlace` **yok**. Yani veri cihazın **Files uygulamasından** sızmıyor. Bu dar bir rahatlama, ama yedekleme riskini **kapatmaz**: yedekleme, Files erişiminden bağımsız bir kanaldır ve `Info.plist` anahtarıyla kontrol edilemez. `src/__tests__/mobileReadiness.test.ts` bu iki anahtarın yok kaldığını sabitler.
- Dışlama `NSURLIsExcludedFromBackupKey` ile, **native** tarafta `FileManager.setResourceValue` çağrısıyla yapılır. Bu yüzeyin Tauri'de **olmadığı** ayrı ayrı tarandı: `@tauri-apps/api` genelinde `backup` geçmişi **yok** (`path.d.ts:589` yalnız yol çözümleyicilerini dışa veriyor), `tauri` Rust çekirdeğinde `ExcludedFromBackup` **yok**, `tauri-plugin-fs` ACL'i yalnız okuma/yazma/silme. **Yani Tauri v2'nin Rust ve JS tarafında yedeği kapatacak bir API bulunmuyor.**

Yazılabilir tek yol bir `setup` kancasıdır (`src-tauri/src/lib.rs` zaten `tauri::Builder` ile kuruluyor): `#[cfg(target_os = "ios")]` altında `objc2`/`objc2-foundation` ile `NSFileManager` çağrısı. Bu üçüncü taraf bağımlılık ister ve **yalnız gerçek cihazda doğrulanabilir** (simülatörde `NSURLIsExcludedFromBackupKey` anlamsızdır). Bu dalda yapılmadı — `SECURITY_REPORT.md`'de Bulgu 10 olarak kaydedildi ve ayrı bir karar maddesine (K14) bırakıldı.

### Android/iOS parity

Android emülatörde doğrulanan beş şeyden iOS'ta doğrulanmış olan **hiçbiri** yok; iOS tarafı derleme engelinde duruyor. Platform başına hazırlık durumu:

| Konu                                                | Android                                                                       | iOS                                                                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kişi ekleme, veri kalıcılığı, Kura Çarkı, boş durum | Emülatörde doğrulandı                                                         | Doğrulanamadı (derlenmedi)                                                                                                                                                                                             |
| Derin bağlantı                                      | `AndroidManifest.xml` intent-filter, doğrulandı                               | `Info.plist` `CFBundleURLTypes` **yazıldı ve doğrulandı**, ancak uçtan uca denenemedi                                                                                                                                  |
| Bildirim izinleri                                   | `POST_NOTIFICATIONS` çalışıyor                                                | İzin istemi iOS'ta sistem tarafından gösterilir; uygulama tarafında ek bir `Info.plist` anahtarı gerekmiyor                                                                                                            |
| `BaseDirectory.Download`                            | Uygulamaya özel `Android/data/.../Download` — gezilemez, kullanıcıya görünmez | **`BaseDirectory.Download` iOS'ta çalışmaz.** Tauri masaüstü çözümleyicisini kullanır, o da `dirs::download_dir()`'a düşer; `dirs` iOS'ta `HOME` env'i olmadığı için `None` döner ve komut `UnknownPath` hatası verir. |

Son satır önemli: mevcut kod zaten mobilde `saveFileWithPicker` yolunu seçiyor (`csvExport.ts`, `workerReport.ts`), yani `Download` yolu iOS'ta yanlışlıkla tetiklenmez. Ancak `saveFileWithPicker` iOS'ta dosya seçme dialogu açar ve seçilen hedef **security-scoped** bir URL'dir; yazma işlemini `tauri-plugin-fs` bunun için ele alıyor (`commands.rs`, `SecurityScopedResources`). Bu yolun çalıştığı da cihaz/simülatör üzerinde denenmelidir.

## Sonuçlar

**Kazanımlar**

- Tek codebase, tek veri katmanı, tek test paketi.
- Rust/Android ve Rust/iOS hedefleri zaten kurulu; yeniden yazım yok.
- Derin bağlantı (`istakip://bugun`) ve günlük bildirim mobilde Tauri eklentileriyle çalışır.

**Bedeller (kabul edilmiş)**

- **UI mobilde yeniden düzenlenmek zorunda.** Sabit genişlik/piksel varsayan ekranlar telefonda taşar. `CalendarView` ve ekran listesi bu işe dahildir; alt gezinme çubuğu 44px hedef büyüklüğünde dokunulabilir olmalıdır.
- **Yedekleme yolu mobilde farklı çalışır.** `BaseDirectory.Download` Android'de uygulamaya özel `Android/data/<paket>/files/Download` altına düşer; dosya yöneticisinden gezilemez ve uygulama silinince silinir. Bu yüzden `saveFileWithPicker` (SAF dialogu) kurtarma yolu olarak tanımlandı ve `save:allow-save` izni capability'ye eklendi. `saveFileToDownloads` mobilde güvenilir bir yedekleme hedefi **değildir**.
- **Bildirim komutları masaüstünde kayıtlı değildir.** Masaüstü derlemesinin `invoke_handler` listesinde yalnız `notify`, `request_permission` ve `is_permission_granted` vardır; `cancel` ve `register_action_types` **yalnız mobil eklentide** kayıtlıdır. `src/lib/reminder.ts` bu komutları çağırmadan önce `isMobile()` platform tespitiyle doğru ayırıyor, böylece masaüstünde `command not found` üretilmiyor. Buna karşılık capability `notification:allow-cancel` / `allow-register-action-types` / `allow-register-listener` izinlerini **tanımlı tutar**: izin vermek mobil yolu engellemez, yalnızca mobilde çalışmasını sağlar. Bu davranış korunur.
- **`getCurrentWindow().close()` izni platformlar arası paylaşılır.** `core:window:allow-close` capability'de **masaüstü için** şarttır (`src/App.tsx` kök ekranda çift geri ile çıkış); `core:window:default` kümesi bu komutu içermediği için açıkça tanımlanmalıdır. Mobilde anlamı yoktur — uygulama tam ekrandır ve activity zaten kapanır — ama izin verilmesi mobilde zararsızdır. `src/__tests__/mobileReadiness.test.ts` bu izni sabitler.

**Risk azaltma**

- Mobil altyapının config'i (`tauri.conf.json`, `capabilities/default.json`, `AndroidManifest.xml`) üçlüsü derleme sırasında üretilen/okunan dosyalardır; sessizce geri alınırsa uygulama runtime'da "not allowed" hatası verir ve test paketi yeşil kalır. `src/__tests__/mobileReadiness.test.ts` bu üçlüyü sabitler.
- Android yedekleme kararı (K12) `gen/android` içinde elle tutulur; `src/__tests__/androidBackup.test.ts` bunu korur.

## Alternatifler

### (A) Masaüstü-only — reddedildi

Saha yöneticisi telefondan uygulamayı açamaz; günlük veri girişi masaüstüne kadar bekler. Uygulamanın hedef kitlesi (şantiye) için pratikte kullanılamaz. Maliyeti sıfır, ama amaca hizmet etmiyor.

### (B) React Native (ayrı codebase) — reddedildi

En pahalı ve en riskli yol. Ayrı depo, ayrı build zinciri, ayrı test paketi. Para hesabı, denetim trigger'ları ve geri alma mantığı yeniden yazılır; **bu kodun doğruluğu kanıtlanmış ve trigger'larla zorlanmış bir kod** ([0002](0002-ikili-denetim-sistemi.md), [0009](0009-para-yuvarlama-ve-hakedis-esi.md)). İki implementasyonun ayrışması, para hatası demektir. `is-takip-kontrol` bu yol için açılmıştı ve terk edilmiştir.

### (C) Tauri mobil yolu — **seçilen**

Tek codebase, yeniden yazım yok, Rust veri katmanı paylaşımlı. Maliyet mobilde UI düzenlemesidir; bu, iş mantığını iki kez yazmaktan düşük ve geri dönüşü olan bir maliyettir.

## İlgili dosyalar

| Dosya                                                    | Rolü                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/tauri.conf.json`                              | `plugins.deep-link.mobile` (`istakip` şeması, `bugun` host'u), pencere yapılandırması                                                                                                          |
| `src-tauri/capabilities/default.json`                    | Tek capability; `platforms` anahtarı **yok**, dolayısıyla mobilde de tam geçerli                                                                                                               |
| `src-tauri/gen/android/app/src/main/AndroidManifest.xml` | Derleme sırasında Tauri üretir; deep-link intent-filter, `allowBackup="false"` (K12)                                                                                                           |
| `src-tauri/Info.ios.plist`                               | `CFBundleURLTypes` (`istakip` şeması). `tauri ios build` her seferinde `gen/apple/is-takip_iOS/Info.plist` ile birleştirir; kalıcı kaynak budur                                                |
| `src-tauri/gen/apple/project.yml`                        | XcodeGen kaynağı; `options.deploymentTarget.iOS` Xcode 27 için **15.0** olmalıdır                                                                                                              |
| `src-tauri/gen/apple/is-takip_iOS/Info.plist`            | Derleme sırasında Tauri yeniden üretir; **elle düzenleme kalıcı değildir**. `UIFileSharingEnabled` / `LSSupportsOpeningDocumentsInPlace` **yok** (veri Files uygulamasına sızmıyor — Bulgu 10) |
| `src/lib/tauri.ts`                                       | `saveFileToDownloads` (masaüstü) ve `saveFileWithPicker` (mobil SAF yolu)                                                                                                                      |
| `src/lib/reminder.ts`                                    | `isMobile()` tespitiyle bildirim komutlarını yalnız mobilde çağırır                                                                                                                            |
| `src/hooks/useReminders.ts`                              | `onAction` (bildirimden toplu işaretleme), `getCurrent`/`onOpenUrl` (derin bağlantı)                                                                                                           |
| `src/__tests__/mobileReadiness.test.ts`                  | Mobil altyapı envanterini sabitler (deep-link, capability kapsamı, Android manifesti, **iOS `Info.ios.plist` kalıcılığı** ve dosya paylaşımı kapalılığı)                                       |
| `src/__tests__/androidBackup.test.ts`                    | K12: Android yedeği kapalı kalsın                                                                                                                                                              |
| `SECURITY_REPORT.md` — Bulgu 10                          | iOS'ta cihaz yedeğine dahil olma boşluğu; `NSURLIsExcludedFromBackupKey` için Tauri'de API yok                                                                                                 |
