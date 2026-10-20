import assert from "node:assert/strict";
import test from "node:test";
import { MemoryMail } from "../mail.js";
import { sendSmtpTestEmail } from "../smtp-test.js";

test("SMTP diagnostic sends only a fixed token-free test message", async () => {
  const transport = new MemoryMail();
  await sendSmtpTestEmail(transport, "Randomize USR <noreply@example.org>", "owner@example.org");
  assert.equal(transport.outbox.length, 1);
  assert.equal(transport.outbox[0]?.to, "owner@example.org");
  assert.equal(transport.outbox[0]?.subject, "Randomize USR SMTP test");
  assert.doesNotMatch(transport.outbox[0]?.text ?? "", /token|https?:\/\//i);
});
