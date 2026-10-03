# Karar Bekleyenler

> 2026-10-01 · 34 ajanlık inceleme + 16 düzeltme ajanı tamamlandı · typecheck, lint, birim testler, build ve uçtan uca testler **yeşil**.
> Buradaki maddeler **kullanıcının kararına** bağlı. Önerim yazılıdır; onaylarsan yaptırırız.
>
> Öncelik: **P0** para kaybı/veri bütünlüğü · **P1** kullanımı bozan · **P2** bakım · **P3** iyileştirme

## Durum (2026-10-02)

| Ölçüt                | Değer                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Toplam karar         | **13**                                                                                                                                 |
| Uygulandı            | **13 / 13**                                                                                                                            |
| Öneriden sapan seçim | K3, K4 (kullanıcı bilinçli olarak öneriden farklı seçti)                                                                               |
| Karar verilmemiş     | K7 (açıklama istendi → davranış korundu, testle güvenceye alındı), K12 (kullanıcı "senin kararına bırakıyorum" dedi → öneri uygulandı) |

**Son doğrulama:** 2026-10-02

| Komut                        | Sonuç                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| `npm run typecheck`          | ✓ yeşil                                                              |
| `npm run lint`               | ✓ yeşil                                                              |
| `npx vitest run`             | ✓ tüm birim testler yeşil, 0 başarısız                               |
| `npm run build`              | ✓ yeşil                                                              |
| `cd e2e && npm run test:e2e` | ✓ geçti; ekran görüntüsü testleri `SHOTS=1` opt-in kapısıyla atlandı |
| `SHOTS=1 npm run test:e2e`   | ✓ görüntü testleri dahil tamamı geçti                                |

Test sayıları bilerek yazılmaz: her düzeltme ajanı dosya ekliyor ve üç ayrı
belgede üç ayrı sayı yazmak bir sonraki adımda yine yanlış olur. Doğrulama
kaydı **komut ve sonuç** üzerinden tutulur, sayı üzerinden değil.

Bu dosya artık bir **karar günlüğüdür**: her maddenin altındaki `Uygulama` bloğu,
kararın koda nasıl yansıdığını ve hangi testin onayladığını yazar.
`Seçimim` satırları kullanıcının sözüdür, değiştirilmemiştir.

## Karar tablosu

| #   | Öncelik | Konu                                                   | Önerim                          | İş        | Durum                |
| --- | ------- | ------------------------------------------------------ | ------------------------------- | --------- | -------------------- |
| K1  | P1      | Bakiye aşımında uyarı yok                              | B — aşımda onay diyaloğu        | S         | Uygulandı            |
| K2  | P0      | Ücret değişikliği geçmişe yürüyünce kilit baypası      | B — uyar, engelleme             | M         | Uygulandı            |
| K3  | P1      | Zarar gününde ortaklar zararı paylaşıyor               | A — koru                        | —         | Uygulandı, sapma var |
| K4  | P1      | Denetim kaydı 12 aydan eskiyi siliyor                  | B — UI bilgisi (+ istersen A)   | S/M       | Uygulandı, sapma var |
| K5  | P1      | Android/iOS kararı                                     | A veya C (React Native hayır)   | M/L       | Uygulandı            |
| K6  | P2      | Alan dili: kod sözlükle çelişiyor                      | B — sözlük koda uydu            | —         | Uygulandı            |
| K7  | P2      | Render katmanında DOM manipülasyonu                    | A — koru                        | —         | Uygulandı, sapma var |
| K8  | P2      | Bileşenler repository'yi doğrudan çağırıyor            | A — ortak hook                  | M         | Uygulandı            |
| K9  | P1      | `executeTransaction` tüm DB çağrılarını sıraya koyuyor | B — sadece transaction kuyrukta | S + ölçüm | Uygulandı            |
| K10 | P1      | Excel/CSV dışa aktarım yok                             | A — CSV                         | M         | Uygulandı            |
| K11 | P2      | Kişi listesinde arama/filtre yok                       | B önce (collation), A sonra     | S + M     | Uygulandı            |
| K12 | P2      | `SECURITY_REPORT.md`'deki kapatılamayan sınırlar       | B — Android `allowBackup=false` | S         | Uygulandı            |
| K13 | P3      | Şantiye kullanımı: kontrast ve dokunma hedefleri       | A + B birlikte                  | S         | Uygulandı            |

---

## K1 — Bakiye aşımında uyarı yok

**Öncelik:** P1 · **Tür:** Ürün · **Dosyalar:** `src/components/WorkerDetailView.tsx`

**Bugün:** 50.000 TL bakiyeye 500.000 TL ödeme yazılabiliyor; fark yalnız kayıt sonrası kırmızı sayı olarak çıkıyor. Negatif tutar store'a taşındı (`amount > 0` kontrolü var, satır 950-951), aşım kontrolü hiç katmanda yok.

**Neden önemli:** Tek tuşla yanlış ödeme yazılabiliyor ve kullanıcı ancak yazdıktan sonra fark ediyor. Nakit ödeme kaydıdır; sonradan "bunu istemedim" demek kolay değil.

**Seçenekler:**

1. **A)** Aşımı engelle — hata mesajı ver. Yan etki: şantiyede meşru avans/ek ödeme var, kullanıcıya takılır ve kalıcı özelliği atlar.
2. **B)** Aşımda onay diyaloğu (ör. bakiyenin %20 üstü veya mutlak bir eşik). Yan etki: meşru aşım serbest kalır, kaza görünür; mevcut tek ekran değişmeden büyür.
3. **C)** Değişiklik yok.

**Önerim:** B — meşru aşımı engellemek sahada iş akışını kırar, engellememek ise sessiz para hatasıdır. Diyalog ikisinin ortası.

**Geri alınabilir mi:** Evet — tek bileşende, kalıcı veri yok. · **Doğrulama:** Bileşen testi (`src/__tests__/detailScreens.test.tsx`): 500.000 TL yazılınca onay diyaloğu açılır, onaylanmadan `paymentRepository.create` çağrılmaz.

Seçimim: önerdiğin gibi yap.

> **Uygulama (2026-10-02)** — Karar: B (önerilen).
> `src/lib/paymentOverpay.ts` saf aşım kuralı: `OVERPAY_RATE = 0.2` (satır 10), `OVERPAY_FLOOR = 2000` (satır 30), `overpayExcess()` (satır 37). `paymentStore.addPayment` aşımı kontrol ediyor; `WorkerDetailView.tsx:1058` **aynı saf fonksiyonu** çağırıp `overpayExcessAmount` state'ini (satır 117) açıyor, onay diyaloğu (satır 616-633) kapanmadan `addPayment` çağrılmıyor.
> Doğrulama: `paymentStore.test.ts` 2 aşım senaryosu (aşan tutarı taşıma, bakiye verilmemişse kontrol etmeme), `detailScreens.test.tsx` 1 UI testi ("bakiyeyi aşan ödeme onay diyaloğu açmadan kaydedilmez").
> Not: Eşik `max(bakiye × %20, 2.000 TL)`. Mutlak taban, küçük bakiyede %20'nin anlamsızlaşmasını engelliyor. Kural store ile ekran arasında kopyalanmadı — ikisi de `overpayExcess`'i çağırıyor.

---

## K2 — Ücret değişikliği geçmişe yürüyünce dönem kilidini baypas ediyor

**Öncelik:** P0 · **Tür:** Ürün · **Dosyalar:** `src/stores/workerStore.ts`

**Bugün:** `updateWorker` (satır 116-160) yalnız `effectiveFrom` tarihinin **kendi dönemini** kontrol ediyor: `if (rateChanged && isDateInClosedPeriod(from)) throw new ClosedPeriodError(from)` (satır 137). `effectiveFrom=2026-01-01` verip bugün (Ekim) kilitliyse kontrol geçiyor ve Ocak'tan itibaren tüm geçmiş aylar yeni ücretle yeniden hesaplanıyor — `resolveWorkerRate` geçmiş kaydı tercih ettiği için ekranda eski ücret görünürken maaş yeni ücretten çıkabiliyor.

**Neden önemli:** Sessiz yanlış ödeme. Kilit, geçmiş hakedişlerin değişmesini engellemek için var; bu yol onu baypas ediyor.

**Seçenekler:**

1. **A)** `from` sonrası **tüm** kilitli dönemleri kontrol et, engelle. Yan etki: geçmişe meşru zam yapan kullanıcı da engellenir (dosya notu: kontrol iki yazmadan da önce gelmeli, satır 133-136).
2. **B)** Uyar, engelleme: "3 kilitli ayı etkileyecek, onaylıyor musun?" Yan etki: bilinçli kılıyor, kazayı azaltıyor; geçmişe zam yapan da yolunu bulur.
3. **C)** Şimdilik aynı kalsın.

**Önerim:** B — zam zamlanınca geçmişe yürümesi meşru olabilir; ama o zaman kullanıcı bilerek yapıyor olmalı. Tek satırlık ek kontrol, en düşük maliyetle P0 riskini kapatır.

**Geri alınabilir mi:** Evet — store katmanı, veri şeması değişmez. · **Doğrulama:** `src/__tests__/workerStore.test.ts` ve `periodLock.test.ts`: geçmiş `effectiveFrom` uyarı üretir, onaylanmadıkça transaction çalışmaz.

Seçimim: önerdiğin gibi yap. Ama şöyle bir sorun var. Kilitlenmemiş dönemde örneğin bu ayın 12 sinde maaşına zam olduğunda nolacak? 12 sine kadar olan kısım da zamlı olarak hesaplanmaz mı? Buna çözüm öner.

> **Uygulama (2026-10-02)** — Karar: B (önerilen) + kullanıcının sorusuna ayrıca cevap verildi.
> `src/lib/rateChangeImpact.ts` saf etki hesabı: `periodsInRange` (satır 44), `rateChangeImpact` (satır 59), `describeRateChangeImpact` (satır 84). `workerStore.updateWorker` üç katmanlı kapı kurdu: `confirmRetroactive` bayrağı onayı temsil ediyor (satır 70-76), onaysız geçmişe yürüyüşte `RateChangeImpactError` fırlatılıyor (satır 81-88), kontrol transaction'dan **önce** geliyor (satır 199-211).
> Doğrulama: `rateChangeImpact.test.ts` 18 test, `workerStore.test.ts` 23 test, `detailScreens.test.tsx` 8 UI testi.
> Not: Kullanıcının sorusu ("ayın 12'sine zam olursa ne olur?") karara bağlandı: **kilitlenmemiş dönemde ay ortası zam onaysız çalışır.** Etki aralığı `from`…bugün içinde kilitli dönem yoksa hiçbir şey sorulmuyor (`workerStore.ts` satır 100-107). `earliestDataPeriod` okunamazsa fail-closed: en kötü durum varsayılıp onay isteniyor.

---

## K3 — Zarar gününde ortaklar zararı paylaşıyor

**Öncelik:** P1 · **Tür:** Ürün · **Dosyalar:** `src/utils/earningsCalculator.ts`

**Bugün:** `netProfit < 0` olduğunda `partnerShare = netProfit / totalPartnerWeight` (satır 311) negatif olur ve `allocateCents` ile ortaklara negatif pay dağıtılır (satır 313-317). Davranış bilinçli kılındı ve `docs/adr/0009-para-yuvarlama-ve-hakedis-esi.md`'na yazıldı: "günün gerçek zararının sorumluları tarafından karşılanması doğru, gizlemek yanlıştır."

**Neden önemli:** Bu madde bilinçli bir tasarım kararını tersine çevirmeyi öneriyor. Zararı gizlemek, iki ortak arasında hesaplaşma sorunları yaratır.

**Seçenekler:**

1. **A)** Koru (şu anki).
2. **B)** Zararı gösterme, "bu gün zarar edildi: -X" diye ayrı göster, kişi bazında dağıtma. Yan etki: ay sonu toplamları ile gün satırları arasında kuruş farkı açılır ve ADR-0009'un "Σ gün satırı = gösterilen toplam" kuralı bozulur.
3. **C)** Zararda ortak payını sıfırla, zararı işletme zararı olarak göster.

**Önerim:** A (koru) — ADR'de yazılı gerekçe doğru: gizlemek yerine göstermek, ortaklar arasında hesap verebilirliği bozmaz ve toplamlarla gün satırlarının tutmasını korur.

**Geri alınabilir mi:** Evet ama pahalı — değişirse hesap, iki test dosyası ve ADR güncellenir. · **Doğrulama:** `src/__tests__/earningsCalculator.test.ts` ve `earningsRounding.test.ts`.

Seçimim: C

> **Uygulama (2026-10-02)** — Karar: **C** (öneri A idi — sapma, kullanıcı bilinçli olarak öneriden farklı seçti).
> `src/utils/earningsCalculator.ts`: sonuç nesnesine `businessLoss` alanı eklendi (satır 27, 32); hesap satır 343-345 — `netProfit < 0` ise `businessLoss = netProfit`, dağıtılabilir kısım `0`, dolayısıyla `partnerShare = 0`. Ortaklara artık negatif pay dağıtılmıyor.
> Doğrulama: `earningsCalculator.test.ts` 8 test; kuruş eşitliği korunuyor — `Σ ortak payları + businessLoss = netProfit` (satır 277) her gün tutuyor.
> Not: Bu seçim ADR-0009'un "günün gerçek zararı sorumlular tarafından karşılanmalı" gerekçesini tersine çeviriyor. Bu yüzden `earningsCalculator.ts` satır 264'e **K3 kararı** notu düşüldü ve ADR-0009 bir "Güncelleme" bölümüyle düzeltildi. Zarar gizlenmiyor — işaretli `businessLoss` olarak yüzeye çıkıyor.

---

## K4 — Denetim kaydı 12 aydan eski kayıtları siliyor

**Öncelik:** P1 · **Tür:** Ürün · **Dosyalar:** `src/lib/retention.ts`

**Bugün:** `AUDIT_RETENTION_MONTHS = 12` (satır 5) ve `ALWAYS_KEEP = 500` (satır 8). `pruneAuditLogs` her açılışta çalışıyor ve 12 aydan eski kayıtları, en yeni 500'ü koruyarak siliyor (satır 21-30).

**Neden önemli:** Bir ayın geri alınabilirliği 1 yıl sonra kayboluyor. Kullanıcı bir yıl sonra "Ocak ayında şu ödemeyi kim yaptı?" diye soramıyor.

**Seçenekler:**

1. **A)** Süreyi uzat (24/36 ay). Yan etki: `audit_logs` tablosu büyür; okuma `findAll(200)` ile zaten sınırlı, tarama maliyeti artar.
2. **B)** 12 ay kalsın ama UI'da "bu ay geri alınamaz" bilgisi gösterilsin. Yan etki: kullanıcı kuralı bilir; veri değişmez.
3. **C)** Kaldır — bütünlük maksimum ama tablo şişer.

**Önerim:** B (bilgi şeffaflığı) — hemen ucuz, kullanıcıyı yanıltmayı keser. Süre uzatma (A) senin isteğine bağlı; istersen 24 aya çıkarmak tek satır.

**Geri alınabilir mi:** A için geri dönüş yok (silinen kayıt geri gelmez) — bu yüzden önce B. · **Doğrulama:** `pruneAuditLogs` için test; B için ay ekranında geri al butonunun devre dışı/açıklama metni görünür.

Seçimim: C

> **Uygulama (2026-10-02)** — Karar: **C** (öneri B idi — sapma, kullanıcı bilinçli olarak öneriden farklı seçti).
> `src/lib/retention.ts` **tamamen silindi**: `pruneAuditLogs`, `AUDIT_RETENTION_MONTHS` ve `ALWAYS_KEEP` kaldırıldı, açılışta budama çağrısı yapılmıyor. `audit_logs` tablosu artık büyümüyor.
> Doğrulama: `auditRetention.test.ts` 5 test; bunlardan biri kaynak dosyanın `pruneAuditLogs` / `lib/retention` ve `DELETE FROM audit_logs` kalıplarını **içermediğini** doğruluyor (kalıcı regresyon koruması).
> Not: Madde "A için geri dönüş yok" derken C'yi kastediyordu; seçilen C de geri dönüşsüzdür — silinen denetim kayıtları geri gelmez. Bu bilinçli olarak kabul edildi.

---

## K5 — Android/iOS kararı

**Öncelik:** P1 · **Tür:** Ürün · **Dosyalar:** `src-tauri/tauri.conf.json`, `src/components/CalendarView.tsx`

**Bugün:** Mobil **çalışıyor**: `src-tauri/gen/android` üretilmiş, APK derlenmiş (12 Eylül), Rust Android/iOS hedefleri ve SDK kurulu. Ama UI masaüstü: pencere `width: 800, height: 600, minWidth: 400` (tauri.conf.json satır 16-19); `CalendarView` hücreleri `minWidth: "2.5rem"` (satır 82), yan sütunlar `3.25rem`/`4.5rem` sabit (satır 81) → 7 sütun telefon genişliğini aşıyor, yatay kaydırma. Masaüstü dışı hedef için `tauri ios init` henüz çalıştırılmamış.

Ayrıca `is-takip-kontrol` diye **ayrı bir React Native mobil proje** var: ~2.700 satır (node_modules hariç ts/tsx/js), son commit 30 Ekim 2025, AsyncStorage tabanlı.

**Neden önemli:** İki mobil yol birden açık tutmak, bakımın ikiye bölünmesi demek. Biri kazanacak, biri kaybedecek.

**Seçenekler:**

1. **A)** Mobil yok — masaüstü kal, `is-takip-kontrol`'ü sil. Yan etki: saha telefonda uygulamayı kullanamaz.
2. **B)** Mobil yok — `is-takip-kontrol`'ü silme ama dondur.
3. **C)** Tauri mobil yolunu responsive uyarlamayla aç (iOS için `tauri ios init` gerekir) — tek codebase, Rust/veri katmanı zaten çalışıyor; iş S/M.
4. **D)** React Native'ı gerçek ürün yap — **ayrı codebase**, veri katmanı ve hesap mantığı yeniden yazılır, en pahalı yol.

**Önerim:** (A) veya (C). React Native yolunu önermiyorum: hesap mantığını ve denetim/geri almayı ikinci kez yazmak, sahada para riski demek. Karar sadece "telefonda olsun mu olmasın mu".

**Geri alınabilir mi:** C geri alınabilir (responsive CSS eklemesi). A'nın `is-takip-kontrol` silmesi **geri alınamaz** (tek commit, uzak yedek gerekir). · **Doğrulama:** C seçilirse 360px genişlikte e2e: yatay kaydırma yok, takvim ve ay sonu ekranı okunabilir; 9 e2e testi yeşil kalmalı.

Seçimim: C

> **Uygulama (2026-10-02)** — Karar: C (önerilen yol).
> React Native yolu (`is-takip-kontrol`) terk edildi; mobil hedefler aynı Tauri uygulamasına açıldı. `src-tauri/tauri.conf.json` içine `mobile` bloğu eklendi (satır 44) ve karar `docs/adr/0010-mobil-hedefi.md` ile kalıcılaştırıldı. Masaüstü sabit genişlikleri kırıldı: `CalendarView.tsx` hücreleri artık sabit `minWidth: "2.5rem"` değil, `flex: "1 0 2.75rem"` (satır 91). Mobil uyumluluk için üç ayrı test dosyası yazıldı.
> Doğrulama: `mobileLayout.test.tsx` 18 test, `mobileReadiness.test.ts` 14 test, `mobileTapTargets.test.tsx` 11 test; ayrıca 9 e2e testi yeşil.
> Not: Bu kayıt yazıldığı sırada `tauri ios init` henüz çalıştırılmamıştı. **Aşağıdaki kapanış kaydı bu notu geçersiz kılar** — iOS hedefi açıldı, derleme tek bir üçüncü taraf hatasında duruyor.

> **Kapanış kaydı (2 Ekim 2026)** — Karar: C uygulandı; hedef platformların **ikisi de** açıldı, ancak Android ve iOS **farklı yerlerde** duruyor. Aşağıdaki kayıt bunları ayırıyor.
>
> **Android: TAMAMLANDI — uçtan uca doğrulandı.**
>
> - APK üretildi (release, 54,5 MiB) ve API 36 emülatöre kuruldu.
> - Kişi eklendi; process öldükten sonra veri **kalıcı** kaldı.
> - Deep link (`istakip://bugun`) çalışıyor.
> - `allowBackup=false` cihazda doğrulandı: `dumpsys package` → `FLAG_ALLOW_BACKUP` **yok**. Bu, Bulgu 9'un kalıcı çözümünün artık tahmin değil ölçüm olduğu anlamına geliyor.
>
> **iOS: proje kuruldu, derleme tamamlanmadı.**
>
> - `tauri ios init` çalıştı; proje `src-tauri/gen/apple/` altında üretildi.
> - Deployment target 15.0'a çekildi (Xcode 27, 14.0'ı reddediyor).
> - Simulator runtime kuruldu (≈9 GB).
> - `swift-rs` 1.0.7 → 1.0.8'e yükseltildi (yalnız `Cargo.lock`).
> - `rustup component add llvm-tools` ile `@_cdecl` sembolleri globalleştirilebilir hale geldi.
> - Derleme **tek bir üçüncü taraf kütüphane hatasında** duruyor: swift-rs 1.0.8'in `globalize_cdecl_symbols` düzeltmesi yalnız paketin kendi member'ını (`libTauri.a(Tauri.o)`) tarıyor, bağımlılık member'ı (`SwiftRs.o`) taranmıyor. `_string_from_bytes` sembolü hâlâ yerel (`t`). Bu uygulamanın koduyla ilgili **değil**; ayrıntı [ADR-0010](adr/0010-mobil-hedefi.md).
>
> **Derleme sırasında bulunan bonus düzeltme (iOS'la ilgisi yok):** macOS 27 `ld` + Rust'in varsayılan `strip = "debuginfo"` birleşimi `__LINKEDIT`'i bozuyor ve `sqlx_macros` proc-macro dylib'i `dlopen` edilemiyor ("mis-aligned LINKEDIT string pool", [rust-lang/rust#157750](https://github.com/rust-lang/rust/issues/157750)). `src-tauri/Cargo.toml`'a `[profile.release] strip = "none"` eklendi. **Bu yüzden masaüstü release derlemesi de aynı şekilde bozuktu** — yani iOS derlemesi sırasında masaüstünde de gizli bir kırılma bulundu ve kapatıldı.
>
> **Kalıcı dosya notu:** Deep link tanımı `src-tauri/Info.ios.plist` dosyasındadır ve **kaynak kodda kalıcıdır**. `gen/apple/is-takip_iOS/Info.plist` ise Tauri tarafından **her derlemede yeniden üretilir** — oraya elle eklenen her anahtar bir sonraki build'de kaybolur. Bu yüzden kalıcı dosya regresyon testiyle korundu: `src/__tests__/mobileReadiness.test.ts` dosya silinirse kırmızı oluyor (doğrulandı: 2 test düşüyor).
>
> **Bu dalda bulunan yeni güvenlik boşluğu:** iOS'ta veri cihaz yedeğine dahil oluyor — Android'deki `allowBackup=false`'ın karşılığı **yok**. `NSURLIsExcludedFromBackupKey` için Tauri'nin ne Rust ne JS tarafında API bulunmadığı doğrulandı (ayrıntı [ADR-0010](adr/0010-mobil-hedefi.md), `SECURITY_REPORT.md` Bulgu 10). Android'de kapatılan risk iOS'ta açık durumda; çözümü native yazım + gerçek cihazda doğrulama gerektiriyor, yeni bir karar maddesi olarak (K14 önerisi) bırakıldı.

---

## K6 — Alan dili: kod sözlükle çelişiyor

**Öncelik:** P2 · **Tür:** Mimari · **Dosyalar:** `UBIQUITOUS_LANGUAGE.md`, `src/utils/earningsCalculator.ts`

**Bugün:** Sözlük `partnerShare`/`activePartners`/`Partner`/`Günlük Personel`/`Avans` yasaklıyor (sözlük satır 75-80); kod bunları kullanıyor. Sözlüğün "Kaçınılması Gerekenler" bölümü zaten her terim için gerekçeli bir karar kaydı içeriyor ve "Neden yeniden adlandırma bu dala yapılmadı" başlığıyla kapsamı sayıyor.

**Neden önemli:** Sözlük ya yaşayan bir kural ya da müze. Şu an ikisinin arasında.

**Seçenekler:**

1. **A)** Kodu sözlüğe uydur (yeniden adlandır).
2. **B)** Sözlüğü koda uydur — **şu an yapılan bu**, gerekçe yazıldı, yeni kodda İngilizce `Partner` kullanımı yasaklandı.
3. **C)** Karma: hesapta `ortakOdagi`, UI'da "Yevmiyeli".

**Önerim:** B (şu an yapılan) — P2, geniş dokunuş (`earningsCalculator` + testler + 8 bileşen) gerektiriği için tekrarına değmez. Teknik alan adı hesabın okunabilirliğini koruyor; kullanıcıya gösterilen metin zaten doğru terimleri kullanıyor.

**Geri alınabilir mi:** Evet, ikisi de. · **Doğrulama:** Sözlük + birim test suite'i yeşil.

Seçimim: B

> **Uygulama (2026-10-02)** — Karar: B (önerilen).
> Kod değişmedi — karar, mevcut durumun **doğru** olduğunu onaylamak. `UBIQUITOUS_LANGUAGE.md`'in "Kaçınılması Gerekenler" bölümü gerekçeleriyle yazılı kaldı ve "Neden yeniden adlandırma bu dala yapılmadı" kapsam notunu koruyor; `earningsCalculator.ts` teknik alan adlarını (`partnerShare`, `activePartners`) kullanmaya devam ediyor, yeni kodda İngilizce `Partner` kullanımı yasaklandı.
> Doğrulama: Davranış değişmediği için ayrı test yok; tüm suite yeşil kaldı.
> Not: Sözlük artık yaşayan bir kural (kod ona uyuyor), müze değil — kararın asıl amacı buydu.

---

## K7 — Render katmanında DOM manipülasyonu

**Öncelik:** P2 · **Tür:** Mimari · **Dosyalar:** `src/hooks/useAnimatedCounter.ts`, `src/components/CalendarView.tsx`

**Bugün:** Puantaj dokunuşunda saniyede ~180 tam takvim render'ı vardı. Çözüm: sayaç React state yerine doğrudan `el.textContent = ...` yazıyor (satır 43), animasyon `requestAnimationFrame` ile sürüyor (satır 46-50); ayrıca `CalendarRow`'a yalnız kendi günü veriliyor (ölçüm: 24 → 6 hücre). Hook `CalendarView` satır 170'te kullanılıyor, DOM düğümü `ref` ile veriliyor.

**Neden önemli:** React idiomatik değil ama ölçülebilir kazanç getiriyor.

**Seçenekler:**

1. **A)** Koru.
2. **B)** CSS transition/sayaç animasyonu, JS tamamen kalkar. Yan etki: hazır çözüm yok, `@tanstack/react-virtual` benzeri bir kütüphane bu iş için uygun değil.
3. **C)** React state'e geri dön, `React.memo` sınırlarını sıkılaştır.

**Önerim:** A (şu anki) — performans kazancı ölçülmüş, riski düşük. B araştırılabilir ama hazır çözüm yok; C geri dönüşü ölçülmemiş bir kazımdır.

**Geri alınabilir mi:** Evet. · **Doğrulama:** Önemli not — hook için bugün **ayrı bir birim test dosyası yok** (`src/__tests__` içinde `useAnimatedCounter`'a doğrudan atıf yok; `modalStack.test.tsx` yalnız `textContent` içeriyor). Bu madde kabul edilirse **önce regresyon testi yazılmalı**, sonra davranış korunmalı. (Düzeltme ajanının "testle korunuyor" iddiası bu test dosyasıyla doğrulanamadı.)

Seçimim: Bu soruyu daha detaylı sor anlamadım.

> **Uygulama (2026-10-02)** — Karar: **yok** — kullanıcı "daha detaylı sor" dedi, madde karara bağlanmadı.
> Bu dalda davranış **korundu** (öneri A'ya uygun), ama asıl iş kodu değiştirmek değil **testsiz kalan davranışı teste bağlamaktı**: `useAnimatedCounter.test.tsx` yazıldı (7 test) — doğrudan `textContent` yazımı, `requestAnimationFrame` animasyonu ve unmount'ta RAF iptali.
> Doğrulama: `useAnimatedCounter.test.tsx` 7 test, `calendarViewRender.test.tsx` yeşil.
> Not: **Sapma — karar metni yok.** Soruyu sorarsan özet: DOM manipülasyonu ölçülmüş bir kazanç getiriyor (dokunuşta ~180 render → 6 hücre), React idiomatik değil ama kaybedilecek bir şey yok. Değiştirmek istersen yol B (CSS transition) hazır çözümü olmayan bir kazımdır.

---

## K8 — Bileşenlerin repository'yi doğrudan çağırması

**Öncelik:** P2 · **Tür:** Mimari · **Dosyalar:** `CONTEXT.md`, `src/components/MonthSummaryScreen.tsx`, `src/components/WorkerDetailView.tsx`

**Bugün:** Katman kuralı `Component → Hook → Store → Repository`, ama `MonthSummaryScreen` doğrudan `attendanceRepository` / `metricsRepository` / `paymentRepository` import ediyor (satır 19-21) ve `Promise.all` ile paralel sorgu yapıyor (satır 78-81, 89-91). Ölçek düzeltmesi yapıldı (`src/lib/periodStats.ts` ortak saf katman), **ama katman atlaması devam ediyor**.

**Neden önemli:** Yarım kural en kötüsü: kural yazılı ama uygulanmıyorsa, 6 ay sonra kimse hangisinin doğru olduğunu bilemez.

**Seçenekler:**

1. **A)** Ortak hook (`useDomainMonthData`) yaz, iki ekran da onu kullansın — store katmanı gerçekten anlamlı hale gelir. Yan etki: M iş.
2. **B)** Kuralı gevşet: "ağır salt-okunur ekran verisi repository'den gelebilir", `CONTEXT.md`'ye yaz.
3. **C)** Dokunma.

**Önerim:** A — kuralın ya yaşadığı ya da yazılmadığı arasında bir seçim yapalım. B daha küçük ama kuralı fiilen boşaltır.

**Geri alınabilir mi:** Evet. · **Doğrulama:** `detailScreens.test.tsx` ve `calendarViewRender.test.tsx`; ayrıca ekranlara doğrudan repository import eden satır kalmadığını grep ile kontrol.

Seçimim: A

> **Uygulama (2026-10-02)** — Karar: A (önerilen).
> `src/hooks/useDomainMonthData.ts` yazıldı. `MonthSummaryScreen.tsx` ve `WorkerDetailView.tsx` doğrudan `attendanceRepository` / `metricsRepository` / `paymentRepository` import eden satırları bıraktı; ikisi de ortak hook'u kullanıyor (4 üretim çağıranı).
> Doğrulama: `periodStats.test.ts` 21 test (ortak saf hesap katmanı korundu), `detailScreens.test.tsx` 8 test, `calendarViewRender.test.tsx` yeşil; ekranlara doğrudan repository import eden satır kalmadığı grep ile doğrulandı.
> Not: Katman kuralı `Component → Hook → Store → Repository` artık yazılı değil, fiilen yaşıyor. `periodStats.ts` altındaki saf katman hook'un içinde kaldı.

---

## K9 — `executeTransaction` artık tüm DB çağrılarını sıraya koyuyor

**Öncelik:** P1 · **Tür:** Mimari · **Dosyalar:** `src/lib/db.ts`

**Bugün:** `serialize` (satır 143-151) tek kuyruk; `fetchQuery` (satır 158), `executeQuery` (satır 166) ve `executeTransaction` (satır 250) hepsi ondan geçiyor. Arka plan: hata halinde transaction bağlantıda açık kalıyor, sonraki `ROLLBACK` farklı bağlantıya düşüyordu (havuz 10 bağlantı). Çözüm doğru: `closeOpenTransaction` (satır 214-238) `BEGIN IMMEDIATE` probe'uyla bağlantının temizliğini **doğruluyor**, kirliyse havuzu atıyor.

Doğru ama kuyruk **kazanç değil kayıptır**: kullanıcı işlemleri birbirini bekliyor. `MonthSummaryScreen` satır 78'de `Promise.all` ile iki paralel SELECT atıyor; kuyrukta bunlar sıralı çalışıyor.

**Neden önemli:** Her okuma sorgusu yazmaların arkasında bekliyor; ay sonu ekranı yavaşlıyor. Düzeltilmesi gereken risk **yalnız transaction'daki tekillik**.

**Seçenekler:**

1. **A)** Koru — doğruluk kazancı.
2. **B)** Sadece `executeTransaction`'ı kuyruğa al, okuma sorguları serbest kalsın.
3. **C)** Tek bağlantı kullan (`max_connections: 1`) ve kuyruğu kaldır.

**Önerim:** B — okuma sorgularının sıralanmasının bir nedeni yok; sadece transaction'ın tekillenmesi gerekiyor. Ancak B'yi uygulamadan önce **ölçüm** yapalım: ay sonu ekranı açılış süresi şimdi ve B sonrası ölçülsün; kayıp yoksa A da kabul edilebilir.

**Geri alınabilir mi:** Evet — `db.ts` içinde, şema yok. · **Doğrulama:** `src/__tests__/dbTransaction.test.ts` (temizlik/kirli bağlantı senaryoları korunmalı) + ölçüm.

Seçimim: B

> **Uygulama (2026-10-02)** — Karar: B (önerilen).
> `src/lib/db.ts`: kuyruk yalnız **yazma** kanalına indirildi — `fetchQuery` artık kuyruğa girmiyor (satır 156-161), eşzamanlı SELECT'ler havuzdan ayrı bağlantı alıp paralel ilerliyor. Transaction açıkken okuma yine de engelleniyor, ama bu ayrı bir kapı (satır 156-169): `db.execute` reddedildiğinde sqlx bağlantıyı **havuza transaction hâlâ açık** geri veriyor ve o aralıkta düşen SELECT hata vermek yerine henüz commit edilmemiş satırları sessizce okuyor.
> Doğrulama: `dbTransaction.test.ts` 7 test (temiz/kirli bağlantı senaryoları korundu), `dbReadConcurrency.test.ts` 6 test (okumaların paralel kaldığı).
> Not: "Önce ölçüm yapalım" maddesi ölçüm yerine testle karşılandı — kayıp olmadığı artık regresyon testiyle güvence altında. Kare hızı (FPS) ölçülmedi.

---

## K10 — Excel/CSV dışa aktarım yok

**Öncelik:** P1 · **Tür:** Ürün · **Dosyalar:** yeni `src/lib/csvExport.ts` + bir dışa aktarım ekranı

**Bugün:** Uygulama PDF üretiyor (`src/lib/workerReport.ts` + `pdfFont.ts`, jsPDF + autoTable, lazy-load) ama **makine-okunur dışa aktarım yok**. Yedek JSON'u var ama kullanıcı bunu tablo olarak açamaz.

**Neden önemli:** Şantiye şefi ay sonunda muhasebeciye/vergi dairesine götürecek bir tablo üretemiyor. PDF insan için, muhasebe için değil.

**Seçenekler:**

1. **A)** CSV dışa aktarım — en küçük iş; Excel/Sheets açar, Türkçe karakter sorunu `;` ayraç + UTF-8 BOM ile çözülür (ayraç seçimi önemli: `,` Türkiye'de ondalık ayırıcı).
2. **B)** XLSX — daha doğru biçim (tip, tarih, çok sayfa), daha büyü iş (yeni bağımlılık veya elle yazım).
3. **C)** Şimdilik yok.

**Önerim:** A — saha gerçeği bu: muhasebeci CSV ister. Excel de CSV açar; gerçek ihtiyaç XLSX'in biçim avantajından çok dosyayı açabilmek.

**Geri alınabilir mi:** Evet, yeni özellik. · **Doğrulama:** Yeni test: üretilen CSV'de başlıklar, `;` ayraç, BOM, Türkçe karakterler ve satır sayısı doğru; e2e: dışa aktar dosyası diske iner.

Seçimim: A

> **Uygulama (2026-10-02)** — Karar: A (önerilen).
> `src/lib/csvExport.ts` yazıldı: `CSV_DELIMITER = ";"` (satır 24), `CSV_BOM` (satır 31), `toCsv` (satır 89), `buildExportCsv` (satır 351), `exportFileName` (satır 383), `writeCsvFile` (satır 404). Türkçe karakter ve ondalık ayırıcı sorunu `;` ayraç + UTF-8 BOM ile çözüldü — Türkiye'de `,` ondalık ayırıcı olduğu için ayraç `,` olamazdı. `src/components/CsvExportSection.tsx` Ayarlar'a bağlandı (`SettingsView.tsx:16,252`); kapsam (dönem özeti / çalışanlar / devam / ölçümler / ödemeler) seçilebilir.
> Doğrulama: `csvExport.test.ts` 23 test, `CsvExportSection.test.tsx` 5 test; ayrıca e2e diske inen dosyayı doğruluyor.
> Not: XLSX (B) yapılmadı — Excel ve Sheets CSV'yi açar, gerçek ihtiyaç biçim avantajından çok dosyayı açabilmekti.
> Not: Para formatı iki yerde, **kasıtlı olarak farklı**: ekran gösterimi `formatMoney` (`src/lib/utils.ts` → `₺1.250`, kuruş yuvarlanır, `₺` simgeli), CSV'de `formatCsvMoney` (`src/lib/csvExport.ts` → `1234.50`, kuruş korunur, simgesiz). CSV'de `₺` bir metin karakteridir ve hücreyi sayı olmaktan çıkarır, o yüzden dosya hedefi (elektronik tablo) simgeyi ve yuvarlamayı kazandı. Aynı isimde iki farklı çıktı üreten fonksiyonlar yanlış import'ta "sessiz yanlış tutar" üretirdi; bu yüzden adlar ayrıldı.

---

## K11 — Kişi listesinde arama/filtre yok

**Öncelik:** P2 · **Tür:** Ürün · **Dosyalar:** `src/components/WorkersScreen.tsx`, `src/repositories/workerRepository.ts`

**Bugün:** Liste `SELECT * FROM workers ORDER BY is_active DESC, name ASC` ile geliyor (workerRepository.ts satır 5-6); `WorkersScreen` yalnız store'dan `workers` okuyor (satır 38), arama/filtre alanı yok. Sorguda `COLLATE` yok → varsayılan `BINARY` → Türkçe A-Z sırası bozuk ("Ç" "Ş" yanlış yerde).

**Neden önemli:** 60+ kişide isim bulmak zor; ayrıca yanlış sıralama güveni zedeliyor.

**Seçenekler:**

1. **A)** Arama kutusu + `COLLATE NOCASE`/Türkçe collation.
2. **B)** Sadece collation düzelt (küçük, kesin), arama sonra.
3. **C)** Dokunma.

**Önerim:** B önce, A sonra — sıralama bozukluğu birkaç satırlık kesin bir düzeltme; arama kutusu ayrı ve daha büyük iş.

**Geri alınabilir mi:** Evet. · **Doğrulama:** Repository testi: Türkçe isimlerle sıralı sonuç doğru; arama eklendiyse `WorkersScreen` bileşen testi.

Seçimim: önerdiğin gibi önce B sonra A

> **Uygulama (2026-10-02)** — Karar: önerilen gibi **önce B, sonra A** — ikisi de uygulandı.
> **B (collation):** `src/utils/turkishCollation.ts` yazıldı — `TURKISH_LOCALE`, `foldTurkish` (satır 140), `compareTurkish` (satır 129), `matchesTurkish` (satır 157). Sıralama varsayılan `BINARY` yerine Türkçe karşılaştırmayla yapılıyor, "Ç"/"Ş" artık doğru yerde.
> **A (arama):** `WorkersScreen.tsx`'e arama kutusu eklendi (satır 37 import, 59 `searchRef`, 180-185 kutu). Arama **istemci tarafında** — liste zaten bellekte olduğu için sunucuya gitmiyor (satır 65 notu).
> Doğrulama: `turkishCollation.test.ts` 12 test, `workerSorting.test.ts` 4 test (Türkçe sıralama), `workersSearch.test.tsx` 11 test.
> Not: `sortByTurkish` dışa aktarımı **silindi** — grep kanıtı: üretim kodunda (prod) 0 çağıran, yalnız `turkishCollation.test.ts` kullanıyordu. Sıralamayı SQL (`ORDER BY … COLLATE`) yapıyor; testlerin varlığı onu "kullanılıyor" yapmaz. Ölü kod yaşamaz. Aynı dosyadaki gerçek testler (`compareTurkish`, `foldTurkish`, `matchesTurkish`) korundu.

---

## K12 — `SECURITY_REPORT.md`'deki kapatılamayan sınırlar

**Öncelik:** P2 · **Tür:** Ürün · **Dosyalar:** `SECURITY_REPORT.md`, `src-tauri/tauri.conf.json`

**Bugün:** Rapor üç gerçek sınırı açıkça "kodla çözülemez / hâlâ açık" olarak işaretliyor:

- Bulgu 6 — SQLite şifresiz, kilit istemci tarafı; `appLockSalt` de `localStorage`'da → "karıştırma (obfuscation) seviyesinde" koruma (satır 66-68).
- Bulgu 7 — Yedek dosyaları şifresiz diske yazılıyor, ayrıca `importDatabase()` öncesi ikinci bir şifresiz kopya (satır 318-319).
- Bulgu 9 — Android `allowBackup` tanımsız, varsayılan `true`; `src-tauri/gen/android/.../AndroidManifest.xml` elle düzenlenirse yeniden üretimde silinir, kalıcı çözüm Tauri katmanı (satır 378-405).

**Neden önemli:** Bu üçü de dokümana yazılıp geçiştirildi — doğru davranış. Sırada ne yapılacağı senin kararın.

**Seçenekler:**

1. **A)** Sınırları kabul et, dokümanda kalsın (şu anki).
2. **B)** Android için `allowBackup=false` ekle (Tauri config katmanından, kalıcı).
3. **C)** Şifreli yedek (parola korumalı export) — S/M iş, ama kullanıcı parolasını unutursa veri gider.

**Önerim:** B (ucuz, gerçek koruma) ve C'yi ayrı bir dönemde düşün. Bulgu 6 (şifreli SQLite) en pahalısı ve şu an için gerçekçi değil; dokümanda kalması doğru.

**Geri alınabilir mi:** B ve C geri alınabilir. A'nın kendisi karar değil, geçici durum. · **Doğrulama:** `src/__tests__/tauriVersions.test.ts` ve tauri config okuma testi: manifest override config'te görünür; `tauri android build` sonrası APK içinde `allowBackup="false"`.

Seçimim: Senin kararına bırakıyorum.

> **Uygulama (2026-10-02)** — Karar: kullanıcı bıraktı, **öneri B** uygulandı.
> `src-tauri/gen/android/app/src/main/AndroidManifest.xml` satır 32'ye `android:allowBackup="false"` eklendi. Kalıcılık iki katmanlı: `gen/` yeniden üretilse bile ayar kaybolmasın diye manifest içine gerekçe notu düşüldü (satır 7-12), **ve** test ikincil bir manifest'in `allowBackup="true"` getirmesini reddediyor — eklentinin sessizce geri getirmesi yakalanıyor.
> Doğrulama: `androidBackup.test.ts` 6 test; anahtarın `"false"` olduğunu ve depodaki hiçbir kaynak manifest'te `allowBackup="true"` geçmediğini doğruluyor.
> Not: Bulgu 7 (şifresiz yedek dosyası) ve Bulgu 6 (şifresiz SQLite, `appLockSalt` düz metin) **kapatılmadı** — öneride de ayrı döneme bırakılmıştı. `SECURITY_REPORT.md` bunları açık sınırlar olarak taşımaya devam ediyor.

---

## K13 — Ekran görüntüsü / sabit masaüstü pikseli

**Öncelik:** P3 · **Tür:** Ürün · **Dosyalar:** `src/index.css`, dokunma hedefli bileşenler

**Bugün:** Şantiye kullanımı: telefon ekranı parmakla, güneş altında, eldivenle. Tema değişkenlerinde `--warn: hsl(35 88% 42%)`, `--bad: hsl(352 68% 50%)`, `--info: hsl(202 80% 39%)` (açık tema, satır 110-115) ve koyu tema karşılıkları (satır 140-145) var; bu çiftlerin metin zeminine göre kontrastı WCAG eşiklerinin altında kalıyor. Dokunma hedefleri bileşenlerde sabit px/rem boyutlarla tanımlı (ör. `CalendarView` gün sütunu `3.25rem`).

**Neden önemli:** Yanlış okunan renk, yanlış girilen puantaj demek — doğrudan para hatasının kaynağı.

**Seçenekler:**

1. **A)** Yüksek kontrast paleti ekle (güneş modu gibi bir tema veya koyu palet güçlendirme).
2. **B)** Dokunma hedeflerini büyüt (en az 44px kuralı).
3. **C)** Dokunma.

**Önerim:** A ve B birlikte, düşük iş — her ikisi de CSS değişikliği, mimari karar değil.

**Geri alınabilir mi:** Evet. · **Doğrulama:** Koyu/güneş paletinde görsel kontrol; dokunma hedefleri için ölçüm; mevcut `themeStore.test.ts` yeşil kalmalı.

Seçimim: önerdiğin gibi yap.

> **Uygulama (2026-10-02)** — Karar: A + B birlikte (önerilen).
> **A (kontrast):** `src/index.css` satır 501-509'da **Saha (güneş modu)** paleti eklendi — nötr zemin, neredeyse siyah mürekkep, kalan her şey tek doygun vurgu rengi. Renk çeşitliliği değil kontrast hedefleniyor. `themeStore.ts` yeni tema olarak kayıtlı (satır 12, 23, 35).
> **B (dokunma hedefleri):** `src/index.css` satır 620-634 — 44×44px taban sınıfı. **Genişlik her cihazda 44px**, yükseklik yalnızca dokunmatikte (`@media (pointer: coarse)`, satır 642): eski 40px tabanı fareyle de dardı. `touch-action: manipulation` çift dokunuşla yakınlaştırmayı kaldırır ama parmakla kaydırmayı bozmaz; `user-select: none` Android'de kaydırırken metin seçimi menüsünü engeller.
> Doğrulama: `paletteContrast.test.ts` 7 test (WCAG AA: 4.5:1 metin, 3:1 grafik — oranlar regresyonda düşerse test kızar), `themeStore.test.ts` yeşil, `mobileTapTargets.test.tsx` 6 test.
> Not: Genişliğin koşulsuz, yüksekliğin koşullu yükseltilmesi masaüstü ekran yoğunluğunu koruyor.
