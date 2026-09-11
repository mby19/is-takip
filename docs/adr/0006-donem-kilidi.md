# ADR-0006: Dönem Kilidi

**Tarih:** 2026-09-11
**Statü:** Kabul Edildi

## Bağlam

ADR-0005 ile ücret geçmişi tarih etkili hale geldi, yani bir zam artık geçmiş
ayların hakedişini değiştirmiyor. Ancak geçmişi koruyan başka bir mekanizma
yoktu: ödemesi yapılmış bir aya ait puantaj, ciro veya gider kaydı istendiği
zaman değiştirilebiliyor ve rakamlar sessizce oynuyordu.

Bir puantaj/hakediş uygulamasında "bu ay kapandı" kavramının bulunmaması
eksik bir parçaydı — özellikle ödeme dökümü PDF olarak paylaşıldıktan sonra.

## Karar

**`closed_periods` tablosu eklendi** (migration 12):

```
period TEXT PRIMARY KEY   -- 'YYYY-MM'
closed_at DATETIME
note TEXT
```

Kapalı bir dönemde şunlar engellenir:

- puantaj yazma / silme (`attendanceStore.markAttendance`)
- gün verisi yazma (`metricsStore.updateMetrics`)
- ödeme ekleme ve silme (`paymentStore`)
- ücret değişikliğini o dönemden itibaren geçerli kılma (`workerStore.updateWorker`)
- o döneme ait bir denetim kaydını geri alma (`auditLogStore.revertLog`)

### Kontrol store katmanında

Kilit kontrolü bileşenlerde değil, store'larda yapılır. Store'lar tüm yazma
yollarının tek geçiş noktası olduğu için arayüz — bugünkü veya ileride
eklenecek herhangi bir ekran — kilidi atlayamaz. Bileşenler yalnızca durumu
görsel olarak yansıtır (salt okunur rozet, pasif düğmeler).

Hata tipi `ClosedPeriodError`; mesajı hangi dönemin kapalı olduğunu ve nereden
açılacağını söyler.

### Açma ve kapama denetlenir

Her iki işlem `CLOSE_PERIOD` / `REOPEN_PERIOD` olarak `audit_logs`'a yazılır.
Dönem kilidi geri alınabilir bir karardır: amaç yanlışlıkla değişikliği
engellemek, kullanıcıyı kilitlemek değil.

## Arayüz

İki giriş noktası var, ikisi de aynı store'u kullanır:

- **Ay Sonu ekranı** — ayın özetini görüp oradan kapatmak (doğal akış)
- **Ayarlar → Dönem Kilidi** — geçmiş dönemleri toplu görmek ve yönetmek

## Sonuçlar

- Ödemesi yapılmış ay, açıkça açılmadıkça değişmez.
- Dönem kilitleri yedeğe dahildir; eski yedeklerde bu alan yoksa hiç kapalı
  dönem yokmuş gibi yüklenir (alan ekleme geriye dönük uyumludur, ADR-0004).
- Testler: `src/__tests__/period.test.ts` (birim) ve `e2e/tests/app.spec.ts`
  (uçtan uca: kapat → gün detayı salt okunur).
