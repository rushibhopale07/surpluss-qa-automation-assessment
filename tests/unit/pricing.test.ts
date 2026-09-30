import { describe, expect, it } from "vitest";
import {
  discountPercent,
  needsPricesForSale,
  NO_PRICE_LABEL,
  PRICE_ON_REQUEST_LABEL,
  priceLabel,
} from "@/lib/pricing";

describe("discountPercent", () => {
  it("rounds the saving against MRP for a normal offer", () => {
    // Atlas cabin trolley in the seed: 2499 on 5999 is 58% off after rounding.
    expect(
      discountPercent({ priceOnRequest: false, mrp: 5999, offerPrice: 2499 }),
    ).toBe(58);
  });

  it("is zero when price is on request, even if both prices are present", () => {
    expect(
      discountPercent({ priceOnRequest: true, mrp: 5999, offerPrice: 2499 }),
    ).toBe(0);
  });

  it("is zero when MRP or offer price is missing, zero, or non-finite", () => {
    expect(discountPercent({ priceOnRequest: false, mrp: null, offerPrice: 2499 })).toBe(0);
    expect(discountPercent({ priceOnRequest: false, mrp: 5999, offerPrice: null })).toBe(0);
    expect(discountPercent({ priceOnRequest: false, mrp: 0, offerPrice: 2499 })).toBe(0);
    expect(
      discountPercent({ priceOnRequest: false, mrp: Number.NaN, offerPrice: 2499 }),
    ).toBe(0);
  });

  it("returns a negative percent when the offer is above MRP", () => {
    // The storefront only paints a badge when discount > 0, so this does not
    // currently show as a mark-up. The helper itself does not clamp.
    expect(
      discountPercent({ priceOnRequest: false, mrp: 1000, offerPrice: 1200 }),
    ).toBe(-20);
  });
});

describe("priceLabel", () => {
  const format = (value: number) => `INR ${value}`;

  it("uses the on-request copy when that flag is set", () => {
    expect(priceLabel({ priceOnRequest: true, offerPrice: 2499 }, format)).toBe(
      PRICE_ON_REQUEST_LABEL,
    );
  });

  it("falls back to enquiry copy when there is no offer price", () => {
    expect(priceLabel({ priceOnRequest: false, offerPrice: null }, format)).toBe(
      NO_PRICE_LABEL,
    );
  });

  it("formats a numeric offer price", () => {
    expect(priceLabel({ priceOnRequest: false, offerPrice: 2499 }, format)).toBe(
      "INR 2499",
    );
  });
});

describe("needsPricesForSale", () => {
  it("does not block publish when price is on request", () => {
    expect(
      needsPricesForSale({ priceOnRequest: true, mrp: null, offerPrice: null }),
    ).toBe(false);
  });

  it("blocks publish when MRP or offer is missing", () => {
    expect(
      needsPricesForSale({ priceOnRequest: false, mrp: null, offerPrice: 100 }),
    ).toBe(true);
    expect(
      needsPricesForSale({ priceOnRequest: false, mrp: 100, offerPrice: null }),
    ).toBe(true);
  });
});
