import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initErrorMonitoring } from "./lib/errorMonitoring";
import "./index.css";

initErrorMonitoring();

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
