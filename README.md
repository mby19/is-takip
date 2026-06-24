# İş Takip

Bir inşaat/üretim sahasında çalışan personelin günlük devam durumunu, üretim miktarını ve ödemelerini takip etmek için geliştirilmiş bir masaüstü uygulaması.

## Özellikler

- **Personel Yönetimi**: Günlük yevmiyeli ve ortak bazlı çalışan takibi
- **Günlük Devam Takibi**: Tam gün, yarım gün, izinli/yok durumu kaydı
- **Üretim Metrikleri**: Günlük palet sayısı, kazanç ve gider girişi
- **Ödeme Takibi**: Personel bazında avans/ödeme kaydı ve bakiye hesaplama
- **Detaylı Raporlar**: Aylık kazanç dökümü, grafikler ve PDF çıktısı
- **Denetim Günlüğü**: Tüm değişikliklerin otomatik kaydı ve geri alma desteği
- **Uygulama Kilidi**: Emoji deseni + PIN ile güvenlik
- **Yedekleme**: JSON formatında veritabanı yedekleme ve geri yükleme
- **Karanlık/Aydınlık Tema**: Sistem tercihine uyumlu tema desteği

## Teknolojiler

- [Tauri v2](https://v2.tauri.app/) — Masaüstü uygulama çatısı
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — Ön yüz
- [Tailwind CSS v4](https://tailwindcss.com/) — Stil
- [SQLite](https://www.sqlite.org/) (`@tauri-apps/plugin-sql`) — Yerel veritabanı
- [Zustand](https://github.com/pmndrs/zustand) — State yönetimi
- [Recharts](https://recharts.org/) + [jsPDF](https://github.com/parallax/jsPDF) — Grafik ve PDF raporlama
- [date-fns](https://date-fns.org/) — Tarih işlemleri
- [Lucide React](https://lucide.dev/) — İkon seti

## Geliştirme

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme sunucusunu başlat
npm run tauri dev

# Testleri çalıştır
npx vitest run

# Tip kontrolü
npx tsc --noEmit

# Lint
npm run lint

# Format
npm run format
```

## Derleme

```bash
npm run tauri build
```

Derleme çıktısı `src-tauri/target/release/` klasöründe oluşur.

## Mimari

```
src/
├── components/    # React bileşenleri (ui, views)
├── stores/        # Zustand store'ları (durum ve veritabanı işlemleri)
├── lib/           # Veritabanı, Tauri ve yardımcı fonksiyonlar
├── utils/         # Hesaplama mantığı
├── types/         # TypeScript tip tanımları
└── App.tsx        # Ana uygulama bileşeni
```
