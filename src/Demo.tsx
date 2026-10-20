import { useEffect, useState } from "react";
import { useAccess } from "./Access";
import { useLocale } from "./useLocale";
import { hostedCopy } from "../shared/copy";
import { demoEndedKey, exitDemo } from "./demoSession";

export function DemoBadge() {
  const access = useAccess();
  const { locale } = useLocale();
  const demo = !!access.principal?.demo;
  useEffect(() => {
    document.body.classList.toggle("demo-mode", demo);
    return () => document.body.classList.remove("demo-mode");
  }, [demo]);
  if (!demo) return null;
  return (
    <aside
      className="demo-badge"
      aria-label={hostedCopy("demoMode", locale)}
    >
      <strong>{hostedCopy("demoMode", locale)}</strong>
      <p>{hostedCopy("demoNotice", locale)}</p>
      <button type="button" onClick={() => void exitDemo()}>
        {hostedCopy("demoExit", locale)}
      </button>
    </aside>
  );
}

export function DemoNotice() {
  const { locale } = useLocale();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let ended = false;
    try {
      ended = sessionStorage.getItem(demoEndedKey) === "1";
      if (ended) sessionStorage.removeItem(demoEndedKey);
    } catch {
      /* ignore */
    }
    if (!ended) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 9000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="demo-notice" role="status">
      {hostedCopy("demoEnded", locale)}
    </div>
  );
}
