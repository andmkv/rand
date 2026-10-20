import { useMemo } from "react";
import type { SoundDraft } from "./sound-draft";
import {
  graphSize,
  pitchAxis,
  pitchPath,
  pitchY,
  stageMarkers,
  tracks,
  volumePath,
  wavePath,
} from "./sound-graph";

/**
 * Three stacked tracks computed from the draft itself: pitch glide, volume envelope, waveform.
 * Static SVG; the only motion is a CSS playhead while a preview runs (no timers, no audio-driven
 * redraw, and none at all under prefers-reduced-motion).
 */
export function SoundGraph({
  draft,
  noteHz,
  playing,
  playRun,
  labels,
  description,
}: {
  draft: SoundDraft;
  noteHz?: number;
  playing: boolean;
  playRun: number;
  labels: { graph: string; pitch: string; volume: string; wave: string };
  description: string;
}) {
  const pitch = useMemo(() => pitchPath(draft, noteHz), [draft, noteHz]);
  const volume = useMemo(() => volumePath(draft), [draft]);
  const wave = useMemo(() => wavePath(draft, noteHz), [draft, noteHz]);
  const markers = stageMarkers(draft);
  return (
    <figure className="sl-graph" data-playing={playing}>
      <svg
        viewBox={`0 0 ${graphSize.width} ${graphSize.height}`}
        role="img"
        aria-label={`${labels.graph}: ${description}`}
        preserveAspectRatio="none"
        shapeRendering="geometricPrecision"
      >
        {(["pitch", "volume", "wave"] as const).map((key) => (
          <g key={key}>
            <rect
              className="sl-track"
              x="0"
              y={tracks[key].top}
              width={graphSize.width}
              height={tracks[key].height}
            />
          </g>
        ))}
        {pitchAxis.map((hz) => (
          <line
            key={hz}
            className="sl-gridline"
            x1="0"
            x2={graphSize.width}
            y1={pitchY(hz)}
            y2={pitchY(hz)}
          />
        ))}
        {[markers.attack, markers.decay, markers.release].map((x, index) => (
          <line
            key={index}
            className="sl-mark"
            x1={x}
            x2={x}
            y1={tracks.volume.top}
            y2={tracks.volume.top + tracks.volume.height}
          />
        ))}
        <path className="sl-pitch" d={pitch} fill="none" />
        <path className="sl-volume-area" d={volume.area} />
        <path className="sl-volume" d={volume.line} fill="none" />
        <path className="sl-wave-line" d={wave} fill="none" />
        {playing && (
          <line
            key={playRun}
            className="sl-playhead"
            x1="0"
            x2="0"
            y1="0"
            y2={graphSize.height}
            style={{ animationDuration: `${draft.duration}s` }}
          />
        )}
      </svg>
      <figcaption aria-hidden="true">
        <span className="sl-cap-pitch">{labels.pitch}</span>
        <span className="sl-cap-volume">{labels.volume}</span>
        <span className="sl-cap-wave">{labels.wave}</span>
      </figcaption>
    </figure>
  );
}
