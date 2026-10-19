import React from "react";
import { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./AppShell";
import { AuthGate } from "./components/AuthGate";
import { applyFontSizeSettings } from "./components/DisplaySettings";
import { initializeTheme, ThemeErrorNotice } from "./features/theme";
import "./styles/app.css";
import "./styles/workspace.css";
import "./styles/theme.css";
import "./styles/mobile.css";

void initializeTheme();
applyFontSizeSettings();

function AccountApplication() {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><App /></QueryClientProvider>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeErrorNotice />
    <AuthGate>
      <AccountApplication />
    </AuthGate>
  </React.StrictMode>
);
