// src/components/errors/ErrorBoundary.tsx
//
// Purpose
// -------
// A production-ready React Error Boundary that catches render-time exceptions
// anywhere below it, shows a friendly fallback UI, and (optionally) reports
// the error to the backend. We also export a *route-aware* wrapper that
// automatically resets on route changes.
//
// Why this matters
// ----------------
// • Prevents a white screen when a component throws.
// • Gives users a way to recover (Try again / Reload).
// • Lets us log unexpected UI crashes for triage.
// • Plays nicely with React Router by resetting on navigation.
//
// How to use (simple)
// -------------------
// Wrap your app shell in the route-aware boundary:
//   import { RouteAwareErrorBoundary } from "@/components/errors/ErrorBoundary";
//   <RouteAwareErrorBoundary>
//     <AppLayout />
//   </RouteAwareErrorBoundary>
//
// Or for a single page/feature:
//   <ErrorBoundary><StudentsPage /></ErrorBoundary>
//
// Security & Privacy
// ------------------
// • We sanitize payloads before sending to backend.
// • Reporting is opt-in via `report={true}` (default: false).
//
// Dependencies
// ------------
// • React 18+
// • react-router-dom (for the route-aware wrapper)
// • Optional: src/lib/http.ts (we guard the import; if missing, reporting is skipped)

import React, { Component, ReactNode } from "react";
import { useLocation } from "react-router-dom";

// Lazy import http client (so this file works even if http.ts isn't present yet)
let http: any = null;
try {
  // Use relative import to stay compatible with Lovable's constraints
  // If you move this file, update the path accordingly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  http = require("../../lib/http");
} catch {
  // no-op: error reporting to backend will be disabled
}

// -----------------------------
// Default fallback UI component
// -----------------------------
type DefaultFallbackProps = {
  error?: Error | null;
  onRetry?: () => void;
};

export function DefaultFallback({ error, onRetry }: DefaultFallbackProps) {
  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <div className="rounded-2xl border bg-white/80 dark:bg-neutral-900/60 backdrop-blur p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-4">
          The page hit an unexpected error. You can try again. If the problem
          persists, please contact support.
        </p>

        {error ? (
          <pre className="text-xs overflow-auto rounded-md bg-neutral-100 dark:bg-neutral-800 p-3 mb-4">
            {sanitizeErrorMessage(error)}
          </pre>
        ) : null}

        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium shadow-sm border bg-white hover:bg-neutral-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium shadow-sm bg-black text-white hover:bg-neutral-800"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// ErrorBoundary (class component)
// -----------------------------
type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * Optional custom fallback:
   *  - ReactNode: <MyFallback />
   *  - (error, reset) => ReactNode: (err, reset) => <MyFallback ... />
   */
  fallback?: ReactNode | ((error: Error | null, reset: () => void) => ReactNode);
  /** Called when an error is caught (telemetry hook). */
  onError?: (error: Error, info: { componentStack: string }) => void;
  /** If true, attempts to POST details to /api/v1/client-errors (via http.ts). */
  report?: boolean;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Local console log for dev/diagnostics
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Caught error:", error, info?.componentStack);

    // Propagate to caller (e.g., Sentry, custom logger)
    this.props.onError?.(error, { componentStack: info?.componentStack ?? "" });

    // Optional: report to backend
    if (this.props.report && http?.post) {
      // Best-effort: do not block UI
      void http.post("/api/v1/client-errors", {
        message: sanitizeErrorMessage(error),
        name: error?.name,
        stack: limitLength(error?.stack ?? "", 6000),
        componentStack: limitLength(info?.componentStack ?? "", 6000),
        url: window.location.href,
        userAgent: navigator.userAgent,
        ts: new Date().toISOString(),
      }).catch(() => {
        // swallow network/reporting errors silently
      });
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      if (typeof fallback === "function") {
        return (fallback as (e: Error | null, reset: () => void) => ReactNode)(error, this.reset);
      }
      if (fallback) return fallback;
      return <DefaultFallback error={error ?? undefined} onRetry={this.reset} />;
    }

    return children;
  }
}

// ----------------------------------------
// Route-aware wrapper (auto-resets on nav)
// ----------------------------------------
type RouteAwareProps = Omit<ErrorBoundaryProps, "children"> & { children: ReactNode };

/**
 * Wraps ErrorBoundary and resets it when the route changes
 * (by keying the boundary with the current location.key).
 */
export function RouteAwareErrorBoundary(props: RouteAwareProps) {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.key} {...props}>
      {props.children}
    </ErrorBoundary>
  );
}

// -----------------------------
// Small internal helpers
// -----------------------------
function sanitizeErrorMessage(error: Error | string | unknown): string {
  try {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    if (typeof error === "string") return error;
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function limitLength(s: string, max: number): string {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + " …(truncated)" : s;
}

export default RouteAwareErrorBoundary;
