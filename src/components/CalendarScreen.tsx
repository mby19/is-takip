import { ClipboardList, Sun, Moon } from "lucide-react";
import { useThemeStore } from "../stores/themeStore";
import { CalendarView } from "./CalendarView";
import { SpinWheelDialog } from "./SpinWheelDialog";
import type { Worker } from "../types";

interface CalendarScreenProps {
  onDayClick: (date: string) => void;
  onWorkerClick: (worker: Worker) => void;
}

export function CalendarScreen({ onDayClick, onWorkerClick }: CalendarScreenProps) {
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);

  return (
    <div className="flex flex-col h-full overflow-hidden animate-scale-in">
      <header className="pt-14 pb-4 px-5 border-b bg-card shrink-0 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">İş Takip</h1>
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
      <div className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden relative">
        <CalendarView
          onDayClick={(date) => onDayClick(date)}
          onWorkerClick={(worker) => onWorkerClick(worker)}
        />
      </div>
    </div>
  );
}
