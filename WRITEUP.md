# Write-up

## 1. Strategy

I started with what actually costs Surpluss money: pricing leaving the
building, and the two admin-only actions (publish and delete). The README is
explicit that a draft reaching the public, or one buyer seeing another’s
negotiated price, is a commercial problem. Task 3’s “check the server, not
just the screen” is the same risk from the other side.

Order of work:

1. Confirm leaks and authz holes with tests that fail on the current code
   (`FINDINGS.md`). I did not patch the product.
2. Cover the helpers where a silent wrong answer is expensive: discount /
   price-on-request, catalogue effective status, spreadsheet mapping and row
   validation, enquiry contact/qty rules.
3. API access-control: signed-out 401, staff vs admin, swapped listing ids,
   extra fields on a valid PATCH.
4. One Playwright journey that a real buyer and a real sales user would
   recognise.
5. This write-up.

Passing tests sit next to the failing ones on purpose. Example: the public
HTML page correctly 404s a draft and shows the expired landing page; search
and enquiry do not. `setCatalogueStatus` correctly refuses staff; delete /
PATCH / create do not. That contrast is the finding.

Five verified bugs. I demoted an import auto-map quirk (English header
“Minimum Order Quantity”) to suspected — the brief does not say that header
must map to MOQ, and the import UI lets you remap before commit.

## 2. The riskiest part of this product

If I had one week and could only protect one area, it would be **“is this
catalogue allowed to show prices to this caller?”**

That is one question with three doors today: the public page, public search,
and enquiry POST. Only the page answers it. Search returns Northstar offer
prices with no cookie. Enquiry will snapshot those prices into a lead if you
have the UUID. Staff can also publish through PATCH or create without being
admin.

If nobody tests this, a draft “pending sign-off” campaign becomes a public
price list, or an expired campaign keeps taking orders. That is lost margin
and a broken promise to the seller, not a cosmetic bug.

Concrete protection I’d want: one function, `assertPubliclyReadable(catalogue)`,
used by page, search and enquiry; and one `assertCanPublish(actor)` used by
every write path that can set `published` or delete.

## 3. What I left out, and why

- **Badges, banners, slug cosmetics, command palette UI, dashboard charts.**
  Wrong badges look untidy. Wrong prices lose deals.
- **Image upload, SES, WATI, Mailchimp, Google Places.** Blank env on
  purpose; 503 / skip is specified. No signal in testing the stub.
- **Archive/restore, per-city stock, category rename.** Real product surface,
  but not in the assessment’s “hurt us most” list, and easy to get wrong in
  a 4–6 hour window.
- **Auth CSRF ceremony as the thing under test.** README already documents
  it. E2E signs in through the form instead.
- **A second Playwright test** (login failure, expired page, staff cannot
  see a delete button). The assessment asked for one journey. UI hiding of
  delete is already the wrong layer to trust; the server test covers it.
- **CI, load, AI-extraction bonus.** Would do CI next (see below) if I had
  leftover time. I did not.

Uncertainties I did not invent an answer for:

- README says 9 products; seed has 8. Tests use slugs and SKUs, not a count.
- Enquiry on draft/expired (finding 4): I filed it because a lead row is
  created with a price snapshot. The tests assert **no enquiry is created**,
  not a particular HTTP status, because the assessment materials do not
  specify 403/404/409.
- Listing PATCH IDOR (finding 5): the requirement is that another catalogue’s
  listing must not be modified. 403, 404, or 400 would all be fine; I do not
  require 404.
- `autoMap` and “Minimum Order Quantity”: substring match sends that header
  to stock. Suspicious, not verified — see FINDINGS. Sample-sheet headers
  (`MOQ`, `Available Quantity`) already map correctly.
- `₹1,20,000 / piece`: `parseNumber` returns null. Failing closed is
  defensible. Characterised in a passing test, not filed as a planted bug.
- Phone 6–10 digits: likely intentional for non-IN country codes. Untouched.

## 4. AI tool usage

I used **Cursor** (this session) throughout.

- Architecture pass: it read `ASSESSMENT.md`, `README.md`, Prisma seed,
  `src/lib`, API routes, admin actions, and auth, then we agreed a plan
  before writing files.
- It drafted the first test files. I changed several things after running
  them, because the first versions would have been hard to defend:
  - Assertions on search talk about leaked names/prices, not a status code I
    made up.
  - Enquiry draft/expired checks that no lead row exists, not HTTP ≥ 400.
  - Listing IDOR checks listing B is unchanged, not a 404.
  - E2E does not wait on the BlurText `<h1>` (opacity 0) or the sr-only
    “Contact supplier” dialog title. It waits on the product link, the
    WhatsApp reply copy, and “Enquiry sent”.
  - No `waitForTimeout`. Unique buyer name so seed leads are not the match.
  - Throwaway catalogues for write/delete, not the Northstar draft.
- Port 3001 was already taken by another Docker container
  (`docker-headless-browser`). E2E ran with
  `PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_BASE_URL=http://localhost:3002` against a
  `next dev --port 3002` I started. That is an environment clash, not an app
  bug. When 3001 is free, `npm run test:e2e` is enough.

I can walk through every test in `tests/` and `e2e/` and say what fails if
the assertion is wrong.

## 5. One thing this codebase gets wrong

**Authorization and “is this live?” are not policies. They are scattered
ifs.**

Publish is guarded in `setCatalogueStatus` and hidden in one dropdown, but
PATCH, create-with-publish, and delete do not call `isAdmin`. Expiry is
computed three ways: inverted in `effectiveStatus`, correct in
`getPublishedCatalogue`, correct again in the dashboard count. Search
selects `status` and `expiresAt` and ignores both.

A junior change to “let staff edit the catalogue form” silently becomes
“staff can go live”, because the form already posts `status`. That is a
quality problem: the next feature will re-implement the rule and get it
wrong again.

What I would change: one `requireAdmin()` used by every publish/delete path,
and one `isBuyerVisible(catalogue)` used by page, search and enquiry. Tests
would target those two functions plus the HTTP wiring, not six copies of the
date comparison.

---

## Bonus: Load Testing

### Target and rationale

The load test targets:

GET /api/catalogues/premium-corporate-essentials/search

This was selected because it is a public, read-only, database-backed search endpoint that exercises a realistic buyer-facing catalogue path without creating or modifying enquiry data.

The test deliberately uses the published `premium-corporate-essentials` catalogue rather than the known draft/expired catalogues, because the assessment already identifies access-control/lifecycle defects there and those endpoints are not necessary for establishing a safe read-only baseline.

### Method

The load test uses a dependency-free Node.js script with the Node 20 built-in `fetch` API.

Configuration:
- 10 concurrent closed-loop workers
- 30-second measurement window
- Each worker waits for its current request to finish before starting the next
- Queries rotate through: `atlas`, `TRV`, `flask`, `a`, and `zzzz`
- One warmup request per worker before measurement
- Warmup requests are excluded from all measured metrics
- 5-second per-request timeout
- HTTP 200 is treated as success, including an empty result set
- Non-200 responses, fetch failures, and timeouts are measured as failures
- Percentiles use nearest-rank calculation
- No latency SLA/pass threshold is imposed because the assessment does not define one

### Baseline results

The baseline was run locally against the seeded eight-product catalogue.

| Metric | Result |
|---|---:|
| Concurrency | 10 |
| Duration | 30 seconds |
| Total measured requests | 8,750 |
| Successful requests | 8,750 |
| Failed requests | 0 |
| Error rate | 0.00% |
| Requests/sec | 291.52 |
| Minimum latency | 10.97 ms |
| P50 | 28.44 ms |
| P95 | 47.75 ms |
| P99 | 90.00 ms |
| Maximum latency | 1,157.55 ms |
| HTTP 200 responses | 8,750 |
| Warmup success | 10/10 |

### Interpretation and limitations

The endpoint completed all 8,750 measured requests successfully during this local baseline, with no measured HTTP or fetch failures. P95 latency was 47.75 ms and P99 latency was 90.00 ms.

The 1,157.55 ms maximum is recorded as a long-tail observation, not as a performance failure, because no SLA is defined by the assessment.

This result should not be interpreted as production capacity. The test runs against a local Next.js/PostgreSQL environment and the seeded catalogue contains only eight products. It therefore does not represent realistic production catalogue size, network conditions, infrastructure, or database capacity.

### Follow-up load-testing work

If more time were available, I would repeat the test with a materially larger catalogue and production-like infrastructure, then compare latency and error rates across increasing concurrency levels. I would also investigate the long-tail latency observed in the baseline and evaluate search performance as the catalogue grows, including whether the current database search pattern requires indexing or another query strategy.

---

## Bonus: AI Extraction Thinking

### Proposed use case

For messy seller-provided catalogue data, AI could assist with extracting structured product fields such as product name, SKU, description, price, minimum order quantity, available quantity, category, and other supported catalogue fields from semi-structured text or spreadsheets.

The AI should be treated as an extraction assistant, not as an authority. Deterministic validation must remain responsible for deciding whether extracted values are acceptable.

### QA risks

I would test at least:

- Missing fields
- Ambiguous field names
- Conflicting values
- Incorrect field mapping
- Hallucinated values that were not present in the source
- Incorrect numeric parsing
- Currency and decimal handling
- MOQ versus available quantity confusion
- Negative or zero quantities where invalid
- Extremely large values
- Duplicate SKUs
- Unsupported categories
- Mixed-language or unusual formatting
- Malformed or partially corrupted input
- Prompt/instruction text embedded inside seller data
- Attempts to cause the model to ignore extraction rules

### Validation strategy

For each extraction, I would preserve the original input alongside the structured result so the result can be audited.

The automated checks should compare extracted values against deterministic business rules rather than only checking that the model returned JSON.

Examples:
- Required fields must be present.
- Price must be numeric and within accepted business bounds.
- MOQ and available quantity must remain separate fields.
- SKU must follow the supported format.
- Quantities must satisfy the product's validation rules.
- Values that cannot be confidently extracted should remain unresolved rather than being invented.

### Confidence and human review

I would define confidence thresholds for fields where incorrect extraction could have commercial impact.

High-confidence deterministic fields could proceed automatically. Low-confidence or conflicting values should be flagged for human review rather than silently committed.

For example, if the source says "minimum order: 100" and another field says "stock: 100", the system must not infer that the two values are interchangeable.

### Regression approach

I would maintain a curated corpus of representative seller inputs containing clean examples, messy spreadsheets, ambiguous headers, currency variations, missing values, duplicate products, and deliberately adversarial inputs.

Every model or prompt change would be evaluated against this corpus, with particular attention to:
- extraction accuracy
- field-level validation failures
- false values introduced by the model
- previously-correct examples becoming incorrect
- safety/security regressions

The key QA principle would be: AI may suggest structured data, but deterministic validation and explicit human review should control whether commercially important data is accepted.

## Notes

- Node 20, Docker Postgres on `localhost:5544`. Docker Desktop was not
  running at first; `docker compose up -d` after starting it was enough.
  `npm run db:seed` reports 8 products / 19 enquiries / 3 catalogues.
- This machine already had another container on **:3001**
  (`docker-headless-browser`). Playwright used **:3002** via
  `PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_BASE_URL=http://localhost:3002`.
- Vitest: 33 passing, 10 failing (43 tests). The 10 are the Task 1 contract
  tests for the five verified bugs. Do not “fix” them by weakening the
  assertion.
- Playwright: 1 passing (Chromium). Waits are Playwright auto-waits on
  locators. The test leaves a `QA Buyer <timestamp>` lead in the local
  database; the name is unique so repeats do not collide. If this ran on
  every PR I would: keep it serial, require seed, not parallelise against
  one database, retry once on CI, and fail the merge on this file plus the
  passing Vitest cases. The 10 red tests should **not** block a merge until
  the bugs are fixed — they should be labelled `test.fails` or a separate
  `vitest` project only after the team agrees they are accepted risk. Right
  now they are documentation that the bugs still exist.
- `npm run typecheck` already fails in `src/components/admin/rich-text-editor.tsx`
  (TipTap types). That predates this work; I did not change application code
  to make it pass.
- I did not run `npm audit fix`, change Prisma, or upgrade dependencies.
