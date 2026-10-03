import { create } from "zustand";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { executeQuery, executeTransaction, fetchQuery } from "../lib/db";
import { sqlLiteral } from "../lib/sql";
import type { AuditLog } from "../types";
import { getRevertStrategy, createRevertContext, resolveAffectedDate } from "./revertStrategies";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";

interface AuditLogState {
  logs: AuditLog[];
  isLoading: boolean;
  error: string | null;
  fetchLogs: () => Promise<void>;
  revertLog: (log: AuditLog) => Promise<boolean>;
}

/** Tarih gibi görünmeyen bir `old_data` değerini yakalar. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tarihi olmayan tek tablo `workers`'tır — çalışan kaydı tek bir güne ait
 * değildir, dönem kilidi ona uygulanmaz. Bu tabloda tarih çözülemezse geri
 * alma reddedilmez (reddedilirse hiçbir çalışan düzenlemesi geri alınamaz).
 */
const DATE_SCOPED_TABLES = new Set([
  "attendance",
  "daily_metrics",
  "payments",
  "worker_rate_history",
]);

/**
 * Geri alma sonrası store'ları tazeler.
 *
 * Dönem kilidi gün bazlı olduğu için, tarihi çözülemeyen kayıtların store
 * senkronu yapılamaz. O durumda ekranda gösterilen veri geri alınan veriden
 * farklı kalır — kullanıcı geri alınmış bir ödemeyi tekrar kaydedebilir.
 * Bu yüzden tarih çözülemezse ilgili store'ların tamamı tazelenir.
 */
const syncStoresAfterRevert = async (
  log: AuditLog,
  oldData: Record<string, string> | null,
  newData: Record<string, string> | null,
) => {
  const { useMetricsStore } = await import("./metricsStore");
  const { useAttendanceStore } = await import("./attendanceStore");
  const { usePaymentStore } = await import("./paymentStore");
  const { useWorkerStore } = await import("./workerStore");

  const date = oldData?.date || newData?.date;
  const workerId = Number(oldData?.worker_id ?? newData?.worker_id);

  switch (log.entity_table) {
    case "daily_metrics":
      if (date) {
        await useMetricsStore.getState().fetchMetricsByDate(date);
        await useAttendanceStore.getState().fetchAttendanceByDate(date);
      } else {
        // Tarih çözülemedi: en geniş aralıkla tazele.
        await useAttendanceStore.getState().fetchAttendanceByDateRange("", "9999-12-31");
      }
      break;

    case "attendance":
      if (date) {
        await useAttendanceStore.getState().fetchAttendanceByDate(date);
      } else {
        await useAttendanceStore.getState().fetchAttendanceByDateRange("", "9999-12-31");
      }
      break;

    case "payments": {
      // `old_data` bozuksa worker_id çözülemez; o zaman record_id'den sor.
      // Hiçbiri olmazsa ekranda açık olan çalışanın ödemelerini tazele:
      // çözülemezse en azından YÜKLÜ olan store yanlış veri göstermesin.
      let target = Number.isInteger(workerId) && workerId > 0 ? workerId : null;
      if (target === null) {
        const rows = await fetchQuery<{ worker_id: number }>(
          "SELECT worker_id FROM payments WHERE id = ?",
          [log.record_id],
        );
        if (rows.length > 0) target = rows[0].worker_id;
      }
      if (target === null) target = usePaymentStore.getState().loadedWorkerId;
      if (target !== null) await usePaymentStore.getState().fetchWorkerPayments(target);
      break;
    }

    case "workers":
    case "worker_rate_history":
      // Ücret geçmişi tablosu revert'te de değişir; ikisini birlikte tazele.
      await useWorkerStore.getState().fetchWorkers();
      await useWorkerStore.getState().fetchRateHistory();
      break;

    default:
      break;
  }
};

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  logs: [],
  isLoading: false,
  error: null,

  fetchLogs: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await auditLogRepository.findAll();
      set({ logs: result, isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  /**
   * Bir denetim kaydını geri alır.
   *
   * Tüm adımlar tek transaction içinde uygulanır — geri alma yarıda kalıp
   * tutarsız duruma yol açamaz. Kayıt silinmez, `reverted_at` ile işaretlenir
   * ve geri alma işleminin kendisi ayrı bir REVERT kaydı olarak yazılır;
   * böylece denetim izi eksiksiz kalır.
   */
  revertLog: async (log: AuditLog): Promise<boolean> => {
    if (log.reverted_at) {
      throw new Error("Bu işlem daha önce geri alınmış.");
    }

    try {
      const strategy = getRevertStrategy(log.action_type, log.entity_table);
      if (!strategy) {
        throw new Error("Bu işlem türü geri alınamaz.");
      }

      const ctx = createRevertContext(log);

      // Geri alma kapalı bir dönemin verisine dokunuyorsa engellenir.
      //
      // Fail-closed: tarihli tablolarda (attendance, daily_metrics, payments,
      // worker_rate_history) tarih çözülemezse kontrolden GEÇME — reddet.
      // Önceden "tarih yoksa kontrolü atla" davranışı vardı; bozuk `old_data`
      // bu yolla kapalı dönemin verisini sessizce değiştiriyordu.
      //
      // Kontrol, kaydın KENDİ tarihiyle sınırlı değildir: strateji ikinci bir
      // tabloya dokunuyorsa (`workers` UPDATE'i `worker_rate_history` satırını
      // siliyor) o tablonun tarihi de denetlenir. `DATE_SCOPED_TABLES`'a
      // eklemek yetmezdi, çünkü sorun kaydın tablosunda değil, stratejinin
      // dokunduğu ikinci tabloda.
      const affectedDates: string[] = [];
      const ownDate = resolveAffectedDate(ctx);
      if (ownDate !== null && !ISO_DATE.test(ownDate)) {
        throw new Error(
          `Bu kaydın tarihi okunamadı ("${ownDate}"); kapalı dönem kontrolü yapılamadığı için geri alma durduruldu.`,
        );
      }
      if (ownDate !== null) affectedDates.push(ownDate);
      if (strategy.resolveAffectedDates) {
        for (const date of await strategy.resolveAffectedDates(ctx)) {
          if (!ISO_DATE.test(date)) {
            throw new Error(
              `Bu kaydın tarihi okunamadı ("${date}"); kapalı dönem kontrolü yapılamadığı için geri alma durduruldu.`,
            );
          }
          affectedDates.push(date);
        }
      }
      if (ownDate === null && DATE_SCOPED_TABLES.has(log.entity_table)) {
        throw new Error(
          "Bu kaydın etkilediği tarih bulunamadı; kapalı dönem kontrolü yapılamadığı için geri alma durduruldu.",
        );
      }
      for (const date of affectedDates) {
        if (isDateInClosedPeriod(date)) throw new ClosedPeriodError(date);
      }

      const statements = await strategy.execute(ctx);

      const revertNote = JSON.stringify({
        reverted_log_id: log.id,
        action_type: log.action_type,
        entity_table: log.entity_table,
        record_id: log.record_id,
      });

      // 1) KİLİTLE. Koruma bellekte değil SQL'de: `AND reverted_at IS NULL`
      //    koşulu olmadan aynı kayıt iki kez geri alınabilir ve veri iki kez
      //    değişir. Bu UPDATE koşulu sağlamıyorsa hiçbir satır güncellenmez.
      //    Claim transaction'ın DIŞINDA ve ÖNÜNDE olmalı — transaction içinde
      //    "kaç satır güncellendi" bilgisi yoktur, dolayısıyla ikinci deneme
      //    kendi veri ifadelerini yine çalıştırırdı.
      const claimed = await auditLogRepository.markReverted(log.id);
      if (!claimed || claimed.rowsAffected === 0) {
        throw new Error("Bu işlem daha önce geri alınmış.");
      }

      try {
        await executeTransaction([
          ...statements,
          `INSERT INTO audit_logs (action_type, entity_table, record_id, new_data) VALUES ('REVERT', ${sqlLiteral(log.entity_table)}, ${sqlLiteral(log.record_id)}, ${sqlLiteral(revertNote)})`,
        ]);
      } catch (error: unknown) {
        // Veri yazılamadı: kilidi geri bırak, yoksa kayıt geri alınamaz
        // görünür ama hiçbir şey değişmemiş olur.
        await executeQuery(
          "UPDATE audit_logs SET reverted_at = NULL WHERE id = ? AND reverted_at IS NOT NULL",
          [log.id],
        );
        throw error;
      }

      await syncStoresAfterRevert(log, ctx.oldData, ctx.newData);
      await get().fetchLogs();
      return true;
    } catch (error: unknown) {
      reportError(error instanceof Error ? error : new Error(String(error)), {
        scope: "revertLog",
        log_id: log.id,
      });
      throw error;
    }
  },
}));
