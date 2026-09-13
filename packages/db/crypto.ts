import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const PREFIX = "v1";
const KEY_BYTES = 32;

export function parseHexSecretKey(keyHex: string, name: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(`${name} must be 64 hex characters (32 bytes)`);
  }
  return key;
}

export function parseTokenEncryptionKey(keyHex: string): Buffer {
  return parseHexSecretKey(keyHex, "TOKEN_ENCRYPTION_KEY");
}

export function hmacSha256Hex(keyHex: string, value: string): string {
  const key = parseHexSecretKey(keyHex, "EMAIL_HASH_KEY");
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = parseTokenEncryptionKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptSecret(encoded: string, keyHex: string): string {
  const key = parseTokenEncryptionKey(keyHex);
  const [version, ivHex, tagHex, dataHex] = encoded.split(".");
  if (version !== PREFIX || !ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
