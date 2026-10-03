import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { attendanceRepository } from "../repositories/attendanceRepository";
import { metricsRepository } from "../repositories/metricsRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { useWorkerStore } from "../stores/workerStore";
import {
  ALL_TIME_START_YEAR,
  allTimeRanges,
  buildPeriodIndex,
  periodWindowOf,
  type DateRange,
  type PeriodData,
  type PeriodEarnings,
  type PeriodIndex,
  type PeriodWindow,
} from "../lib/periodStats";
import {
  accumulateAllTimeEarnedIndexed,
  calculatePeriodEarningsIndexed,
} from "../lib/periodEarningsIndexed";
import { buildRateIndex } from "../utils/earningsCalculator";

import type { Attendance, DailyMetric, Payment, Worker, WorkerRate } from "../types";

/**
 * Aylık dökümün ortak veri kaynağı — `WorkerDetailView` ve
 * `MonthSummaryScreen` bunun dışında hiçbir repository'ye dokunmaz.
 *
 * ## Neden store kullanmıyor?
 *
 * Uygulamanın store'ları **yazma** odaklıdır: `attendanceStore` ve
 * `metricsStore` o günün satırlarını tutar, `workerStore` çalışan
 * listesini. Bu iki ekran ise **aylık dökümü tarih aralığı üzerinden
 * okur** — ekranda gösterilen ayın tüm günleri, o ayın ödemeleri ve
 * "tüm dönemler dahil" bakiyesi için yıllar boyu akıtılan tarama.
 * Takvim store'u (`attendanceStore`) ay kapsamını taşıyan TEK bir
 * `currentDate` alanıyla çalışır; onu iki ekrana bağlamak, iki ekranın
 * birbirinin seçili ayını ezmesine yol açardı (ayrıntı ekranı ay
 * değiştirince ay sonu ekranının ayı da değişirdi). Bu yüzden dönem
 * penceresi bu hook'un YEREL durumudur ve veri doğrudan repository'den
 * aralık sorgusuyla gelir.
 *
 * Katman kuralı korunur: `Component → Hook → Repository`. Hook, ekranların
 * tek tek yazdığı indeksleme (`buildPeriodIndex`), tek geçişli hakediş
 * (`calculatePeriodEarningsIndexed`) ve yıllık akıtma
 * (`accumulateAllTimeEarnedIndexed`) çağrılarını da tek yerde toplar; para
 * hesabının kopyası iki yerde yaşamaz.
 *
 * Hakediş `periodEarningsIndexed` katmanından gelir: para formülleri
 * (`calculateDailyEarnings`, `allocateCents`, `roundMoney`) yine tek
 * kaynaktan gelir, yalnız ücret çözümlemesi `rateResolverFor` yerine
 * önceden kurulmuş indeksten ikili aramayla yapılır (ADR-0009).
 */

export interface UseDomainMonthDataOptions {
  /** Ekranda görüntülenen ay (gün bilgisi yok sayılır). */
  month: Date;
  /**
   * `calculatePeriodEarnings` havuzunu verilen aydan türetir.
   *
   * Ay sonu ekranı arşivli çalışanları ay verisi yoksa havuzdan çıkarır;
   * kimliğin bu süzgeçten geçmesi gerekiyor, işte bu geri çağrı.
   * Verilmezse tüm çalışanlar kullanılır.
   */
  selectPool?: (attendance: readonly Attendance[]) => readonly Worker[];
  /** Günlük döküm de hesaplansın mı (`buildWorkerStats` gerektirir). */
  withBreakdown?: boolean;
  /**
   * Tüm ödemeler de okunsun mu?
   *
   * Ödemeler puantajın aksine gün/personel satırı değil, ödeme başına TEK
   * kayıttır; bu yüzden ölçek olarak aralığa sığmaz. Yalnız ay sonu ekranı
   * tüm dönemler bakiyesi için hepsine ihtiyaç duyar (ayrıntı ekranı
   * kendi çalışanının ödemelerini `paymentStore`'dan okur).
   */
  withPayments?: boolean;
}

export interface DomainMonthData {
  workers: Worker[];
  rateHistory: WorkerRate[];
  /** Ekranın ay penceresi: `period`, `start`, `end`. */
  viewPeriod: PeriodWindow;
  attendance: Attendance[];
  metrics: DailyMetric[];
  /** `withPayments` verilmediyse boş dizi. */
  payments: Payment[];
  /** Tarih → satır dizini; hesap başına bir kez kurulur. */
  periodIndex: PeriodIndex;
  /** Dönemin tüm çalışanlar için tek geçişte hesaplanmış hakedişi. */
  periodEarnings: PeriodEarnings;
  /** worker_id → tüm dönemlerdeki hakediş (yıl yıl akıtılarak). */
  allTimeEarned: Map<number, number>;
  isLoading: boolean;
  /** Kullanıcıya gösterilebilecek hazır hata metni. */
  error: string | null;
}

export function useDomainMonthData({
  month,
  selectPool,
  withBreakdown = false,
  withPayments = false,
}: UseDomainMonthDataOptions): DomainMonthData {
  const workers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);

  /**
   * Ücret geçmişi **bir kez** indekslenir; hem ay dökümü hem "tüm dönemler"
   * akıtması bu indeksten ikili aramayla çözer. `periodStats` içindeki
   * `rateResolverFor` her gün × her çalışan için geçmişi baştan tarar —
   * 5 yıllık veride ölçülen 3961 ms'ye karşılık bu yol 24 ms (ADR-0009,
   * 162×). Sonuç birebir aynıdır: `periodEarningsIndexed.test.ts` iki yolu
   * hücre hücre karşılaştırır.
   */
  const rateIndex = useMemo(() => buildRateIndex(rateHistory), [rateHistory]);

  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allTimeEarned, setAllTimeEarned] = useState<Map<number, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kimliği her render'da değişen bir geri çağrı, `useMemo`'yu her turda
  // geçersiz kılardı; en güncel hali bir ref'te tutulur.
  const selectPoolRef = useRef(selectPool);
  selectPoolRef.current = selectPool;

  const viewPeriod = useMemo(() => periodWindowOf(month), [month]);

  /** Aralık sorgusu: ekrandaki ay ve tüm dönem taraması bunu kullanır. */
  const loadRange = useCallback(async (start: string, end: string): Promise<PeriodData> => {
    const [a, m] = await Promise.all([
      attendanceRepository.findByDateRange(start, end),
      metricsRepository.findByDateRange(start, end),
    ]);
    return { attendance: a, metrics: m };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        const [monthData, allPayments] = await Promise.all([
          loadRange(viewPeriod.start, viewPeriod.end),
          withPayments ? paymentRepository.findAll() : Promise.resolve([] as Payment[]),
        ]);
        if (cancelled) return;
        setAttendance(monthData.attendance);
        setMetrics(monthData.metrics);
        setPayments(allPayments);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(`Veriler yüklenemedi: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRange, viewPeriod, withPayments]);

  /**
   * "Tüm dönemler" rakamı tüm tabloyu belleğe almadan üretilir: yıl yıl
   * aralık sorgulanır, her yıl hesaplanıp atılır. Ortak payı hesabı o günün
   * tüm ekibini gerektirdiği için tek çalışana özel bir sorgu yetmez.
   *
   * Taban sabit `ALL_TIME_START_YEAR` (2000) DEĞİL, tablodaki en eski
   * puantaj yılıdır: 2000'den bugüne 27 yıl, bunun 26'sı boş olsa da her
   * biri için iki tam tablo taraması gidiyordu — `React.StrictMode` her
   * effect'i iki kez çalıştırdığı için ekranda 108 ek SQL turu dönüyordu.
   * `accumulateAllTimeEarned` puantajsız yılı zaten atladiğı için sonuç
   * değişmez; yalnız sorgu sayısı verinin gerçekten kapladığı yılla ölçülür.
   * Tablo boşsa tarama hiç yapılmaz: her çalışanın hakedişi zaten 0.
   */
  useEffect(() => {
    let cancelled = false;
    const load = async (range: DateRange) => loadRange(range.start, range.end);
    void (async () => {
      try {
        const earliest = await attendanceRepository.earliestDate();
        if (cancelled) return;
        if (!earliest) {
          setAllTimeEarned(new Map(workers.map((w) => [w.id, 0])));
          return;
        }
        // Bozuk bir tarih tüm taramayı sessizce boş bırakmasın: yıl
        // çözülemezse güvenli taban kullanılır.
        const startYear = Number.parseInt(earliest.slice(0, 4), 10);
        const totals = await accumulateAllTimeEarnedIndexed(
          workers,
          rateIndex,
          allTimeRanges(
            new Date(),
            Number.isFinite(startYear) ? Math.max(startYear, ALL_TIME_START_YEAR) : undefined,
          ),
          load,
        );
        if (!cancelled) setAllTimeEarned(totals);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(
          `Geçmiş hakediş hesaplanamadı: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workers, rateIndex, loadRange]);

  /** Tarih dizini hesap başına bir kez kurulur ve tüm çalışanlarda paylaşılır. */
  const periodIndex = useMemo(() => buildPeriodIndex(attendance, metrics), [attendance, metrics]);

  const pool = useMemo(() => {
    if (!selectPoolRef.current) return workers;
    return selectPoolRef.current(attendance);
  }, [workers, attendance]);

  const periodEarnings = useMemo(
    () => calculatePeriodEarningsIndexed(pool, month, periodIndex, rateIndex, withBreakdown),
    [pool, month, periodIndex, rateIndex, withBreakdown],
  );

  return {
    workers,
    rateHistory,
    viewPeriod,
    attendance,
    metrics,
    payments,
    periodIndex,
    periodEarnings,
    allTimeEarned,
    isLoading,
    error,
  };
}
