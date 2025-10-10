Here’s a compact `schema_cheatsheet.md` you can auto-load with Quickstart (≤500 tokens).

---

# schema_cheatsheet.md (core v3)

## Global

* Every doc: `tenantId:ObjectId`, `tenantCode:string`, `schemaVersion:int`, `audit{createdAt,createdBy,updatedAt,updatedBy[,deleted*]}`.
* Always filter by `tenantId`. `tenantCode` is for logs/exports.
* **Null vs missing:** known-empty → `null`; unknown/not-applicable → omit.
* **Authority vs cache:** Only link tables are authoritative for roles/permissions; `contactsLite[]` is display-only.

## Tenants (v1)

Config brain per school.

```
{ school{name,timeZone,branding,license{capacity},desiredCapacity?},
  contacts?, hours?, closures?, programs[], billing?, tax?, paymentProviders?,
  enrollmentPolicy?, pickupPolicy?, attendance?, health?, consentsDefault?,
  meals?, transport?, geo?, notifications?, language?, integrations?,
  features?, custom?, status }
```

Used by theming, policies, billing, localization.

## Students (v2.1)

Canonical child record.

```
{ student{name{first,last,preferred?},gender,birthday{y,m,d},birthdayDate?},
  school{status,studentId?,program?,roomId?,schedule?}, medical?, attachments?,
  contactsLite?[], custom?, audit }
```

`contactsLite[]` is a **cache**; rebuild after contact/link changes.

## Contacts (v2)

One person (guardian/family/pickup), optional login.

```
{ profile{name{first,last,preferred?},email?,phones[]?,address?,notes?},
  account?{status,role?,lastLoginAt?,inviteSentAt?,verifiedEmail?},
  pickup?{defaultCode?,photoUrl?,idRequired?}, billing?, custom?, audit }
```

## Student_Contact_Links (v2)

Authoritative per-student role/permissions.

```
{ studentId, contactId, role(guardian|family|pickup),
  capabilities?{canReceiveUpdates,canViewPayments,canMessage,canPickup},
  invite?{status,invitedAt?,acceptedAt?,revokedAt?},
  pickupCode?{override?},
  billingForThisStudent?{isPayer?,payerSharePercent?,notes?},
  legal?, audit }
```

**Effective pickup code:** `links.pickupCode.override ?? contacts.pickup.defaultCode ?? null`.

## Rooms (v1)

Classroom/space + time-bounded assignments.

```
{ room{name,code?,type?,status,minAgeMonths,maxAgeMonths,
       capacity{maxStudents}, ratio{studentsPerStaff}, schedule?, location?, tags?, notes?},
  assignments?{ staff[], students[] }, audit }
```

Current = `effectiveTo == null || effectiveTo > now`.

## Staff (v1)

Employee record.

```
{ profile{name,email?,phones[]?,photoUrl?,status},
  employment{position,role?,hireDate,terminationDate?,workSchedule?,roomAssignments[]?},
  account?, emergencyContacts[]?, documents[]?, custom?, audit }
```

## Read/Write Gold

* FE lists use server-computed DTOs (don’t recompute auth/permissions client-side).
* Add/modify relationships via **student_contact_links**, then refresh `students.contactsLite`.
* Moving rooms: close old assignment (`effectiveTo`), append new in target room.

## Index Hints

* Prefix with `tenantId` everywhere.
* Uniques: `(tenantId, room.code?)`, `(tenantId, room.name)`, `(tenantId, studentId, contactId)`, partial unique on `contacts.profile.email` if used for login.