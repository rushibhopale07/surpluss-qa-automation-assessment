import { afterAll, describe, expect, it, vi } from "vitest";
import { GET as searchCatalogue } from "@/app/api/catalogues/[slug]/search/route";
import { POST as createEnquiry } from "@/app/api/enquiries/route";
import { getPublishedCatalogue } from "@/lib/catalogue-queries";
import {
  catalogueBySlug,
  deleteEnquiriesByBuyerPrefix,
  DRAFT_SLUG,
  EXPIRED_SLUG,
  LIVE_SLUG,
  prisma,
} from "../helpers/db";
import { jsonRequest, readJson } from "../helpers/http";

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => unknown) => {
      void task();
    },
  };
});

const BUYER_PREFIX = "QA Enquiry ";

afterAll(async () => {
  await deleteEnquiriesByBuyerPrefix(BUYER_PREFIX);
});

async function search(slug: string, q: string) {
  return searchCatalogue(new Request(`http://localhost:3001/api/catalogues/${slug}/search?q=${q}`), {
    params: Promise.resolve({ slug }),
  });
}

type SearchBody = {
  ids?: string[];
  matches?: { id: string; name: string; sku: string; offerPrice: unknown }[];
  error?: string;
};

function leakedContents(body: SearchBody) {
  const ids = body.ids ?? [];
  const matches = body.matches ?? [];
  return {
    ids: ids.length,
    names: matches.map((match) => match.name),
    prices: matches.map((match) => match.offerPrice).filter((price) => price != null),
  };
}

describe("getPublishedCatalogue", () => {
  it("returns products for the live published catalogue", async () => {
    const data = await getPublishedCatalogue(LIVE_SLUG);
    expect(data).not.toBeNull();
    expect(data && "expired" in data).toBe(false);
    if (!data || "expired" in data) return;
    expect(data.products.length).toBeGreaterThan(0);
    expect(data.products.some((product) => product.price != null)).toBe(true);
  });

  it("hides a draft catalogue from the public page", async () => {
    expect(await getPublishedCatalogue(DRAFT_SLUG)).toBeNull();
  });

  it("returns the expired payload without products for a lapsed campaign", async () => {
    const data = await getPublishedCatalogue(EXPIRED_SLUG);
    expect(data).toEqual(expect.objectContaining({ expired: true }));
    expect(data && "products" in data).toBe(false);
  });
});

describe("GET /api/catalogues/[slug]/search", () => {
  it("returns matches for a published live catalogue", async () => {
    const { status, body } = await readJson<SearchBody>(await search(LIVE_SLUG, "atlas"));
    expect(status).toBe(200);
    expect((body.ids ?? []).length).toBeGreaterThan(0);
    expect(body.matches?.[0]?.name).toMatch(/atlas/i);
  });

  it("does not expose draft catalogue contents or prices to an anonymous caller", async () => {
    // README: a draft is internal; nobody outside the sales team should reach
    // it or its contents. The HTML page 404s. Search currently still returns
    // names, SKUs and offerPrice.
    const { body } = await readJson<SearchBody>(await search(DRAFT_SLUG, "atlas"));
    const leaked = leakedContents(body);
    expect(leaked.ids, "draft listings must not be searchable anonymously").toBe(0);
    expect(leaked.names, "draft product names must not leak").toEqual([]);
    expect(leaked.prices, "draft offer prices must not leak").toEqual([]);
  });

  it("does not return offer prices for a catalogue whose validity date has passed", async () => {
    const { body } = await readJson<SearchBody>(await search(EXPIRED_SLUG, "pulse"));
    const leaked = leakedContents(body);
    expect(leaked.prices, "stale prices must not be returned as if still on offer").toEqual([]);
  });
});

describe("POST /api/enquiries", () => {
  it("rejects an enquiry with neither phone nor email", async () => {
    const live = await catalogueBySlug(LIVE_SLUG);
    const productId = live.listings[0]?.productId;
    expect(productId).toBeDefined();
    const { status, body } = await readJson(
      await createEnquiry(
        jsonRequest("http://localhost:3001/api/enquiries", "POST", {
          catalogueId: live.id,
          name: `${BUYER_PREFIX}No Contact`,
          items: [{ productId, quantity: live.listings[0]!.product.moq }],
        }),
      ),
    );
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("rejects a quantity below MOQ on the live catalogue", async () => {
    const live = await catalogueBySlug(LIVE_SLUG);
    const listing = live.listings[0]!;
    expect(listing.product.moq).toBeGreaterThan(1);
    const { status } = await readJson(
      await createEnquiry(
        jsonRequest("http://localhost:3001/api/enquiries", "POST", {
          catalogueId: live.id,
          name: `${BUYER_PREFIX}Low Qty`,
          phone: "9876543210",
          items: [{ productId: listing.productId, quantity: listing.product.moq - 1 }],
        }),
      ),
    );
    expect(status).toBe(400);
  });

  it("accepts a valid enquiry against the live catalogue and snapshots the offer price", async () => {
    const live = await catalogueBySlug(LIVE_SLUG);
    const listing = live.listings[0]!;
    const { status, body } = await readJson<{ ok?: boolean; reference?: string }>(
      await createEnquiry(
        jsonRequest("http://localhost:3001/api/enquiries", "POST", {
          catalogueId: live.id,
          name: `${BUYER_PREFIX}Live`,
          phone: "9876543210",
          items: [{ productId: listing.productId, quantity: listing.product.moq }],
        }),
      ),
    );
    expect(status).toBe(201);
    expect(body.reference).toMatch(/^ENQ-/);

    const stored = await prisma().enquiry.findUnique({
      where: { reference: body.reference },
      include: { items: true },
    });
    expect(stored?.buyerName).toBe(`${BUYER_PREFIX}Live`);
    expect(stored?.items[0]?.productSku).toBe(listing.product.sku);
    expect(Number(stored?.items[0]?.unitPrice)).toBe(Number(listing.product.offerPrice));
  });

  it("does not create a lead against a draft catalogue", async () => {
    // README forbids outsiders reaching a draft. The materials do not specify
    // an HTTP status, so this asserts the business effect: no new lead row.
    const draft = await catalogueBySlug(DRAFT_SLUG);
    const listing = draft.listings[0]!;
    const buyer = `${BUYER_PREFIX}Draft ${crypto.randomUUID()}`;
    const before = await prisma().enquiry.count({
      where: { catalogueId: draft.id, buyerName: buyer },
    });
    expect(before).toBe(0);

    await createEnquiry(
      jsonRequest("http://localhost:3001/api/enquiries", "POST", {
        catalogueId: draft.id,
        name: buyer,
        phone: "9876543210",
        items: [{ productId: listing.productId, quantity: listing.product.moq }],
      }),
    );

    const created = await prisma().enquiry.findMany({
      where: { catalogueId: draft.id, buyerName: buyer },
    });
    expect(created, "a draft catalogue must not create a public lead").toHaveLength(0);
  });

  it("does not create a lead against an expired catalogue", async () => {
    const expired = await catalogueBySlug(EXPIRED_SLUG);
    const listing = expired.listings[0]!;
    const buyer = `${BUYER_PREFIX}Expired ${crypto.randomUUID()}`;
    const before = await prisma().enquiry.count({
      where: { catalogueId: expired.id, buyerName: buyer },
    });
    expect(before).toBe(0);

    await createEnquiry(
      jsonRequest("http://localhost:3001/api/enquiries", "POST", {
        catalogueId: expired.id,
        name: buyer,
        phone: "9876543210",
        items: [{ productId: listing.productId, quantity: listing.product.moq }],
      }),
    );

    const created = await prisma().enquiry.findMany({
      where: { catalogueId: expired.id, buyerName: buyer },
    });
    expect(created, "an expired catalogue must not create a public lead").toHaveLength(0);
  });
});
