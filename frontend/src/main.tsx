import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./AppShell";
import { AuthGate } from "./components/AuthGate";
import { initializeTheme, ThemeErrorNotice } from "./features/theme";
import "./styles/app.css";
import "./styles/workspace.css";
import "./styles/theme.css";

void initializeTheme();

const client = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeErrorNotice />
    <AuthGate>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </AuthGate>
  </React.StrictMode>
);
