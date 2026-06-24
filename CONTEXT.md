# İş Takip — Context

## Domain

Bir inşaat/üretim sahasında çalışan personelin günlük devam durumunu, üretim miktarını ve ödemelerini takip eden masaüstü uygulaması.

### Ubiquitous Language

| Terim                             | Anlamı                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Personel / Çalışan (Worker)**   | Sahada çalışan kişi. İki türü vardır: `ORTAK` ve `GUNLUK`.                                                                                                        |
| **Ortak (ORTAK)**                 | Günlük sabit ücret yerine, günlük net kârdan (toplam kazanç - giderler - günlükçü ücretleri) pay alan çalışan. Kâr havuzu ortakların ağırlıklı varlığına bölünür. |
| **Günlükçü / Yevmiyeli (GUNLUK)** | Sabit günlük ücretle (daily_wage) çalışan personel. Tam gün = 1x yevmiye, yarım gün = 0.5x yevmiye.                                                               |
| **Yevmiye (Daily Wage)**          | Günlükçü bir çalışanın bir tam gün için aldığı sabit ücret.                                                                                                       |
| **Devam Durumu (Attendance)**     | Bir çalışanın belirli bir tarihteki çalışma durumu: `FULL` (tam gün), `HALF` (yarım gün), `ABSENT` (gelmedi), `HOLIDAY` (tatil/resmî tatil).                      |
| **Günlük Metrik (Daily Metric)**  | Bir iş gününe ait üretim palet sayısı (production_amount), toplam kazanç (total_earned) ve ek giderler (extra_expenses).                                          |
| **Palet**                         | Üretim miktarını ölçen birim.                                                                                                                                     |
| **Avans / Ödeme (Payment)**       | Çalışana yapılan nakdi ödeme. Kesinleşmiş kazançtan düşülerek bakiye hesaplanır.                                                                                  |
| **Bakiye (Balance)**              | Çalışanın toplam kazancından yapılan ödemeler düşüldükten sonra kalan net tutar.                                                                                  |
| **Denetim Günlüğü (Audit Log)**   | Tüm INSERT/UPDATE/DELETE işlemlerinin otomatik kaydı. SQLite trigger'ları ile tutulur. Geri alma (revert) desteği vardır.                                         |
| **Soft Delete**                   | Çalışanlar veritabanından silinmez, `is_active = 0` yapılarak pasifleştirilir.                                                                                    |

### İş Kuralları

- **Ortak kazanç hesabı**: Günlük net kazanç = `total_earned - extra_expenses - (günlükçü toplam yevmiye)`. Kalan "havuz" ortaklar arasında varlık ağırlığına (FULL=1, HALF=0.5) bölünür.
- **Günlükçü kazanç hesabı**: `daily_wage × weight` (FULL=1, HALF=0.5).
- **Tatil günlerinde (HOLIDAY)** üretim ve kazanç hesaplaması yapılmaz.
- **Optimistic UI**: Veritabanı işlemi başarısız olsa bile kullanıcı arayüzü anında güncellenir, hata toast ile bildirilir.

## Mimari

### Stack

| Katman         | Teknoloji                                                       |
| -------------- | --------------------------------------------------------------- |
| Desktop Shell  | Tauri v2 (Rust)                                                 |
| Frontend       | React 19 + TypeScript                                           |
| Styling        | Tailwind CSS v4 + `tailwind-merge` + `class-variance-authority` |
| State          | Zustand v5 (store'lar)                                          |
| DB             | SQLite (`@tauri-apps/plugin-sql`)                               |
| Grafik         | Recharts                                                        |
| PDF            | jsPDF + jspdf-autotable                                         |
| Tarih          | date-fns (locale: tr)                                           |
| İkon           | Lucide React                                                    |
| UI Bileşenleri | Radix UI (Dialog, Sheet, Label, Slot)                           |

### Dizin Yapısı

```
src/
├── __tests__/          # Vitest test dosyaları
├── components/         # React bileşenleri
│   ├── ui/             # Radix + CVA ile oluşturulmuş atomik UI bileşenleri
│   ├── CalendarView.tsx
│   ├── DayDetailSheet.tsx
│   ├── WorkerDetailView.tsx
│   ├── AuditLogView.tsx
│   ├── SettingsView.tsx
│   ├── AppLockOverlay.tsx
│   ├── SpinWheelDialog.tsx
│   └── ToastContainer.tsx
├── lib/                # Veritabanı, Tauri API, yardımcı fonksiyonlar
│   ├── db.ts           # SQLite bağlantısı, fetchQuery/executeQuery
│   ├── tauri.ts        # Tauri API wrapper'ları
│   ├── backup.ts       # JSON yedekleme/geri yükleme
│   └── utils.ts        # Genel yardımcılar
├── stores/             # Zustand store'ları
│   ├── attendanceStore.ts
│   ├── auditLogStore.ts
│   ├── metricsStore.ts
│   ├── paymentStore.ts
│   ├── toastStore.ts
│   └── workerStore.ts
├── types/              # TypeScript tip tanımları
│   └── index.ts
├── utils/              # Hesaplama mantığı
│   └── calculations.ts
└── App.tsx
```

### Veritabanı Tabloları

| Tablo           | Açıklama                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `workers`       | Çalışanlar (id, name, daily_wage, worker_type, is_active, created_at)                            |
| `attendance`    | Günlük devam durumu (id, worker_id, date, status: FULL/HALF/ABSENT/HOLIDAY)                      |
| `daily_metrics` | Günlük üretim metrikleri (id, date, production_amount, total_earned, extra_expenses, is_holiday) |
| `payments`      | Ödemeler (id, worker_id, amount, date, description)                                              |
| `audit_logs`    | Denetim kayıtları (id, action_type, entity_table, record_id, old_data, new_data, created_at)     |

### Repository Katmanı

Her veritabanı işlemi bir repository üzerinden yapılır:

| Repository             | Sorumluluk                      |
| ---------------------- | ------------------------------- |
| `workerRepository`     | Çalışan CRUD                    |
| `attendanceRepository` | Devam durumu sorguları          |
| `metricsRepository`    | Günlük metrik CRUD              |
| `paymentRepository`    | Ödeme CRUD                      |
| `auditLogRepository`   | Denetim kaydı sorguları + silme |

Store'lar repository'leri çağırır, repository'ler `fetchQuery`/`executeQuery` üzerinden DB'ye erişir.

### State Yönetimi

Her domain entity'si için ayrı bir Zustand store'u var. Store'lar state + repository çağrılarını yönetir:

- `workerStore` — çalışan CRUD
- `attendanceStore` — devam durumu yönetimi
- `metricsStore` — günlük üretim metrikleri
- `paymentStore` — ödeme kaydı
- `auditLogStore` — denetim kaydı görüntüleme + geri alma
- `toastStore` — bildirim mesajları

### Key Patterns

1. **Store + Repository birlikteliği**: Store metotları state'i günceller, repository'ler üzerinden SQLite sorgularını çalıştırır.
2. **Optimistic UI**: Veritabanı cevabı beklemeden önce state güncellenir, hata durumunda toast gösterilir.
3. **Audit Logging (JS-managed triggers)**: Tüm INSERT/UPDATE/DELETE işlemleri SQLite trigger'ları ile otomatik kaydedilir. Trigger'lar JS tarafında (`src/schema/triggers.ts`) tanımlıdır ve her boot'ta yeniden oluşturulur. Detay: [ADR 0003](docs/adr/0003-tetikleyici-yonetimi.md).
4. **Soft Delete**: Çalışanlar `is_active = 0` ile pasifleştirilir, veri bütünlüğü korunur.
5. **Single-context veritabanı**: Tüm veri tek bir SQLite dosyasında (`is_takip_v3.db`), WAL modu aktif.
