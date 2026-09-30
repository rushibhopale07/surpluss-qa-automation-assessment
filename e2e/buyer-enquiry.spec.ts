import { expect, test } from "@playwright/test";

/**
 * One buyer journey: published catalogue → product → enquiry → admin leads.
 *
 * The storefront has no multi-item cart. Contact supplier sends one product,
 * which is what this test drives.
 *
 * If something else is bound to :3001:
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_BASE_URL=http://localhost:3002 npx playwright test
 */
test("buyer submits an enquiry that appears in the staff leads inbox", async ({
  page,
}) => {
  test.setTimeout(90_000);

  const stamp = Date.now();
  const buyer = `QA Buyer ${stamp}`;
  const phone = "9876501234";

  await page.goto("/catalogue/premium-corporate-essentials", {
    waitUntil: "domcontentloaded",
  });
  const productLink = page.getByRole("link", { name: /atlas cabin trolley/i }).first();
  await expect(productLink).toBeVisible();
  await productLink.click();
  await expect(page.getByRole("heading", { name: /atlas cabin trolley/i })).toBeVisible();

  await page.getByRole("button", { name: "Contact Us" }).click();
  await expect(
    page.getByText("The Surpluss team replies on WhatsApp within 24 hours."),
  ).toBeVisible();

  await page.getByLabel("Your name").fill(buyer);
  await page.getByLabel("WhatsApp number").fill(phone);
  await page.getByRole("button", { name: "Send enquiry" }).click();

  await expect(page.getByRole("heading", { name: "Enquiry sent" })).toBeVisible();
  const reference = (await page.getByText(/^ENQ-\d+$/).textContent())?.trim();
  expect(reference).toMatch(/^ENQ-\d+$/);

  await page.goto("/login");
  await page.getByLabel("Email").fill("staff@catalogue.test");
  await page.getByLabel("Password").fill("Staff#2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin/);

  await page.goto("/admin/leads");
  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await page.getByPlaceholder("Search buyer, reference or contact").fill(reference!);
  await expect(page.getByRole("link", { name: buyer })).toBeVisible();
  await expect(page.getByText(reference!)).toBeVisible();
});
