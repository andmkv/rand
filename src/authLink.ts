// Capture once outside React rendering. Suspense may retry/discard initial renders;
// removing a fragment inside a state initializer would lose the token on retry.
const isAuthLink = ["/verify", "/reset-password", "/invite"].includes(
  location.pathname,
);
export const authLinkToken = isAuthLink
  ? (new URLSearchParams(location.hash.slice(1)).get("token") ?? "")
  : "";
if (isAuthLink && location.hash)
  history.replaceState(null, "", location.pathname);
