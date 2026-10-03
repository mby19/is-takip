import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  Search,
  X,
} from "lucide-react";
import { useThemeStore } from "../stores/themeStore";
import { useWorkerStore } from "../stores/workerStore";
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
import { useModalStack } from "./modal-stack";
import { matchesTurkish } from "../utils/turkishCollation";
import { Label } from "./ui/label";
import type { Worker } from "../types";
import { WorkerAvatar } from "./ui/worker-avatar";
import { workerInitials } from "../utils/initials";
import { useToastStore } from "../stores/toastStore";

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
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { hasOpenModal } = useModalStack();
  const addToast = useToastStore((s) => s.addToast);

  // Liste türetmeleri veri değişmedikçe yeni referans üretmemeli: `workers`
  // her render'da yeni dizi olsa da filtre ve initials hesabı tekrarlanmasın.
  // Arama istemci tarafındadır — liste zaten bellekte, sunucuya gitmesine
  // gerek yok (60–100 kişi). `query` sabitken arama sonucu yeni referans
  // üretmez.
  const activeWorkers = useMemo(
    () =>
      query
        ? workers.filter(
            (w) => w.is_active !== false && matchesTurkish([w.name, w.short_label], query),
          )
        : workers.filter((w) => w.is_active !== false),
    [workers, query],
  );
  const initials = useMemo(() => workerInitials(workers), [workers]);
  const archivedWorkers = useMemo(() => workers.filter((w) => w.is_active === false), [workers]);

  /**
   * `/` veya Cmd/Ctrl+F arama kutusuna odaklanır — şantiyede eldivenle
   * çalışırken iki parmakla kısayol, fare hedefi aramaktan hızlıdır.
   *
   * Modal açıkken (çalışan ekleme) odak arkaya kaçmasın diye kısayol yok sayılır.
   * Yazarken `/` ve `Cmd/Ctrl+F` yazılacak karakterler olabildiği için bir
   * metin alanına odaktayken `/` yok sayılır.
   */
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || hasOpenModal) return;
      const isFind = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";
      const isSlash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isFind && !isSlash) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isSlash && typing) return;

      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [hasOpenModal]);

  /**
   * Escape aramadan çıkar: metin varsa temizlenir, kutu boşsa odak bırakılır.
   * `preventDefault` uygulamanın global geri işleyicisini (`useGlobalBack`) da
   * durdurur — bu ekrandan çıkılmasın, yalnız arama kapansın.
   */
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setQuery("");
    if (searchRef.current?.value) return;
    searchRef.current?.blur();
  };

  /**
   * Arşivden geri alma para/veri kaydı yaratır; hata yutulursa kullanıcı
   * "aktifleştirildi" sanıp ekranda görmeye devam eder. Bu yüzden await +
   * catch zorunlu, ayrıca in-flight guard ile çift tıklama engellenir.
   */
  const reactivate = useCallback(
    async (id: number) => {
      if (reactivatingId !== null) return;
      setReactivatingId(id);
      try {
        await updateWorkerStatus(id, true);
        addToast("Çalışan yeniden aktifleştirildi", "success");
      } catch (err: unknown) {
        addToast(
          `Aktifleştirilemedi: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      } finally {
        setReactivatingId(null);
      }
    },
    [reactivatingId, updateWorkerStatus, addToast],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden animate-screen-enter">
      <header className="pt-safe-header pb-4 px-5 bg-card border-b shrink-0 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-control bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Ekip</h1>
            <p className="text-[10px] font-bold text-muted-foreground  ">
              {query
                ? `${activeWorkers.length} kişi bulundu`
                : `${activeWorkers.length} kişi aktif`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SpinWheelDialog />
          <button
            onClick={toggleMode}
            aria-label={mode === "dark" ? "Aydınlık temaya geç" : "Koyu temaya geç"}
            aria-pressed={mode === "dark"}
            className="w-10 h-10 rounded-control bg-muted/40 hover:bg-muted flex items-center justify-center transition-all active:scale-95"
          >
            {mode === "dark" ? (
              <Sun className="w-5 h-5 text-amber-400" />
            ) : (
              <Moon className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
        </div>
      </header>

      {/* Arama kutusu — liste bellekte olduğu için filtre istemci tarafında. */}
      <div className="px-5 pb-3 bg-card border-b shrink-0">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Kişi ara…  (/)"
            aria-label="Kişi ara"
            className="h-10 pl-9 pr-9 rounded-control"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Aramayı temizle"
              className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-control flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-2.5 pb-safe-content">
        {workerError && (
          <div className="p-4 rounded-card bg-bad-soft border border-rose-100 dark:border-rose-500/20 text-bad text-xs font-bold animate-slide-up">
            Hata: {workerError}
          </div>
        )}

        {isLoading && workers.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {/* Ekip tamamen boşken tek satırlık yönlendirme. "Yeni Kişi Ekle"
            düğmesi zaten her durumda ekranın altında duruyor; buradaki metin
            yalnızca "verim nerede?" diyen kullanıcıya yedeği hatırlatır.
            Arama varken gösterilmez — arama tutmamışken bu metin yanıltır. */}
        {!query && !isLoading && workers.length === 0 && (
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed text-center px-4 py-1">
            Bu cihazda henüz veri yok. Başka bir cihazda kullandıysanız{" "}
            <span className="text-foreground">Ayarlar › Yedekleme</span> bölümünden geri
            yükleyebilirsiniz.
          </p>
        )}

        {/* Aktif Çalışanlar */}
        <div className="space-y-3">
          {activeWorkers.map((w: Worker) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onWorkerClick(w)}
              className="w-full text-left p-3 rounded-card surface-raised flex justify-between items-center gap-3 active:scale-[0.98] transition-all"
            >
              <span className="flex items-center gap-3 min-w-0">
                <WorkerAvatar worker={w} label={initials.get(w.id)} />
                <span className="min-w-0 block">
                  <span className="block text-[14px] font-medium tracking-tight truncate">
                    {w.name}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {w.worker_type === "ORTAK" ? "Ortak" : "Yevmiyeli"}
                  </span>
                </span>
              </span>
              {w.worker_type === "GUNLUK" && (
                <span className="text-[15px] font-semibold tabular-nums text-primary">
                  ₺{w.daily_wage.toLocaleString("tr-TR")}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Arama boş döndü: "liste boş" ile "arama tutmadı" ayrımı önemli,
            kullanıcı ikincisini listeyi kaybettiği sanır. */}
        {query && activeWorkers.length === 0 && (
          <div className="py-10 text-center">
            <Search className="w-6 h-6 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-[13px] font-medium text-muted-foreground">
              &quot;{query}&quot; için kişi bulunamadı
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Aksan ve büyük/küçük harf farkı yok sayılır; kısa etiketler de aranır.
            </p>
          </div>
        )}

        {/* Arşivlenmiş Çalışanlar */}
        {archivedWorkers.length > 0 && (
          <div className="mt-6 space-y-2">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-control bg-muted/30 border border-border hover:bg-muted/50 transition-all active:scale-[0.99]"
            >
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-muted-foreground" />
                <span className="text-[13px] font-medium text-muted-foreground  ">
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
                    className="p-3.5 rounded-control border border-dashed bg-muted/20 flex justify-between items-center opacity-70 hover:opacity-100 transition-opacity"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted text-muted-foreground">
                        <Archive className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-bold text-sm tracking-tight text-muted-foreground">
                          {w.name}
                        </p>
                        <p className="text-[10px] font-bold text-muted-foreground/60">
                          {w.worker_type === "ORTAK" ? "Ortak" : "Yevmiyeli"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => void reactivate(w.id)}
                      disabled={reactivatingId !== null}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-control bg-primary/10 hover:bg-primary/20 disabled:opacity-50 text-primary font-bold text-[10px] transition-all active:scale-95"
                      aria-label={`${w.name} kişisini yeniden aktifleştir`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {reactivatingId === w.id ? "Aktifleştiriliyor" : "Aktifleştir"}
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
  // Kaydet, kayıt tamamlanana kadar ikinci kez basılabilir: iki INSERT
  // çalışır ve aynı kişi iki kez listeye düşer. In-flight guard bunu keser.
  const [saving, setSaving] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const save = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const finalWage = type === "ORTAK" ? 0 : parseFloat(wage);
    if (type === "GUNLUK" && (isNaN(finalWage) || finalWage <= 0)) return;

    setSaving(true);
    try {
      await onAdd(trimmed, finalWage, type);
      setOpen(false);
      setName("");
      setWage("600");
    } catch (err: unknown) {
      addToast(`Kişi kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full rounded-card border-dashed border-2 h-16 text-base font-bold gap-2 hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-all duration-300 active:scale-95"
        >
          <UserPlus className="w-5 h-5" /> Yeni Kişi Ekle
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-sheet border-none shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Yeni Kişi Ekle</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-[13px] font-medium   opacity-60">
              İsim Soyisim
            </Label>
            <Input
              id="name"
              placeholder="Örn: Ahmet Yılmaz"
              className="h-13 rounded-control border-2 border-transparent bg-muted/50 font-bold text-base focus:border-primary focus:bg-background transition-all"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[13px] font-medium   opacity-60">Çalışan Türü</Label>
            <div className="flex gap-3">
              <button
                type="button"
                aria-pressed={type === "GUNLUK"}
                className={`flex-1 p-4 rounded-control border-2 transition-all duration-300 flex flex-col items-center gap-2 active:scale-95 ${
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
                  className={`text-[13px] font-medium  ${type === "GUNLUK" ? "text-blue-600" : "text-muted-foreground"}`}
                >
                  Yevmiyeli
                </span>
              </button>
              <button
                type="button"
                aria-pressed={type === "ORTAK"}
                className={`flex-1 p-4 rounded-control border-2 transition-all duration-300 flex flex-col items-center gap-2 active:scale-95 ${
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
                  className={`text-[13px] font-medium  ${type === "ORTAK" ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  Ortak
                </span>
              </button>
            </div>
          </div>
          {type === "GUNLUK" && (
            <div className="space-y-2 animate-slide-up">
              <Label htmlFor="wage" className="text-[13px] font-medium   opacity-60">
                Günlük Yevmiye (₺)
              </Label>
              <Input
                id="wage"
                type="number"
                className="h-13 rounded-control border-2 border-transparent bg-muted/50 font-bold text-base focus:border-primary focus:bg-background transition-all"
                value={wage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWage(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => void save()}
            disabled={
              saving || !name.trim() || (type === "GUNLUK" && (!wage || parseFloat(wage) <= 0))
            }
            className="w-full h-13 rounded-card font-semibold shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
