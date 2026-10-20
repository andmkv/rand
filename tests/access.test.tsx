import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccessProvider, PermissionBoundary } from "../src/Access";
import { permissionRules } from "../shared/permissions";
describe("guest UI capability boundaries", () => {
  it("keeps the local editor visible while hiding every unavailable action", () => {
    for (const permission of Object.keys(
      permissionRules,
    ) as (keyof typeof permissionRules)[]) {
      const html = renderToStaticMarkup(
        <AccessProvider>
          <PermissionBoundary permission={permission}>
            <button>Action</button>
          </PermissionBoundary>
        </AccessProvider>,
      );
      expect(html.includes("Action")).toBe(
        ["localEditor", "browsePublic", "viewShared"].includes(permission),
      );
    }
  });
});
