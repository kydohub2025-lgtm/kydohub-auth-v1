/**
 * src/components/LogoutButton.tsx
 * -----------------------------------------------------------------------------
 * Purpose
 *  - One-click, safe logout control for the KydoHub frontend.
 *  - Navigates to the dedicated /logout page, which already performs:
 *      • Supabase sign-out (frontend)
 *      • Backend refresh revoke (/api/v1/auth/logout)
 *      • UI context/cache clear + redirect to /signin
 *
 * Why navigate instead of calling APIs here?
 *  - Keeps all logout side-effects in ONE place (the LogoutPage).
 *  - Avoids duplicating logic across Navbar, Sidebar, AccountMenu, etc.
 *
 * Usage
 *  <LogoutButton />            // default text button
 *  <LogoutButton as="icon" />  // icon-only button (for compact nav bars)
 *
 * Security
 *  - No tokens are handled here. The LogoutPage handles the secure flows.
 * -----------------------------------------------------------------------------
 */

import React from "react";
import { useNavigate } from "react-router-dom";

type LogoutButtonProps = {
  /** If "icon", renders a minimal icon-only control. Default is text button. */
  as?: "text" | "icon";
  /** Optional className to style/position in toolbars/menus. */
  className?: string;
  /** Optional override for the label when as="text". */
  label?: string;
  /** Optional title/aria-label for accessibility. */
  title?: string;
  /** Optional onClick tap-in (fires before navigation). */
  onClick?: () => void;
};

export const LogoutButton: React.FC<LogoutButtonProps> = ({
  as = "text",
  className,
  label = "Sign out",
  title = "Sign out of KydoHub",
  onClick,
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    try {
      onClick?.();
    } catch {
      // ignore consumer onClick errors and still try to logout
    }
    // Navigate to the central logout workflow page.
    navigate("/logout");
  };

  if (as === "icon") {
    return (
      <button
        type="button"
        aria-label={title}
        title={title}
        onClick={handleClick}
        className={className}
      >
        {/* Simple fallback icon (SVG) to avoid extra deps. Replace with your UI lib icon if desired. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path d="M16 17v-2h-5v-2h5V11l3 3-3 3zM14 3a2 2 0 012 2v3h-2V5H6v14h8v-3h2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h8z" />
        </svg>
      </button>
    );
  }

  // Default text/button variant
  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={className}
    >
      {label}
    </button>
  );
};

export default LogoutButton;
