# İlk Kullanım Rehberi

Bu belge iki farklı okuru hedefler:

- **Son kullanıcı** — uygulamayı ilk kez açan şantiye şefi. İlk bölüm onun için.
- **Yayınlayan / sürdüren kişi** — uygulamayı dağıtan ve hataları okuyacak
  geliştirici. Son bölümler onun için.

---

## 1. Uygulamayı ilk kez açıyorsunuz

### Karşınıza çıkan ekran

Uygulama tamamen boş veritabanıyla açılır ve sizi **takvim yerine bir başlangıç
ekranıyla** karşılar:

> **Henüz çalışan yok**
> Puantaj tutmaya başlamak için ekibinizi ekleyin. İsim ve yevmiye yeterlidir;
> geri kalanı sonra doldurursunuz.

Bu ekranda tek bir iş vardır ve iki yol sunulur.

### Yol A — Sıfırdan başla (çoğu kullanıcı)

1. **Personel Ekle** düğmesine basın. Sizi doğrudan **Kişiler** ekranına götürür.
2. **Yeni Kişi Ekle** düğmesini kullanarak ekibi ekleyin. İsim ve günlük yevmiye
   yeterlidir; çalışan türünü (Yevmiyeli / Ortak) sonra da değiştirebilirsiniz.
3. Takvime döndüğünüzde her çalışan bir sütun olarak görünür.

> **Neden sihirbaz yok?** Bu bir araç uygulaması, tüketici uygulaması değil.
> Hedef kullanıcı işini zaten bilen biri. "1. şunu yap, 2. bunu yap" diyen
> adım adım bir akış, işini bilen kişiye zaman kaybı; bilmeyene ise zaten
> yardımcı olmaz, çünkü neyi yapması gerektiği ekranda yazıyordur. Bu yüzden
> bilinçli olarak tutulmadı.

### Yol B — Başka cihazda kullandınız, veri orada

Aynı başlangıç ekranının altındaki ince bağlantıyla geçilir:

> **Başka cihazda mı kullandınız? Yedekten geri yükle**

Yedek dosyanız varsa (bkz. bölüm 2) uygulama onu doğrudan yükler, ekip, puantaj
ve ödemeler geri gelir.

Aynı işlem **Ayarlar › Yedekleme** bölümünden de yapılabilir. Yol B'yi seçmeyen
kullanıcılar, verilerini bu ekrandan girdikten sonra ayarlardan yedek almayı
unutmasın diye **Kişiler** ekranında boş durumda kısa bir hatırlatma görür:

> Bu cihazda henüz veri yok. Başka bir cihazda kullandıysanız
> **Ayarlar › Yedekleme** bölümünden geri yükleyebilirsiniz.

### "Verilerim nerede?" sorusu

Uygulama çevrimdışı çalışır, hesap açmanızı istemez ve veriniz sunucuya
gitmez. Veriler yalnızca **bu cihazda** durur.

Bu, uygulamanın en önemli kuralıdır:

> **Verileriniz bu cihazda saklanır, cihazdan çıkarsa gider.**
> Geri getirme garantisi verilemez.

Bu yüzden düzenli yedek almak zorunludur, tavsiye değil.

---

## 2. Yedekleme ve geri yükleme

### Yedek dosyası nerede durur

| İşlem                        | Dosya adı                              | Konum                  |
| ---------------------------- | -------------------------------------- | ---------------------- |
| Siz aldınız                  | `is_takip_backup_<tarih>.json`         | "İndirilenler" klasörü |
| Geri yükleme öncesi otomatik | `is_takip_otomatik_yedek_<tarih>.json` | "İndirilenler" klasörü |

Yedek dosyası **JSON** metnidir. İçinde personel adları, yevmiye, puantaj ve
ödeme kayıtları bulunur — yani maaş verisi. Bir yere taşıyacaksanız güvenli
bir yerde tutun.

### Ne zaman yedek almalı

- Haftada en az bir kez.
- Cihazı değiştirmeden, uygulamayı silmeden, yeni bilgisayara geçmeden önce.
- Yeni cihaza veri taşımak istiyorsanız **mutlaka**: veriler bulutta değil.

### Geri yükleme ne yapar — ve neden dikkat

Geri yükleme **mevcut tüm verilerinizi seçtiğiniz dosyadakilerle değiştirir.**
Eski puantajlarınız, ödemeleriniz ve arşiviniz dosyada yoksa kaybolur.

Bu yüzden uygulama geri yüklemeden hemen önce bir **güvenlik yedeği** alır ve
boyutunu, çalışan sayısını ve kayıt sayısını onay ekranında gösterir. Onay
vermeden geri yükleme başlamaz.

Geri yüklenen dosya bu uygulamanın okuyabildiği en yüksek biçim sürümünden
yeniyse reddedilir.

---

## 3. Hata bildirimi (kullanıcıdan geliştiriciye)

### Hata bildirirken ne söylemelisiniz

Uygulama çökerse ekran size şunları gösterir:

- Hatanın kendisi
- **Sürüm numarası** — örn. `0.1.0`
- **Kopyalanabilir hata raporu** (aşağıya bakın)

### En kolay yol: "Hata bilgisini panoya kopyala"

Hata ekranındaki bu düğme, bildiriminizin tamamını panoya kopyalar:

```
İş Takip hata bildirimi
Sürüm: 0.1.0
Zaman: 03.10.2026 14:32
Platform: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...
Hata: TypeError: puantaj kaydedilemedi
```

Yapmanız gereken tek şey: teknik destek kanalına (e-posta, WhatsApp, GitHub
issue) **yapıştırmak**. Sürüm ve cihaz bilgisi otomatik geldiği için ayrıca
yazmanız gerekmez.

Bu yol **Sentry kurulu olmasa da çalışır**. İzleme kapalıyken hata hiçbir
yere düşmez, ama kullanıcı yine de hatayı bize bildirebilir. Kopyalama
başarısız olursa (bazı sistemlerde pano izni verilmez) metin ekranda kalır ve
elle seçilebilir — yani bu yol hiçbir koşulda tıkanmaz.

### Elle bildirimde bulunması gerekenler

Panoya kopyalama yerine elle yazacaksanız şunları ekleyin:

1. **Ne yapıyordunuz?** — "Yeni kişi eklerken yevmiyeye 0 yazdım"
2. **Ne oldu?** — "Kaydet dedim, düğme tepki vermedi"
3. **Sürüm** — hata ekranındaki satır
4. **Cihaz** — işletim sistemi ve model

### Hata izleme nasıl kurulur (geliştirici)

Uygulama **Sentry** ile hata izleme yapar ve bu izleme **varsayılan olarak
kapalıdır**. Kapalıyken uygulama hiçbir yere ağ isteği yapmaz; hatalar yalnızca
konsola düşer.

**Üretimde kapalı bırakmanın bedeli:** konsol, kullanıcının erişemediği bir
yerdir. Yani DSN tanımlı değilse, kullanıcı bir hata bildirdiğinde **o hataya
ulaşmanın hiçbir yolu yoktur** — kullanıcı yalnızca ekranda gördüğü metni
okuyup size yazabilir. Bu, yayımlanmış bir üründe kabul edilebilir bir durum
değildir; DSN tanımlanmadan yayın yapılmamalıdır.

Kurulum adımları `.env.example` dosyasında adım adım anlatılmıştır. Özet:

1. [sentry.io](https://sentry.io) hesabı aç, organization ve proje oluştur
   (platform: **Browser JS / React**).
2. Projenin **Client Key (DSN)** değerini kopyala.
3. Derleme makinesinde `VITE_SENTRY_DSN` olarak tanımla (yerelde `.env`,
   CI'da repository secret).
4. **Yeniden derle.** Vite değişkenleri derleme anında gömülür; `.env`
   dosyasına sonradan eklemek hiçbir şeyi değiştirmez.
5. `[ErrorMonitoring] Initialized` yazısını konsolda doğrula.

Ücretsiz (Developer) plan kota ve saklama değerleri de `.env.example` içindedir.

### Sentry kurulu değilse hata toplama nasıl çalışır

Kurulu değilse hata **hiçbir yere düşmez** — `console.error` üretimde
kullanıcının erişemediği bir yerdir. Bu, izlemeyi kurmayan bir kurulum için
gerçek bir boşluktur. Kapatılan yer şudur: hata ekranındaki **"Hata
bilgisini panoya kopyala"** düğmesi Sentry'den bağımsız çalışır. Kullanıcı
hatayı görür, panoya kopyalar ve teknik destek kanalına yapıştırır; sürüm ve
cihaz bilgisi raporla birlikte gider.

Böylece hata toplama iki bağımsız kanaldan yürür: **Sentry** (varsa, otomatik)
ve **kullanıcıdan gelen manuel bildirim** (her zaman). İkisi birbirinin yerine
geçmez — Sentry olmadığında devrede kalan tek şey panoya kopyalama düğmesidir.

### Sentry'ye hangi veri gider

Kurulum açıkken dahi her olay gönderilmeden önce bir maskeleme katmanından
geçer (`src/lib/errorMonitoring.ts`):

| Veri                                                         | Durum                                               |
| ------------------------------------------------------------ | --------------------------------------------------- |
| Para tutarları (`12.500,00 TL`, `₺1.250`)                    | `[masked]` ile değiştirilir                         |
| TC kimlik numarası (11 hane)                                 | `[masked]`                                          |
| IBAN                                                         | `[masked]`                                          |
| Telefon numarası                                             | `[masked]`                                          |
| Hata mesajı, breadcrumb, transaction, event `extra` alanları | Maskelenir                                          |
| IP adresi, kullanıcı kimliği                                 | **Gönderilmez** (`sendDefaultPii: false`)           |
| Session replay (ekran kaydı)                                 | **Hiç gönderilmez** (`replaysSessionSampleRate: 0`) |
| Transaction (performans izleme)                              | Hataların %10'u kadar örneklenir                    |

**Personel adları maskelenmez.** Bunu bilinçli bir karar olarak alın: ad
maskelemesi için her büyük harfli kelimeyi isim saymak `Maske`, `Kaydet`,
`Özet` gibi sıradan arayüz metinlerini de silerdi ve hata okunamaz hale gelirdi.
Bunun yerine hata mesajlarına ad yazılmaz; ekranda görünen verilerin
aktarılması gereken kanallar (replay) zaten tamamen kapalıdır. Mevcut risk
kabulü `PRIVACY.md` §6.1'de yazılıdır.

### PII maskelemesi yeterli mi — değerlendirme

Kısa cevap: **mevcut haliyle yeterli, ama bir boşluk vardı ve kapatıldı.**

`beforeSend` olayın `message`, `transaction`, `breadcrumbs`, `extra` ve
`contexts` alanlarını maskeliyordu. Ancak `captureException` ile gönderilen
hataların metni bu alanlardan birinde değil, **`exception.values[].value`
alanında** durur. Bu alan maskelenmediği için, bir hata mesajında geçen tutar
(`"Ödeme kaydedilemedi: 12.500,00 TL"`) Sentry'ye olduğu gibi gidiyordu. Aynı
sebeple `reportError` ile eklenen `extra` değerleri de düz metin olarak
yazılabiliyordu.

Bu dalda `exception.values[].value` alanı da maskelemeye katıldı ve
`src/__tests__/errorMonitoring.test.ts` içinde regresyon testi eklendi.

Kalan bilinçli açıklar:

- **Hata mesajındaki personel adı maskelenmiyor** (yukarıda gerekçelendirildi).
- **Stack trace satırları maskelenmiyor.** Üretim derlemesi satır kaynak
  kodunu içermediği için bu pratikte sıfır risk; kaynak haritası yüklenirse
  gözden geçirilmelidir.
- **Breadcrumb'lar her zaman maskelenir** — ekran içeriği değil, olay
  açıklamaları taşır.

---

## 4. Sürüm bilgisi

Sürüm, `package.json`'dan derleme sırasında gömülür (`vite.config.ts`
`define`), böylece iki yerde ayrı ayrı güncellenemez ve unutulamaz.

Kullanıcıya üç ayrı yerde görünür:

| Yer                                | Ne zaman                                   |
| ---------------------------------- | ------------------------------------------ |
| **Hata ekranı** (`ErrorBoundary`)  | Uygulama çöktüğünde — en kritik an         |
| **Ayarlar** ekranının en altı      | İçinde "İş Takip Mobile / Versiyon 0.1.0"  |
| **Sentry olaylarında** (`release`) | Geliştirici tarafında, her olayda otomatik |

Sentry olayları `is-takip@<sürüm>` `release` etiketiyle gönderilir. Yani bir
hata raporunda sürümü ayrıca yazmanıza gerek yok — hangi sürümde olduğu
geliştirici tarafında otomatik görünür.

---

## 5. Yayın öncesi kontrol listesi

- [ ] `VITE_SENTRY_DSN` derlemeye gömülmüş (`[ErrorMonitoring] Initialized`)
- [ ] Boş veritabanıyla açılışta başlangıç ekranı geliyor
- [ ] "Personel Ekle" düğmesi Kişiler ekranını açıyor
- [ ] Yedekten geri yükleme gerçekten veriyi getiriyor
- [ ] Hata ekranında sürüm numarası görünüyor
- [ ] `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` yeşil

---

## İlgili dosyalar

| Dosya                              | Rolü                                                    |
| ---------------------------------- | ------------------------------------------------------- |
| `src/components/EmptyState.tsx`    | İlk açılış ekranı (ekip ekleme + yedekten geri yükleme) |
| `src/components/CalendarView.tsx`  | Boş durumda `EmptyState`'i gösterir                     |
| `src/components/WorkersScreen.tsx` | Ekip boşken yedek yolunu hatırlatır                     |
| `src/components/ErrorBoundary.tsx` | Çökme ekranı: sürüm + panoya kopyalanabilir hata raporu |
| `src/lib/errorMonitoring.ts`       | Sentry kurulumu + PII maskeleme                         |
| `src/lib/appInfo.ts`               | Sürüm okuma                                             |
| `.env.example`                     | DSN kurulumunun adım adım anlatımı                      |
| `PRIVACY.md` §6.1                  | Yasal metin: hata izlemenin kapsamı                     |
