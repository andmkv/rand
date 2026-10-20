import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { createVerifiedUser, editSource } from "./hosted-helpers";
test.skip(
  process.env.HOSTED_E2E !== "1",
  "Requires the disposable server/tests/serve.ts API",
);
async function mailLink(to: string, marker: string) {
  let link = "";
  await expect
    .poll(async () => {
      for (const file of (await readdir("/tmp/randusr-e2e-mail")).sort().reverse()) {
        const mail = JSON.parse(await readFile(`/tmp/randusr-e2e-mail/${file}`, "utf8"));
        if (mail.to === to && mail.text.includes(marker)) {
          link = mail.text.match(/https?:\/\/[^\s]+/)[0];
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return link;
}
test("admin invites a tester from /admin; the invitee registers, verifies and saves to the cloud", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  await createVerifiedUser(page, "admin@example.invalid");
  await page.goto("/admin");
  await page.getByRole("button", { name: "Invitations", exact: true }).click();
  const email = `invitee-${info.project.name}-${Date.now()}@example.invalid`;
  const panel = page.getByRole("region", { name: "Invitations" });
  await panel.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("I confirm the invitee is an adult").check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation emailed");
  await expect(page.getByRole("heading", { name: email })).toBeVisible();
  // The link is only in the email, never in the page.
  await expect(page.locator("body")).not.toContainText("#token=");
  const first = await mailLink(email, "/invite#");

  // Resend replaces the link; the old one no longer registers.
  await page.getByRole("button", { name: "Resend (new link)" }).first().click();
  await expect(page.getByRole("status")).toContainText("Invitation emailed");
  const second = await mailLink(email, "/invite#");
  expect(second).not.toBe(first);

  const context = await browser.newContext();
  const invitee: Page = await context.newPage();
  try {
    await invitee.goto(second);
    const dialog = invitee.getByRole("dialog");
    await dialog.getByLabel("Email address", { exact: true }).fill(email);
    await dialog.getByLabel("Password", { exact: true }).fill("A very secret testing password");
    await dialog.getByLabel("Display name", { exact: true }).fill("Invited friend");
    const notice = dialog.getByLabel("I have read the closed-test data notice.", { exact: true });
    if (await notice.count()) await notice.check();
    await dialog.getByRole("button", { name: "Sign up", exact: true }).click();
    await expect(dialog.getByText("Please confirm your email", { exact: false })).toBeVisible();
    await invitee.goto(await mailLink(email, "/verify#"));
    await invitee.getByRole("button", { name: "Confirm email", exact: true }).click();
    await expect(invitee.getByRole("alert")).toContainText("Email confirmed");
    await invitee.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await editSource(invitee, 'PRINT "INVITED"');
    await invitee.getByRole("button", { name: "Save to cloud", exact: true }).click();
    await expect(invitee.locator(".cloud-status")).toHaveText("Saved to cloud");
  } finally {
    await context.close();
  }
  await page.reload();
  await page.getByRole("button", { name: "Invitations", exact: true }).click();
  await page.getByRole("button", { name: "Used", exact: true }).click();
  await expect(page.getByRole("heading", { name: email })).toBeVisible();
});
test("invitation form stays compact, clear and keyboard-operable at every review width", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await createVerifiedUser(page, "admin@example.invalid");
  await page.goto("/admin?tab=invitations");
  const panel = page.locator("section.admin-invitations");
  await expect(page.getByRole("region", { name: "Invitations" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  // Sending while another status is selected must reveal the new Active invitation and keep the notice.
  await panel.getByRole("button", { name: "Used", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Used", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel
    .getByLabel("Email address", { exact: true })
    .fill(`layout-${info.project.name}-${Date.now()}@example.invalid`);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { name: el?.getAttribute("name"), text: el?.textContent };
    });
  const adultConfirmation = panel.getByLabel("I confirm the invitee is an adult");
  const sendInvitation = panel.getByRole("button", { name: "Send invitation" });
  if (info.project.name === "webkit") {
    // macOS WebKit's default Full Keyboard Access skips native checkboxes and buttons in Tab order.
    // Keep the native consent control and prove keyboard activation without changing the OS setting.
    await adultConfirmation.focus();
    expect((await focused()).name).toBe("adult");
    await page.keyboard.press("Space");
    await expect(adultConfirmation).toBeChecked();
    await sendInvitation.focus();
    expect((await focused()).text).toContain("Send invitation");
  } else {
    await page.keyboard.press("Tab");
    expect((await focused()).name).toBe("adult");
    await page.keyboard.press("Space");
    await expect(adultConfirmation).toBeChecked();
    await page.keyboard.press("Tab");
    expect((await focused()).text).toContain("Send invitation");
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Invitation emailed");
  await expect(panel.getByRole("button", { name: "Active", exact: true })).toHaveAttribute("aria-pressed", "true");

  const sizes = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 820, height: 874 },
    { width: 390, height: 844 },
  ];
  // German and Russian layouts are checked in docs/ux-106 screenshots; keeping this test
  // English-only avoids mutating the shared administrator account's saved language.
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    const layout = await panel.evaluate((el) => {
      type Box = { x: number; y: number; w: number; h: number } | null;
      const box = (selector: string): Box => {
        const node = el.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      };
      const overlap = (a: Box, b: Box) =>
        !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const email = box('input[name="email"]'),
        checkbox = box('input[name="adult"]'),
        button = box("button.primary"),
        width = el.getBoundingClientRect().width;
      return {
        email,
        checkbox,
        button,
        width,
        emailCheckboxOverlap: overlap(email, checkbox),
        checkboxButtonOverlap: overlap(checkbox, button),
        stacked:
          !!email &&
          !!checkbox &&
          !!button &&
          email.y + email.h <= checkbox.y + 1 &&
          checkbox.y + checkbox.h <= button.y + 1,
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    });
    expect(layout.email, "email field").not.toBeNull();
    expect(layout.email!.w, `${size.width} email fills the panel`).toBeGreaterThan(layout.width * 0.6);
    expect(layout.emailCheckboxOverlap, `${size.width} email/checkbox overlap`).toBe(false);
    expect(layout.checkboxButtonOverlap, `${size.width} checkbox/CTA overlap`).toBe(false);
    expect(layout.stacked, `${size.width} field rows are separate`).toBe(true);
    expect(layout.clipped, `${size.width} panel overflow`).toBe(false);
  }
});
test("a mail failure is reported as an error, never as a sent invitation", async ({
  page,
}, info) => {
  await createVerifiedUser(page, "admin@example.invalid");
  await page.goto("/admin?tab=invitations");
  const email = `mailfail-${info.project.name}-${Date.now()}@example.invalid`;
  const panel = page.locator("section.admin-invitations");
  await page.route("**/api/v1/admin/invitations", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "MAIL_UNAVAILABLE" } }),
        })
      : route.continue(),
  );
  await panel.getByLabel("Email address", { exact: true }).fill(email);
  await panel.getByLabel("I confirm the invitee is an adult").check();
  await panel.getByRole("button", { name: "Send invitation" }).click();
  await expect(panel.getByRole("alert")).toContainText("could not be emailed");
  await expect(panel.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: email })).toHaveCount(0);
  await expect(panel.getByLabel("Email address", { exact: true })).toHaveValue(email);
});
test("a signed-in non-administrator gets an explanation instead of a bare Forbidden", async ({
  page,
}, info) => {
  await createVerifiedUser(page, `plain-${info.project.name}-${Date.now()}@example.invalid`);
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("does not have administrator access");
  await expect(page.locator("body")).toContainText("ask the operator");
});
