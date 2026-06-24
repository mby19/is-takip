# ADR-0002: İkili Denetim Sistemi (Dual-Safety Audit)

**Tarih:** 2026-06-21
**Durum:** Kabul Edildi

## Bağlam

Uygulamada yapılan tüm değişikliklerin (ekleme, güncelleme, silme) kayıt altına alınması ve gerektiğinde geri alınabilmesi (revert) gerekiyor.

Alternatifler:

- **Sadece uygulama seviyesinde log**: Trigger yok, her CRUD işlemi store'dan audit log yazar. Daha esnek ama atlanabilir.
- **Sadece SQLite trigger**: DB seviyesinde zorunlu log, uygulama kodu ile uğraşmaz. Karmaşık geri alma mantığı zor.
- **İkili sistem (seçilen)**: SQLite trigger'ları otomatik log tutar, uygulama kodu ise geri alma mantığını yönetir.

## Karar

**Hem SQLite trigger'ları hem de uygulama kodu ile çift katmanlı denetim sistemi kullanılacak.**

- **Trigger katmanı**: `payments` tablosu için INSERT/UPDATE/DELETE trigger'ları otomatik olarak `audit_logs` tablosuna kayıt ekler. Veri, pipe-delimited key=value formatında (`worker_id=5|amount=1500`) tutulur.
- **Uygulama katmanı**: Audit log görüntüleme, format çözümleme (JSON/pipe/plain text) ve geri alma işlemleri `auditLogStore` içinde yönetilir.
- Trigger'lar `db.ts` içinde dinamik olarak oluşturulur (uygulama başlangıcında).

## Gerekçe

- **Veri bütünlüğü**: Trigger'lar uygulama dışı müdahalelerde bile log tutar.
- **Geri alma esnekliği**: Karmaşık revert mantığı (snapshot geri yükleme, ilişkili kayıtları temizleme) TypeScript'te yönetilir.
- **Format uyumluluğu**: Eski JSON formatındaki loglar da `parseLogData()` ile desteklenir.

## Sonuçları

- Trigger'lar sadece `payments` tablosu için aktiftir; diğer tabloların audit kaydı uygulama kodu ile yapılır.
- Pipe-delimited format insan tarafından okunabilir ama yapısal sorgulama zordur.
- Geri alma işlemi başarılı olursa audit log kaydı silinir (temiz revert).
