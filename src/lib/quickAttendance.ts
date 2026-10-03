import { useAttendanceStore } from "../stores/attendanceStore";
import { useWorkerStore } from "../stores/workerStore";
import { isDateInClosedPeriod, ClosedPeriodError } from "../stores/periodStore";
import { todayKey } from "./period";

/**
 * Tek dokunuşla gün doldurma.
 *
 * Bildirimden ve uygulama kısayolundan çağrılır: sahada herkesin tam gün
 * çalıştığı sıradan bir günde tek tek hücreye dokunmak gereksiz.
 */

export interface QuickFillResult {
  /** Bu çağrıda tam güne çekilen kişi sayısı. */
  marked: number;
  /** Zaten kaydı olduğu için dokunulmayan kişi sayısı. */
  skipped: number;
}

/**
 * Bugün için kaydı OLMAYAN aktif çalışanları tam güne çeker.
 *
 * Mevcut kayıtlara dokunulmaz: kullanıcı birine bilerek «yok» demişse,
 * toplu doldurma bunu ezmemeli.
 *
 * Tüm yazma TEK transaction içinde geçer (`markAttendanceMany` →
 * `attendanceRepository.upsertMany`). Sıralı tekil yazmalarda 12. çalışanda
 * hata oluştuğunda 12 kişi tam gün, 38 kişi boş kalıyordu — üstelik kayıt
 * artık "var" göründüğü için o gün için hatırlatma da gelmiyordu.
 */
export async function markTodayFull(): Promise<QuickFillResult> {
  const date = todayKey();
  if (isDateInClosedPeriod(date)) throw new ClosedPeriodError(date);

  const { fetchAttendanceByDate, markAttendanceMany } = useAttendanceStore.getState();
  await fetchAttendanceByDate(date);

  const recorded = new Set(
    useAttendanceStore
      .getState()
      .attendances.filter((a) => String(a.date).trim() === date)
      .map((a) => Number(a.worker_id)),
  );

  const targets = useWorkerStore
    .getState()
    .workers.filter((w) => w.is_active && !recorded.has(w.id));

  if (targets.length === 0) return { marked: 0, skipped: recorded.size };

  const { written } = await markAttendanceMany(
    targets.map((worker) => ({ workerId: worker.id, date, status: "FULL" as const })),
  );

  return { marked: written, skipped: recorded.size };
}
