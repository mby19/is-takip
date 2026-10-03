import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initErrorMonitoring, reportError } from "./lib/errorMonitoring";
import { useToastStore } from "./stores/toastStore";
import { useThemeStore, type ThemePalette } from "./stores/themeStore";
import "./index.css";

// Tema, React'in ilk render'ından ÖNCE uygulanır. Aksi halde varsayılan
// koyu temayla açılışta ~300ms beyaz flaş olurdu (effect sonrası uygulama).
// Bu satır `index.html`'deki statik `class="dark"` ile aynı değeri üretir;
// farkı, kullanıcının kaydettiği tercihin ilk kareden itibaren geçerli olması.
const applyTheme = ({ mode, palette }: { mode: "light" | "dark"; palette: ThemePalette }) => {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.setAttribute("data-palette", palette);
};

// Açılışta anında, sonrasında her değişiklikte.
applyTheme(useThemeStore.getState());
useThemeStore.subscribe(applyTheme);

initErrorMonitoring();

// Yakalanmamış hatalar: kullanıcıya alert yerine toast, geliştiriciye Sentry.
window.addEventListener("error", (event) => {
  const error = event.error instanceof Error ? event.error : new Error(String(event.message));
  console.error("[window.onerror]", error);
  reportError(error, { source: event.filename, line: event.lineno });
  useToastStore.getState().addToast("Beklenmeyen bir hata oluştu.", "error");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[unhandledrejection]", error);
  reportError(error, { scope: "unhandledrejection" });
  useToastStore.getState().addToast("Bir işlem tamamlanamadı.", "error");
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
