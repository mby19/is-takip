import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { buildExportCsv, exportFileName, writeCsvFile, type ExportScope } from "../lib/csvExport";
import { attendanceRepository } from "../repositories/attendanceRepository";
import { metricsRepository } from "../repositories/metricsRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { workerRepository } from "../repositories/workerRepository";
import { workerRateRepository } from "../repositories/workerRateRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { useWorkerStore } from "../stores/workerStore";
import { useToastStore } from "../stores/toastStore";
import { usePeriodStore } from "../stores/periodStore";
import { formatPeriod, periodsSince, periodOfDate, type PeriodKey } from "../lib/period";
import { reportError } from "../lib/errorMonitoring";

type ScopeKind = ExportScope["kind"];

/**
 * CSV dışa aktarımı.
 *
 * Veri doğrudan repository'lerden okunur, store'lardan değil: store'lar
 * yalnız ekranda açık olan ayın kayıtlarını tutar ve "tüm veri" kapsamı
 * eksik çıkardı. Dışa aktarım her seferinde veritabanının tamamını okur.
 */
export function CsvExportSection() {
  const workers = useWorkerStore((s) => s.workers);
  const fetchWorkers = useWorkerStore((s) => s.fetchWorkers);
  const addToast = useToastStore((s) => s.addToast);

  const [kind, setKind] = useState<ScopeKind>("all");
  const [workerId, setWorkerId] = useState<number | null>(null);
  const [period, setPeriod] = useState<PeriodKey>(periodOfDate(new Date()));
  const [busy, setBusy] = useState(false);

  const earliestDataPeriod = usePeriodStore((s) => s.earliestDataPeriod);
  const fetchClosedPeriods = usePeriodStore((s) => s.fetchClosedPeriods);

  useEffect(() => {
    fetchWorkers();
    fetchClosedPeriods();
  }, [fetchWorkers, fetchClosedPeriods]);

  // Veri bulunan en eski döneme kadar geriye doğru listelenir; en erken dönem
  // bilinmiyorsa yalnız içinde bulunulan ay gösterilir.
  const periods = useMemo(() => periodsSince(earliestDataPeriod), [earliestDataPeriod]);

  const scope = useMemo<ExportScope>(() => {
    if (kind === "worker" && workerId !== null) return { kind: "worker", workerId };
    if (kind === "month") return { kind: "month", period };
    return { kind: "all" };
  }, [kind, workerId, period]);

  const selectedWorker = workers.find((w) => w.id === workerId) ?? null;

  /** Kapsam geçerli mi? Geçersizse dosya üretilmez — kullanıcı nedenini görür. */
  const scopeError =
    kind === "worker" && workerId === null
      ? "Dışa aktarılacak çalışanı seçin."
      : kind === "worker" && selectedWorker === null
        ? "Seçilen çalışan bulunamadı."
        : null;

  const handleExport = async () => {
    if (scopeError) {
      addToast(scopeError, "error");
      return;
    }

    setBusy(true);
    try {
      const [allWorkers, rateHistory, attendance, metrics, payments] = await Promise.all([
        workerRepository.findAll(),
        workerRateRepository.findAll(),
        attendanceRepository.findAll(),
        metricsRepository.findAll(),
        paymentRepository.findAll(),
      ]);

      const csv = buildExportCsv({
        workers: allWorkers,
        attendance,
        metrics,
        payments,
        rateHistory,
        scope,
      });
      const fileName = exportFileName(scope, selectedWorker?.name);
      const saved = await writeCsvFile(fileName, csv);

      // Kullanıcı vazgeçtiyse denetim kaydı da yazılmaz — dosya oluşmadı.
      if (saved === null) {
        addToast("Dışa aktarım iptal edildi", "info");
        return;
      }

      await auditLogRepository.write(
        "EXPORT",
        "csv",
        0,
        JSON.stringify({ file: fileName, scope, exported_at: new Date().toISOString() }),
      );
      addToast(`${fileName} dışa aktarıldı`, "success");
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      reportError(err, { scope: "csvExport" });
      addToast(`Dışa aktarılamadı: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-[11px] font-medium text-muted-foreground ml-1 flex items-center gap-1.5">
        <FileSpreadsheet className="w-3.5 h-3.5" /> Dışa Aktarım (CSV)
      </h2>

      <div className="space-y-2">
        <span className="text-[10px] font-bold text-muted-foreground px-1">Kapsam</span>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "all", label: "Tüm Veri" },
              { id: "worker", label: "Tek Çalışan" },
              { id: "month", label: "Tek Ay" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={kind === option.id}
              onClick={() => setKind(option.id)}
              disabled={busy}
              className={`h-11 rounded-control border-2 text-[12px] font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                kind === option.id
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {kind === "worker" && (
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-muted-foreground px-1">Çalışan</span>
          {workers.length === 0 ? (
            <p className="text-[11px] text-muted-foreground px-1">Çalışan listesi boş.</p>
          ) : (
            <select
              aria-label="Çalışan"
              value={workerId ?? ""}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value;
                setWorkerId(value === "" ? null : Number(value));
              }}
              className="w-full h-11 rounded-control border-2 bg-card px-3 text-[13px] disabled:opacity-50"
            >
              <option value="">Seçiniz…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.is_active ? "" : " (pasif)"}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {kind === "month" && (
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-muted-foreground px-1">Ay</span>
          <select
            aria-label="Ay"
            value={period}
            disabled={busy}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full h-11 rounded-control border-2 bg-card px-3 text-[13px] disabled:opacity-50"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {formatPeriod(p)}
              </option>
            ))}
          </select>
        </div>
      )}

      <Button
        className="w-full h-14 rounded-card flex items-center justify-center gap-2.5 font-semibold active:scale-[0.98] transition-all"
        onClick={handleExport}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <FileSpreadsheet className="w-5 h-5" />
        )}
        <span className="text-[13px]">{busy ? "Hazırlanıyor…" : "CSV İndir"}</span>
      </Button>

      <p className="text-[11px] text-center font-bold text-muted-foreground/70 px-4">
        Excel uyumlu: nokta ondalıklı tutarlar, Türkçe karakterler için BOM, noktalı virgül ayraç.
      </p>
    </div>
  );
}
