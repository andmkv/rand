import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Chrome around the 256×192 canvas inside the SCREEN panel, in CSS px (see .screen-panel in style.css). */
export const screenChrome = { x: 36, y: 114 };
const gap = 10;
export type WorkspaceLayout = "split" | "stack";
export interface Metrics {
  width: number;
  height: number;
  dpr: number;
  story: boolean;
  /** A text strip (the Story) shares the workspace with SCREEN and CODE. */
  strip: boolean;
  /** Read-only project pages: SCREEN first, project info and code in a narrower side column. */
  viewer?: boolean;
}
export interface Placement {
  layout: WorkspaceLayout;
  /** CSS size of one SCREEN pixel. Always a whole number of device pixels, so every pixel is drawn the same width. */
  scale: number;
}
const minCodeWidth = 340,
  minCodeHeight = 240,
  minStoryHeight = 150,
  minInfoWidth = 360;
/**
 * Picks the arrangement and the largest SCREEN scale k/dpr (k whole device pixels per SCREEN pixel)
 * that leaves usable room for CODE (and the Story strip). On 2x displays 1.5×, 2.5× … are exact too.
 */
export function placeWorkspace({ width, height, dpr, story, strip, viewer }: Metrics): Placement {
  const ratio = Math.max(1, dpr);
  const snap = (fit: number) => {
    const k = Math.floor(fit * ratio + 1e-6);
    return Math.max(1, k / ratio);
  };
  if (viewer) {
    // The page scrolls under a stacked viewer, so only SCREEN itself has to fit the window;
    // whichever arrangement gives the larger SCREEN wins (side by side on a tie).
    const stack = snap(
      Math.min((width - screenChrome.x) / 256, (height - screenChrome.y - 60) / 192),
    );
    // A split viewer needs one SCREEN pixel plus the full minimum info column.
    // snap() floors tiny or negative fits to 1, so reject an impossible split
    // before comparing scales or narrow screens stay split in a vertical strip.
    if (width - minInfoWidth - gap - screenChrome.x < 256)
      return { layout: "stack", scale: stack };
    const split = snap(
      Math.min(
        (width - minInfoWidth - gap - screenChrome.x) / 256,
        (height - screenChrome.y) / 192,
      ),
    );
    return stack > split
      ? { layout: "stack", scale: stack }
      : { layout: "split", scale: split };
  }
  if (height > width * 1.05) {
    // Portrait tablets: SCREEN on top at full width, CODE below, Story last.
    const fit = Math.min(
      (width - screenChrome.x) / 256,
      (height - (strip ? minStoryHeight + gap : 0) - minCodeHeight - gap - screenChrome.y) / 192,
    );
    return { layout: "stack", scale: snap(fit) };
  }
  const fit = Math.min(
    (width - minCodeWidth - gap - screenChrome.x) / 256,
    (height - (strip ? minStoryHeight + gap : 0) - screenChrome.y) / 192,
  );
  return { layout: "split", scale: snap(fit) };
}
export function useWorkspaceLayout(
  ref: RefObject<HTMLElement | null>,
  story: boolean,
  strip = story,
  viewer = false,
): Placement {
  const [placement, setPlacement] = useState<Placement>({
    layout: "split",
    scale: 2,
  });
  const [dpr, setDpr] = useState(
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  );
  useEffect(() => {
    const update = () => setDpr(window.devicePixelRatio || 1);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const next = placeWorkspace({ width, height, dpr, story, strip, viewer });
      setPlacement((old) =>
        old.layout === next.layout && old.scale === next.scale ? old : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, dpr, story, strip, viewer]);
  return placement;
}
export function useMedia(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
