import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initErrorMonitoring, reportError } from "./lib/errorMonitoring";
import { useToastStore } from "./stores/toastStore";
import "./index.css";

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
