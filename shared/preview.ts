export const previewPixelsSchema = {
  type: "string",
  minLength: 65536,
  maxLength: 65536,
  pattern: "^[A-Za-z0-9+/]+$",
} as const;
export function previewUrl(
  kind: "projects" | "shared",
  id: string,
  key: string | null | undefined,
) {
  return key && /^[a-f0-9-]{36}$/i.test(key)
    ? `/api/v1/${kind}/${id}/preview/${key}`
    : null;
}
/** True when every pixel has the same colour: an empty SCREEN, never worth publishing. */
export function isUniformFrame(base64: string) {
  const raw = atob(base64);
  for (let i = 1; i < raw.length; i++)
    if (raw.charCodeAt(i) !== raw.charCodeAt(0)) return false;
  return true;
}
/** True for the all-black SCREEN a reset leaves behind; the server never lets it replace a picture. */
export function isBlackFrame(base64: string) {
  return /^A+$/.test(base64);
}
