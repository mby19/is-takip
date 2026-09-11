import { create } from "zustand";

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  /** Bildirimin içindeki tek eylem — örn. bir değişikliği geri almak. */
  action?: ToastAction;
}

interface ToastOptions {
  type?: Toast["type"];
  action?: ToastAction;
  /** Milisaniye. Eylemli bildirimler daha uzun durur. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, typeOrOptions?: Toast["type"] | ToastOptions) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_DURATION = 3000;
const ACTION_DURATION = 6000;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, typeOrOptions) => {
    const options: ToastOptions =
      typeof typeOrOptions === "string" ? { type: typeOrOptions } : (typeOrOptions ?? {});

    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    const toast: Toast = { id, message, type: options.type ?? "info", action: options.action };

    set((state) => ({ toasts: [...state.toasts, toast] }));

    const duration = options.duration ?? (options.action ? ACTION_DURATION : DEFAULT_DURATION);
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
