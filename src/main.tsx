import { createRoot } from "react-dom/client";
import { installFatalReporting } from "./operations";
import { AnalyticsControl } from "./Analytics";
import { DemoBadge, DemoNotice } from "./Demo";
import { lazy, Suspense } from "react";
import { Home } from "./Home";
import { AccessProvider, useAccess } from "./Access";
import { hostedCopy } from "../shared/copy";
import { readLocale, useLocale } from "./useLocale";
import { t } from "./i18n";
import "./style.css";
import PolicyPage from "./Privacy";
const AdminPage = lazy(() => import("./Admin"));
const AdminProjectViewer = lazy(() => import("./AdminProjectViewer"));
const App = lazy(() => import("./App"));
const Book = lazy(() => import("./Book"));
const PublicViewer = lazy(() =>
  import("./Viewer").then((m) => ({ default: m.PublicViewer })),
);
const BuiltinViewer = lazy(() =>
  import("./Viewer").then((m) => ({ default: m.BuiltinViewer })),
);
function BrandFooter() {
  const { locale } = useLocale();
  if (import.meta.env.VITE_SHOW_BRAND_FOOTER === "false") return null;
  return (
    <footer className="site-brand-footer">
      <span>{t("brandCopyright", locale)}</span>{" "}
      <a href="https://smallhall.net" target="_blank" rel="noopener noreferrer">
        {t("brandMoreApps", locale)}
      </a>
    </footer>
  );
}
function Router() {
  const path = location.pathname;
  const principal = useAccess().principal;
  const identity = principal?.verified ? principal.id : "guest";
  if (path === "/privacy" || path === "/terms")
    return <PolicyPage kind={path === "/privacy" ? "privacy" : "terms"} />;
  if (path === "/admin") return <AdminPage key={identity} />;
  if (/^\/admin\/projects\/[a-f0-9-]{36}$/i.test(path))
    return <AdminProjectViewer key={identity} id={path.split("/")[3]} />;
  if (path === "/book" || path.startsWith("/book/")) return <Book />;
  if (path === "/") return <Home />;
  if (path.startsWith("/p/")) return <PublicViewer code={path.slice(3)} />;
  if (path.startsWith("/examples/"))
    return <BuiltinViewer id={path.slice(10)} />;
  if (
    [
      "/create",
      "/settings",
      "/me/projects",
      "/verify",
      "/invite",
      "/reset-password",
    ].includes(path)
  )
    return <App />;
  return (
    <main className="public-loading">
      <p>{hostedCopy("error_NOT_FOUND", readLocale())}</p>
      <a href="/">{hostedCopy("home", readLocale())}</a>
    </main>
  );
}
installFatalReporting();
createRoot(document.getElementById("root")!).render(
  <AccessProvider>
    <Suspense fallback={<p>{hostedCopy("working", readLocale())}</p>}>
      <Router />
      <AnalyticsControl />
      <DemoBadge />
      <DemoNotice />
    </Suspense>
    <BrandFooter />
  </AccessProvider>,
);
