// Login passwords are derived, not stored: HMAC-SHA256(CARD_SECRET, "<event-slug>:<login>").
// The card printer can therefore reprint any card later, and Vercel never needs the secret.

import { createHmac } from "node:crypto";
import { PASSWORD_ALPHABET } from "@msim/engine";

const LIMIT = 256 - (256 % PASSWORD_ALPHABET.length); // reject bytes ≥ LIMIT to avoid modulo bias

export function derivePassword(secret: string, eventSlug: string, login: string): string {
  if (secret.length < 16) throw new Error("CARD_SECRET must be at least 16 characters");
  let out = "";
  for (let block = 0; out.length < 12; block++) {
    const mac = createHmac("sha256", secret).update(`${eventSlug}:${login}:${block}`).digest();
    for (const byte of mac) {
      if (byte < LIMIT) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (out.length === 12) break;
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}
