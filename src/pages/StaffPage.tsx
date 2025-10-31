import * as React from "react";
import { IfAction } from "@/components/acl/IfAction";
import { Button } from "@/components/ui/button";

// Legacy standalone Staff page (kept for compatibility with older routes).
// Modern routes use feature-scoped page at src/features/staff/pages/StaffPage.tsx.
export default function StaffPage() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Staff (Legacy)</h1>
          <p className="text-sm text-muted-foreground">This is a stub page kept for backward compatibility.</p>
        </div>
        <IfAction actionId="staff.create">
          <Button variant="outline">Add Staff</Button>
        </IfAction>
      </div>

      <div className="rounded-xl border p-6 text-sm text-muted-foreground">
        No staff members found.
        <div className="mt-3">
          <IfAction actionId="staff.create">
            <Button size="sm">Create your first staff member</Button>
          </IfAction>
        </div>
      </div>
    </div>
  );
}
