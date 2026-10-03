import { describe, it, expect } from "vitest";
import { maskSensitiveText, maskEvent } from "../lib/errorMonitoring";

describe("maskSensitiveText", () => {
  it("ücret tutarlarını maskeler", () => {
    expect(maskSensitiveText("Ahmet Yılmaz'a 12.500,00 TL ödendi")).toBe(
      "Ahmet Yılmaz'a [masked] ödendi",
    );
    expect(maskSensitiveText("Bakiye: ₺1.250")).toContain("[masked]");
  });

  it("genel UI metnini olduğu gibi geçirir", () => {
    const uiText = "Devam durumu kaydedildi, yevmiye listesi güncellendi";
    expect(maskSensitiveText(uiText)).toBe(uiText);
  });

  it("kimlik no, IBAN ve telefonu maskeler", () => {
    expect(maskSensitiveText("TC: 12345678901")).toContain("[masked]");
    expect(maskSensitiveText("IBAN TR330006100519786457841326")).toContain("[masked]");
    expect(maskSensitiveText("0555 123 45 67")).toContain("[masked]");
  });
});

describe("maskEvent", () => {
  it("breadcrumb ve extra içindeki hassas metni maskeler", () => {
    const event = maskEvent({
      transaction: "Ödeme kaydet 9.500,00 TL",
      breadcrumbs: [{ message: "Bakiye 3.250,00 TL", data: { tutar: "3.250,00 TL" } }],
      extra: { not: "noter değil" },
    });

    expect(event.transaction).toBe("Ödeme kaydet [masked]");
    expect(event.breadcrumbs?.[0].message).toBe("Bakiye [masked]");
    expect(event.breadcrumbs?.[0].data).toEqual({ tutar: "[masked]" });
    expect(event.extra?.not).toBe("noter değil");
  });

  it("exception.values içindeki hata mesajını maskeler", () => {
    // `captureException` hata metnini `message` alanına değil
    // `exception.values[].value` alanına yazar. Bu alan maskelenmezse
    // hata mesajındaki tutarlar Sentry'ye olduğu gibi gider.
    const event = maskEvent({
      exception: {
        values: [
          { type: "Error", value: "Ödeme kaydedilemedi: 12.500,00 TL" },
          { type: "Error", value: "Sunucu yok" },
        ],
      },
    });

    expect(event.exception?.values?.[0].value).toBe("Ödeme kaydedilemedi: [masked]");
    // Hata sınıfı adı hata ayıklamanın parçası; maskelenmemeli.
    expect(event.exception?.values?.[0].type).toBe("Error");
    // Hassas değer içermeyen mesaj olduğu gibi kalmalı.
    expect(event.exception?.values?.[1].value).toBe("Sunucu yok");
  });

  it("döngüsel yapıda sonsuza kadar gezmez", () => {
    const circular: Record<string, unknown> = { name: "Ahmet" };
    circular.self = circular;
    expect(() => maskEvent({ extra: circular })).not.toThrow();
  });
});
