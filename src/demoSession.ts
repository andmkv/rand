/**
 * Client-side demo session helpers.
 *
 * The local editor project is backed up before entering Demo Mode and restored on exit, so a
 * tester's real local work is never replaced by temporary demo code. Nothing here is a credential:
 * the server session is an httpOnly cookie and the readable marker is only an API-base hint.
 */
import { api, clearDemoFlag, isDemoMode, setDemoMode } from "./api";
import { cloudLinkKey } from "./cloudStorage";

const projectKey = "randomize-usr.project.v1";
const backupKey = "randusr-demo-backup";
const endedKey = "randusr-demo-ended";
let ending = false;

export function backupLocalProject() {
  try {
    sessionStorage.setItem(
      backupKey,
      JSON.stringify({
        project: localStorage.getItem(projectKey),
        link: localStorage.getItem(cloudLinkKey),
      }),
    );
    // Never autosave demo edits into a real cloud project association.
    localStorage.removeItem(cloudLinkKey);
  } catch {
    /* storage unavailable: demo still works, only local restoration is skipped */
  }
}

export function restoreLocalProject() {
  try {
    const raw = sessionStorage.getItem(backupKey);
    if (!raw) return;
    const backup = JSON.parse(raw) as {
      project?: string | null;
      link?: string | null;
    };
    // An explicit null in the backup means the tester had no local project before demo:
    // remove the temporary demo source instead of leaving it as their normal project.
    if (typeof backup.project === "string")
      localStorage.setItem(projectKey, backup.project);
    else localStorage.removeItem(projectKey);
    if (typeof backup.link === "string")
      localStorage.setItem(cloudLinkKey, backup.link);
    else localStorage.removeItem(cloudLinkKey);
    sessionStorage.removeItem(backupKey);
  } catch {
    /* keep whatever local project exists rather than deleting user work */
  }
}

/** Leave demo context, restore the pre-demo local project and reload the SPA. */
export function finishDemo(reload = true) {
  if (ending) return;
  ending = true;
  setDemoMode(false);
  clearDemoFlag();
  restoreLocalProject();
  try {
    sessionStorage.setItem(endedKey, "1");
  } catch {
    /* ignore */
  }
  if (reload && typeof location !== "undefined") location.assign("/create");
}

export async function exitDemo() {
  try {
    if (isDemoMode()) await api("/auth/logout", "POST", {});
  } catch {
    /* the readable marker and local state are still cleared below */
  }
  finishDemo();
}

export const demoEndedKey = endedKey;
