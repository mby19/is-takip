import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// DEBUG: Gerçek cihazlarda beyaz/siyah ekran hatasını yakalamak için
window.onerror = function (msg, url, line, _col, _error) {
  alert("JS HATASI: " + msg + "\nSatır: " + line + "\nURL: " + url);
  return false;
};

window.onunhandledrejection = function (event) {
  alert("PROMISE HATASI: " + event.reason);
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
