/**
 * src/pages/LoginPage.tsx
 * -----------------------------------------------------------------------------
 * Production-ready login page aligned with backend /auth/exchange contract.
 *
 * Flow:
 *  1) Authenticate with Supabase (email+password).
 *  2) POST /api/v1/auth/exchange with { provider:"supabase", token, client:"web" }.
 *     - 200/204: backend mints secure cookies → redirect to next (or "/").
 *     - 209: multiple tenants — backend returns { tenants: [...] } → we route
 *            to /auth/switch after stashing tenants in sessionStorage.
 *  3) No tokens are stored in localStorage; cookies are httpOnly (backend).
 * -----------------------------------------------------------------------------
 */

import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { useToast } from "../hooks/use-toast";
import { fetchJson } from "../lib/http";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const { toast } = useToast?.() || {};

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((v) => ({ ...v, [e.target.name]: e.target.value }));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Step 1: Supabase sign-in
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      if (error || !data.session?.access_token) {
        throw new Error(error?.message || "Invalid credentials");
      }

      const token = data.session.access_token;

      // Step 2: Exchange with KydoHub backend (mint cookies)
      const res = await fetchJson("/api/v1/auth/exchange", {
        method: "POST",
        body: JSON.stringify({
          provider: "supabase",
          token,
          client: "web",
          // tenantHint: optional — populate if you already know it
        }),
      });

      // Handle 209 Tenant Choice
      if (res.status === 209) {
        const payload = await res.json().catch(() => ({}));
        if (payload?.tenants?.length) {
          sessionStorage.setItem("tenantChoices", JSON.stringify(payload.tenants));
          toast?.({ title: "Choose an organization" });
          navigate("/auth/switch?next=" + encodeURIComponent(next), { replace: true });
          return;
        }
        throw new Error("Multiple tenants but none returned.");
      }

      if (!res.ok) {
        // Common auth failures
        if (res.status === 401 || res.status === 403) {
          throw new Error("Authentication failed. Please try again.");
        }
        const errText = await res.text().catch(() => "");
        throw new Error(errText || "Login failed. Please try again.");
      }

      // 200/204 → cookies set; go to next
      toast?.({ title: "Welcome back!" });
      navigate(next, { replace: true });
    } catch (err: any) {
      console.error(err);
      toast?.({
        title: "Login failed",
        description: err?.message || "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm bg-white p-6 rounded-xl shadow-md space-y-4"
      >
        <h1 className="text-2xl font-semibold text-center">Sign In</h1>

        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
          autoComplete="username"
          className="w-full p-2 border rounded-md"
        />

        <input
          type="password"
          name="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
          autoComplete="current-password"
          className="w-full p-2 border rounded-md"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>

        <div className="text-center text-sm text-gray-500">
          Don’t have an account?{" "}
          <span
            className="text-blue-600 cursor-pointer hover:underline"
            onClick={() => navigate("/signup")}
          >
            Create one
          </span>
        </div>
      </form>
    </div>
  );
};
