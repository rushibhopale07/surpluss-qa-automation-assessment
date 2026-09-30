import { afterEach, describe, expect, it, vi } from "vitest";
import { effectiveStatus } from "@/lib/catalogue-status";

/**
 * The helper's own comment: a published catalogue whose validity date has
 * passed should read as expired; legacy inactive/expired rows read as draft.
 *
 * These assertions follow that comment and the README. They currently fail
 * because the date comparison is inverted (`expiresAt > now` marks expired).
 */
describe("effectiveStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it("treats a published catalogue past its validity date as expired", () => {
    at("2026-09-30T12:00:00.000Z");
    expect(effectiveStatus("published", new Date("2026-08-15T18:29:59.000Z"))).toBe(
      "expired",
    );
  });

  it("keeps a published catalogue with a future validity date as published", () => {
    at("2026-09-30T12:00:00.000Z");
    expect(effectiveStatus("published", new Date("2026-12-31T18:29:59.000Z"))).toBe(
      "published",
    );
  });

  it("keeps a published catalogue with no expiry as published", () => {
    at("2026-09-30T12:00:00.000Z");
    expect(effectiveStatus("published", null)).toBe("published");
  });

  it("reads legacy inactive and expired rows as draft", () => {
    at("2026-09-30T12:00:00.000Z");
    expect(effectiveStatus("inactive", null)).toBe("draft");
    expect(effectiveStatus("expired", null)).toBe("draft");
    expect(effectiveStatus("draft", new Date("2026-08-15T18:29:59.000Z"))).toBe(
      "draft",
    );
  });
});
