import { spriteAssets } from "./runtime/assets";
import { useState } from "react";
import { palette } from "./runtime/palette";
export function ProjectPreview({
  title,
  seed,
  url,
}: {
  title: string;
  seed: string;
  url?: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <img
      className="gallery-preview"
      src={url}
      width="256"
      height="192"
      alt={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
    />
  ) : (
    <PixelPreview title={title} seed={seed} />
  );
}
export function PixelPreview({
  title,
  seed,
  assetId,
}: {
  title: string;
  seed: string;
  assetId?: string;
}) {
  const sprite = spriteAssets.find((asset) => asset.id === assetId);
  const hash = [...seed].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 17);
  return (
    <svg
      className="gallery-preview"
      role="img"
      aria-label={title}
      viewBox="0 0 256 192"
      shapeRendering="crispEdges"
    >
      <rect width="256" height="192" fill={palette[0]} />
      {Array.from({ length: 16 }, (_, i) => (
        <rect
          key={i}
          x={(hash * (i + 1) + i * 43) % 252}
          y={(hash + i * 47) % 188}
          width="3"
          height="3"
          fill={palette[8 + (i % 7) + 1]}
        />
      ))}
      {sprite ? (
        <g transform="translate(96 64) scale(8)">
          {sprite.pixels.flatMap((row, y) =>
            [...row].map((pixel, x) =>
              pixel === "." ? null : (
                <rect
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  width="1"
                  height="1"
                  fill={palette[Number(pixel) + 8]}
                />
              ),
            ),
          )}
        </g>
      ) : (
        Array.from({ length: 6 }, (_, i) => (
          <rect
            key={i}
            x={56 + i * 10}
            y={24 + i * 10}
            width={144 - i * 20}
            height={144 - i * 20}
            fill={palette[9 + (i % 7)]}
          />
        ))
      )}
      <rect
        x="3"
        y="3"
        width="250"
        height="186"
        fill="none"
        stroke={palette[13]}
        strokeWidth="6"
      />
    </svg>
  );
}

/** Pre-rendered frame of the example's own output (scripts/render-example-previews.mjs). */
export function ExamplePreview({
  id,
  title,
  assetId,
}: {
  id: string;
  title: string;
  assetId?: string;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <PixelPreview title={title} seed={id} assetId={assetId} />
  ) : (
    <img
      className="gallery-preview example-preview"
      src={`/previews/examples/${id}.png`}
      width="256"
      height="192"
      alt={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
