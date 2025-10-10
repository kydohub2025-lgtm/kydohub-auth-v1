---

# multi_tenant_design.md

*tenantId/tenantCode usage, cross-tenant safety rules (core v3)*

## 1) Goals

* **Isolation first:** every read/write is scoped to a single tenant.
* **Human-friendly ops:** logs/exports stay readable without risking isolation.
* **Predictable performance:** all hot indexes are tenant-prefixed.

---

## 2) Tenant identifiers

* **`tenantId:ObjectId` (authoritative)**

  * Used in all predicates, joins, and index prefixes.
  * Never accept writes that do not include `tenantId`.
* **`tenantCode:string` (human-readable)**

  * Used for logs, CSV exports, UX routes, and API paths.
  * May be duplicated in documents for traceability (e.g., links) but **never** used alone for DB scoping.

**Invariant:** Every collection requires `{ tenantId, tenantCode, schemaVersion, audit{…} }`.

---

## 3) Query rules (DO)

* Always start with a tenant filter:

  ```js
  db.students.find({ tenantId, "school.status": "active" })
  ```
* Aggregations: `$match` on `tenantId` **first**:

  ```js
  [
    { $match: { tenantId } },
    // lookups follow…
  ]
  ```
* When joining, filter the foreign collection by the **same** `tenantId`:

  ```js
  { $lookup: {
      from: "student_contact_links",
      let: { sid: "$_id", t: "$tenantId" },
      pipeline: [{ $match: { $expr: { $and: [
        { $eq: ["$tenantId", "$$t"] },
        { $eq: ["$studentId", "$$sid"] }
      ]}}}],
      as: "links"
  }}
  ```

---

## 4) Write rules (DO)

* Validate that **all referenced IDs** belong to the same `tenantId`.
  Example: on creating a link, confirm `student.tenantId === contact.tenantId === body.tenantId`.
* For cross-doc operations (e.g., moving a student between rooms), wrap in a **single-tenant transaction**; never span tenants.
* Maintain audit fields on every write; prefer **soft delete**.

---

## 5) Things to never do (DON’T)

* ❌ Query by `tenantCode` alone.
* ❌ Cross-tenant `$lookup` or updates.
* ❌ Global unique indexes without `tenantId` prefix.
* ❌ Drive permissions from caches (e.g., `students.contactsLite[]`).

---

## 6) Index strategy (prefix with tenantId)

Create indexes with `tenantId` **first**, then the domain key:

* Students: `{ tenantId:1, "student.name.last":1, "student.name.first":1 }`
* Contacts: `{ tenantId:1, "profile.email":1 }` (**partial unique** if login/email present)
* Links: `{ tenantId:1, studentId:1, contactId:1 }` (**unique**)
* Rooms: `{ tenantId:1, "room.code":1 }` (**unique, sparse**), `{ tenantId:1, "room.name":1 }` (**unique**)
* Staff: `{ tenantId:1, "profile.status":1 }`

> Keep an index spec file with a **“why”** note per index to prevent accidental drift.

---

## 7) API surface & middleware

* **Routing:** `/v1/:tenantCode/...` is fine for UX; resolve `tenantCode → tenantId` once, then pass `tenantId` through the request context.
* **Guard middleware (pseudocode):**

  ```ts
  // attachTenant.ts
  const tenant = await Tenants.findOne({ tenantCode, status: "active" });
  req.ctx.tenantId = tenant._id;
  // forbid requests that include a mismatched tenantId in body/query
  ```
* **DTOs:** Always return **server-computed** fields (e.g., `effectivePickupCode`) to avoid FE recomputation.

---

## 8) Authorization & RBAC (data expectations)

* Data layer does not enforce RBAC; API must check roles/capabilities from:

  * `student_contact_links.capabilities` (per-student)
  * `staff.account.role` / platform roles
* Never infer auth from caches or display fields.

---

## 9) Data movement & migrations

* Each doc carries `schemaVersion`.
* Use `collMod` + idempotent index scripts per release.
* **Single-tenant migrations:** operate tenant-by-tenant when safe; keep a resume token to avoid cross-tenant mistakes.
* Backfills that touch multiple collections must enforce `tenantId` at each step.

---

## 10) Caching & denormalization

* Allowed caches: `students.contactsLite[]` (UI snapshot).
* Rebuild caches **server-side** after mutations to `contacts` or `student_contact_links`.
* Never persist computed aggregates long-term; compute on read or cache with TTL.

---

## 11) Observability & logs

* Log context objects with `{ tenantId, tenantCode, actorUserId, entityIds… }`.
* Redact PII (emails/phones).
* Emit domain events (e.g., `link.invited`, `pickup.override_set`) for audits.

---

## 12) PII, privacy, and secrets

* Keep provider secrets **out** of tenant docs; store references only.
* If using field-level encryption, manage a separate `field_policies` registry per tenant for sensitive paths.

---

## 13) Testing checklist

* ✓ Queries without `tenantId` → should fail tests.
* ✓ Cross-tenant ID attempts → rejected by validation layer.
* ✓ Index creation scripts assert tenant-prefixed keys.
* ✓ Aggregations start with `{ $match: { tenantId } }`.
* ✓ Cache rebuilds do not leak data across tenants.

---

## 14) Quick copy-paste snippets

**Find active students by name (tenant-safe):**

```js
db.students.find({
  tenantId,
  "school.status": "active",
  "student.name.last": /^Sm/i
})
```

**Roster with guardians (skeleton):**

```js
[{ $match: { tenantId, _id: roomId } },
 { $project: { assignments: 1 } },
 { $unwind: "$assignments.students" },
 { $match: { "assignments.students.effectiveTo": null } },
 /* $lookup links & contacts with tenantId matching as shown earlier */
]
```

---

## 15) TL;DR

* **Always** tenant-match first, index with `tenantId` first, and validate foreign IDs belong to the same tenant.
* Use `tenantCode` for humans; use `tenantId` for the database.
* Caches are for display; authority lives in normalized collections (especially `student_contact_links`).
