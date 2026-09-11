import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

interface MonthPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Date;
  onSelect: (date: Date) => void;
}

export function MonthPickerDialog({ open, onOpenChange, value, onSelect }: MonthPickerDialogProps) {
  const [year, setYear] = useState(value.getFullYear());

  useEffect(() => {
    if (open) setYear(value.getFullYear());
  }, [open, value]);

  const today = new Date();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-sheet border-none shadow-2xl max-w-xs w-[90%] p-5">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-center text-base font-semibold">Dönem seç</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between bg-muted/50 rounded-control p-1 mb-4">
          <button
            onClick={() => setYear((y) => y - 1)}
            aria-label="Önceki yıl"
            className="w-10 h-9 flex items-center justify-center rounded-lg hover:bg-background active:scale-90 transition-all text-muted-foreground"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-base font-semibold tabular-nums">{year}</div>
          <button
            onClick={() => setYear((y) => y + 1)}
            aria-label="Sonraki yıl"
            className="w-10 h-9 flex items-center justify-center rounded-lg hover:bg-background active:scale-90 transition-all text-muted-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((label, index) => {
            const selected = value.getMonth() === index && value.getFullYear() === year;
            const isThisMonth = today.getMonth() === index && today.getFullYear() === year;
            return (
              <button
                key={label}
                onClick={() => {
                  onSelect(new Date(year, index, 1));
                  onOpenChange(false);
                }}
                className={`h-11 rounded-control text-[13px] font-medium transition-all active:scale-95 ${
                  selected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isThisMonth
                      ? "bg-muted/60 text-foreground ring-1 ring-inset ring-primary/40"
                      : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
