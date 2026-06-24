# 06 — Profesyonel Uygulama İçin Mimari Değerlendirme

**Status:** needs-triage
**Priority:** medium
**Related:** (tüm proje)

---

## Mevcut Durum

Proje mevcut haliyle çalışıyor ve temel işlevleri yerine getiriyor. Aşağıdaki değerlendirme, profesyonel bir uygulama seviyesine çıkmak için eksik olan yapıları, servisleri ve mekanizmaları sıralar.

---

## 1. 🔴 Form Validasyonu (Eksik)

**Şu an:** `AddWorkerDialog`, `DayDetailSheet` (production, earned, expenses inputları) ve `SettingsView`'de hiçbir validasyon yok. Kullanıcı boş string, negatif sayı, NaN girebilir.

**Yapılması gereken:**

- `zod` veya benzeri bir schema validation kütüphanesi eklenmeli
- Tüm sayısal input'lar için `min`, `max`, `required` kontrolleri
- Kullanıcıya anlık hata mesajları (toast yerine input altında)
- `DayDetailSheet`'te `production`, `totalEarned`, `extraExpenses` alanları `Number()` ile zorlanıyor ama validasyon yok

**Dosyalar:** `src/components/DayDetailSheet.tsx` (49-52), `src/App.tsx` (AddWorkerDialog), `src/components/SettingsView.tsx`

---

## 2. 🔴 Repository Pattern Tutarsızlığı (Eksik)

**Şu an:** Bazı store'lar repository kullanıyor (`attendanceRepository`, `metricsRepository`), bazıları doğrudan `fetchQuery`/`executeQuery` çağırıyor (`auditLogStore`, `paymentStore`, `workerStore`).

**Yapılması gereken:**

- Tüm DB erişimleri repository katmanına taşınmalı
- Her entity için bir repository: `WorkerRepository`, `PaymentRepository`, `AuditLogRepository`
- Store'lar asla doğrudan SQL sorgusu içermemeli

**Dosyalar:** `src/stores/auditLogStore.ts`, `src/stores/paymentStore.ts`, `src/stores/workerStore.ts`, `src/repositories/`

---

## 3. 🟡 Service Katmanı Eksikliği

**Şu an:** İş mantığı store'ların içinde (`attendanceStore.markAttendance`, `metricsStore.updateMetrics`). Store'lar hem state yönetimi hem de iş mantığı yapıyor.

**Yapılması gereken:**

- `AttendanceService`, `MetricsService`, `PaymentService`, `WorkerService` gibi servis katmanları
- Servisler repository'leri kullanır, store'lar servisleri çağırır
- Store'lar sadece state yönetiminden sorumlu olur

---

## 4. 🟡 Hata Yönetimi / Merkezi Error Handler

**Şu an:** Hatalar ya `console.error` ile loglanıyor, ya `useToastStore` ile toast gösteriliyor, ya da sessizce yutuluyor. Merkezi bir hata yönetimi yok. ErrorBoundary yeni eklendi.

**Yapılması gereken:**

- `ErrorService` — merkezi hata yakalama, loglama, kullanıcıya gösterme
- Window `onerror` + `onunhandledrejection` handler'ları
- Store'lardaki try/catch'ler standartlaştırılmalı

---

## 5. 🟡 Test Altyapısı

**Şu an:** 72 test var (4 file), hepsi saf fonksiyon testi. Hiç entegrasyon testi yok. DB bağımlılığı olan hiçbir kod test edilemiyor.

**Yapılması gereken:**

- Repository'ler için `interface` tanımlanıp mock repository yazılabilir hale getirilmeli
- Store'ların repository bağımlılığı enjekte edilebilir olmalı
- Kritik akışlar için entegrasyon testleri (SQLite in-memory ile)
- Vitest config hazır, `__tests__/` dizini mevcut

---

## 6. 🟢 Bundle Optimizasyonu

**Şu an:** `jspdf` hala bağımlılıklarda (WorkerDetailView PDF export). `recharts` kaldırıldı (önceki oturumda).

**Öneri:** `jspdf` kullanımı sorgulanmalı —替代i olarak native print API veya daha hafif bir kütüphane düşünülebilir.

---

## 7. 🟢 State Yönetimi İyileştirmeleri

**Şu an:** Zustand kullanılıyor, selector'lar düzeltildi. Ancak:

- `useWorkerStore.getState().error` App.tsx'te render içinde çağrılıyor (re-render riski)
- `fetchAttendanceByDate` optimistic update yapıyor ama hata durumunda rollback yok
- `fetchMetricsByDateRange`'de `isLoading` set edilmiyor (sadece `fetchMetricsByDateRange`'de var, `fetchMetricsByDate`'te yok)

**Yapılması gereken:**

- Store'lardaki `isLoading` flag'leri tüm fetch fonksiyonlarında tutarlı olmalı
- Error state render'da `useWorkerStore.getState()` yerine selector ile alınmalı

---

## 8. 🟢 Erişilebilirlik (Accessibility)

**Şu an:** Hiçbir `aria-label`, `role`, keyboard navigation desteği yok. Tüm etkileşimler sadece click/touch ile.

**Yapılması gereken:**

- Tüm butonlara `aria-label` eklenmeli
- Liste öğelerinde `role="listitem"`
- Klavye ile gezinme (Tab, Enter, Arrow keys)
- Dialog'larda focus trap (Radix UI bunu sağlıyor)

---

## 9. 🟢 Build / CI Pipeline

**Şu an:** `npm run lint`, `npm run format` mevcut ama CI/CD yok. `pre-commit` hook'u yok.

**Yapılması gereken:**

- GitHub Actions — push/PR'da `tsc --noEmit` + `vitest run` + `lint`
- `husky` + `lint-staged` ile pre-commit hook
- Tauri build'i otomatikleştirilebilir

---

## 10. 🟢 Logging / Telemetry

**Şu an:** Audit log sistemi var (SQLite trigger-based). Ama uygulama içi hatalar için loglama yok (console.log dışında).

**Yapılması gereken:**

- Structured logging (JSON format, timestamp, severity)
- Dosyaya log yazma (Tauri fs plugin ile)

---

## 11. 🟢 Uluslararasılaştırma (i18n)

**Şu an:** Tüm metinler Türkçe, hardcoded. Çok dilli destek yok.

**Öneri:** Şu an için gerekli değil ama ileride `react-i18next` veya benzeri ile çok dil desteği eklenebilir.

---

## 12. 🟢 Performans

**Şu an:**

- Zustand selector fix yapıldı (önceki oturum)
- `useMemo` kullanılıyor bazı yerlerde
- `CalendarView`'de tüm ay verileri tek seferde yükleniyor

**Potansiyel sorunlar:**

- `CalendarView`'de `attendanceMap` ve `metricsMap` useMemo ile memoize edilmiş — iyi
- `DayDetailSheet`'te `calculations` useMemo'su doğru bağımlılıklara sahip — iyi
- `WorkerDetailView`'de `stats` useMemo'su `currentMonth` değişince yeniden hesaplanıyor — iyi

---

## Öncelik Sıralaması

| #   | Alan                   | Çaba   | Etki   |
| --- | ---------------------- | ------ | ------ |
| 1   | Repository tutarlılığı | Orta   | Yüksek |
| 2   | Form validasyonu       | Az     | Yüksek |
| 3   | Service katmanı        | Orta   | Yüksek |
| 4   | Hata yönetimi          | Az     | Yüksek |
| 5   | CI pipeline            | Az     | Orta   |
| 6   | Erişilebilirlik        | Az     | Düşük  |
| 7   | Bundle optimizasyonu   | Az     | Düşük  |
| 8   | i18n                   | Yüksek | Düşük  |

---

## Hemen Yapılabilecekler (Düşük Çaba)

1. ✅ ErrorBoundary — **tamamlandı** (bu oturumda)
2. ✅ Navigasyon path stack — **tamamlandı** (bu oturumda)
3. Store'lardaki isLoading tutarsızlığı (`fetchMetricsByDate`)
4. `useWorkerStore.getState().error` → selector'a çevirme
5. jspdf alternatifi değerlendirme
6. husky + lint-staged kurulumu
