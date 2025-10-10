---

# AuthN/AuthZ Collections (KydoHub)

This spec defines the **authorization-side** collections that sit alongside your existing school data (tenants, students, contacts, rooms, links). Everything is **multi-tenant**: always include `tenantId` in writes, queries, and indexes.

---

## 1) `users` — identity directory (minimal)

**Purpose**: Link KydoHub users to Supabase identities; light profile used in `/me/context`.

**Document shape**

```jsonc
{
  "_id": "u_8f3...",                // string ObjectId or ULID; app uses "userId" externally
  "userId": "sbp_2c1...",           // Supabase auth user.id (primary external id)
  "email": "alex@sunrise.com",
  "displayName": "Alex",
  "avatarUrl": "https://…",         // optional
  "createdAt": "2025-10-10T09:12:33Z",
  "updatedAt": "2025-10-10T09:12:33Z"
}
```

**Indexes**

* `{ userId: 1 }` **unique**
* `{ email: 1 }` (sparse, optional)

**Notes**

* No tenant scope here (a single user can belong to many tenants via `memberships`).

---

## 2) `memberships` — user ↔ tenant link (+ ABAC)

**Purpose**: The **source of truth** for a user’s roles and per-tenant attributes (rooms, guardianOf). This powers RBAC + ABAC and `/me/context`.

**Document shape**

```jsonc
{
  "_id": "m_d1a...",
  "tenantId": "t1",
  "userId": "sbp_2c1...",
  "roles": ["teacher"],             // e.g., owner|admin|teacher|assistant|parent|billing_manager
  "attrs": {
    "rooms": ["room-a","room-b"],   // staff scoping (room _ids or codes)
    "guardianOf": ["stu_101","stu_203"] // parent scoping (student ids)
  },
  "status": "active",               // active|suspended|invited
  "createdAt": "2025-10-10T09:12:33Z",
  "updatedAt": "2025-10-10T09:12:33Z"
}
```

**Indexes**

* `{ tenantId: 1, userId: 1 }` **unique**
* `{ tenantId: 1, roles: 1 }` (multi-key; helps admin screens)
* `{ tenantId: 1, "attrs.rooms": 1 }` (optional; if you filter by room often)

**Notes**

* Populate `attrs.guardianOf` from the **student↔contact link** collection during onboarding/sync.
* Keep `roles` small (names), use `roles` collection to expand to permissions.

---

## 3) `roles` — permission bundles

**Purpose**: Map role names to permission strings (`resource.action`). Can be global templates, then copied/overridden per tenant.

**Document shape**

```jsonc
{
  "_id": "r_teach_t1",
  "tenantId": "t1",                  // allow per-tenant overrides
  "name": "teacher",
  "permissions": [
    "students.view",
    "students.list_room",
    "attendance.mark",
    "messages.send"
  ],
  "system": false,                   // true for KydoHub-managed global roles (read-only)
  "createdAt": "2025-10-10T09:12:33Z",
  "updatedAt": "2025-10-10T09:12:33Z"
}
```

**Indexes**

* `{ tenantId: 1, name: 1 }` **unique**
* `{ tenantId: 1 }` (for admin listings)

**Notes**

* Keep permissions **flat strings**; avoid nested objects to simplify checks & caching.

---

## 4) `ui_resources` — server-owned menu & actions

**Purpose**: The server’s canonical list of **pages** and **actions** (with required permissions) that the frontend renders. This prevents hardcoding gates in the FE.

**Document shape**

```jsonc
{
  "_id": "ui_t1",
  "tenantId": "t1",
  "pages": [
    { "id": "dashboard",  "title": "Dashboard",  "requires": [], "path": "/dashboard", "icon": "layout-dashboard" },
    { "id": "students",   "title": "Students",   "requires": ["students.view"], "path": "/students" },
    { "id": "attendance", "title": "Attendance", "requires": ["attendance.mark"], "path": "/attendance" }
  ],
  "actions": [
    { "id": "student.view",    "requires": ["students.view"] },
    { "id": "attendance.mark", "requires": ["attendance.mark"] }
  ],
  "version": 3, // optional: bump to force FE reloads if you cache client-side
  "updatedAt": "2025-10-10T09:12:33Z"
}
```

**Indexes**

* `{ tenantId: 1 }`

**Notes**

* Keep **one document per tenant** (or a global default duplicated at tenant creation).

---

## 5) `refresh_sessions` — long-lived session registry (optional but recommended)

**Purpose**: Track refresh tokens/devices, support logout-all and audits. Useful for **mobile** (Bearer tokens). Web cookies can work without this, but having it adds control.

**Document shape**

```jsonc
{
  "_id": "rs_7a2...",
  "tenantId": "t1",
  "userId": "sbp_2c1...",
  "jti": "b4b7-…",                    // refresh token id
  "device": { "client": "mobile", "name": "iPhone 15", "fingerprint": "…" },
  "ip": "203.0.113.10",
  "expiresAt": "2025-11-10T09:12:33Z",
  "createdAt": "2025-10-10T09:12:33Z",
  "revokedAt": null
}
```

**Indexes**

* `{ tenantId: 1, userId: 1, jti: 1 }` **unique**
* `{ expiresAt: 1 }`  (TTL if you prefer; see lifecycle)
* `{ tenantId: 1, userId: 1, revokedAt: 1 }`

**Lifecycle**

* Add a TTL index on `expiresAt` if you don’t need historical analytics: `db.refresh_sessions.createIndex({expiresAt:1}, {expireAfterSeconds:0})`.

---

## 6) (Cache) Redis keys — not a collection, but part of design

**Purpose**: Performance + control. All keys are **ephemeral**; Mongo is the source of truth.

* `ev:{tenantId}:{userId}` → integer **epoch/version**. Bump when roles or membership change to trigger `EV_OUTDATED`.
* `permset:{tenantId}:{userId}` → cached flattened `permissions[]` (JSON) with TTL (e.g., 15m).
* `jti:block` → a **set** of revoked JTI values for instant logout-all / compromise response.

---

## Relationships with your existing data

* **Students**: ABAC limits lists/views; staff see only `currentRoomId ∈ attrs.rooms`, parents see only `_id ∈ attrs.guardianOf`.
* **Student ↔ Contact links**: Use this collection to compute `guardianOf` for **parent** memberships.
* **Rooms**: Your room assignment data (time-bounded) is the source to populate `attrs.rooms` for **staff**.

---

## Query patterns (write them once, reuse everywhere)

* **Load membership + roles for a request**

  ```js
  const mem = await memberships.findOne({ tenantId, userId });
  const roles = await rolesColl.find({ tenantId, name: { $in: mem.roles } }).toArray();
  ```
* **Build permissions set**

  ```js
  const permissions = new Set(roles.flatMap(r => r.permissions));
  ```
* **ABAC filter for students (server-side)**

  ```js
  // Admin shortcut:
  if (permissions.has("students.list_all")) q = { tenantId };
  // Staff by room:
  else if (permissions.has("students.list_room")) q = { tenantId, currentRoomId: { $in: mem.attrs.rooms } };
  // Parent by guardianship:
  else if (permissions.has("students.list_guardian")) q = { tenantId, _id: { $in: mem.attrs.guardianOf } };
  else q = { tenantId, _id: { $in: [] } }; // deny
  ```

---

## Indexing rules of thumb

1. **Always** start compound indexes with `tenantId`.
2. For high-fanout lists (students/staff by room), index the scoped field:

   * students: `{ tenantId: 1, currentRoomId: 1 }` (already in your domain collections)
3. Keep `roles.permissions` as an array of strings—no need to index it. Authorization checks are in-memory after fetch.

---

## Seeding plan (bootstrap & per-tenant)

**On founding tenant creation**

1. Insert `roles` for: `owner`, `admin`, `teacher`, `assistant`, `parent`, `billing_manager`, `support_viewer`.
2. Insert `ui_resources` with default pages/actions for education SaaS.
3. Create `users` record for the founder (link Supabase `user.id`).
4. Create `memberships` for founder with roles `["owner"]`.

**On staff invite acceptance**

* Create/merge `users` (if not present) and `memberships` with role(s) from invite.
* Derive `attrs.rooms` from staff assignment (if known), else leave empty until assigned.

**On parent invite acceptance**

* Create/merge `users`, `memberships` with role `["parent"]`.
* Compute `attrs.guardianOf` from student-contact links for that parent.

---

## Example documents (copy/paste)

**roles (teacher)**

```json
{
  "tenantId": "t1",
  "name": "teacher",
  "permissions": ["students.view","students.list_room","attendance.mark","messages.send"]
}
```

**memberships (teacher)**

```json
{
  "tenantId": "t1",
  "userId": "sbp_2c1...",
  "roles": ["teacher"],
  "attrs": { "rooms": ["room-a","room-b"], "guardianOf": [] },
  "status": "active"
}
```

**ui_resources (t1)**

```json
{
  "tenantId": "t1",
  "pages": [
    { "id": "dashboard", "title": "Dashboard", "requires": [] },
    { "id": "students",  "title": "Students",  "requires": ["students.view"], "path": "/students" },
    { "id": "attendance","title": "Attendance","requires": ["attendance.mark"], "path": "/attendance" }
  ],
  "actions": [
    { "id": "student.view",    "requires": ["students.view"] },
    { "id": "attendance.mark", "requires": ["attendance.mark"] }
  ]
}
```

---

## Migration & evolution notes

* If you later support **custom roles**, keep the same structure; just add a UI to edit `roles.permissions`.
* To deprecate a permission safely:

  1. Ship backend change to ignore it,
  2. Bump `ui_resources.version`,
  3. Sweep role docs to remove the old string.

---

## Operational guardrails

* **EV bump on change**: When `memberships.roles` or any `roles.permissions` change for a user, bump `ev:{tenantId}:{userId}` in Redis. Clients receive `401 EV_OUTDATED` and refresh silently.
* **Logout-all**: Add JTI to `jti:block` set; mobile/web sessions become invalid immediately.
* **Least privilege**: Keep parent role minimal; staff permissions derived from function (teacher vs assistant).

---

### Done criteria for DB layer

* Collections exist with indexes above.
* Seed script creates default roles + ui_resources per tenant and an owner membership.
* `/me/context` assembles from `memberships`, `roles`, and `ui_resources` in ≤150ms P95 (Mongo-only), ≤60ms P95 (with Redis permset cache).

---

If you want, next I’ll generate a tiny **`GET /me/context` FastAPI route** that reads these collections and returns a response matching `me_context_schema.json`.
