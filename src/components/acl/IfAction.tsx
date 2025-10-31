// src/components/acl/IfAction.tsx
//
// Purpose
// -------
// Sugar component for action-level RBAC on interactive controls (e.g., buttons, menu items).
// It uses <Acl> under the hood and provides ergonomics for:
//  • hide vs. disable when not allowed
//  • auto-adding aria-disabled + title (tooltip) when disabled
//  • render-prop pattern to pass `disabled` to children
//
// Typical usage
// -------------
// <IfAction actionId="students.create">
//   <button onClick={onCreate}>New Student</button>
// </IfAction>
//
// <IfAction actionId="billing.refund" whenDenied="disable" denyTitle="You lack refund permission">
//   {(disabled) => <Button disabled={disabled}>Refund</Button>}
// </IfAction>
//
// Notes
// -----
// • whenDenied = "hide" (default) will not render anything when access is denied.
// • whenDenied = "disable" will render the child but set disabled/aria-disabled + optional title.
// • You can also use `requires` (explicit permissions) instead of `actionId`.
// • This is a purely client-side UX guard; backend authorization remains authoritative.

import React from "react";
import Acl, { type AclProps } from "./Acl";

type WhenDeniedMode = "hide" | "disable";

type RenderChild =
  | React.ReactNode
  | ((disabled: boolean) => React.ReactElement<any, any> | null);

export interface IfActionProps
  extends Omit<AclProps, "pageId" | "fallback" | "as" | "debugAttrsOnly"> {
  /** What to do when access is denied. Default: "hide". */
  whenDenied?: WhenDeniedMode;
  /** Title/tooltip to show when rendered as disabled. */
  denyTitle?: string;
  /** Add data attributes for QA (no visible text). */
  debugAttrsOnly?: boolean;
  children: RenderChild;
}

export function IfAction(props: IfActionProps) {
  const {
    whenDenied = "hide",
    denyTitle,
    debugAttrsOnly = false,
    children,
    // Pass-through to Acl:
    actionId,
    requires,
    mode,
    meOverride,
  } = props;

  // Render branch for denied:
  const fallback =
    whenDenied === "hide"
      ? null
      : renderDisabled(children, denyTitle, debugAttrsOnly);

  return (
    <Acl
      actionId={actionId}
      requires={requires}
      mode={mode}
      meOverride={meOverride}
      fallback={fallback}
      debugAttrsOnly={debugAttrsOnly}
    >
      {renderEnabled(children, debugAttrsOnly)}
    </Acl>
  );
}

function renderEnabled(
  children: RenderChild,
  debugAttrsOnly: boolean
): React.ReactNode {
  if (typeof children === "function") {
    const el = children(false /* disabled */);
    return addDebugAttrs(el, { allowed: true, debugAttrsOnly });
  }
  return addDebugAttrs(children as React.ReactElement, {
    allowed: true,
    debugAttrsOnly,
  });
}

function renderDisabled(
  children: RenderChild,
  denyTitle?: string,
  debugAttrsOnly?: boolean
): React.ReactNode {
  if (typeof children === "function") {
    const el = children(true /* disabled */);
    return wrapAsDisabled(el, denyTitle, debugAttrsOnly);
  }
  return wrapAsDisabled(children as React.ReactElement, denyTitle, debugAttrsOnly);
}

function wrapAsDisabled(
  el: React.ReactElement | null,
  denyTitle?: string,
  debugAttrsOnly?: boolean
): React.ReactElement | null {
  if (!el) return el;

  // If the element supports `disabled`, set it; otherwise add aria-disabled.
  const props: any = {
    ...(denyTitle ? { title: denyTitle } : null),
    ...(debugAttrsOnly ? { "data-acl-disabled": "true" } : null),
  };

  const hasDisabledProp =
    typeof el.type === "string" // intrinsic element like 'button'
      ? "disabled" in (el.props ?? {})
      : // heuristic: if it already has disabled, preserve the pattern
        "disabled" in (el.props ?? {});

  if (hasDisabledProp) {
    props.disabled = true;
    props["aria-disabled"] = true;
    // Defensive: remove onClick-like handlers to avoid accidental execution
    for (const k of Object.keys(el.props || {})) {
      if (/^on[A-Z]/.test(k)) props[k] = undefined;
    }
  } else {
    // Non-button element → use aria-disabled and pointer-events:none via style
    props["aria-disabled"] = true;
    props.style = {
      ...(el.props?.style || {}),
      pointerEvents: "none",
      opacity: typeof el.props?.style?.opacity === "number" ? el.props.style.opacity : 0.6,
    };
  }

  return React.cloneElement(el, props);
}

function addDebugAttrs(
  node: React.ReactElement | null,
  opts: { allowed: boolean; debugAttrsOnly: boolean }
): React.ReactElement | null {
  if (!node || !opts.debugAttrsOnly) return node;
  const extra = opts.allowed
    ? { "data-acl-allowed": "true" }
    : { "data-acl-denied": "true" };
  return React.cloneElement(node, { ...(node.props || {}), ...extra });
}

export default IfAction;
