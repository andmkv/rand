import { drawText, textWidth } from "./pixel-font";
import { SpellError } from "./language";
import {
  Engine,
  numeric,
  count,
  unknown,
  type Value,
  type Sprite,
  type Host,
} from "./engine";
import { AudioToy } from "./audio";
import { sprites } from "./sprites";
import { palette } from "./palette";
import {
  assertProjectAssetManifest,
  indexedSpriteFrame,
  type AnimatedSpriteV1,
  type IndexedSpriteV1,
  type ProjectAssetManifestV1,
  type SpriteAssetV1,
} from "../../shared/assets";
import { animationFrameIndex, animationIsPlaying } from "./animation";
export { palette };
const rgb = palette.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);
function documentHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
type Shape = {
  id: number;
  name: string;
  args: Value[];
  color: string;
  cx: number;
  cy: number;
  indestructible?: boolean;
};
export class World implements Host {
  ink = 7;
  paper = 0;
  border = 1;
  bright = 1;
  tempo = 120;
  shapes: Shape[] = [];
  objects: Sprite[] = [];
  particles: { x: number; y: number; color: string }[] = [];
  nextId = 1;
  rasterWork = 0;
  pixels = new Uint8Array(256 * 192);
  owners = new Uint32Array(256 * 192);
  nextShape = 1;
  frame: number | undefined;
  image?: ImageData;
  startupFrame: number | undefined;
  startupBorder = 1;
  audio = new AudioToy();
  private projectSprites = new Map<string, SpriteAssetV1>();
  private projectSpriteCanvases = new Map<string, HTMLCanvasElement[]>();
  keys = new Set<string>();
  releaseKeys?: () => void;
  key(name: string) {
    if (!this.releaseKeys && this.canvas) {
      const canvas = this.canvas;
      const keyName = (event: KeyboardEvent) => {
        if (event.code.startsWith("Arrow"))
          return event.code.slice(5).toUpperCase();
        if (event.code === "Space") return "SPACE";
        // Letter controls keep their physical position with Cyrillic layouts too.
        if (/^(Key[A-Z]|Digit[0-9])$/.test(event.code))
          return event.code.replace(/^(Key|Digit)/, "");
        return event.key.toUpperCase();
      };
      const down = (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const key = keyName(event);
        if (/^(LEFT|RIGHT|UP|DOWN|SPACE|ENTER|[A-Z0-9])$/.test(key)) {
          event.preventDefault();
          this.keys.add(key);
        }
      };
      const up = (event: KeyboardEvent) => {
        this.keys.delete(keyName(event));
      };
      const clear = () => this.keys.clear();
      canvas.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
      canvas.addEventListener("blur", clear);
      window.addEventListener("blur", clear);
      document.addEventListener("visibilitychange", clear);
      this.releaseKeys = () => {
        canvas.removeEventListener("keydown", down);
        window.removeEventListener("keyup", up);
        canvas.removeEventListener("blur", clear);
        window.removeEventListener("blur", clear);
        document.removeEventListener("visibilitychange", clear);
        clear();
        this.releaseKeys = undefined;
      };
      canvas.focus({ preventScroll: true });
    }
    return this.keys.has(name);
  }
  events: string[] = [];
  eventCounts = new Map<string, number>();
  onChange = () => {};
  onPrint = (_s: string) => {};
  ask: Host["input"] = async () => "";
  private animationVisibilityListener?: () => void;
  constructor(
    public canvas?: HTMLCanvasElement,
    private readonly animationNow: () => number = () => performance.now(),
  ) {}
  setProjectAssets(manifest?: ProjectAssetManifestV1) {
    if (!manifest) {
      this.projectSprites.clear();
      this.projectSpriteCanvases.clear();
      this.audio.setProjectSounds();
      return;
    }
    try {
      assertProjectAssetManifest(manifest);
    } catch {
      throw new SpellError("importInvalid");
    }
    this.projectSprites = new Map(
      manifest.sprites.map((binding) => [binding.alias, binding.sprite]),
    );
    this.audio.setProjectSounds(manifest.sounds ?? []);
    this.projectSpriteCanvases.clear();
    if (typeof document !== "undefined") {
      for (const binding of manifest.sprites) {
        const source = binding.sprite;
        const frameCount = source.format === "randusr.animated-sprite" ? source.frames.length : 1;
        const canvases: HTMLCanvasElement[] = [];
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
          const pixels = indexedSpriteFrame(source, frameIndex);
          const canvas = document.createElement("canvas");
          canvas.width = pixels.width;
          canvas.height = pixels.height;
          const context = canvas.getContext("2d");
          if (!context) continue;
          const image = context.createImageData(pixels.width, pixels.height);
          for (let i = 0; i < pixels.pixels.length; i++) {
            const index = pixels.pixels[i];
            if (index === pixels.transparentIndex) continue;
            const [red, green, blue] = rgb[pixels.palette[index]];
            image.data[i * 4] = red;
            image.data[i * 4 + 1] = green;
            image.data[i * 4 + 2] = blue;
            image.data[i * 4 + 3] = 255;
          }
          context.putImageData(image, 0, 0);
          canvases.push(canvas);
        }
        if (canvases.length) this.projectSpriteCanvases.set(binding.alias, canvases);
      }
    }
  }
  reset() {
    this.stop();
    this.ink = 7;
    this.paper = 0;
    this.border = 1;
    this.bright = 1;
    this.tempo = 120;
    this.shapes = [];
    this.objects = [];
    this.particles = [];
    this.nextId = 1;
    this.rasterWork = 0;
    this.pixels.fill(0);
    this.owners.fill(0);
    this.nextShape = 1;
    this.events = [];
    this.eventCounts.clear();
    this.render();
  }
  stop() {
    this.releaseKeys?.();
    this.keys.clear();
    this.cancelStartup();
    const now = this.animationNow();
    for (const object of this.objects) {
      const asset = this.projectSprites.get(object.kind);
      if (
        asset?.format === "randusr.animated-sprite" &&
        object.animationStartedAt !== undefined
      ) {
        object.animationFrozenFrame = animationFrameIndex(
          asset,
          now - object.animationStartedAt,
        );
        object.animationStartedAt = undefined;
      }
    }
    this.detachAnimationVisibilityListener();
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.audio.stop();
    this.particles = [];
    this.render();
  }
  cancelStartup() {
    if (this.startupFrame !== undefined) {
      cancelAnimationFrame(this.startupFrame);
      this.startupFrame = undefined;
      this.border = this.startupBorder;
    }
  }
  startup(duration = 900, reduced = false) {
    this.cancelStartup();
    if (!this.canvas || reduced) {
      this.render();
      return;
    }
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    this.startupBorder = this.border;
    let start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      if (elapsed >= duration) {
        this.startupFrame = undefined;
        this.border = this.startupBorder;
        this.render();
        return;
      }
      const ctx = this.canvas?.getContext("2d");
      if (!ctx) return;
      const phase = Math.floor(elapsed / (duration / 3));
      this.border = [1, 5, 3][phase] ?? 1;
      this.onChange();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = palette[0];
      ctx.fillRect(0, 0, 256, 192);
      const frame = Math.floor(elapsed / 60);
      // Original deterministic blocks, short bands and fragments, never ROM screenshots.
      for (let n = 0; n < 60; n++) {
        const x = (n * 47 + frame * 13) % 256,
          y = (n * 29 + frame * 7) % 192;
        ctx.fillStyle = palette[9 + ((n + frame) % 7)];
        if (y > (elapsed / duration) * 192)
          ctx.fillRect(x, y, 8 + (n % 3) * 8, 3 + (n % 5));
      }
      ctx.fillStyle = palette[15];
      ctx.fillRect(0, (frame * 11) % 192, 256, 2);
      this.startupFrame = requestAnimationFrame(tick);
    };
    this.startupFrame = requestAnimationFrame(tick);
  }
  clearScreen(duration = 650, reduced = false) {
    this.cancelStartup();
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    // Capture the final program frame before discarding its visual state.
    const ctx = this.canvas?.getContext("2d");
    this.paint();
    const picture =
      ctx && !reduced ? ctx.getImageData(0, 0, 256, 192) : undefined;
    this.shapes = [];
    this.objects = [];
    this.particles = [];
    this.pixels.fill(0);
    this.owners.fill(0);
    this.paper = 0;
    if (!ctx || !picture) {
      this.render();
      return;
    }
    this.startupBorder = this.border;
    let start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / duration);
      ctx.putImageData(picture, 0, 0);
      ctx.fillStyle = palette[0];
      // Erase in Spectrum-sized character rows, from top to bottom.
      ctx.fillRect(0, 0, 256, Math.floor(progress * 24) * 8);
      if (progress === 1) {
        this.startupFrame = undefined;
        this.render();
      } else this.startupFrame = requestAnimationFrame(tick);
    };
    this.startupFrame = requestAnimationFrame(tick);
  }
  print(s: string) {
    this.onPrint([...s].slice(0, 1000).join(""));
  }
  record(event: string) {
    this.eventCounts.set(
      event,
      Math.min(Number.MAX_SAFE_INTEGER, (this.eventCounts.get(event) ?? 0) + 1),
    );
    this.events.push(event);
    if (this.events.length > 256) this.events.shift();
  }
  input(prompt: string, signal: AbortSignal) {
    this.record("INPUT");
    return this.ask(prompt, signal);
  }
  color(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 7)
      throw new SpellError("range", { value: "color (0–7)" });
    return palette[n + this.bright * 8];
  }
  coord(n: Value) {
    const x = numeric(n);
    if (Math.abs(x) > 10000)
      throw new SpellError("range", { value: "coordinate (−10000…10000)" });
    return Math.round(x);
  }
  spawn(kind: string, x: number, y: number, e?: Engine): Sprite {
    kind = kind.toLowerCase();
    if (!Object.hasOwn(sprites, kind) && !this.projectSprites.has(kind))
      throw new SpellError("sprite", {
        value: [...Object.keys(sprites), ...this.projectSprites.keys()].join(", "),
      });
    this.coord(x);
    this.coord(y);
    if (
      (!e?.longRunning && this.nextId > 512) ||
      this.objects.filter((s) => s.alive).length >= 128
    )
      throw new SpellError("limit");
    const s: Sprite = {
      id: this.nextId++,
      kind,
      x,
      y,
      angle: 0,
      visible: true,
      alive: true,
      say: "",
    };
    const asset = this.projectSprites.get(kind);
    if (asset?.format === "randusr.animated-sprite")
      s.animationStartedAt = this.animationNow();
    this.objects = this.objects.filter((s) => s.alive);
    this.objects.push(s);
    this.record("SPAWN:" + kind);
    this.render();
    return s;
  }
  async method(s: Sprite, name: string, a: Value[], e: Engine) {
    this.record(name);
    switch (name) {
      case "SIZE": {
        count(a, 2, name);
        const width = numeric(a[0]),
          height = numeric(a[1]);
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width < 1 ||
          height < 1 ||
          width > 256 ||
          height > 192
        )
          throw new SpellError("range", { value: "sprite size" });
        s.width = width;
        s.height = height;
        break;
      }
      case "MOVE":
      case "MOVE_BY":
        count(a, 2, name);
        s.x = this.coord(name === "MOVE" ? a[0] : s.x + numeric(a[0]));
        s.y = this.coord(name === "MOVE" ? a[1] : s.y + numeric(a[1]));
        break;
      case "TURN":
        count(a, 1, name);
        s.angle = numeric(a[0]) % 360;
        break;
      case "SHOW":
      case "HIDE":
      case "DESTROY":
        count(a, 0, name);
        if (name === "DESTROY") s.alive = false;
        else s.visible = name === "SHOW";
        break;
      case "SAY":
        count(a, 1, name);
        s.say = [...String(a[0])].slice(0, 40).join("");
        break;
      case "EXPLODE":
        count(a, 0, name);
        s.say = "!";
        this.render();
        await e.wait(0.2);
        this.audioBudget(e);
        this.audio.effect("explosion");
        this.objects.forEach((o) => {
          if (!o.indestructible && Math.hypot(o.x - s.x, o.y - s.y) < 44)
            o.alive = false;
        });
        const destroyed = new Set(
          this.shapes
            .filter((o) => !o.indestructible && withinBlast(o, s.x, s.y))
            .map((o) => o.id),
        );
        const protectedIds = new Set(
          this.shapes.filter((o) => o.indestructible).map((o) => o.id),
        );
        for (let y = 0; y < 192; y++)
          for (let x = 0; x < 256; x++) {
            const i = y * 256 + x;
            if (protectedIds.has(this.owners[i])) continue;
            if (
              destroyed.has(this.owners[i]) ||
              Math.hypot(x - s.x, y - s.y) < 44
            ) {
              this.pixels[i] = 0;
              this.owners[i] = 0;
            }
          }
        this.shapes = this.shapes.filter((o) => !destroyed.has(o.id));
        for (let frame = 0; frame < 7; frame++) {
          this.particles = Array.from({ length: 32 }, (_, i) => ({
            x: s.x + Math.cos(i * 2.4) * frame * 7,
            y: s.y + Math.sin(i * 2.4) * frame * 7,
            color: palette[[10, 14, 15][i % 3]],
          }));
          this.render();
          await e.wait(0.045);
        }
        this.particles = [];
        break;
      default:
        unknown(name, [
          "MOVE",
          "MOVE_BY",
          "TURN",
          "SHOW",
          "HIDE",
          "DESTROY",
          "SAY",
          "EXPLODE",
        ]);
    }
    this.render();
  }
  audioBudget(e: Engine) {
    return e.audioEvent();
  }
  async command(name: string, a: Value[], e: Engine) {
    this.record(name);

    const arity: Record<string, number> = {
      INK: 1,
      PAPER: 1,
      BORDER: 1,
      BRIGHT: 1,
      PLOT: 2,
      LINE: 4,
      BOX: 4,
      FILLBOX: 4,
      CIRCLE: 3,
      FILLCIRCLE: 3,
      TEXT: 3,
      BEEP: 2,
      NOTE: 2,
      REST: 1,
      TEMPO: 1,
      PLAY: 1,
      SOUND: 1,
      SFX: 1,
    };
    if (name === "NOTE" && a.length !== 2 && a.length !== 3)
      throw new SpellError("args", { value: name, count: 2 });
    if (name === "PLAY" && a.length !== 1 && a.length !== 2)
      throw new SpellError("args", { value: name, count: 1 });
    if (name !== "CLS" && name !== "NOTE" && name !== "PLAY") count(a, arity[name], name);
    if (["INK", "PAPER", "BORDER"].includes(name)) {
      const n = numeric(a[0]);
      this.color(n);
      if (name === "INK") this.ink = n;
      if (name === "PAPER") this.paper = n;
      if (name === "BORDER") this.border = n;
    } else if (name === "BRIGHT") {
      const n = numeric(a[0]);
      if (n !== 0 && n !== 1) throw new SpellError("range", { value: name });
      this.bright = n;
    } else if (name === "CLS") {
      if (a.length > 1) count(a, 1, name);
      if (a.length) {
        this.color(numeric(a[0]));
        this.paper = numeric(a[0]);
      }
      this.shapes = [];
      this.pixels.fill(0);
      this.owners.fill(0);
    } else if (
      ["BEEP", "NOTE", "REST", "TEMPO", "PLAY", "SOUND", "SFX"].includes(name)
    ) {
      if (name === "TEMPO") {
        const n = numeric(a[0]);
        if (n < 30 || n > 300) throw new SpellError("range", { value: name });
        this.tempo = n;
      } else if (name === "REST")
        await e.wait((numeric(a[0]) * 60) / this.tempo);
      else if (name === "SOUND" || name === "SFX") {
        if (this.audioBudget(e)) this.audio.effect(String(a[0]));
        if (name === "SOUND") await e.wait(0.2);
      } else if (name === "PLAY") {
        const notes = String(a[0]).trim().split(/\s+/);
        if (notes.length > 64) throw new SpellError("limit");
        for (const note of notes) {
          const allowed = this.audioBudget(e);
          if (allowed && a[1] !== undefined)
            this.audio.playInstrument(String(a[1]), this.audio.note(note), 60 / this.tempo);
          else if (allowed) this.audio.tone(this.audio.note(note), 60 / this.tempo);
          await e.wait(60 / this.tempo);
        }
      } else {
        const allowed = this.audioBudget(e);
        const duration =
          numeric(a[1]) * (name === "NOTE" ? 60 / this.tempo : 1);
        if (allowed && name === "NOTE" && a[2] !== undefined)
          this.audio.playInstrument(String(a[2]), this.audio.note(String(a[0])), duration);
        else if (allowed)
          this.audio.tone(
            name === "NOTE" ? this.audio.note(String(a[0])) : numeric(a[0]),
            duration,
          );
        await e.wait(duration);
      }
    } else {
      const args = a.map((v, i) =>
        name === "TEXT" && i === 2
          ? [...String(v)].slice(0, 120).join("")
          : this.coord(v),
      );
      if (
        (name.includes("CIRCLE") && numeric(args[2]) < 0) ||
        (["BOX", "FILLBOX"].includes(name) &&
          (numeric(args[2]) < 0 || numeric(args[3]) < 0))
      )
        throw new SpellError("range", { value: "size" });
      const x = numeric(args[0]),
        y = numeric(args[1]);
      const cost = name.includes("CIRCLE")
        ? 65536
        : name === "LINE"
          ? Math.min(
              20001,
              Math.abs(numeric(args[2]) - x) +
                Math.abs(numeric(args[3]) - y) +
                1,
            )
          : name === "TEXT"
            ? String(args[2]).length * 25
            : 1;
      if (this.nextShape >= 4294967295) {
        this.nextShape = 1;
        this.owners.fill(0);
        this.shapes = [];
      }
      const shape: Shape = {
        id: this.nextShape++,
        name,
        args,
        color: this.color(this.ink),
        cx:
          name === "LINE"
            ? (x + numeric(args[2])) / 2
            : name.includes("BOX")
              ? x + numeric(args[2]) / 2
              : x,
        cy:
          name === "LINE"
            ? (y + numeric(args[3])) / 2
            : name.includes("BOX")
              ? y + numeric(args[3]) / 2
              : y,
      };
      this.shapes.push(shape);
      if (this.shapes.length > 512) this.shapes.shift();
      this.rasterWork = cost;
      this.rasterize(shape);
      this.render();
      await e.drawing(cost);
    }
    this.render();
  }
  render() {
    if (!this.canvas || this.startupFrame !== undefined) return;
    if (this.frame !== undefined) return;
    const now = this.animationNow();
    const hasAnimations = this.hasPlayingAnimations(now);
    if (hasAnimations) this.attachAnimationVisibilityListener();
    if (hasAnimations && documentHidden()) return;
    this.frame = requestAnimationFrame((timestamp) => {
      this.frame = undefined;
      const time = Number.isFinite(timestamp) ? timestamp : this.animationNow();
      this.paint(time);
      if (this.hasPlayingAnimations(time)) this.render();
      else this.detachAnimationVisibilityListener();
    });
  }
  private hasPlayingAnimations(now: number) {
    return this.objects.some((object) => {
      if (!object.alive || !object.visible || object.animationStartedAt === undefined)
        return false;
      const asset = this.projectSprites.get(object.kind);
      return (
        asset?.format === "randusr.animated-sprite" &&
        animationIsPlaying(asset, now - object.animationStartedAt)
      );
    });
  }
  private attachAnimationVisibilityListener() {
    if (this.animationVisibilityListener || typeof document === "undefined") return;
    const listener = () => {
      if (documentHidden()) {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
      } else this.render();
    };
    this.animationVisibilityListener = listener;
    document.addEventListener("visibilitychange", listener);
  }
  private detachAnimationVisibilityListener() {
    if (!this.animationVisibilityListener || typeof document === "undefined") return;
    document.removeEventListener("visibilitychange", this.animationVisibilityListener);
    this.animationVisibilityListener = undefined;
  }
  rasterize(shape: Shape) {
    const color = palette.indexOf(shape.color) + 1;
    const pixel = (x: number, y: number) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x >= 0 && x < 256 && y >= 0 && y < 192) {
        const i = y * 256 + x;
        this.pixels[i] = color;
        this.owners[i] = shape.id;
      }
    };
    const rect = (x: number, y: number, w: number, h: number) => {
      for (let yy = Math.max(0, y); yy < Math.min(192, y + h); yy++)
        for (let xx = Math.max(0, x); xx < Math.min(256, x + w); xx++)
          pixel(xx, yy);
    };
    const line = (x: number, y: number, x2: number, y2: number) => {
      let dx = Math.abs(x2 - x),
        sx = x < x2 ? 1 : -1,
        dy = -Math.abs(y2 - y),
        sy = y < y2 ? 1 : -1,
        err = dx + dy;
      for (let i = 0; i < 40002; i++) {
        pixel(x, y);
        if (x === x2 && y === y2) break;
        const e = 2 * err;
        if (e >= dy) {
          err += dy;
          x += sx;
        }
        if (e <= dx) {
          err += dx;
          y += sy;
        }
      }
    };
    const [x, y, w, h] = shape.args as number[];

    switch (shape.name) {
      case "PLOT":
        pixel(x, y);
        break;
      case "LINE":
        line(x, y, w, h);
        break;
      case "FILLBOX":
        rect(x, y, w, h);
        break;
      case "BOX":
        rect(x, y, w, 1);
        rect(x, y + h - 1, w, 1);
        rect(x, y, 1, h);
        rect(x + w - 1, y, 1, h);
        break;
      case "CIRCLE":
      case "FILLCIRCLE": {
        for (let yy = Math.max(0, y - w); yy <= Math.min(191, y + w); yy++)
          for (let xx = Math.max(0, x - w); xx <= Math.min(255, x + w); xx++) {
            const d = (xx - x) ** 2 + (yy - y) ** 2;
            if (
              shape.name === "FILLCIRCLE"
                ? d <= w * w
                : Math.abs(Math.sqrt(d) - w) < 0.55
            )
              pixel(xx, yy);
          }
        break;
      }
      case "TEXT":
        drawText(pixel, x, y, String(shape.args[2]));
        break;
    }
  }
  paint(now = this.animationNow()) {
    this.onChange();
    const ctx = this.canvas?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.color(this.paper);
    ctx.fillRect(0, 0, 256, 192);
    const image = (this.image ??= ctx.createImageData(256, 192));
    const bg = this.paper + this.bright * 8;
    for (let i = 0; i < this.pixels.length; i++) {
      const color = rgb[this.pixels[i] ? this.pixels[i] - 1 : bg];
      image.data[i * 4] = color[0];
      image.data[i * 4 + 1] = color[1];
      image.data[i * 4 + 2] = color[2];
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    for (const s of this.objects) {
      if (!s.alive || !s.visible) continue;
      const custom = this.projectSprites.get(s.kind);
      if (custom) {
        const index = this.currentAnimationFrame(s, custom, now);
        this.paintIndexedSprite(
          ctx,
          s,
          indexedSpriteFrame(custom, index),
          this.projectSpriteCanvases.get(s.kind)?.[index],
        );
      }
      else {
        const rows = sprites[s.kind],
          r = (s.angle * Math.PI) / 180;
        rows.forEach((row, y) =>
          [...row].forEach((v, x) => {
            if (v !== ".") {
              ctx.fillStyle = palette[Number(v) + 8];
              const width = (s.width ?? 16) / 8,
                height = (s.height ?? 16) / 8;
              const dx = (x - 4) * width,
                dy = (y - 4) * height;
              ctx.fillRect(
                Math.round(s.x + dx * Math.cos(r) - dy * Math.sin(r)),
                Math.round(s.y + dx * Math.sin(r) + dy * Math.cos(r)),
                Math.ceil((s.width ?? 16) / 8),
                Math.ceil((s.height ?? 16) / 8),
              );
            }
          }),
        );
      }
      if (s.say) this.text(ctx, s.x - 12, s.y - 22, s.say, palette[15]);
    }
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
    }
  }
  private paintIndexedSprite(
    ctx: CanvasRenderingContext2D,
    object: Sprite,
    sprite: IndexedSpriteV1,
    cached?: HTMLCanvasElement,
  ) {
    const width = object.width ?? sprite.width;
    const height = object.height ?? sprite.height;
    const scaleX = width / sprite.width;
    const scaleY = height / sprite.height;
    const rotation = (object.angle * Math.PI) / 180;
    if (cached) {
      ctx.save();
      ctx.translate(object.x, object.y);
      ctx.rotate(rotation);
      ctx.drawImage(cached, -width / 2, -height / 2, width, height);
      ctx.restore();
      return;
    }
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        const index = sprite.pixels[y * sprite.width + x];
        if (index === sprite.transparentIndex) continue;
        ctx.fillStyle = palette[sprite.palette[index]];
        const dx = (x + 0.5 - sprite.width / 2) * scaleX;
        const dy = (y + 0.5 - sprite.height / 2) * scaleY;
        ctx.fillRect(
          Math.round(object.x + dx * Math.cos(rotation) - dy * Math.sin(rotation) - scaleX / 2),
          Math.round(object.y + dx * Math.sin(rotation) + dy * Math.cos(rotation) - scaleY / 2),
          Math.max(1, Math.ceil(scaleX)),
          Math.max(1, Math.ceil(scaleY)),
        );
      }
    }
  }
  private currentAnimationFrame(
    object: Sprite,
    asset: SpriteAssetV1,
    now: number,
  ) {
    if (asset.format !== "randusr.animated-sprite") return 0;
    if (object.animationFrozenFrame !== undefined) return object.animationFrozenFrame;
    return animationFrameIndex(
      asset,
      object.animationStartedAt === undefined ? 0 : now - object.animationStartedAt,
    );
  }
  text(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    value: string,
    color: string,
  ) {
    ctx.fillStyle = color;
    drawText((xx, yy) => ctx.fillRect(xx, yy, 1, 1), x, y, value);
  }
}
// Test geometry against the blast, so a long line is hit even if its center is far away.
function withinBlast(shape: Shape, bx: number, by: number): boolean {
  const [x, y, w, h] = shape.args as number[];
  if (shape.name === "LINE") {
    const dx = w - x,
      dy = h - y;
    const t = Math.max(
      0,
      Math.min(1, ((bx - x) * dx + (by - y) * dy) / (dx * dx + dy * dy || 1)),
    );
    return Math.hypot(bx - (x + t * dx), by - (y + t * dy)) < 44;
  }
  if (shape.name.includes("CIRCLE")) {
    const d = Math.hypot(bx - x, by - y);
    return d < w + 44 && (shape.name === "FILLCIRCLE" || d > w - 44);
  }
  if (shape.name.includes("BOX") || shape.name === "TEXT") {
    const width = shape.name === "TEXT" ? textWidth(String(shape.args[2])) : w,
      height = shape.name === "TEXT" ? 18 : h;
    return (
      Math.hypot(
        bx - Math.max(x, Math.min(bx, x + width)),
        by - Math.max(y, Math.min(by, y + height)),
      ) < 44
    );
  }
  return Math.hypot(bx - x, by - y) < 44;
}
