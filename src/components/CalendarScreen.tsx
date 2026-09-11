import { useState } from "react";
import { ChevronLeft, ChevronRight, Sun, Moon, ChevronDown } from "lucide-react";
import { format, addMonths, subMonths } from "date-fns";
import { tr } from "date-fns/locale";
import { useThemeStore } from "../stores/themeStore";
import { CalendarView } from "./CalendarView";
import { SpinWheelDialog } from "./SpinWheelDialog";
import { MonthPickerDialog } from "./MonthPickerDialog";
import type { Worker } from "../types";

interface CalendarScreenProps {
  onDayClick: (date: string) => void;
  onWorkerClick: (worker: Worker) => void;
}

export function CalendarScreen({ onDayClick, onWorkerClick }: CalendarScreenProps) {
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  // Ay durumu burada tutulur: başlık ve tablo aynı dönemi gösterir.
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/*
        Tek başlık bandı: ay seçimi uygulamanın adından daha işlevli olduğu için
 onun yerini alır. Böylece tabloya bir satır daha yer kalır.
      */}
      <header className="pt-safe-header pb-2.5 px-3 bg-surface shrink-0 flex items-center gap-1">
        <button
          onClick={() => setCurrentDate(subMonths(currentDate, 1))}
          aria-label="Önceki ay"
          className="w-10 h-10 rounded-control flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90 transition-all"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          onClick={() => setIsPickerOpen(true)}
          className="flex-1 min-w-0 h-10 rounded-control flex items-center justify-center gap-1.5 hover:bg-muted active:scale-[0.98] transition-all"
        >
          <span className="text-[17px] font-semibold tracking-tight capitalize truncate">
            {format(currentDate, "MMMM yyyy", { locale: tr })}
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>

        <button
          onClick={() => setCurrentDate(addMonths(currentDate, 1))}
          aria-label="Sonraki ay"
          className="w-10 h-10 rounded-control flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90 transition-all"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div className="w-px h-5 bg-border mx-0.5 shrink-0" />

        <SpinWheelDialog />
        <button
          onClick={toggleMode}
          aria-label={mode === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
          className="w-10 h-10 rounded-control flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground active:scale-90 transition-all shrink-0"
        >
          {mode === "dark" ? (
            <Sun className="w-[18px] h-[18px]" />
          ) : (
            <Moon className="w-[18px] h-[18px]" />
          )}
        </button>
      </header>

      <MonthPickerDialog
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        value={currentDate}
        onSelect={setCurrentDate}
      />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CalendarView
          currentDate={currentDate}
          onDayClick={onDayClick}
          onWorkerClick={onWorkerClick}
        />
      </div>
    </div>
  );
}
