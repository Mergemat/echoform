import * as Sentry from "@sentry/electron/renderer";

Sentry.init({
  dsn: "https://156315951684d5acfd672d49d6bd1e8a@o4507184585244672.ingest.de.sentry.io/4511141666816080",
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.2,
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import App from "./App.tsx";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
