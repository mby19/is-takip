# Refactor Plan: Repository Katmanı

**Status:** ready-for-agent
**Tarih:** 2026-06-21

## Problem Statement

Store'lar (Zustand) iki sorumluluğu birleştiriyor: React state yönetimi ve SQLite CRUD işlemleri. Bu birleşim şu sorunlara yol açıyor:

1. **Test edilebilirlik**: Bir store'u test etmek için DB katmanının tamamını mock'lamak gerekiyor. `fetchQuery` ve `executeQuery` fonksiyonları global olarak mock'lanıyor, bu da testlerin kırılgan olmasına neden oluyor.
2. **Dağınık SQL sorguları**: Ham SQL string'leri 4 farklı store'a yayılmış durumda. Şema değişikliklerinde 4 ayrı dosyada değişiklik yapmak gerekiyor.
3. **Tutarsız hata yönetimi**: `attendanceStore` ve `metricsStore` hataları toast ile gösterirken, `paymentStore` ve `workerStore` sadece error state set ediyor.
4. **Sorumluluk ihlali**: Bir Zustand store'unun amacı state yönetimidir, SQL sorgusu çalıştırmak değil.

## Solution

Repository pattern uygulanacak. Her entity için ayrı bir repository modülü oluşturulacak. Store'lar sadece state yönetiminden sorumlu olacak, DB işlemleri için repository'i çağıracak.

### Yeni dosya yapısı

```
src/
├── repositories/
│   ├── workerRepository.ts
│   ├── attendanceRepository.ts
│   ├── metricsRepository.ts
│   ├── paymentRepository.ts
│   └── index.ts
├── stores/
│   ├── workerStore.ts        (sadece state yönetimi)
│   ├── attendanceStore.ts    (sadece state yönetimi)
│   ├── metricsStore.ts       (sadece state yönetimi)
│   ├── paymentStore.ts       (sadece state yönetimi)
│   ├── auditLogStore.ts      (değişmeyecek)
│   └── toastStore.ts         (değişmeyecek)
```

### Repository interface

Her repository şu ortak yapıyı kullanacak:

```typescript
// workerRepository.ts
import { fetchQuery, executeQuery } from "../lib/db";
import type { Worker } from "../types";

export const workerRepository = {
  findAll: (): Promise<Worker[]> =>
    fetchQuery<Worker>("SELECT * FROM workers ORDER BY is_active DESC, name ASC"),

  findById: (id: number): Promise<Worker[]> =>
    fetchQuery<Worker>("SELECT * FROM workers WHERE id = ?", [id]),

  create: (name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK"): Promise<DbResult> =>
    executeQuery(
      "INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES (?, ?, ?, 1)",
      [name, daily_wage, worker_type],
    ),

  update: (
    id: number,
    name: string,
    daily_wage: number,
    worker_type: "ORTAK" | "GUNLUK",
  ): Promise<DbResult> =>
    executeQuery("UPDATE workers SET name = ?, daily_wage = ?, worker_type = ? WHERE id = ?", [
      name,
      daily_wage,
      worker_type,
      id,
    ]),

  updateStatus: (id: number, is_active: boolean): Promise<DbResult> =>
    executeQuery("UPDATE workers SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, id]),
};
```

### Store değişimi (öncesi/sonrası)

**Öncesi** (workerStore.ts):

```typescript
addWorker: async (name, daily_wage, worker_type) => {
  set({ isLoading: true, error: null });
  try {
    const result = await executeQuery(
      "INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES (?, ?, ?, 1)",
      [name, daily_wage, worker_type],
    );
    await get().fetchWorkers();
    set({ isLoading: false });
  } catch (error: any) {
    set({ error: error.message, isLoading: false });
  }
};
```

**Sonrası** (workerStore.ts):

```typescript
addWorker: async (name, daily_wage, worker_type) => {
  set({ isLoading: true, error: null });
  try {
    await workerRepository.create(name, daily_wage, worker_type);
    const workers = await workerRepository.findAll();
    set({ workers, isLoading: false });
  } catch (error: any) {
    set({ error: error.message, isLoading: false });
  }
};
```

## Commits

Her commit sonrası `tsc --noEmit` ve `vitest run` çalışmalı.

### Commit 1: Repository altyapısı ve WorkerRepository

- `src/repositories/index.ts` oluştur (export'lar)
- `src/repositories/workerRepository.ts` oluştur
- `src/stores/workerStore.ts`'u repository'i kullanacak şekilde güncelle
- Testleri güncelle (fetchQuery mock → repository mock)
- `tsc --noEmit` ✅, `vitest run` ✅

### Commit 2: AttendanceRepository

- `src/repositories/attendanceRepository.ts` oluştur
- `src/stores/attendanceStore.ts`'u güncelle
- Testleri güncelle
- `tsc --noEmit` ✅, `vitest run` ✅

### Commit 3: MetricsRepository

- `src/repositories/metricsRepository.ts` oluştur
- `src/stores/metricsStore.ts`'u güncelle (hata yönetimini workerStore ile tutarlı yap)
- Testleri güncelle
- `tsc --noEmit` ✅, `vitest run` ✅

### Commit 4: PaymentRepository

- `src/repositories/paymentRepository.ts` oluştur
- `src/stores/paymentStore.ts`'u güncelle
- Testleri güncelle
- `tsc --noEmit` ✅, `vitest run` ✅

### Commit 5: ADR-0001 güncelle ve cleanup

- `docs/adr/0001-store-ve-db-mimarisi.md`'yi güncelle (repository katmanını yansıt)
- Store'lardan gereksiz `executeQuery`/`fetchQuery` import'larını temizle
- Son `tsc --noEmit` ✅, `vitest run` ✅

## Decision Document

- **Repository'ler sadece veri erişiminden sorumlu**, iş mantığı içermeyecek
- **Store'lar sadece state yönetimi + repository çağrısı** yapacak
- **optimistic UI mantığı store'da kalacak** (attendanceStore.markAttendance önce state günceller, sonra repository çağırır)
- **Hata yönetimi store'da kalacak**, tüm store'lar tutarlı olarak toast + error state kullanacak
- **Repository'ler fonksiyon nesnesi (object literal) olacak**, sınıf değil (Zustand felsefesine uyum)
- **AuditLogStore ve ToastStore değişmeyecek** — auditLogStore'un revert mantığı başka bir refactor'un konusu

## Testing Decisions

- **Repository'lerin kendisi test edilmeyecek** (entegrasyon testi DB gerektirir, mevcut mimaride mock'lanmış fetchQuery üzerinden çalışıyor)
- **Store testleri repository'i mock'layacak** — store.addWorker çağırınca workerRepository.create'in çağrıldığı doğrulanacak
- **Component testleri store'u mock'layacak** (mevcut yaklaşım aynen devam)
- Mevcut testlerde kullanılan mock yaklaşımı (fetchQuery/executeQuery mock) repository mock'una dönüştürülecek

## Out of Scope

- AuditLogStore'un revert mantığını değiştirmek (issue #02 kapsamı)
- Custom hook'lar eklemek (issue #04 kapsamı)
- EarningsCalculator oluşturmak (issue #01 kapsamı)
- SQL trigger'larını taşımak (issue #05 kapsamı)
- Veritabanı şemasını değiştirmek

## Further Notes

Repository katmanı, diğer tüm mimari iyileştirmelerin ön koşulu. EarningsCalculator (issue #01), repository'ler üzerinden veri çekecek. Revert Strategy (issue #02), repository interface'ine göre yazılacak. Custom Hooks (issue #04), repository'leri tüketecek. Bu yüzden bu refactor en önce yapılmalı.
