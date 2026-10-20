import { api } from "./api";

// Operational counts only: no stack, error message, URL, user ID or source leaves the browser.
// One report per page limits noise; reporting failure cannot create a rejection loop.
export function installFatalReporting(target: Window = window) {
  let reported = false;
  for (const kind of ["error", "unhandledrejection"] as const)
    target.addEventListener(kind, (event) => {
      if (reported || (kind === "error" && !(event instanceof ErrorEvent)))
        return;
      reported = true;
      void api("/operations/client-error", "POST", { kind }).catch(() => {});
    });
}
