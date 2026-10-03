import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Retry yok: testler deterministik bir production build'e karşı koşuyor
  // (webServer aşağıda), dolayısıyla retry'nin geçici hata gizlemekten başka
  // işi yok — gerçek bir ürün hatasını maskeleyip yeşil görünen kırık PR
  // üretirdi. CI'da katkıcı, koşumun ilk denemede geçtiğini görmeli.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:1420",
    // Retry kaldırıldığı için "on-first-retry" hiç tetiklenmezdi; başarısızlık
    // durumunda trace yine de toplanır.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 800, height: 600 },
      },
    },
  ],
  webServer: {
    // Testler ÜRETİM çıktısına karşı koşar: önce `vite build`, sonra
    // `vite preview`. Neden dev sunucusu değil: Vite dev'de HMR, kaynak
    // dosya değiştiğinde tam sayfa yeniden yükleme yapar ve açık dialog'lar
    // DOM'dan ayrılır ("element was detached from the DOM"). Ayrıca artık
    // dağıtılan artefaktı test ediyoruz; dev'de çalışan bir test, production
    // build'de kırılan bir şeyi geçebilir.
    //
    // cwd depo kökü: yapılandırma e2e/ içinde, scriptler kökte.
    cwd: "..",
    // `vite preview` varsayılan olarak 4173 portunu kullanır; baseURL 1420
    // olduğu için port burada açıkça sabitleniyor.
    command: "npm run build && npx vite preview --port 1420 --strictPort",
    url: "http://localhost:1420",
    // Her koşu kendi preview sunucusunu kaldırır. `reuseExistingServer`
    // true olsaydı yerelde `npm run tauri dev` (yani HMR'li dev sunucusu)
    // yeniden kullanılır ve flake'in tam kaynağı test sırasında geri gelirdi.
    // Port çakışması artık sessiz değil, açık bir hata olarak görünür.
    reuseExistingServer: false,
    // Build süresini de kapsar.
    timeout: 180000,
  },
});
