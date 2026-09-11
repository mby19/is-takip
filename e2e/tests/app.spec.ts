import { test, expect } from "../support/tauriMock";

/**
 * Bu testler uygulamayı gerçek SQLite üzerinde, tarayıcıda uçtan uca çalıştırır
 * (bkz. support/tauriMock.ts). Amaç ekranların birbirine doğru bağlandığını ve
 * verinin gerçekten yazıldığını doğrulamak.
 */

const addWorker = async (page: import("@playwright/test").Page, name: string, wage = "600") => {
  await page.getByRole("button", { name: "Kişiler" }).click();
  await page.getByRole("button", { name: /Yeni Kişi Ekle/ }).click();
  await page.getByPlaceholder("Örn: Ahmet Yılmaz").fill(name);
  await page.getByLabel("Günlük Yevmiye (₺)").fill(wage);
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(name)).toBeVisible();
};

test.describe("İş Takip", () => {
  test("uygulama veritabanına bağlanıp takvimi açar", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("İş Takip");
    await expect(page.getByRole("navigation", { name: "Ana menü" })).toBeVisible();
    await expect(page.getByText("Henüz Çalışan Yok")).toBeVisible();
  });

  test("dört sekme arasında gezinir", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Ana menü" });

    await nav.getByRole("button", { name: "Kişiler" }).click();
    await expect(page.getByRole("heading", { name: "Ekip" })).toBeVisible();

    await nav.getByRole("button", { name: "Ay Sonu" }).click();
    await expect(page.getByRole("heading", { name: "Ay Sonu" })).toBeVisible();

    await nav.getByRole("button", { name: "Ayarlar" }).click();
    await expect(page.getByRole("heading", { name: "Ayarlar" })).toBeVisible();

    await nav.getByRole("button", { name: "Takvim" }).click();
    await expect(page.getByRole("navigation", { name: "Ana menü" })).toBeVisible();
  });

  test("çalışan ekler ve veritabanına yazar", async ({ page, db }) => {
    await page.goto("/");
    await addWorker(page, "Ahmet Yılmaz");

    const rows = db.prepare("SELECT name, daily_wage, worker_type FROM workers").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Ahmet Yılmaz", worker_type: "GUNLUK" });

    // Açılış ücret kaydı da oluşmalı (geçmişe dönük hesap için).
    const rates = db.prepare("SELECT valid_from, daily_wage FROM worker_rate_history").all();
    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({ valid_from: "2000-01-01" });
  });

  test("gün detayında puantaj ve ciro kaydeder", async ({ page, db }) => {
    await page.goto("/");
    await addWorker(page, "Ahmet Yılmaz");

    await page.getByRole("button", { name: "Takvim" }).click();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;

    await page.getByRole("button", { name: `${dateStr} gününü aç` }).click();
    await page.getByRole("button", { name: "Ahmet Yılmaz: Tam" }).click();
    await page.getByLabel("Ciro (₺)").fill("5000");
    await page.getByRole("button", { name: "Kaydet" }).click();

    await expect(page.getByText("Gün kaydedildi")).toBeVisible();

    const attendance = db.prepare("SELECT date, status FROM attendance").all();
    expect(attendance).toEqual([{ date: dateStr, status: "FULL" }]);

    const metric = db.prepare("SELECT total_earned FROM daily_metrics WHERE date = ?").get(dateStr);
    expect(metric).toMatchObject({ total_earned: 5000 });
  });

  test("kapalı dönemde kayıt değiştirilemez", async ({ page, db }) => {
    await page.goto("/");
    await addWorker(page, "Ahmet Yılmaz");

    const today = new Date();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const dateStr = `${period}-${String(today.getDate()).padStart(2, "0")}`;

    // Ay Sonu ekranından dönemi kapat
    await page.getByRole("button", { name: "Ay Sonu" }).click();
    await page.getByRole("button", { name: /Dönemi Kapat/ }).click();
    await page.getByRole("button", { name: "Evet, Kapat" }).click();
    await expect(page.getByText(/kapatıldı/)).toBeVisible();

    expect(db.prepare("SELECT period FROM closed_periods").all()).toEqual([{ period }]);

    // Gün detayı artık salt okunur
    await page.getByRole("button", { name: "Takvim" }).click();
    await page.getByRole("button", { name: `${dateStr} gününü aç` }).click();
    await expect(page.getByText(/kapalı — salt okunur/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dönem Kapalı" })).toBeDisabled();
  });

  test("denetim kaydı işlemleri yazar", async ({ page, db }) => {
    await page.goto("/");
    await addWorker(page, "Ahmet Yılmaz");

    const logs = db
      .prepare("SELECT action_type, entity_table, new_data FROM audit_logs ORDER BY id")
      .all() as { action_type: string; entity_table: string; new_data: string }[];

    const insert = logs.find((l) => l.entity_table === "workers" && l.action_type === "INSERT");
    expect(insert).toBeDefined();
    // Yeni format JSON olmalı.
    expect(JSON.parse(insert!.new_data)).toMatchObject({ name: "Ahmet Yılmaz", type: "GUNLUK" });
  });
});
