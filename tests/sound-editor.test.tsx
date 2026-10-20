import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SoundEditor } from "../src/SoundEditor";
import { disconnectedAdapter, instrumentDraft, presetDraft } from "../src/sound-draft";
import { locales, t } from "../src/i18n";

const noop = () => undefined;
const render = (locale: (typeof locales)[number]["id"], adapter = disconnectedAdapter, draft = presetDraft("laser")) =>
  renderToStaticMarkup(
    <SoundEditor
      locale={locale}
      adapter={adapter}
      asset={{ id: "a", alias: "x", version: 1, name: "X", draft }}
      onClose={noop}
    />,
  );

describe("SoundEditor markup", () => {
  it("renders every label in all 8 locales with no missing copy", () => {
    for (const { id } of locales) {
      const html = render(id);
      expect(html).toContain(t("slTitle", id));
      for (const key of ["slPresetLaser", "slPresetWind", "slWaveNoise", "slSave", "slLabel_attack"] as const)
        expect(html).toContain(t(key, id));
      expect(html).not.toMatch(/undefined|\[object/);
    }
  });
  it("labels every range input and exposes its value as text", () => {
    const html = render("en");
    const ranges = [...html.matchAll(/<input id="(sl-[A-Za-z]+)" class="sl-range"[^>]*>/g)];
    expect(ranges.map((m) => m[1])).toEqual([
      "sl-pitchStart", "sl-pitchEnd", "sl-duration", "sl-volume", "sl-attack", "sl-decay", "sl-sustain", "sl-release", "sl-pulseWidth", "sl-noiseAmount",
    ]);
    for (const [tag, id] of ranges) {
      expect(html).toContain(`for="${id}"`);
      expect(tag).toContain("aria-valuetext");
    }
  });
  it("says plainly that preview and save are unavailable when the engine is not connected", () => {
    const html = render("en");
    expect(html).toContain(t("slEngineMissing", "en"));
    expect(html).toMatch(/class="primary sl-preview"[^>]*disabled/);
    expect(html).toMatch(/class="primary sl-save"[^>]*disabled/);
  });
  it("shows the graph with a text alternative and no motion while idle", () => {
    const html = render("en");
    expect(html).toMatch(/role="img" aria-label="Sound graph: Square; 1800 Hz/);
    expect(html).not.toContain("sl-playhead");
  });
  it("replaces the pitch sweep with the audition keys for an instrument", () => {
    const html = render("en", { ...disconnectedAdapter, available: { preview: true, save: true } }, instrumentDraft());
    expect(html).toContain("sl-keys");
    expect(html).not.toContain('id="sl-pitchEnd"');
    expect(html).toContain('aria-keyshortcuts="A"');
    expect(html).not.toContain("sl-engine");
  });
  it("keeps the kind switch locked once a sound exists", () => {
    const html = render("en");
    expect(html).toMatch(/class="sl-kind"[^>]*disabled=""[^>]*><strong>Instrument/);
  });
});
