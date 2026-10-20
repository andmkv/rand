import { useEffect, useState, useRef } from "react";
import {
  api,
  isDemoMode,
  usageChoice,
  usageChoiceKey,
  setUsageNotice,
} from "./api";
import { useLocale } from "./useLocale";
import { hostedCopy } from "../shared/copy";
import type { AnalyticsConfiguration, ClientEvent } from "../shared/analytics";
let configuration: Promise<AnalyticsConfiguration> | undefined;
const config = () =>
  (configuration ??= api<AnalyticsConfiguration>("/analytics/config").then(
    (c) => {
      setUsageNotice(c.enabled ? c.noticeVersion : null);
      return c;
    },
  ));
export async function trackUsage(event: ClientEvent) {
  // Demo sessions are disposable UAT infrastructure and never contribute product measurement.
  if (isDemoMode()) return;
  try {
    const c = await config(),
      choice = usageChoice();
    if (
      !c.enabled ||
      !choice?.allowed ||
      choice.version !== c.noticeVersion ||
      !choice.token
    )
      return;
    await api("/analytics/events", "POST", {
      sessionToken: choice.token,
      noticeVersion: c.noticeVersion,
      event,
    });
  } catch {
    /* Optional measurement never interrupts the toy or creates a retry queue. */
  }
}
function trackPage() {
  const path = location.pathname;
  if (path === "/") void trackUsage("homepage_viewed");
  else if (path.startsWith("/examples/")) void trackUsage("example_opened");
  else if (path.startsWith("/p/")) void trackUsage("public_project_viewed");
}
export function AnalyticsControl() {
  const details = useRef<HTMLDetailsElement>(null);
  const { locale } = useLocale(),
    c = (key: string) => hostedCopy(key, locale);
  const [settings, setSettings] = useState<AnalyticsConfiguration | null>(null),
    [choice, setChoice] = useState(usageChoice());
  useEffect(() => {
    let active = true;
    void config()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        const current = usageChoice();
        if (current?.version !== value.noticeVersion) {
          sessionStorage.removeItem(usageChoiceKey);
          setChoice(null);
        }
        trackPage();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!settings?.enabled || !settings.noticeVersion || !settings.noticeUrl)
    return null;
  function choose(allowed: boolean) {
    const previous = usageChoice();
    const token = allowed
      ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "")
      : undefined;
    const next = {
      allowed,
      version: settings!.noticeVersion!,
      ...(token ? { token } : {}),
    };
    try {
      sessionStorage.setItem(usageChoiceKey, JSON.stringify(next));
    } catch {
      return;
    }
    setChoice(next);
    if (details.current) details.current.open = false;
    if (previous?.token)
      void api("/analytics/session", "DELETE", {
        sessionToken: previous.token,
      }).catch(() => {});
    if (allowed) trackPage();
  }
  return (
    <aside className="usage-control" aria-label={c("usageCounts")}>
      <details ref={details}>
        <summary>{c("usageCounts")}</summary>
        <p>{c("usageCountsNotice")}</p>
        <a href={settings.noticeUrl} target="_blank" rel="noreferrer">
          {c("readReviewedPolicy")}
        </a>
        <div className="actions">
          <button
            aria-pressed={choice?.allowed === true}
            onClick={() => choose(true)}
          >
            {c("allowUsageCounts")}
          </button>
          <button
            aria-pressed={choice?.allowed === false}
            onClick={() => choose(false)}
          >
            {c("declineUsageCounts")}
          </button>
        </div>
      </details>
    </aside>
  );
}
