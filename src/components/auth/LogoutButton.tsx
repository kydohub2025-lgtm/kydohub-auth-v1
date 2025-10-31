// src/components/auth/LogoutButton.tsx
//
// Purpose
// -------
// One-click (with confirm) logout control that calls POST /auth/logout via our
// src/lib/auth/actions.ts wrapper. It handles UI states (busy, error) and
// optionally performs "logout from all devices" by passing { all: true }.
//
// Security / UX notes
// -------------------
// • No tokens are handled in JS; server clears HttpOnly cookies.
// • We disable the button during the request to avoid double submits.
// • On success, we redirect to a public route (default: "/login").
// • Errors are displayed non-intrusively below the button.
//
// Props
// -----
// - variant:   "primary" | "ghost" | "danger" (styling hint; tweak as needed)
// - size:      "sm" | "md"
// - confirm:   boolean (default true) — show a native confirm() before logout
// - all:       boolean (default false) — logout across all devices/sessions
// - label:     string (button text override; default depends on `all`)
// - redirectTo:string (default "/login") — where to send user post-logout
// - onDone:    (ok: boolean) => void — callback after attempt finishes
//
// Non-developer tip
// -----------------
// Drop <LogoutButton/> into your header/account menu. If you want to provide
// a separate “Logout all devices” action, render a second instance with all={true}.
//

import React, { useState } from "react";
import * as Auth from "@/lib/auth/actions";

type Props = {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirm?: boolean;
  all?: boolean;
  label?: string;
  redirectTo?: string;
  onDone?: (ok: boolean) => void;
};

export const LogoutButton: React.FC<Props> = ({
  variant = "ghost",
  size = "sm",
  confirm = true,
  all = false,
  label,
  redirectTo = "/login",
  onDone,
}) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const btnCls =
    variant === "primary"
      ? "inline-flex items-center justify-center rounded border border-transparent bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
      : variant === "danger"
      ? "inline-flex items-center justify-center rounded border border-transparent bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
      : // ghost
        "inline-flex items-center justify-center rounded border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-60";

  const padCls = size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-base";

  async function handleClick() {
    setErr(null);
    if (busy) return;

    if (confirm) {
      const msg = all
        ? "Log out from ALL devices? This signs you out everywhere."
        : "Log out from this device?";
      if (!window.confirm(msg)) {
        onDone?.(false);
        return;
      }
    }

    setBusy(true);
    try {
      await Auth.logout({ all });
      // After logout the server clears cookies; we navigate to a public screen.
      window.location.replace(redirectTo);
      onDone?.(true);
    } catch (e: any) {
      const msg =
        e?.error?.message ||
        e?.message ||
        "Failed to logout. Please try again.";
      setErr(msg);
      onDone?.(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={`${btnCls} ${padCls}`}
        aria-busy={busy ? "true" : "false"}
      >
        {busy ? "Signing out…" : label ?? (all ? "Logout all devices" : "Logout")}
      </button>
      {err && (
        <div role="alert" className="text-xs text-red-600">
          {err}
        </div>
      )}
    </div>
  );
};

export default LogoutButton;
