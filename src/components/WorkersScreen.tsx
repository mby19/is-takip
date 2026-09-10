import { useState } from "react";
import {
  Users,
  UserPlus,
  Wallet,
  Handshake,
  Sun,
  Moon,
  Archive,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useThemeStore } from "../stores/themeStore";
import { SpinWheelDialog } from "./SpinWheelDialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { Worker } from "../types";

interface WorkersScreenProps {
  onWorkerClick: (worker: Worker) => void;
}

export function WorkersScreen({ onWorkerClick }: WorkersScreenProps) {
  const workers = useWorkerStore((s) => s.workers);
  const workerError = useWorkerStore((s) => s.error);
  const isLoading = useWorkerStore((s) => s.isLoading);
  const addWorker = useWorkerStore((s) => s.addWorker);
  const updateWorkerStatus = useWorkerStore((s) => s.updateWorkerStatus);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const [showArchived, setShowArchived] = useState(false);

  const activeWorkers = workers.filter((w) => w.is_active !== false);
  const archivedWorkers = workers.filter((w) => w.is_active === false);

  return (
    <div className="flex flex-col h-full overflow-hidden animate-scale-in">
      <header className="pt-14 pb-4 px-5 bg-card border-b shrink-0 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">Ekip</h1>
            <p className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
              {activeWorkers.length} kişi aktif
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SpinWheelDialog />
          <button
            onClick={toggleMode}
            className="w-10 h-10 rounded-xl bg-muted/40 hover:bg-muted flex items-center justify-center transition-all active:scale-95"
          >
            {mode === "dark" ? (
              <Sun className="w-5 h-5 text-amber-400" />
            ) : (
              <Moon className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-2.5 pb-28">
        {workerError && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold animate-slide-up">
            Hata: {workerError}
          </div>
        )}

        {isLoading && workers.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {/* Aktif Çalışanlar */}
        <div className="stagger-children space-y-3">
          {activeWorkers.map((w: Worker) => (
            <div
              key={w.id}
              onClick={() => onWorkerClick(w)}
              className="p-3.5 rounded-xl border bg-card flex justify-between items-center active:scale-[0.98] transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm transition-transform group-active:scale-90 ${w.worker_type === "ORTAK" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"}`}
                >
                  {w.worker_type === "ORTAK" ? (
                    <Handshake className="w-4 h-4" />
                  ) : (
                    <Wallet className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <p className="font-bold text-sm tracking-tight">{w.name}</p>
                  <p
                    className={`text-[9px] uppercase tracking-wider font-bold ${w.worker_type === "ORTAK" ? "text-amber-600 dark:text-amber-500" : "text-primary"}`}
                  >
                    {w.worker_type === "ORTAK" ? "Ortak" : "Yevmiyeli"}
                  </p>
                </div>
              </div>
              {w.worker_type === "GUNLUK" && (
                <div className="text-right">
                  <div className="text-primary font-black text-lg font-mono tracking-tight">
                    ₺{w.daily_wage}
                  </div>
                  <div className="text-[8px] uppercase text-muted-foreground font-bold tracking-widest">
                    Yevmiye
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Arşivlenmiş Çalışanlar */}
        {archivedWorkers.length > 0 && (
          <div className="mt-6 space-y-2">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-muted/30 border border-border hover:bg-muted/50 transition-all active:scale-[0.99]"
            >
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-black text-muted-foreground uppercase tracking-wider">
                  Arşivlenmiş ({archivedWorkers.length})
                </span>
              </div>
              {showArchived ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {showArchived && (
              <div className="space-y-2 animate-slide-up">
                {archivedWorkers.map((w: Worker) => (
                  <div
                    key={w.id}
                    className="p-3.5 rounded-xl border border-dashed bg-muted/20 flex justify-between items-center opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted text-muted-foreground">
                        <Archive className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-sm tracking-tight text-muted-foreground">
                          {w.name}
                        </p>
                        <p className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground/60">
                          {w.worker_type === "ORTAK" ? "Ortak" : "Yevmiyeli"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        updateWorkerStatus(w.id, true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary font-bold text-[10px] uppercase tracking-wider transition-all active:scale-95"
                      title="Tekrar Aktif Et"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Aktifleştir
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <AddWorkerDialog onAdd={addWorker} />
      </div>
    </div>
  );
}

function AddWorkerDialog({
  onAdd,
}: {
  onAdd: (name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [wage, setWage] = useState("600");
  const [type, setType] = useState<"GUNLUK" | "ORTAK">("GUNLUK");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full rounded-2xl border-dashed border-2 h-16 text-base font-bold gap-2 hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-all duration-300 active:scale-95"
        >
          <UserPlus className="w-5 h-5" /> Yeni Kişi Ekle
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl border-none shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Yeni Kişi Ekle</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label
              htmlFor="name"
              className="text-xs font-black uppercase tracking-widest opacity-60"
            >
              İsim Soyisim
            </Label>
            <Input
              id="name"
              placeholder="Örn: Ahmet Yılmaz"
              className="h-13 rounded-xl border-2 border-transparent bg-muted/50 font-bold text-base focus:border-primary focus:bg-background transition-all"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest opacity-60">
              Çalışan Türü
            </Label>
            <div className="flex gap-3">
              <button
                className={`flex-1 p-4 rounded-xl border-2 transition-all duration-300 flex flex-col items-center gap-2 active:scale-95 ${
                  type === "GUNLUK"
                    ? "border-blue-500 bg-blue-50 shadow-md shadow-blue-500/10"
                    : "border-muted bg-muted/30 hover:border-muted-foreground/20"
                }`}
                onClick={() => setType("GUNLUK")}
              >
                <Wallet
                  className={`w-6 h-6 ${type === "GUNLUK" ? "text-blue-600" : "text-muted-foreground"}`}
                />
                <span
                  className={`text-xs font-black uppercase ${type === "GUNLUK" ? "text-blue-600" : "text-muted-foreground"}`}
                >
                  Yevmiyeli
                </span>
              </button>
              <button
                className={`flex-1 p-4 rounded-xl border-2 transition-all duration-300 flex flex-col items-center gap-2 active:scale-95 ${
                  type === "ORTAK"
                    ? "border-amber-500 bg-amber-50 shadow-md shadow-amber-500/10"
                    : "border-muted bg-muted/30 hover:border-muted-foreground/20"
                }`}
                onClick={() => setType("ORTAK")}
              >
                <Handshake
                  className={`w-6 h-6 ${type === "ORTAK" ? "text-amber-600" : "text-muted-foreground"}`}
                />
                <span
                  className={`text-xs font-black uppercase ${type === "ORTAK" ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  Ortak
                </span>
              </button>
            </div>
          </div>
          {type === "GUNLUK" && (
            <div className="space-y-2 animate-slide-up">
              <Label
                htmlFor="wage"
                className="text-xs font-black uppercase tracking-widest opacity-60"
              >
                Günlük Yevmiye (₺)
              </Label>
              <Input
                id="wage"
                type="number"
                className="h-13 rounded-xl border-2 border-transparent bg-muted/50 font-bold text-base focus:border-primary focus:bg-background transition-all"
                value={wage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWage(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={async () => {
              if (!name.trim()) return;
              const finalWage = type === "ORTAK" ? 0 : parseFloat(wage);
              if (type === "GUNLUK" && (isNaN(finalWage) || finalWage <= 0)) return;
              await onAdd(name.trim(), finalWage, type);
              setOpen(false);
              setName("");
              setWage("600");
            }}
            disabled={!name.trim() || (type === "GUNLUK" && (!wage || parseFloat(wage) <= 0))}
            className="w-full h-13 rounded-2xl font-black shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
