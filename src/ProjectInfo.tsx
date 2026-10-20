import { useEffect, useRef, type ReactNode } from "react";
import { t, type Locale } from "./i18n";

/** The editable metadata of a project. `instructions` arrives with the card 107 data contract. */
export interface ProjectInfoFields {
  title: string;
  instructions?: string;
}

/**
 * Project info: title and play instructions in one small dialog, so the header never needs another
 * button. Edits go through the editor's normal update path (autosave, cloud, .randusr).
 */
export function ProjectInfo({
  open,
  onClose,
  locale,
  fields,
  onChange,
  instructionsMax,
  credit,
}: {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  fields: ProjectInfoFields;
  onChange: (patch: Partial<ProjectInfoFields>) => void;
  /** Present once the project model stores instructions; until then only the title is editable. */
  instructionsMax?: number;
  credit?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const copy = (key: Parameters<typeof t>[0]) => t(key, locale);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="account-dialog project-info"
      aria-label={copy("projectInfo")}
      onClose={onClose}
    >
      <div className="dialog-heading">
        <h2>{copy("projectInfo")}</h2>
      </div>
      <form method="dialog" onSubmit={onClose}>
        <label>
          {copy("title")}
          <input
            value={fields.title}
            maxLength={120}
            placeholder={copy("untitled")}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>
        {instructionsMax !== undefined && (
          <label>
            {copy("instructions")}
            <textarea
              value={fields.instructions ?? ""}
              rows={5}
              aria-describedby="instructions-hint"
              placeholder={copy("instructionsPlaceholder")}
              onChange={(e) =>
                // The limit counts Unicode code points (as the server does), not UTF-16 units.
                onChange({
                  instructions: Array.from(e.target.value)
                    .slice(0, instructionsMax)
                    .join(""),
                })
              }
            />
            <small id="instructions-hint" className="field-foot">
              <span>{copy("instructionsHint")}</span>
              <span>
                {Array.from(fields.instructions ?? "").length} / {instructionsMax}
              </span>
            </small>
          </label>
        )}
        {credit && <p className="muted small">{credit}</p>}
        <div className="actions">
          <button type="submit" className="primary">
            {copy("done")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
