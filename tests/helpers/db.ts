import { getPrisma } from "@/lib/prisma";

export const LIVE_SLUG = "premium-corporate-essentials";
export const DRAFT_SLUG = "festive-overstock-2026";
export const EXPIRED_SLUG = "monsoon-clearance-2026";

export function prisma() {
  return getPrisma();
}

export async function catalogueBySlug(slug: string) {
  const catalogue = await getPrisma().catalogue.findUnique({
    where: { slug },
    include: {
      listings: {
        where: { isVisible: true },
        include: { product: true },
        orderBy: { displayOrder: "asc" },
      },
    },
  });
  if (!catalogue) throw new Error(`Seed catalogue missing: ${slug}`);
  return catalogue;
}

export async function firstProductId() {
  const product = await getPrisma().product.findFirst({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (!product) throw new Error("Seed products missing");
  return product.id;
}

export async function deleteCataloguesBySlugPrefix(prefix: string) {
  await getPrisma().catalogue.deleteMany({ where: { slug: { startsWith: prefix } } });
}

export async function deleteEnquiriesByBuyerPrefix(prefix: string) {
  await getPrisma().enquiry.deleteMany({ where: { buyerName: { startsWith: prefix } } });
}
