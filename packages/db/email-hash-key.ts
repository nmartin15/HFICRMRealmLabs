import { hmacSha256Hex } from "./crypto";
import type { Database } from "./client";
import { emailHashKeyState } from "./schema";

export const EMAIL_HASH_KEY_FINGERPRINT_INPUT = "realm-labs.email-hash-key.v1";

export function emailHashKeyFingerprint(keyHex: string): string {
  return hmacSha256Hex(keyHex, EMAIL_HASH_KEY_FINGERPRINT_INPUT);
}

export async function ensureEmailHashKeyFingerprint(
  db: Database,
  keyHex: string,
): Promise<void> {
  const fingerprint = emailHashKeyFingerprint(keyHex);
  const rows = await db
    .select({ fingerprint: emailHashKeyState.fingerprint })
    .from(emailHashKeyState)
    .limit(2);
  const stored = rows[0];
  if (!stored) {
    await db.insert(emailHashKeyState).values({ fingerprint });
    return;
  }
  if (rows.length > 1 || stored.fingerprint !== fingerprint) {
    throw new Error(
      "EMAIL_HASH_KEY does not match the database fingerprint. Rotating this key orphans every suppression tombstone.",
    );
  }
}
