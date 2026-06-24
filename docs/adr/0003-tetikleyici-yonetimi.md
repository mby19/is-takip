# ADR 0003: Tetikleyici (Trigger) Yönetimi

## Tarih

2026-06-24

## Statü

Kabul Edildi

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
2. **Boot-time doğrulama**: `db.ts` her açılışta trigger'ları drop edip yeniden oluşturarak her zaman en güncel halinin çalışmasını garanti eder.
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
