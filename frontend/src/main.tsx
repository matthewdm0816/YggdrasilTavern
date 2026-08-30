import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./AppShell";
import { AuthGate } from "./components/AuthGate";
import "./styles/app.css";

function applyInitialTheme(): void {
  let preference = "system";
  try {
    const saved = window.localStorage.getItem("yggdrasil-tavern.theme");
    if (saved === "light" || saved === "dark" || saved === "system") preference = saved;
  } catch (cause) {
    console.error("Unable to read the initial theme preference from localStorage.", cause);
  }
  const resolved = preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : preference === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

applyInitialTheme();

const client = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </AuthGate>
  </React.StrictMode>
);
