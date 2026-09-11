# ADR-0004: Atomik Yazma ve Yedek Sürüm Uyumluluğu

**Tarih:** 2026-09-11
**Statü:** Kabul Edildi

## Bağlam

Uygulama sahada kullanımda ve tek veri kaynağı cihazdaki SQLite dosyası. Denetim
sırasında üç ciddi sorun çıktı:

1. `importDatabase` beş tabloyu siliyor, sonra satırları tek tek `INSERT`
   ediyordu. Hiçbiri transaction içinde değildi; araya giren tek bir hata
   veritabanını boş bırakıyordu.
2. Yedek dosyasına `version: 1` yazılıyor ama içeri alırken hiç okunmuyordu.
   Daha yeni bir sürümden gelen bir yedek, tablolar silindikten sonra
   yüklenemeyip toplam veri kaybına yol açabiliyordu.
3. `@tauri-apps/plugin-sql` altta bir bağlantı havuzu (pool) kullanıyor.
   Ayrı `execute` çağrıları farklı bağlantılara düşebildiği için `BEGIN` ve
   `COMMIT`'i ayrı ayrı göndermek güvenilir bir transaction sağlamıyor.

## Karar

### 1. Çok adımlı yazmalar tek `execute` çağrısında gönderilir

`executeTransaction(statements)` ifadeleri `BEGIN IMMEDIATE … COMMIT` arasına
alıp **tek bir metin** olarak gönderir. Tek çağrı tek bağlantıda çalışır,
dolayısıyla transaction gerçekten atomiktir.

Tek metin gönderildiği için bağlama parametresi (`?`) kullanılamaz; değerler
`sqlLiteral()` ile gömülür. SQLite metin literallerinde ters bölü kaçışı
olmadığından tek tırnağı ikiye katlamak eksiksiz bir kaçıştır (`src/lib/sql.ts`,
testleri `src/__tests__/sql.test.ts`).

### 2. Yazma ifadeleri `OR ROLLBACK` ile üretilir

SQLite'ta bir kısıt ihlali **varsayılan olarak yalnızca o ifadeyi** geri alır;
transaction açık kalır ve sonraki `COMMIT` önceki ifadeleri kalıcı yapar. Bu
davranış gerçek SQLite üzerinde doğrulandı. Bu yüzden üretilen ifadeler
`INSERT OR ROLLBACK` / `UPDATE OR ROLLBACK` biçimindedir — herhangi bir ihlal
tüm transaction'ı geri alır.

### 3. Geri yükleme sırası: doğrula → otomatik yedek al → tek transaction

1. `validateBackup()` her satırı doğrular (tip, enum, sonlu sayı). Bu adımda
   veritabanına **hiçbir şey yazılmaz**; hata çıkarsa mevcut veri el değmemiş kalır.
2. `createSafetyBackup()` mevcut veritabanını `is_takip_otomatik_yedek_*.json`
   olarak İndirilenler klasörüne yazar.
3. Silme + yazma işlemlerinin tamamı tek transaction'da uygulanır.

### 4. Yedek biçimi sürümlenir ve yalnızca eklenerek büyür

`BACKUP_FORMAT_VERSION = 2`. İçe alırken sürüm desteklenenden büyükse dosya
**hiçbir şey silinmeden** reddedilir ve kullanıcıya güncelleme mesajı gösterilir.
`version` alanı yoksa 1 varsayılır.

**Değişmez kural:** Mevcut alan adları asla değiştirilmez veya kaldırılmaz,
yalnızca yeni alan eklenir. Eski sürümler bilmedikleri alanları yok sayar, böylece
yeni yedekleri okumaya devam edebilirler.

### 5. Denetim kaydı JSON formatına geçti

Tetikleyiciler `json_object()` kullanır. Eski pipe-delimited (`anahtar=değer|…`)
kayıtlar **dönüştürülmez**; `parseLogData` her iki formatı da okur. Sebep: çalışan
adında `|`, `=`, `:` veya `,` geçtiğinde eski format ayrıştırmayı ve dolayısıyla
"Geri Al" işlemini bozuyordu.

### 6. Geri alınan kayıt silinmez, işaretlenir

`audit_logs.reverted_at` sütunu eklendi (`DEFAULT NULL` — eski sürümler etkilenmez).
Geri alma işleminin kendisi `action_type = 'REVERT'` olarak ayrıca kaydedilir.

## Sonuçlar

- Geri yükleme artık ya tamamen uygulanır ya hiç uygulanmaz.
- Kaydetme hataları yutulmaz: store'lar hatayı yukarı fırlatır, iyimser
  güncellemeyi geri alır ve gün detayı penceresi kapanmaz.
- `DayDetailSheet` artık önce günün finansal verisini, sonra puantajı yazar.
  Böylece `daily_metrics` tetikleyicisinin aldığı `old_data.atts` anlık görüntüsü
  gerçekten değişiklik ÖNCESİ durumu gösterir — geri alma doğru duruma döner.
- Denetim kaydı kurulamazsa hata yutulmaz; Ayarlar ekranında görünür uyarı çıkar.

## İlgili Dosyalar

- `src/lib/sql.ts` — literal kaçışı ve transaction betiği
- `src/lib/db.ts` — `executeTransaction`, sürümlü tetikleyici kurulumu
- `src/lib/backup.ts` — doğrulama, sürüm kontrolü, otomatik yedek
- `src/stores/revertStrategies.ts` — geri alma ifadelerini üretir (yazmaz)
- `src-tauri/src/db.rs` — migration 11
