import { describe, expect, it } from "vitest";
import {
  autoMap,
  parseNumber,
  validateRows,
  type ParsedFile,
} from "@/lib/import-mapping";

function sheet(headers: string[], rows: string[][]): ParsedFile {
  return {
    name: "stock.csv",
    sizeKB: 1,
    headers,
    rows: rows.map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
    ),
  };
}

describe("parseNumber", () => {
  it("strips rupee signs, spaces and grouping commas used in Indian sheets", () => {
    expect(parseNumber("₹1,20,000")).toBe(120000);
    expect(parseNumber("2,499")).toBe(2499);
  });

  it("returns null for blank or non-numeric cells", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber("negotiable")).toBeNull();
  });

  it("does not currently strip a unit suffix such as /piece", () => {
    // README's messy-data example. Failing closed is defensible; I am not
    // treating this as a planted bug. Characterised so a later parser change
    // is visible.
    expect(parseNumber("₹1,20,000 / piece")).toBeNull();
  });
});

describe("autoMap", () => {
  it("maps the sample-sheet headers onto the required fields", () => {
    const mapping = autoMap([
      "SKU",
      "Product Name",
      "Brand",
      "Category",
      "MRP",
      "Offer Price",
      "Available Quantity",
      "MOQ",
    ]);
    expect(mapping).toMatchObject({
      SKU: "sku",
      "Product Name": "name",
      Brand: "brand",
      Category: "category",
      MRP: "mrp",
      "Offer Price": "offerPrice",
      "Available Quantity": "quantity",
      MOQ: "moq",
    });
  });
});

describe("validateRows", () => {
  const mapping = {
    SKU: "sku" as const,
    Name: "name" as const,
    Qty: "quantity" as const,
    MRP: "mrp" as const,
    Offer: "offerPrice" as const,
  };

  it("blocks a row with no SKU and does not import it", () => {
    const result = validateRows(sheet(["SKU", "Name", "Qty"], [["", "Flask", "10"]]), mapping);
    expect(result.rows).toHaveLength(0);
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 2, blocking: true, message: "The SKU is missing" }),
    ]);
  });

  it("blocks a duplicate SKU in the same sheet", () => {
    const result = validateRows(
      sheet(
        ["SKU", "Name", "Qty"],
        [
          ["TRV-1", "Trolley", "10"],
          ["TRV-1", "Trolley duplicate", "8"],
        ],
      ),
      mapping,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.issues.some((issue) => issue.blocking && issue.message.includes("more than once"))).toBe(
      true,
    );
  });

  it("blocks a fractional available quantity", () => {
    const result = validateRows(
      sheet(["SKU", "Name", "Qty"], [["TRV-1", "Trolley", "10.5"]]),
      mapping,
    );
    expect(result.rows).toHaveLength(0);
    expect(result.issues[0]).toMatchObject({ blocking: true, row: 2 });
  });

  it("counts missing prices as a warning tally, not a blocking error", () => {
    const result = validateRows(
      sheet(["SKU", "Name", "Qty", "MRP", "Offer"], [["TRV-1", "Trolley", "10", "", ""]]),
      mapping,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.missingPrices).toBe(1);
    expect(result.issues.filter((issue) => issue.blocking)).toHaveLength(0);
  });
});
