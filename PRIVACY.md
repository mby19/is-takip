# Gizlilik Politikası

**Son güncelleme:** 2 Ekim 2026
**Uygulama:** is-takip — İnşaat Sahası Personel Takibi

---

## 1. Veri Sorumlusu

Bu uygulamanın veri sorumlusu, uygulamayı yayımlayan ve dağıtan gerçek ve tüzel kişidir:

> **Veri sorumlusu:** mby19 (GitHub: https://github.com/mby19)
> **Adres:** Türkiye
> **Başvuru kanalı:** Bu depodaki **Issues** bölümü (uygun etiketle yeni bir issue açın)

> Bu bölüm dağıtıcı tarafından doldurulmuştur. Adres alanı ülke düzeyinde tutulmuştur.
> Başvurular GitHub Issues üzerinden alınır; açık adres talep edilirse issue
> içinde belirtilir.

---

## 2. Özet

Bu uygulama **şantiye personelinin devam, yevmiye ve ödeme kayıtlarını** takip etmek için geliştirilmiştir.

Verileriniz **uygulamanın çalıştığı cihazda** saklanır. Uygulama kendi sunucusunu **çalıştırmaz**; geliştirici tarafından işlenen bir veri tabanı veya API bulunmaz.

Ancak aşağıdaki iki durumda verileriniz cihazınızdan çıkabilir:

1. **Hata izleme etkinse** (aşağıdaki bölüm 6) — kişisel veri maskelenmiş hata kayıtları geliştiriciye iletilir.
2. **Siz kendiniz dışa aktarırsanız** — CSV/PDF raporu, işçi listesi dosyası veya yedekleme dosyası cihazınızın indirilenler klasörüne ya da sizin seçtiğiniz bir konuma yazılır. Bu dosyalar düz metindir; şifreli değildir.

Bu iki durum dışında verileriniz cihazınızda kalır.

---

## 3. İşlenen Kişisel Veriler

### 3.1 Toplanan veriler

| Veri              | Açıklama                                                  | Nereden                      |
| ----------------- | --------------------------------------------------------- | ---------------------------- |
| Çalışan adı       | Personelin adı (isteğe bağlı olarak takma ad / kısa ad)   | Kullanıcıdan manuel giriş    |
| Çalışan tipi      | Ortak veya günlük ücretli                                 | Kullanıcıdan manuel giriş    |
| Devam durumu      | Her gün için tam gün / yarım gün / gelmedi / izin         | Kullanıcıdan manuel giriş    |
| Günlük yevmiye    | Günlük ücret tutarı (TL)                                  | Kullanıcıdan manuel giriş    |
| Ücret geçmişi     | Yevmiye değişiklikleri, geçerli olma tarihiyle            | Uygulama (kullanıcı girdisi) |
| Üretim metrikleri | Günlük üretim miktarı/metre kare gibi sayısal alanlar     | Kullanıcıdan manuel giriş    |
| Ödeme kayıtları   | Yapılan ödeme tarihi ve tutarı, dönem kapama kayıtları    | Kullanıcıdan manuel giriş    |
| Denetim günlüğü   | Kim/ne zaman/hangi kaydı değiştirdi, geri alma işaretleri | Uygulama (otomatik)          |

### 3.2 Otomatik toplanan veriler

- **Cihaz bilgisi:** Hata izleme etkinse işletim sistemi sürümü, cihaz modeli, uygulama sürümü ve oturum bilgisi Sentry'ye iletilebilir. Bu veriler kişisel veri niteliği taşımayan teknik kayıtlardır.
- **Bildirim içeriği:** Bildirimlerin gövdesi yalnızca **"Bugünün puantajı henüz girilmedi."** veya **"Günün puantajını girmeyi unutmayın."** metnini içerir. Bildirimde çalışan adı, yevmiye veya ödeme bilgisi **yer almaz**.

### 3.3 Toplanmayan veriler

Uygulama konum, adres defteri, telefon, e-posta, fotoğraf, GPS, reklam kimliği, sosyal medya hesabı veya benzeri veri **toplamaz**. Uygulama reklam SDK'sı içermez.

---

## 4. İşleme Amaçları

Kişisel veriler yalnızca aşağıdaki amaçla işlenir:

- Şantiye personelinin günlük devam durumunun kayıt altına alınması
- Yevmiye ve dönem kazancının hesaplanması
- Yapılan ödemelerin kaydı ve kontrolü
- Ücret değişikliklerinin geriye dönük izlenebilirliği (denetim günlüğü)
- Kullanıcının kendi raporlarını (CSV/PDF) hazırlaması

Bu amaçların dışında hiçbir işleme yapılmaz. Verileriniz profilleme, pazarlama, otomatik karar verme veya yapay zekâ modeli eğitimi için kullanılmaz.

---

## 5. Hukuki Sebep

Kişisel veriler **6698 sayılı KVKK md.5/1-e** ("Sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması") kapsamında işlenir.

Devam, yevmiye ve ödeme kayıtları işveren–çalışan ilişkisinden doğan bir sözleşmenin ifası için zorunludur: uygulama bu kayıtları **işverenin kendi** yasal yükümlülüğünü (ücret hesaplama, çalışanın çalışma süresini belgeleme) yerine getirmesine yardımcı olur.

Açık rıza bu amaçla toplanmaz ve istenmemektedir.

---

## 6. Üçüncü Taraflar

### 6.1 Sentry (hata izleme) — **koşullu**

Uygulama, hata izleme için [Sentry](https://sentry.io) SDK'sını içerir. Bu SDK **yalnızca geliştirme derlemesinde `VITE_SENTRY_DSN` ortam değişkeni tanımlanmışsa etkinleşir.**

| Durum                                                       | Davranış                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DSN **tanımlı değilse** (yayımlanan sürümlerin varsayılanı) | Hata izleme **tamamen kapalıdır**. Hiçbir hata, oturum veya teknik kayıt geliştiriciye gönderilmez. `console` dışında hiçbir ağ isteği yapılmaz.                                           |
| DSN **tanımlıysa**                                          | Hatalar Sentry'ye gönderilir. Gönderimden önce kişisel veri maskeleme katmanı (`maskEvent`) çalıştırılır: hata mesajlarındaki sayısal tutarlar ve kişi adlarına benzer dizeler maskelenir. |

Dağıtım sürümünüzde DSN tanımlı olup olmadığı belirsizse, veri sorumlusuyla iletişime geçin.

### 6.2 Firebase / Google — **kullanılmıyor**

Bu uygulama **Firebase, Google Analytics, Google Cloud Messaging veya reklam SDK'sı içermez.** Bildirimler cihazın yerel bildirim sistemi üzerinden, geliştirici sunucusuna uğramadan gösterilir. Bildirimlere cevap verildiğinde hiçbir ağ isteği yapılmaz.

### 6.3 Uygulama mağazaları

Uygulamanın mağazadan indirilmesi ve güncellenmesi sırasında mağaza sağlayıcısının kendi teknik kayıtları (hesap kimliği, cihaz modeli, indirme zamanı) işlenir. Bu kayıtların işlenmesi Sentry'nin kapsamı dışındadır ve ilgili sağlayıcının kendi gizlilik politikasına tabidir.

---

## 7. Veri Saklama Yeri

Veriler **yalnızca uygulamanın çalıştığı cihazda** saklanır:

- **Veritabanı:** SQLite, dosya adı `is_takip_v3.db`. Uygulamanın kendi veri dizininde tutulur (masaüstü/iOS: uygulama veri klasörü; Android: uygulamanın özel dizini).
- **Uygulama kilidi tuzu:** Tarayıcı/uygulama yerel deposu (`localStorage`), SHA-256 özeti olarak saklanır.
- **Tercihler:** Yerel depoda.

Geliştirici tarafında kalıcı bir veri tabanı, arşiv veya yedekleme sunucusu **bulunmamaktadır**. Hesap oluşturma veya giriş yapma gerektirmez.

---

## 8. Saklama Süreleri

| Veri türü                         | Saklama süresi                                      | Gerekçe                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Denetim günlüğü (`audit_logs`)    | **Kalıcı — uygulama kullanımı sürdüğü sürece**      | Ücret değişikliklerinin ve geri alma işlemlerinin yıllar boyunca izlenebilir olması gerekir. Kullanıcı tarafından kalıcı olarak silinene kadar saklanır. (Bu kayıtlarda **otomatik süre sonu/budama yoktur.**) |
| Puantaj, devam ve ücret kayıtları | **Kalıcı — uygulama kullanımı sürdüğü sürece**      | Hesap kesimi, dönem raporu ve ücret geçmişi yeniden üretilebilmelidir.                                                                                                                                         |
| Ödeme kayıtları                   | **Kalıcı**                                          | Ödeme kanıtı niteliğindedir.                                                                                                                                                                                   |
| Yedekleme dosyaları               | Kullanıcı belirler                                  | Uygulama yedeği indirilenler klasörüne yazar veya sizin seçtiğiniz konuma kaydeder. Süreyi ve silinmesini siz belirlersiniz.                                                                                   |
| Hata izleme kayıtları             | Sentry'nin kendi saklama süresi (varsayılan 90 gün) | Yalnızca DSN tanımlıysa oluşur.                                                                                                                                                                                |

Veriler, uygulamanın veri dizini silinerek veya uygulama cihazdan kaldırılarak kalıcı olarak yok edilir. **Verileri geri getirme garantisi verilemez** — lütfen düzenli olarak yedek alın.

---

## 9. Kullanıcı Hakları (KVKK md.11)

KVKK md.11 uyarınca veri sorumlusuna başvurarak aşağıdaki haklara sahipsiniz:

1. **Aydınlatma hakkı** — işlemenin amaçları, hukuki sebebi ve aktarım yapılan kişiler hakkında bilgi alma
2. **Verilerinize erişme / düzeltilmesini isteme** — uygulamada çalışan kayıtlarını doğrudan düzenleyebilirsiniz
3. **Silme veya anonimleştirme hakkı** — uygulamanın Ayarlar bölümündeki "Tüm Verileri Sil" işlemi
4. **İşlemeye itiraz hakkı**
5. **Düzeltilmiş veya silinmiş verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme**
6. **Verilerinizin aktarıldığı üçüncü kişileri öğrenme**

**Başvuru:** Haklarınızı kullanmak için bu depodaki **Issues** bölümünde yeni bir issue açın. Talebiniz en geç 30 gün içinde sonuçlandırılır ve talebinizi yazılı olarak bildiririz.

**Doğrudan uygulama içi haklar:** Uygulama birçok hakkı size kendi içinde verir — her kaydı görüntüleme/düzenleme/silme, tüm verileri tek işlemle silme. Başvuru yalnızca bu yolların yeterli olmadığı durumlar için gerekir.

**Hakları kullanmanın bedeli yoktur.**

---

## 10. Güvenlik Önlemleri ve **Bunların Sınırları**

Bu bölüm bilerek abartılmadan yazılmıştır. Uygulamanın gerçek güvenlik sınırları şunlardır:

### 10.1 Uygulama kilidi (istemci tarafı — **sınırlı koruma**)

- Ayarlar ekranından bir **4 haneli PIN** veya **ekran grafiği deseni** tanımlanabilir.
- Desen/PIN, rastgele bir tuzla birlikte **SHA-256** özeti olarak yerel depoda saklanır; düz metin olarak saklanmaz.
- Veritabanının kendisi şifrelenmez.

> ⚠️ **Dürüst sınır:** Bu kilit **tamamen cihaz (istemci) tarafında çalışır** ve fiziksel cihaz erişimi olan birini durdurmaz. Saldırgan uygulama dosyalarına veya veritabanı dosyasına erişebiliyorsa PIN/bağlantıyı atlayabilir. Amaç çalışanların veya yanlışlıkla açılan telefonun günlük kullanımda veriye ulaşmasını güçlü biçimde zorlaştırmaktır — **güvenli kasa değildir.** Veri açısından kritik kayıtlar tutuyorsanız cihazı ayrıca işletim sistemi düzeyinde şifreleyin (iOS: Dosya Koruması, Android: ekran kilidi, masaüstü: BitLocker/disk şifreleme).

### 10.2 Veritabanı şifrelemesi

Veritabanı SQLite'tır ve **şifreleme kullanılmaz.** Veri cihazın diski okunabiliyorsa düz metindir. Cihazın tam disk şifrelemesi yalnızca işletim sistemi katmanına bağlıdır.

### 10.3 Android yedekleme — devre dışı

Android tarafında `android:allowBackup="false"` uygulanmıştır. Veritabanı **Google otomatik yedeklemesine dahil edilmez.** (Bu ayar manifest ve kaynak XML'i olmak üzere iki katmanlı uygulanır; `gen/` klasörü yeniden üretildiğinde ayar korunur.)

### 10.4 iOS yedekleme — **dikkate alınmalı**

> ⚠️ **iOS'ta uygulama verisi, cihazın iCloud Yedekleme kapsamına girebilir.** Bu, Apple'ın işletim sistemi düzeyindeki davranışıdır ve tamamen kapatılamaz; cihazı iCloud Yedekleme dışında tutmak kullanıcının kendi kararıdır. Bu durumda veri, **Apple'ın yedekleme hizmetleri üzerinden** Apple sunucularına kopyalanmış olabilir. Mağaza denetimlerinde bu açıkça beyan edilmelidir.

### 10.5 Dışa aktarılan dosyalar

CSV/PDF raporları, yedekleme dosyaları ve dışa aktarma çıktıları **şifresiz düz metindir** ve cihazın indirilenler klasörüne yazılabilir. Bu dosyalar paylaşıldığında içlerindeki tüm kişisel veriler paylaşılır; dosyaları sildiğinizden emin olun.

### 10.6 Taahhüt edilmeyenler

- Otomatik veri şifreleme (bkz. 10.2)
- Anahtarsız iki faktörlü doğrulama
- Cihazlar arası güvenli eşitleme
- Uzaktan oturum sonlandırma

---

## 11. Çocukların Kişisel Verileri

Bu uygulama **18 yaşından küçük kişilerin kişisel verilerinin işlenmesi için tasarlanmamıştır.** Uygulama bir inşaat şantiyesinde çalışan yetişkin personelin kaydını tutmak için geliştirilmiştir ve çocuk istihdamı için özellik içermez.

Uygulamayı kullanan ve 18 yaşından küçük bir kişinin verilerini kaydeden bir işverenin, **6698 sayılı Kanun md.6** uyarınca ilgili kişilerin veli/vasi rızasını ayrıca alması gerekir. Böyle bir durumda işveren ayrıca veri sorumlusu sıfatıyla kendi yükümlülüklerini yerine getirir.

---

## 12. Politika Değişiklikleri

Bu politika içeriği uygulamanın geliştirilmesiyle birlikte güncellenebilir. Önemli değişikliklerde (üçüncü taraf eklenmesi, veri akışının değişmesi, saklama sürelerinin değişmesi) uygulama içinde bildirim gösterilir ve bu sayfanın **"Son güncelleme"** tarihi güncellenir.

Dağıtım öncesi sürümlerdeki politika, ilgili sürümün dağıtım tarihindeki hâliyle ayrıca arşivlenmelidir.

---

## 13. İletişim

Gizlilik, KVKK başvuruları ve bu politika ile ilgili tüm sorular için bu depodaki **Issues** bölümünde yeni bir issue açabilirsiniz. Açık adres talep edilirse issue içinde belirtilir.

---

_Bu politika, uygulamanın hiçbir sunucuya bağlanmadan cihaz üzerinde çalışan mimarisini esas alır. Verileriniz geliştiriciye gönderilmez; ancak hata izleme etkinse maskelenmiş hata kayıtları gönderilebilir (bkz. Bölüm 6.1)._
