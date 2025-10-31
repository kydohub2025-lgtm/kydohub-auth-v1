/**
 * src/pages/SignupPage.tsx
 * -----------------------------------------------------------------------------
 * ✅  Secure, production-ready Sign-Up page for the multi-tenant SaaS platform.
 *
 * Flow:
 *  1. User submits name, email, password.
 *  2. Supabase creates the auth user.
 *  3. Backend `/api/v1/auth/signup` endpoint:
 *        - creates tenant (school/day-care)
 *        - creates membership (role = owner)
 *        - issues refresh + access cookies
 *  4. Redirect to `/auth/exchange` for context bootstrap.
 * -----------------------------------------------------------------------------
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { useToast } from "../hooks/use-toast";
import { fetchJson } from "../lib/http";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!
);

export const SignupPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast?.() || {};
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    orgName: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Step 1 → Create user in Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: { data: { full_name: form.name } },
      });
      if (error || !data.user) throw error;

      // Step 2 → Register tenant + membership in backend
      const res = await fetchJson("/api/v1/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          orgName: form.orgName,
        }),
      });

      if (!res.ok) throw new Error("Backend signup failed");

      toast?.({ title: "Account created!", duration: 2000 });
      navigate(`/auth/exchange?code=${data.session?.access_token || ""}`, {
        replace: true,
      });
    } catch (err: any) {
      console.error("Signup failed:", err);
      toast?.({
        title: "Signup failed",
        description: err.message || "Please try again later.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <form
        onSubmit={handleSignup}
        className="w-full max-w-sm bg-white p-6 rounded-xl shadow-md space-y-4"
      >
        <h1 className="text-2xl font-semibold text-center">Create Account</h1>

        <input
          type="text"
          name="name"
          placeholder="Full Name"
          value={form.name}
          onChange={handleChange}
          required
          className="w-full p-2 border rounded-md"
        />

        <input
          type="text"
          name="orgName"
          placeholder="Organization / School Name"
          value={form.orgName}
          onChange={handleChange}
          required
          className="w-full p-2 border rounded-md"
        />

        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
          className="w-full p-2 border rounded-md"
        />

        <input
          type="password"
          name="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
          className="w-full p-2 border rounded-md"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Sign Up"}
        </button>

        <div className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <span
            onClick={() => navigate("/login")}
            className="text-blue-600 cursor-pointer hover:underline"
          >
            Sign in
          </span>
        </div>
      </form>
    </div>
  );
};
