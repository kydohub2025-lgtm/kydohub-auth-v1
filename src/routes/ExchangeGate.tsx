/**
 * src/routes/ExchangeGate.tsx
 * -----------------------------------------------------------------------------
 * ✅ Handles Supabase → Backend session exchange.
 *
 * Flow:
 * 1. Supabase redirects user here with a temporary code.
 * 2. This component calls /api/v1/auth/exchange to mint backend cookies.
 * 3. On success, it navigates to the app (or ?next target).
 * 4. On failure, it shows a graceful retry prompt.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchJson } from "../lib/http"; // ✅ using relative import now
import { useToast } from "../hooks/use-toast"; // optional toast hook (if exists)

export const ExchangeGate: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast?.() || {};
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");

  useEffect(() => {
    const code = searchParams.get("code");
    const next = searchParams.get("next") || "/";

    if (!code) {
      setStatus("error");
      return;
    }

    const doExchange = async () => {
      try {
        const res = await fetchJson("/api/v1/auth/exchange", {
          method: "POST",
          body: JSON.stringify({ code }),
        });

        if (res?.ok) {
          setStatus("success");
          toast?.({ title: "Login successful", duration: 2000 });
          navigate(next, { replace: true });
        } else {
          throw new Error("Exchange failed");
        }
      } catch (err) {
        console.error("Exchange failed:", err);
        setStatus("error");
      }
    };

    doExchange();
  }, [navigate, searchParams]);

  if (status === "pending") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <p>Authorizing, please wait...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
        <div>
          <h3>Authorization failed</h3>
          <button onClick={() => navigate("/login", { replace: true })}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return null; // success → navigated away
};
