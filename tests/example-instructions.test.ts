import { describe, expect, it } from "vitest";
import { examples } from "../src/content/examples";
import { exampleInstructions } from "../src/i18n";
import { locales } from "../src/locales/registry";
import { tables } from "../src/locales/tables";

describe("example project instructions", () => {
  it("returns localized controls and omits missing instructions", () => {
    const english = examples.find(
      (example) => example.id === "alien-attack",
    )?.controls;
    expect(english).toBeTruthy();

    for (const locale of locales) {
      expect(exampleInstructions("alien-attack", locale.id)).toBe(
        locale.id === "en"
          ? english
          : (tables[locale.id]["example.alien-attack.controls"] ?? english),
      );
    }
    expect(exampleInstructions("tunnel", "en")).toBe("");
    expect(exampleInstructions("missing-example", "en")).toBe("");
  });
});
