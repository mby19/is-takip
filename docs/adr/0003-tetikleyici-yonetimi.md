# ADR-0003: Tetikleyici (Trigger) Yönetimi

**Tarih:** 2026-06-24
**Statü:** Kabul Edildi — kısmen aşıldı (bkz. Güncelleme, 2026-10-01)

## Bağlam

Projede denetim günlüğü (audit log) tetikleyicileri iki farklı yerde tanımlanmıştı:

1. **Rust migration'ları** (`src-tauri/src/db.rs`): Her migration versiyonunda trigger'lar eklenip değiştiriliyordu (v1–v9 arası).
2. **JS şeması** (`src/schema/triggers.ts`): Tüm trigger'ların son hali burada tutuluyor, `db.ts` boot sırasında hepsini drop edip yeniden oluşturuyordu.

Bu ikili yapı şu sorunlara yol açıyordu:

- Rust migration'larındaki trigger SQL'leri **dead code** halindeydi — JS tarafı boot'ta hepsini sildiği için hiçbir zaman kullanılmıyorlardı.
- İki yer arasında tutarsızlık riski vardı.
- Her yeni trigger değişikliği için yeni bir Rust migration'ı yazmak gerekiyordu.

## Karar

**Tetikleyiciler tek bir yerden yönetilecek: JavaScript tarafı (`src/schema/triggers.ts`).**

### Gerekçe

1. **JS tarafı daha esnek**: Trigger'lar uygulama mantığına sıkı sıkıya bağlı. JS'de değiştirmek, Rust derlemesi gerektirmez.
2. **Boot-time doğrulama**: `db.ts` trigger'ların en güncel halinin kurulu olmasını garanti eder.
3. **Migration karmaşasını önler**: Her trigger değişikliği için migration yazmak yerine, tek bir JS dosyası güncellenir.

### Rust Migration'larının Yeni Rolü

Rust migration'ları (`src-tauri/src/db.rs`) bundan sonra **sadece** şunları yönetir:

- Tablo şemaları (`CREATE TABLE`)
- Index'ler (`CREATE INDEX`)
- CHECK constraint değişiklikleri

Trigger ekleme/değiştirme amaçlı yeni migration **eklenmeyecektir**. Mevcut migration'lardaki trigger SQL'leri (v1–v9) geriye dönük uyumluluk için olduğu gibi bırakılmıştır — çalışan bir DB'de etkisizdirler çünkü JS tarafı boot'ta hepsini temizler.

## Sonuçlar

- Yeni trigger eklemek için: sadece `src/schema/triggers.ts` güncellenir (+ `DROP_TRIGGERS` dizisi).
- `src-tauri/src/db.rs` sadece tablo ve index değişiklikleri için migration alır.
- DB şema değişiklikleri (yeni sütun, constraint güncellemesi vb.) halen Rust migration'ı gerektirir.

## İlgili Dosyalar

- `src/schema/triggers.ts` — Tüm trigger'ların kaynağı
- `src/lib/db.ts` — Boot'ta trigger'ları drop/create eden kod
- `src-tauri/src/db.rs` — Tablo şeması ve index migration'ları

## Güncelleme (2026-09-11) — ADR-0004

Boot davranışı değişti: trigger'lar artık **her açılışta değil**, yalnızca tanım
sürümü (`TRIGGER_SCHEMA_VERSION`, `PRAGMA user_version` içinde saklanır)
değiştiğinde yeniden kurulur ve kurulum tek bir transaction'da yapılır.

Sebep: her açılışta DROP + CREATE yapmak, uygulama bu iki adım arasında
kapanırsa veritabanını **denetim kaydı olmadan** bırakıyordu ve hata
`catch {}` ile yutulduğu için kullanıcı bunu hiç fark etmiyordu. Artık hata
yutulmaz; `getTriggerSetupError()` ile Ayarlar ekranında görünür uyarı çıkar.

Trigger içerikleri de pipe-delimited metinden `json_object()` JSON'a geçti —
gerekçe ve geriye dönük uyumluluk için bkz. ADR-0004.

---

## Güncelleme (2026-10-01) — Şema onarım katmanının eklenmesi

ADR'lar değiştirilmez; yalnızca not düşülür.

- **"Rust migration'ları sadece tablo şeması, index'ler ve CHECK
  constraint'lerini yönetir"** ifadesi artım tek başına doğru değildir.
  **`src/lib/schemaGuard.ts`** adlı bir JS onarım katmanı açılışta
  çalışır ve eksik şema parçalarını tamamlar.

  Gerekçe: Rust migration'ları bazı cihazlarda uygulanmamış olabiliyor
  (yarıda kalan bir migration, sonrakilerin tamamını durdurur). Belirti
  kullanıcıya "no such table" gibi anlaşılmaz hatalar olarak yansıyordu.
  Her kontrol **idempotent**'tir ve tek tek çalışır; biri başarısız olursa
  diğerleri denenmeye devam eder, sonuç `getSchemaReport()` ile Ayarlar
  ekranında gösterilir.

  Dikkat: `ALTER TABLE … RENAME TO` veritabanındaki tüm tetikleyicileri
  yeniden ayrıştırdığı için tablo yeniden kurulumu **önce tüm
  tetikleyicileri düşürür** ve tek transaction içinde çalışır.

- **Denetim kapsamı genişledi:** 15 trigger (`TRIGGER_SCHEMA_VERSION = 3`).
  `worker_rate_history` de kapsama girdi. Bkz. [ADR-0002](0002-ikili-denetim-sistemi.md).

ADR'in kararı — **tetikleyiciler tek kaynaktan, `src/schema/triggers.ts`
dosyasından yönetilir** — geçerlidir ve aşılmayan çekirdektir. `schemaGuard`
katmanı aynı gerekçeyi (JS tarafı daha esnek, boot'ta doğrulanır) tablo ve
index tarafına taşır; tetikleyicilerin tek kaynağı olma ilkesini bozmaz.
