import { useEffect, useState, type ReactNode } from "react";

/**
 * A labelled drop-down that groups secondary actions. The panel stays in the DOM (hidden with
 * visibility) so dialogs opened from inside it keep rendering; a click on a button closes it.
 */
export function Menu({
  id,
  label,
  className = "",
  children,
}: {
  id: string;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-menu="${id}"]`)) setOpen(false);
    };
    // Escape closes the menu wherever focus is, unless a dialog opened from it handles the key.
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(`#${id} dialog[open]`)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open, id]);
  return (
    <div className={"more-menu " + className} data-menu={id}>
      <button
        className="menu-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span aria-hidden="true"> ▾</span>
      </button>
      <div
        id={id}
        className={"more-panel" + (open ? " open" : "")}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          // Buttons inside an open dialog belong to that dialog, not to the menu.
          if (target.closest("button") && !target.closest("dialog")) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
