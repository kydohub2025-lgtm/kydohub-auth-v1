---

# common_mistakes.md

*(Frequent LLM/FE/BE pitfalls & anti-patterns — core v3)*

### Multi-tenant & IDs

* ❌ Queries without `tenantId` in the predicate or index prefix.
  ✅ Always `{ tenantId, ... }` first; include `tenantCode` only for logs/exports.
* ❌ Accepting cross-tenant `ObjectId`s on writes.
  ✅ Verify referenced `studentId/contactId/roomId` belong to the same `tenantId`.

### Authority vs. cache

* ❌ Driving permissions or pickup codes from `students.contactsLite[]`.
  ✅ Truth lives in `student_contact_links` (+ `contacts.pickup.defaultCode`). Rebuild `contactsLite` after changes.

### Links & uniqueness

* ❌ Multiple links for the same `(studentId, contactId)`.
  ✅ Enforce unique index `{ tenantId, studentId, contactId }`.
* ❌ Colliding pickup override codes.
  ✅ Unique sparse `{ tenantId, "pickupCode.override": 1 }`.

### Email/login

* ❌ Global unique on `contacts.profile.email`.
  ✅ Partial unique per tenant only when email exists / login enabled.

### Schedules & dates

* ❌ Free-form times.
  ✅ Use `"HH:MM-HH:MM"` or `null` for `schedule.{mon..sun}`.
* ❌ Ignoring tenant timezone.
  ✅ All time math uses `tenants.school.timeZone`.

### Rooms & assignments

* ❌ Overwriting assignments to “move” a student/staff.
  ✅ Close old (`effectiveTo=now`) and **append** a new assignment in the target room. Consider a transaction if touching two rooms.

### Validation & seeding

* ❌ Heavy `$expr` rules during initial imports causing failures.
  ✅ Start with `$jsonSchema` only; add `$expr` after seed/migration passes.
* ❌ Omitting audit on writes.
  ✅ Always set `audit.created*/updated*`; prefer soft delete (`deleted*/deletedAt`).

### Null vs missing

* ❌ Mixing semantics.
  ✅ **Known empty → `null`**, **unknown/not applicable → omit**. Supports partial indexes & cleaner queries.

### Indexing

* ❌ Creating non-tenant-prefixed indexes.
  ✅ Prefix every index with `tenantId`.
* ❌ Missing user queries in specs.
  ✅ Document “why” per index (search, roster, status filters).

### API & DTOs

* ❌ FE recomputes permissions/“effectivePickupCode”.
  ✅ Return server-computed, UI-ready DTOs.
* ❌ No pagination/sort.
  ✅ Provide stable sorts (name/status/date) and limit/skip.

### Governance & PII

* ❌ Logging emails/phones unredacted.
  ✅ Redact PII in logs; always log `{ tenantId, actorUserId, entityIds }`.

---
