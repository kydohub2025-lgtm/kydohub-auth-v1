import * as React from "react";
import { IfAction } from "@/components/acl/IfAction";
import { Button } from "@/components/ui/button";

// Legacy standalone Students page (kept for compatibility with older routes).
// Modern routes use feature-scoped page at src/features/students/pages/StudentsPage.tsx.
export default function StudentsPage() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Students (Legacy)</h1>
          <p className="text-sm text-muted-foreground">This is a stub page kept for backward compatibility.</p>
        </div>
        <IfAction actionId="students.create">
          <Button variant="outline">Add Student</Button>
        </IfAction>
      </div>

      <div className="rounded-xl border p-6 text-sm text-muted-foreground">
        No students found.
        <div className="mt-3">
          <IfAction actionId="students.create">
            <Button size="sm">Create your first student</Button>
          </IfAction>
        </div>
      </div>
    </div>
  );
}
