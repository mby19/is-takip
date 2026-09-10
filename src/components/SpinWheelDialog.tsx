import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import { useWorkerStore } from "../stores/workerStore";
import { Dices, PartyPopper, Check, RotateCw } from "lucide-react";

export function SpinWheelDialog() {
  const { workers } = useWorkerStore();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);

  // Modal ilk açıldığında aktif çalışanları seçili hale getir
  useEffect(() => {
    setSelectedIds(new Set(workers.filter((w) => w.is_active).map((w) => w.id)));
  }, [workers]);

  const activeWorkers = workers.filter((w) => selectedIds.has(w.id));

  const toggleWorker = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const spin = () => {
    if (activeWorkers.length === 0 || isSpinning) return;
    setIsSpinning(true);
    setWinner(null);

    const winnerIndex = Math.floor(Math.random() * activeWorkers.length);
    const sliceAngle = 360 / activeWorkers.length;

    // Çarkın en tepesi 0 derecedir. Kazanacak dilimin tam ortasının (0) tepeye gelmesi gerekir.
    const centerOfWinner = winnerIndex * sliceAngle + sliceAngle / 2;
    const extraSpins = 360 * 6; // 6 tam tur

    const currentModulo = rotation % 360;
    const targetModulo = 360 - centerOfWinner;

    let rotationToAdd = targetModulo - currentModulo;
    if (rotationToAdd < 0) rotationToAdd += 360;

    const newRotation = rotation + extraSpins + rotationToAdd;

    setRotation(newRotation);

    setTimeout(() => {
      setWinner(activeWorkers[winnerIndex].name);
      setIsSpinning(false);
    }, 4000); // 4 saniyelik CSS transition
  };

  const colors = [
    "#f43f5e", // rose
    "#3b82f6", // blue
    "#10b981", // emerald
    "#f59e0b", // amber
    "#8b5cf6", // violet
    "#ec4899", // pink
    "#14b8a6", // teal
    "#f97316", // orange
    "#64748b", // slate
    "#84cc16", // lime
  ];

  const getConicGradient = () => {
    if (activeWorkers.length === 0) return "conic-gradient(#e2e8f0 0% 100%)";
    if (activeWorkers.length === 1) return `conic-gradient(${colors[0]} 0% 100%)`;

    const slicePercentage = 100 / activeWorkers.length;
    let gradient = "";
    activeWorkers.forEach((_, i) => {
      const color = colors[i % colors.length];
      gradient += `${color} ${i * slicePercentage}% ${(i + 1) * slicePercentage}%, `;
    });
    return `conic-gradient(${gradient.slice(0, -2)})`;
  };

  return (
    <Dialog
      onOpenChange={(isOpen) => {
        if (isOpen) {
          setWinner(null);
          setRotation(0);
        }
      }}
    >
      <DialogTrigger asChild>
        <button className="w-10 h-10 rounded-xl bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-all active:scale-95 group border border-primary/20">
          <Dices className="w-5 h-5 text-primary group-hover:-rotate-12 transition-transform duration-300" />
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-[36px] border-none shadow-2xl p-6 max-w-sm w-[95%]">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-center font-black text-xl">Kura Çarkı</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center py-2 space-y-6 overflow-hidden">
          {/* ÇARK KABUĞU */}
          <div className="relative w-64 h-64 flex items-center justify-center mt-2">
            {/* Gösterge Oku */}
            <div
              className="absolute -top-4 left-1/2 -translate-x-1/2 w-6 h-8 bg-foreground z-20"
              style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }}
            />

            {/* Çarkın Kendisi */}
            <div
              className="w-full h-full rounded-full border-4 border-muted overflow-hidden shadow-[inset_0_4px_12px_rgba(0,0,0,0.2)] relative"
              style={{
                background: getConicGradient(),
                transform: `rotate(${rotation}deg)`,
                transitionProperty: "transform",
                transitionDuration: "4s",
                transitionTimingFunction: "cubic-bezier(0.15, 0.9, 0.25, 1)",
              }}
            >
              {activeWorkers.map((w, i) => {
                const sliceAngle = 360 / activeWorkers.length;
                const rotationAngle = i * sliceAngle + sliceAngle / 2;
                return (
                  <div
                    key={w.id}
                    className="absolute w-62 h-62 top-0 left-0 flex justify-center items-start pt-6 text-white font-black text-[10px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                    style={{ transform: `rotate(${rotationAngle}deg)` }}
                  >
                    <span className="truncate max-w-20">{w.name.split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>

            {/* Merkez Nokta */}
            <div className="absolute w-8 h-8 bg-background rounded-full z-10 shadow-xl border-4 border-muted flex items-center justify-center">
              <div className="w-2 h-2 bg-primary rounded-full"></div>
            </div>
          </div>

          {/* SONUÇ & BİLGİ */}
          <div className="h-16 flex items-center justify-center w-full">
            {winner && !isSpinning ? (
              <div className="bg-primary/10 border-2 border-primary/20 text-primary px-6 py-3 w-full rounded-2xl font-black text-xl flex items-center justify-center gap-3 animate-scale-in">
                <PartyPopper className="w-6 h-6 animate-bounce" /> {winner}
              </div>
            ) : isSpinning ? (
              <div className="text-primary text-sm font-black animate-pulse flex items-center gap-2">
                <RotateCw className="w-4 h-4 animate-spin" /> Çark Dönüyor...
              </div>
            ) : (
              <div className="text-muted-foreground text-sm font-bold opacity-60">
                Şanslı kim olacak?
              </div>
            )}
          </div>

          <Button
            onClick={spin}
            disabled={isSpinning || activeWorkers.length === 0}
            className="w-full h-14 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 transition-all active:scale-95 border-b-4 border-primary/40 active:border-b-0 active:translate-y-1"
          >
            {isSpinning ? "BEKLENİYOR..." : "ÇEVİR"}
          </Button>

          {/* KATILIMCILAR */}
          <div className="w-full mt-4 bg-muted/30 p-3 rounded-2xl border border-border/50">
            <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground ml-1 mb-2">
              Katılımcılar ({activeWorkers.length})
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {workers
                .filter((w) => w.is_active)
                .map((w) => (
                  <button
                    key={w.id}
                    onClick={() => toggleWorker(w.id)}
                    disabled={isSpinning}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 transition-all shrink-0 text-xs font-bold active:scale-95 ${
                      selectedIds.has(w.id)
                        ? "border-primary bg-primary/5 text-foreground shadow-sm"
                        : "border-transparent bg-muted/50 text-muted-foreground opacity-50 grayscale"
                    }`}
                  >
                    {selectedIds.has(w.id) && <Check className="w-3.5 h-3.5 text-primary" />}
                    {w.name.split(" ")[0]}
                  </button>
                ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
