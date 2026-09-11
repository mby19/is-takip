import { test } from "../support/tauriMock";

/**
 * Tasarım aracı — doğrulama yapmaz, ekran görüntüsü üretir.
 * CI'da koşmaz; elle çalıştırmak için:
 *
 *   SHOTS=1 npx playwright test -g görüntüleri
 *
 * Çıktılar e2e/shots/ altına yazılır (git'e girmez).
 */
test.skip(!process.env.SHOTS, "Yalnızca SHOTS=1 ile çalışır");

test.use({ viewport: { width: 420, height: 900 }, colorScheme: "dark" });

const now = new Date();
const P = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const d = (n: number) => `${P}-${String(n).padStart(2, "0")}`;

const SEED = `
  INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES
    ('Ahmet Yılmaz', 900, 'GUNLUK', 1),
    ('Mehmet Demir', 0, 'ORTAK', 1),
    ('Hasan Kaya', 750, 'GUNLUK', 1),
    ('Emre Şahin', 800, 'GUNLUK', 1),
    ('Osman Çelik', 0, 'ORTAK', 0);
  INSERT INTO worker_rate_history (worker_id, valid_from, daily_wage, worker_type)
    SELECT id, '2000-01-01', daily_wage, worker_type FROM workers;
  INSERT INTO daily_metrics (date, production_amount, total_earned, extra_expenses, is_holiday) VALUES
    ('${d(1)}', 14, 9500, 400, 0), ('${d(2)}', 11, 7800, 250, 0),
    ('${d(3)}', 16, 11200, 600, 0), ('${d(4)}', 9, 6400, 150, 0),
    ('${d(5)}', 13, 8900, 300, 0), ('${d(8)}', 15, 10100, 500, 0);
  INSERT INTO attendance (worker_id, date, status) VALUES
    (1,'${d(1)}','FULL'),(2,'${d(1)}','FULL'),(3,'${d(1)}','FULL'),(4,'${d(1)}','HALF'),
    (1,'${d(2)}','FULL'),(2,'${d(2)}','FULL'),(3,'${d(2)}','HALF'),(4,'${d(2)}','ABSENT'),
    (1,'${d(3)}','FULL'),(2,'${d(3)}','FULL'),(3,'${d(3)}','FULL'),(4,'${d(3)}','FULL'),
    (1,'${d(4)}','HOLIDAY'),(2,'${d(4)}','FULL'),(3,'${d(4)}','FULL'),(4,'${d(4)}','FULL'),
    (1,'${d(5)}','FULL'),(2,'${d(5)}','HALF'),(3,'${d(5)}','FULL'),(4,'${d(5)}','FULL'),
    (1,'${d(8)}','FULL'),(2,'${d(8)}','FULL'),(3,'${d(8)}','ABSENT'),(4,'${d(8)}','FULL');
  INSERT INTO payments (worker_id, amount, date, description) VALUES
    (1, 2000, '${d(3)}', 'avans'), (3, 1200, '${d(4)}', 'avans'), (4, 500, '${d(5)}', 'yol parası');
`;

test("ekran görüntüleri", async ({ page, db }) => {
  db.exec(SEED);
  const shot = async (name: string) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `shots/${name}.png` });
  };

  await page.goto("/");
  await shot("01-takvim");

  await page
    .locator(`[data-date="${d(3)}"] button`)
    .first()
    .click();
  await shot("02-gun-detay");
  await page.getByRole("button", { name: "İptal" }).click();

  await page.getByRole("button", { name: "Kişiler" }).click();
  await shot("03-kisiler");

  await page.getByText("Ahmet Yılmaz").first().click();
  await shot("04-calisan-detay");
  await page.getByRole("button", { name: "Geri" }).click();

  await page.getByRole("button", { name: "Ay Sonu" }).click();
  await shot("05-ay-sonu");

  await page.getByRole("button", { name: "Ayarlar" }).click();
  await shot("06-ayarlar");
  await page
    .locator("div.overflow-y-auto")
    .first()
    .evaluate((el) => el.scrollTo(0, 900));
  await shot("07-ayarlar-alt");

  await page.getByRole("button", { name: /Sistem Geçmişi/ }).click();
  await shot("08-gecmis");
});

test("açık tema görüntüleri", async ({ page, db }) => {
  db.exec(SEED);
  await page.addInitScript(() => localStorage.setItem("theme-mode", "light"));
  const shot = async (name: string) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `shots/light-${name}.png` });
  };

  await page.goto("/");
  await shot("takvim");

  await page
    .locator(`[data-date="${d(3)}"] button`)
    .first()
    .click();
  await shot("gun-detay");
  await page.getByRole("button", { name: "İptal" }).click();

  await page.getByRole("button", { name: "Ay Sonu" }).click();
  await shot("ay-sonu");
});
