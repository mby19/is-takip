import { create } from "zustand";

/**
 * Puantaj hücresindeki kısa ömürlü geri bildirim.
 *
 * Her dokunuşta ekranı kapatan toast yerine tek hücrede iki şey olur:
 * kısa bir renk parlaması ve (varsa) birkaç saniye sonra solar "Geri al".
 * Yanlış tıklama 50 kişilik ekipte sık; geri alabilme kaybolursa bu geri
 * dönüşsüz bir veri kaybı olurdu — bu yüzden bildirim sadeleşti, yok edilmedi.
 *
 * Durum `CalendarView`'un state'i DEĞİL: oraya konduğunda bir hücreye dokunmak
 * ayın 31 satırının hepsini geçersiz kılardı (`memo`'lanmış `CalendarRow`
 * yine tutmaz). Ayrı bir store'da ve hücre başına abonelikle, geri bildirim
 * yalnızca değişen hücrenin kendisini yeniden çizer.
 */

/** Başarı yeşil, temizleme gri, hata kırmızı parlar. */
export type FeedbackTone = "success" | "cleared" | "error";

export interface CellFeedbackEntry {
  /** Her dokunuşta artar; parlamanın yeniden başlamasını sağlar. */
  token: number;
  tone: FeedbackTone | null;
  /** `null` ise bu dokunuşta geri al yok. */
  undo: (() => void | Promise<void>) | null;
  /** Geri alma zincirinin başladığı durum — ardışık dokunuşlarda hep bu değere dönülür. */
  base: unknown;
}

/** Parlamanın görünme süresi. */
export const FLASH_WINDOW = 520;
/** "Geri al" düğmesinin ekranda kalma süresi. */
export const UNDO_WINDOW = 3000;

const flashTimers = new Map<string, number>();
const undoTimers = new Map<string, number>();

/** Her dokunuşta artar; aynı hücrede parlama yeniden tetiklenirken çakışmayı önler. */
let tokenSeq = 0;

const cancel = (timers: Map<string, number>, key: string) => {
  // `clearTimeout(undefined)` spec gereği no-op; koruma gerekmez.
  clearTimeout(timers.get(key));
  timers.delete(key);
};

interface CellFeedbackState {
  entries: Record<string, CellFeedbackEntry | undefined>;
  /**
   * Hücrede kısa bir geri bildirim başlatır.
   *
   * `undo` verilmezse hücredeki MEVCUT geri alma dokunulmaz: bir yazma hatası
   * başarılı bir değişikliğin geri alma düğmesini silmemelidir.
   */
  pulse: (
    key: string,
    tone: FeedbackTone,
    options?: { undo?: () => void | Promise<void>; base?: unknown },
  ) => void;
  /** Geri bildirimi ve zamanlayıcılarını hemen kaldırır. */
  clear: (key: string) => void;
}

export const useCellFeedbackStore = create<CellFeedbackState>((set, get) => ({
  entries: {},

  pulse: (key, tone, options) => {
    const previous = get().entries[key];
    const token = ++tokenSeq;
    const undo = options?.undo ?? null;

    // Aynı hücreye art arda dokunulduğunda önceki zamanlayıcılar iptal edilir;
    // aksi hâlde ilk dokunuşun parlaması ikinciyi kısa, ilk dokunuşun geri al
    // düğmesi ikinciyi 3 saniye tutardı — iki zamanlayıcı birbirinin işini bozardı.
    cancel(flashTimers, key);
    cancel(undoTimers, key);

    set((state) => ({
      entries: {
        ...state.entries,
        [key]: {
          token,
          tone,
          undo,
          base: options && "base" in options ? options.base : (previous?.base ?? null),
        },
      },
    }));

    flashTimers.set(
      key,
      window.setTimeout(() => {
        flashTimers.delete(key);
        set((state) => {
          const entry = state.entries[key];
          if (!entry || entry.token !== token) return state;
          const next = { ...state.entries };
          // Geri al düğmesi duruyorsa kayıt kalmaya devam eder, yalnız parlama söner.
          if (entry.undo) next[key] = { ...entry, tone: null };
          else delete next[key];
          return { entries: next };
        });
      }, FLASH_WINDOW),
    );

    if (!undo) return;
    undoTimers.set(
      key,
      window.setTimeout(() => {
        undoTimers.delete(key);
        set((state) => {
          const entry = state.entries[key];
          if (!entry || entry.token !== token) return state;
          const next = { ...state.entries };
          delete next[key];
          return { entries: next };
        });
      }, UNDO_WINDOW),
    );
  },

  clear: (key) => {
    cancel(flashTimers, key);
    cancel(undoTimers, key);
    set((state) => {
      if (!state.entries[key]) return state;
      const next = { ...state.entries };
      delete next[key];
      return { entries: next };
    });
  },
}));

/** Yalnızca verilen hücrenin geri bildirimine abone olur. */
export const useCellFeedback = (key: string): CellFeedbackEntry | undefined =>
  useCellFeedbackStore((state) => state.entries[key]);

/** Dokunma anında mevcut geri bildirimi okur — render sırasında DEĞİL. */
export const readCellFeedback = (key: string): CellFeedbackEntry | undefined =>
  useCellFeedbackStore.getState().entries[key];
