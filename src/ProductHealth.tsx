import { useEffect, useState } from "react";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import type { Locale } from "./i18n";
import type { ProductHealth as Health } from "../shared/analytics";
export function ProductHealth({ locale }: { locale: Locale }) {
  const c = (key: string) => hostedCopy(key, locale);
  const [data, setData] = useState<Health | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<Health>("/admin/product-health")
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
      });
    return () => {
      active = false;
    };
  }, []);
  if (error) return <p role="alert">{c(`error_${error}`)}</p>;
  if (!data) return <p>{c("working")}</p>;
  const accounts = data.accounts,
    projects = data.projects;
  const rows: [string, number | string][] = [
    ["totalAccounts", accounts.total],
    ["verifiedAccounts", accounts.verified],
    ["activeAccounts7d", accounts.active7d],
    ["systemAdmin", accounts.admins],
    ["adminProjects", projects.total],
    ["public", projects.public],
    ["remix", projects.remixes],
    [
      "verifiedShare",
      accounts.total
        ? `${Math.round((accounts.verified / accounts.total) * 1000) / 10}%`
        : "—",
    ],
  ];
  return (
    <section className="class-card product-health">
      <h2>{c("productHealth")}</h2>
      <p>{c("healthMetricDefinitions")}</p>
      <dl className="health-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{c(label)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <a href="/api/v1/admin/operations" target="_blank" rel="noreferrer">
        {c("operationsStatus")}
      </a>
      <h3>{c("usageCounts")}</h3>
      <p>
        {c(
          data.analytics.enabled ? "analyticsSampleNote" : "analyticsDisabled",
        )}
      </p>
      {data.analytics.enabled && (
        <>
          <table>
            <caption>{c("usageFunnel")}</caption>
            <thead>
              <tr>
                <th>{c("metricEvent")}</th>
                <th>{c("measuredSessions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.analytics.funnel.map((row) => (
                <tr key={row.stage}>
                  <th scope="row">{row.stage}</th>
                  <td>{row.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>{c("productEvents")}</caption>
            <thead>
              <tr>
                <th>{c("metricEvent")}</th>
                <th>{c("eventCount")}</th>
                <th>{c("measuredSessions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.analytics.events.map((row) => (
                <tr key={row.event}>
                  <th scope="row">{row.event}</th>
                  <td>{row.count}</td>
                  <td>{row.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
