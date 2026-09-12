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
 */
export async function markTodayFull(): Promise<QuickFillResult> {
  const date = todayKey();
  if (isDateInClosedPeriod(date)) throw new ClosedPeriodError(date);

  const { fetchAttendanceByDate, markAttendance } = useAttendanceStore.getState();
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

  for (const worker of targets) {
    await markAttendance(worker.id, date, "FULL");
  }

  return { marked: targets.length, skipped: recorded.size };
}

/** Bugün hiç puantaj girilmemiş mi? Hatırlatma uyarısı buna bakar. */
export function isTodayEmpty(): boolean {
  const date = todayKey();
  return !useAttendanceStore.getState().attendances.some((a) => String(a.date).trim() === date);
}
