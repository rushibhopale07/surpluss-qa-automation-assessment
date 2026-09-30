import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { createCatalogueWithProducts } from "@/app/admin/catalogues/actions";
import { deleteCatalogue, setCatalogueStatus } from "@/app/admin/actions";
import { GET as getCatalogue, PATCH as patchCatalogue } from "@/app/api/admin/catalogues/[id]/route";
import { PATCH as patchListing } from "@/app/api/admin/catalogues/[id]/listings/[listingId]/route";
import { ADMIN_SESSION, STAFF_SESSION } from "../helpers/session";
import {
  deleteCataloguesBySlugPrefix,
  firstProductId,
  prisma,
} from "../helpers/db";
import { jsonRequest, readJson } from "../helpers/http";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const SLUG_PREFIX = "qa-access-";
const mockedAuth = vi.mocked(auth);

beforeEach(() => {
  mockedAuth.mockReset();
});

afterAll(async () => {
  await deleteCataloguesBySlugPrefix(SLUG_PREFIX);
});

function asStaff() {
  mockedAuth.mockResolvedValue(STAFF_SESSION as never);
}

function asAdmin() {
  mockedAuth.mockResolvedValue(ADMIN_SESSION as never);
}

function signedOut() {
  mockedAuth.mockResolvedValue(null as never);
}

async function createThrowawayDraft(suffix: string, productId?: string) {
  const slug = `${SLUG_PREFIX}${suffix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return prisma().catalogue.create({
    data: {
      name: `QA throwaway ${suffix}`,
      slug,
      description: "Disposable catalogue for access-control tests.",
      status: "draft",
      ...(productId
        ? { listings: { create: { productId, displayOrder: 0, isVisible: true } } }
        : {}),
    },
    include: { listings: true },
  });
}

function editPayload(
  catalogue: { name: string; slug: string; description: string; category: string | null },
  status: "draft" | "published",
) {
  return {
    name: catalogue.name,
    slug: catalogue.slug,
    description: catalogue.description,
    category: catalogue.category ?? "",
    notifyNumber: "",
    status,
    validUntil: null,
    banners: [],
  };
}

describe("admin catalogue HTTP — signed out", () => {
  it("refuses GET without a session", async () => {
    signedOut();
    const throwaway = await createThrowawayDraft("unsigned-get");
    const { status, body } = await readJson(
      await getCatalogue(new Request(`http://localhost:3001/api/admin/catalogues/${throwaway.id}`), {
        params: Promise.resolve({ id: throwaway.id }),
      }),
    );
    expect(status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("refuses PATCH without a session", async () => {
    signedOut();
    const throwaway = await createThrowawayDraft("unsigned-patch");
    const { status } = await readJson(
      await patchCatalogue(
        jsonRequest(
          `http://localhost:3001/api/admin/catalogues/${throwaway.id}`,
          "PATCH",
          editPayload(throwaway, "published"),
        ),
        { params: Promise.resolve({ id: throwaway.id }) },
      ),
    );
    expect(status).toBe(401);
  });
});

describe("admin catalogue HTTP — signed-out server actions", () => {
  it("refuses deleteCatalogue and setCatalogueStatus", async () => {
    signedOut();
    const throwaway = await createThrowawayDraft("unsigned-actions");
    await expect(deleteCatalogue(throwaway.id)).resolves.toMatchObject({
      error: "You need to sign in again.",
    });
    await expect(setCatalogueStatus(throwaway.id, "published")).resolves.toMatchObject({
      error: "You need to sign in again.",
    });
  });
});

describe("staff vs admin on publish and delete", () => {
  it("setCatalogueStatus refuses staff — this is the one path that is actually guarded", async () => {
    asStaff();
    const throwaway = await createThrowawayDraft("status-guard");
    const result = await setCatalogueStatus(throwaway.id, "published");
    expect(result).toMatchObject({ error: "Only an admin can change what is published." });
    const still = await prisma().catalogue.findUnique({ where: { id: throwaway.id } });
    expect(still?.status).toBe("draft");
  });

  it("deleteCatalogue refuses staff, because deleting destroys lead history", async () => {
    asStaff();
    const throwaway = await createThrowawayDraft("staff-delete");
    const result = await deleteCatalogue(throwaway.id);
    expect(result, "staff must not delete a catalogue").toMatchObject({
      error: expect.stringMatching(/admin/i),
    });
    const still = await prisma().catalogue.findUnique({ where: { id: throwaway.id } });
    expect(still, "the catalogue must still exist").not.toBeNull();
  });

  it("PATCH /api/admin/catalogues/:id refuses a staff user publishing a draft", async () => {
    asStaff();
    const throwaway = await createThrowawayDraft("staff-patch-publish");
    const { status, body } = await readJson(
      await patchCatalogue(
        jsonRequest(
          `http://localhost:3001/api/admin/catalogues/${throwaway.id}`,
          "PATCH",
          editPayload(throwaway, "published"),
        ),
        { params: Promise.resolve({ id: throwaway.id }) },
      ),
    );
    expect(status, "publishing is admin-only on the server, not only in the UI").toBeGreaterThanOrEqual(
      400,
    );
    expect(body).not.toMatchObject({ ok: true });
    const still = await prisma().catalogue.findUnique({ where: { id: throwaway.id } });
    expect(still?.status).toBe("draft");
  });

  it("createCatalogueWithProducts refuses staff when publish is true", async () => {
    asStaff();
    const productId = await firstProductId();
    const slug = `${SLUG_PREFIX}staff-create-${Date.now()}`;
    const result = await createCatalogueWithProducts({
      name: "QA staff create live",
      slug,
      description: "",
      category: "",
      validUntil: null,
      banners: [],
      publish: true,
      productIds: [productId],
    });
    expect(result, "staff must not publish via the create action").toMatchObject({
      error: expect.stringMatching(/admin/i),
    });
    const created = await prisma().catalogue.findUnique({ where: { slug } });
    expect(created).toBeNull();
  });

  it("an admin can still publish through setCatalogueStatus", async () => {
    asAdmin();
    const productId = await firstProductId();
    const throwaway = await createThrowawayDraft("admin-publish", productId);
    const result = await setCatalogueStatus(throwaway.id, "published");
    expect(result).toMatchObject({ ok: true });
    const updated = await prisma().catalogue.findUnique({ where: { id: throwaway.id } });
    expect(updated?.status).toBe("published");
  });
});

describe("tampered ids and payloads", () => {
  it("rejects an illegal status value even with a valid catalogue id", async () => {
    asAdmin();
    const throwaway = await createThrowawayDraft("bad-status");
    const { status } = await readJson(
      await patchCatalogue(
        jsonRequest(`http://localhost:3001/api/admin/catalogues/${throwaway.id}`, "PATCH", {
          ...editPayload(throwaway, "draft"),
          status: "inactive",
        }),
        { params: Promise.resolve({ id: throwaway.id }) },
      ),
    );
    expect(status).toBe(400);
  });

  it("ignores extra body fields and does not rewrite the catalogue id", async () => {
    asAdmin();
    const throwaway = await createThrowawayDraft("extra-fields");
    const other = await createThrowawayDraft("extra-fields-other");
    const { status, body } = await readJson<{ ok?: boolean; catalogue?: { id: string; name: string } }>(
      await patchCatalogue(
        jsonRequest(`http://localhost:3001/api/admin/catalogues/${throwaway.id}`, "PATCH", {
          ...editPayload(throwaway, "draft"),
          name: "QA extra fields kept on the url id",
          id: other.id,
        }),
        { params: Promise.resolve({ id: throwaway.id }) },
      ),
    );
    expect(status).toBe(200);
    expect(body.catalogue?.id).toBe(throwaway.id);
    expect(body.catalogue?.name).toBe("QA extra fields kept on the url id");
    const otherRow = await prisma().catalogue.findUnique({ where: { id: other.id } });
    expect(otherRow?.name).not.toBe("QA extra fields kept on the url id");
  });

  it("does not update a listing that belongs to a different catalogue", async () => {
    const productId = await firstProductId();
    const catalogueA = await createThrowawayDraft("idor-a", productId);
    const secondProduct = await prisma().product.findFirst({
      where: { archivedAt: null, id: { not: productId } },
      select: { id: true },
    });
    if (!secondProduct) throw new Error("Need a second seed product for the IDOR test");
    const catalogueB = await createThrowawayDraft("idor-b", secondProduct.id);
    const listingB = catalogueB.listings[0]!;

    asStaff();
    const listingBId = listingB.id;
    const before = {
      isVisible: listingB.isVisible,
      catalogueId: listingB.catalogueId,
    };
    try {
      await patchListing(
        jsonRequest(
          `http://localhost:3001/api/admin/catalogues/${catalogueA.id}/listings/${listingB.id}`,
          "PATCH",
          { isVisible: false },
        ),
        { params: Promise.resolve({ id: catalogueA.id, listingId: listingB.id }) },
      );

      const listing = await prisma().catalogueListing.findUnique({ where: { id: listingBId } });
      expect(listing?.isVisible, "listing B must stay unchanged").toBe(before.isVisible);
      expect(listing?.catalogueId, "listing B must stay on catalogue B").toBe(before.catalogueId);
    } finally {
      await prisma().catalogueListing.updateMany({
        where: { id: listingBId },
        data: { isVisible: true },
      });
    }
  });
});
