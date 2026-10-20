import { useEffect, useSyncExternalStore } from "react";
import { isLocale, type Locale } from "./i18n";
import { useAccess } from "./Access";
import { api } from "./api";
const localeKey = "randomize-usr.locale";
// Which server preference this device already applied, e.g. "demo:…|ru". The account id and the
// value travel together so a *changed* server language still reaches the device, while an
// unchanged server copy can never overwrite a newer local choice on navigation.
const syncedKey = "randomize-usr.locale.synced";
export interface SyncedPreference {
  accountId: string;
  locale: string;
}
export function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(localeKey);
    return isLocale(saved) ? saved : "en";
  } catch {
    return "en";
  }
}
export function readSyncedPreference(): SyncedPreference | null {
  try {
    const [accountId, locale] = (localStorage.getItem(syncedKey) ?? "").split(
      "|",
    );
    return accountId && locale ? { accountId, locale } : null;
  } catch {
    return null;
  }
}
export function rememberSyncedPreference(value: SyncedPreference | null) {
  try {
    if (value)
      localStorage.setItem(
        syncedKey,
        `${value.accountId}|${value.locale}`,
      );
    else localStorage.removeItem(syncedKey);
  } catch {
    /* preferences stay usable without storage */
  }
}
/**
 * Decide whether the account's saved language should replace the current one.
 *
 * The device preference is the one the person just used, so it wins whenever the account copy is
 * the same value this device already applied. A different account, or a server copy that changed
 * elsewhere, is applied; that keeps cross-device sync and login/sign-out behaviour intact.
 */
export function accountLocalePreference(
  account: { id: string; locale: string } | null,
  synced: SyncedPreference | null,
  current: Locale,
): { locale: Locale; synced: SyncedPreference } | null {
  if (!account || !isLocale(account.locale)) return null;
  if (synced?.accountId === account.id && synced.locale === account.locale)
    return null;
  return {
    locale: account.locale,
    synced: { accountId: account.id, locale: account.locale },
  };
}
// One shared locale for the whole page, so the page body, the DEMO bar and dialogs never disagree.
let current: Locale = readLocale();
// Sign-out during this page load clears the applied marker so the next sign-in re-reads it.
let lastAccountId: string | null = null;
const listeners = new Set<() => void>();
function setLocale(value: Locale) {
  if (value === current) return;
  current = value;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export function useLocale() {
  const access = useAccess();
  const locale = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    const account = access.account;
    if (!account) {
      if (lastAccountId) {
        lastAccountId = null;
        rememberSyncedPreference(null);
      }
      return;
    }
    lastAccountId = account.id;
    const decision = accountLocalePreference(
      { id: account.id, locale: account.locale },
      readSyncedPreference(),
      current,
    );
    if (!decision) return;
    rememberSyncedPreference(decision.synced);
    setLocale(decision.locale);
  }, [access.account?.id, access.account?.locale]);
  useEffect(() => {
    try {
      localStorage.setItem(localeKey, locale);
    } catch {
      /* usable offline */
    }
    document.documentElement.lang = locale;
  }, [locale]);
  function chooseLocale(value: Locale) {
    setLocale(value);
    if (access.account)
      void api("/account", "PATCH", { locale: value })
        .then(() => access.refresh())
        .catch(() => {
          /* local preference remains usable offline and is retried at the next change */
        });
  }
  return { locale, chooseLocale };
}
