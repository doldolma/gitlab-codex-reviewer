import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { AppConfig } from "./config";

export class SecretStore {
  private readonly key: Buffer;

  constructor(config: AppConfig) {
    this.key = decodeKey(config);
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  decrypt(payload: string): string {
    const raw = Buffer.from(payload, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}

function decodeKey(config: AppConfig): Buffer {
  const configured = config.appEncryptionKey.trim();

  const base64 = Buffer.from(configured, "base64");
  if (base64.length === 32) return base64;

  const hex = Buffer.from(configured, "hex");
  if (hex.length === 32) return hex;

  const utf8 = Buffer.from(configured, "utf8");
  if (utf8.length === 32) return utf8;

  throw new Error("Generated app encryption key must decode to 32 bytes");
}
