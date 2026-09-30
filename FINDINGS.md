# Findings

`npm test` is expected to report failures for the tests named below. Those
assertions describe the README / `auth-guards` contract. The product still
does the wrong thing, so the tests stay red until someone fixes the code.
I have not changed application logic.

Five verified bugs. One auto-map quirk is recorded at the bottom as suspected,
not verified.

---

## 1. Anonymous search leaks draft and expired catalogue pricing

**What happens**

`GET /api/catalogues/[slug]/search` loads `status` and `expiresAt` and never
uses them. Anyone with the slug gets product names, SKUs and `offerPrice` —
including the confidential Northstar draft and the expired monsoon campaign.

**Steps to reproduce**

1. Do not sign in.
2. Open `http://localhost:3001/api/catalogues/festive-overstock-2026/search?q=atlas`
3. Open `http://localhost:3001/api/catalogues/monsoon-clearance-2026/search?q=pulse`

**What should happen instead**

A draft is internal: outsiders should not reach it or its contents (same as
the HTML page, which 404s). An expired catalogue must not present stale prices
as if they were still on offer. Search should return no listings / no prices
(I am not insisting on a particular status code).

**Impact — how bad is this, and why?**

This is the commercial leak the README warns about. Draft search returns the
Northstar negotiated offer price with no login. Expired search returns a price
that is no longer valid. A buyer or a competing seller who guesses or is
forwarded the slug can undercut or honour a closed deal.

**Failing tests**

`tests/api/public-catalogue.test.ts` —
`does not expose draft catalogue contents or prices to an anonymous caller`

`tests/api/public-catalogue.test.ts` —
`does not return offer prices for a catalogue whose validity date has passed`

---

## 2. Staff can publish and delete on the server

**What happens**

README and `auth-guards.ts` say only an admin may publish (exposes pricing)
or delete (destroys lead history). `setCatalogueStatus` enforces that. Three
other server paths do not:

- `deleteCatalogue` — any signed-in user
- `PATCH /api/admin/catalogues/[id]` with `status: "published"` — any signed-in user
- `createCatalogueWithProducts({ publish: true })` — any signed-in user

The UI hides publish/delete on the table dropdown (`canManage`), but the edit
dialog still has a Status select, New catalogue still has a publish checkbox,
and the API/actions accept the call.

**Steps to reproduce**

1. Sign in as `staff@catalogue.test` / `Staff#2026`.
2. Create a draft catalogue, then `PATCH /api/admin/catalogues/{id}` with
   `status: "published"` (or tick Publish on New catalogue).
3. Call the `deleteCatalogue` server action for a catalogue with no enquiries.

**What should happen instead**

The server should refuse with an admin-only error, the same way
`setCatalogueStatus` already does. Hiding a button is not access control.

**Impact — how bad is this, and why?**

A staff user (or anyone who steals a staff session) can put confidential
pricing on the public internet, or delete a catalogue. Delete is blocked by
Prisma only when enquiries exist; empty or new catalogues are destroyed.
This is a privilege-escalation bug, not a UI polish issue.

**Failing tests**

`tests/api/admin-access.test.ts` —
`deleteCatalogue refuses staff, because deleting destroys lead history`

`tests/api/admin-access.test.ts` —
`PATCH /api/admin/catalogues/:id refuses a staff user publishing a draft`

`tests/api/admin-access.test.ts` —
`createCatalogueWithProducts refuses staff when publish is true`

The same file has a **passing** test that `setCatalogueStatus` does refuse
staff, so the intended rule is visible next to the holes.

---

## 3. `effectiveStatus` treats future dates as expired and past dates as live

**What happens**

```
if (status === "published" && expiresAt && expiresAt > new Date()) return "expired";
```

A published catalogue that **expires in the future** is labelled expired. One
whose date **has passed** is labelled live. The helper's own comment says the
opposite. The public page (`getPublishedCatalogue`) and the dashboard live
count use the correct direction, so admin list/search disagree with buyers.

**Steps to reproduce**

1. Sign in as admin. Open `/admin/catalogues`.
2. Look at **Monsoon clearance 2026** (`expiresAt` 15 Aug 2026; today is after
   that). The public link shows “This catalogue has expired”. The admin table
   uses `effectiveStatus` and will show it as Live.

**What should happen instead**

Past `expiresAt` → expired. Future or null `expiresAt` → published. That is
what the comment in `src/lib/catalogue-status.ts` already describes.

**Impact — how bad is this, and why?**

Sales can share a link they think is live that buyers see as closed, or treat
a closed campaign as live in admin. Command palette status is also wrong.
Not a data leak by itself; it is how the team decides what to send to buyers.

**Failing tests**

`tests/unit/catalogue-status.test.ts` —
`treats a published catalogue past its validity date as expired`

`tests/unit/catalogue-status.test.ts` —
`keeps a published catalogue with a future validity date as published`

---

## 4. The enquiry API creates leads on draft and expired catalogues

**What happens**

`POST /api/enquiries` checks that listings exist, are visible, and that qty is
inside `[MOQ, stock]`. It does not check that the catalogue is published or
still within its validity date. With a catalogue UUID (from a previously live
page, from admin, or from anywhere the id leaks), a buyer can submit a lead
against confidential or stale prices. The handler currently returns 201 and
writes the row.

**Steps to reproduce**

1. From the database (or an admin session) take the id of
   `festive-overstock-2026` and a listed product id.
2. `POST /api/enquiries` with name, phone, that `catalogueId`, and a legal qty.
3. Repeat for `monsoon-clearance-2026`.

A new `ENQ-…` appears in the leads inbox for each.

**What should happen instead**

No new enquiry/lead should be created for a draft or expired catalogue. The
README forbids showing draft contents and stale prices as current. I am **not
certain** of the intended HTTP status — the assessment materials do not
specify 403, 404, or 409 — so the attached tests only check that no lead row
is written.

**Impact — how bad is this, and why?**

The lead exists in the inbox with a price snapshot, so sales may treat closed
or confidential pricing as an active request. Medium: you need the UUID, not
just the slug. Combined with finding 1 (search) it is worse.

**Failing tests**

`tests/api/public-catalogue.test.ts` —
`does not create a lead against a draft catalogue`

`tests/api/public-catalogue.test.ts` —
`does not create a lead against an expired catalogue`

---

## 5. Listing PATCH is not scoped to the catalogue id in the URL

**What happens**

`PATCH /api/admin/catalogues/[id]/listings/[listingId]` checks that the
catalogue id exists, then `updateMany({ where: { id: listingId } })` with no
`catalogueId`. A listing from catalogue B can be hidden or have its badges
changed while the URL points at catalogue A. Revalidation runs for A, so B’s
public page can stay stale.

**Steps to reproduce**

1. Sign in as staff or admin.
2. `PATCH /api/admin/catalogues/{catalogueA}/listings/{listingB}` with
   `{ "isVisible": false }` where `listingB` belongs to another catalogue.

**What should happen instead**

The request must not modify a listing that belongs to another catalogue.
403, 404, or 400 would all be acceptable ways to refuse; the contract is the
listing on catalogue B staying unchanged.

**Impact — how bad is this, and why?**

Staff-only, so this is not the anonymous leak. A confused or malicious staff
request can hide a product on the wrong campaign. Tampered-id case from Task 3.

**Failing test**

`tests/api/admin-access.test.ts` —
`does not update a listing that belongs to a different catalogue`

---

## Uncertainties / suspected but unverified

### Spreadsheet `autoMap` and “Minimum Order Quantity”

`autoMap` normalises headers and uses substring `includes()`. A header
`Minimum Order Quantity` becomes `minimumorderquantity`, which matches the
stock synonym `"quantity"` before `moq` is considered, so the column is
auto-mapped to available quantity. `SYNONYMS.moq` does list `"minimumorder"`,
which is why this looks suspicious.

I am **not** treating it as a confirmed bug:

- ASSESSMENT.md and README.md never say that exact English header must map
  to MOQ. The sample sheet uses `"MOQ"` and `"Available Quantity"`, which
  already map correctly.
- Import is “map columns, review the report, then commit.” The UI lets the
  operator override the auto-map before saving. A wrong hint is not the same
  as writing the wrong field with no review.

I left it here rather than in the verified list so it is not scored as a
planted defect I invented a contract for.
