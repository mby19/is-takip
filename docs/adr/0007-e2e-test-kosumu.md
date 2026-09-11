# ADR-0007: Uçtan Uca Testlerin Gerçek SQLite ile Koşulması

**Tarih:** 2026-09-11
**Statü:** Kabul Edildi

## Bağlam

`e2e/` altında Playwright kurulu ama testler CI'da koşmuyordu ve koşsalar da
geçmeyeceklerdi:

- `webServer.command: "npm run dev"` e2e/ dizininde çalışıyordu; orada `dev`
  scripti yok.
- Beklenen başlık `is-takip`, gerçek başlık `İş Takip`.
- "Çalışanlar" metni aranıyordu; ekranın başlığı "Ekip".
- En önemlisi: tarayıcıda Tauri olmadığı için uygulama veritabanına
  bağlanamıyor ve "Veritabanına Bağlanılamadı" ekranında kalıyordu. Hiçbir
  arayüz testi mümkün değildi.

Yazılmış ama koşmayan test, olmayan testten daha kötüdür — geçtikleri sanılır.

## Karar

**Tauri'nin SQL eklentisi test sırasında taklit edilir, SQL gerçek SQLite'ta
çalışır.**

- Playwright fixture'ı `page.exposeFunction` ile bir köprü kurar ve
  `window.__TAURI_INTERNALS__.invoke` bu köprüye yönlendirilir
  (`e2e/support/tauriMock.ts`).
- Sorgular Node tarafında `node:sqlite` (Node 22.5+ yerleşik) üzerinde
  çalıştırılır. Sahte bir SQL yorumlayıcısı yazmak yerine gerçek motoru
  kullanmak, testlerin gerçekten anlamlı olmasını sağlar.
- Şema tek kaynaktan gelir: migration SQL'i `src-tauri/src/db.rs` dosyasından
  okunur, tetikleyiciler `src/schema/triggers.ts`'den doğrudan import edilir.
  Test şeması böylece gerçek şemadan ayrışamaz.
- Fixture `auto: true`; aksi halde yalnızca `db` parametresini bildiren
  testlerde çalışır ve diğerlerinde köprü hiç kurulmaz.

Fixture kurulum sırası üretimdekiyle aynıdır: migration'lar → `DROP_TRIGGERS`
→ `CREATE_TRIGGERS`. DROP adımı şart: migration v1–v9 eski adlarla trigger
kuruyor ve `CREATE TRIGGER IF NOT EXISTS` onları ezmiyor.

## Sonuçlar

Testler ilk koşumda gerçek bir hata yakaladı: `CalendarView` içindeki veri
yükleme effect'i `monthStart`/`monthEnd` bağımlılıklarına sahipti; bunlar her
render'da yeni `Date` nesnesi olduğu için effect kendini sonsuz döngüye
sokuyor ve takvim yükleme durumundan hiç çıkmıyordu. Düzeltme sonrası test
süresi 42 saniyeden 5,6 saniyeye düştü.

CI'da `e2e` işi eklendi ve derleme işleri ona bağlandı. Node sürümü 20'den
22'ye çıkarıldı (`node:sqlite` için).
