import { useEffect, useState } from "react";
import { api } from "./api";
import { hostedCopy } from "../shared/copy";
import type { PlatformLimits } from "../shared/limits";
import type { Locale } from "./i18n";
export function useServerLimits(enabled = true) {
  const [limits, setLimits] = useState<PlatformLimits | null>(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setError(false);
    void api<PlatformLimits>("/limits")
      .then((r) => {
        if (active) setLimits(r);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [enabled, attempt]);
  return { limits, error, retry: () => setAttempt((n) => n + 1) };
}
export function ServerLimits({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false),
    { limits, error, retry } = useServerLimits(open),
    c = (key: string) => hostedCopy(key, locale);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{c("serverLimits")}</summary>
      {error ? (
        <p role="alert">
          {c("error_UNAVAILABLE")} <button onClick={retry}>{c("retry")}</button>
        </p>
      ) : !limits ? (
        <p>{c("working")}</p>
      ) : (
        <dl className="admin-stats">
          {(
            [
              ["sourceLimit", limits.sourceCharacters],
              ["projectCount", limits.projectsPerUser],
              ["publicationLimit", limits.publicationsPer15Minutes],
              ["revisionLimit", limits.historyCount],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt>{c(key)}</dt>
              <dd>{value.toLocaleString(locale)}</dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}
