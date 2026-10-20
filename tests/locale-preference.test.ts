import { describe, expect, it } from "vitest";
import { accountLocalePreference } from "../src/useLocale";

const synced = (accountId: string, locale: string) => ({ accountId, locale });

describe("account locale preference", () => {
  it("applies the saved account language on a fresh device or a new account", () => {
    expect(accountLocalePreference({ id: "a", locale: "ru" }, null, "en")).toEqual(
      { locale: "ru", synced: synced("a", "ru") },
    );
    expect(
      accountLocalePreference(
        { id: "a", locale: "de" },
        synced("b", "ru"),
        "ru",
      ),
    ).toEqual({ locale: "de", synced: synced("a", "de") });
  });
  it("never reverts a newer local choice when the account copy did not change", () => {
    // The reported Demo bug: a stale session language must not replace the language just chosen.
    expect(
      accountLocalePreference({ id: "demo:1", locale: "en" }, synced("demo:1", "en"), "ru"),
    ).toBeNull();
  });
  it("still applies a language changed on another device for the same account", () => {
    expect(
      accountLocalePreference({ id: "a", locale: "ja" }, synced("a", "ru"), "ru"),
    ).toEqual({ locale: "ja", synced: synced("a", "ja") });
  });
  it("records the applied language so later navigations keep the device choice", () => {
    expect(
      accountLocalePreference({ id: "a", locale: "uk" }, synced("a", "uk"), "uk"),
    ).toBeNull();
  });
  it("ignores guests and unknown language values", () => {
    expect(accountLocalePreference(null, null, "en")).toBeNull();
    expect(accountLocalePreference({ id: "a", locale: "xx" }, null, "en")).toBeNull();
  });
});
