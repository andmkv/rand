import { useRef, useState, type FormEvent } from "react";
import { api, ApiFailure } from "./api";
import { hostedCopy } from "../shared/copy";
import type { Locale } from "./i18n";
export function ModerationControl({
  code,
  revisionId,
  locale,
  onChanged,
}: {
  code: string;
  revisionId: string;
  locale: Locale;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const c = (key: string) => hostedCopy(key, locale);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get("reason");
    if (!confirm(c("confirmBlock"))) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/shared/${code}/block`, "POST", { revisionId, reason });
      dialog.current?.close();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.code : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        {c("moderation")}
      </button>
      <dialog
        ref={dialog}
        className="account-dialog"
        aria-label={c("moderation")}
      >
        <div className="dialog-heading">
          <h2>{c("moderation")}</h2>
          <button onClick={() => dialog.current?.close()}>{c("close")}</button>
        </div>
        <form onSubmit={submit}>
          <label>
            {c("moderationReason")}
            <textarea name="reason" maxLength={2000} required />
          </label>
          <button disabled={busy}>
            {c(busy ? "working" : "blockProject")}
          </button>
        </form>
        {error && <p role="alert">{c(`error_${error}`)}</p>}
      </dialog>
    </>
  );
}
