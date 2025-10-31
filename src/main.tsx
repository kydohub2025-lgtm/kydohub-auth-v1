/**
 * src/main.tsx
 * -----------------------------------------------------------------------------
 * App entrypoint.
 * - StrictMode + ErrorBoundary + Suspense around the whole app
 * - AuthProvider + TenantProvider wrap routing BEFORE anything renders
 * - Inline fallback to avoid dependency on LoadingScreen until it exists
 * -----------------------------------------------------------------------------
 */

import React, { Suspense } from "react";
import "@/index.css";
import ReactDOM from "react-dom/client";

import { ErrorBoundary } from "@/components/errors/ErrorBoundary";
import App from "@/App";

const InlineFallback = () => (
  <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
    <div aria-busy="true" aria-label="Loading">Loading…</div>
  </div>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<InlineFallback />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
