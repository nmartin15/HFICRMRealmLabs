import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isAllowedResume(input: {
  filename: string;
  contentType: string;
}): boolean {
  if (ALLOWED_RESUME_TYPES.has(input.contentType)) {
    return true;
  }
  return /\.(pdf|docx?)$/i.test(input.filename);
}

function extensionFor(filename: string, contentType: string): string {
  const fromName = extname(filename);
  if (fromName) {
    return fromName.toLowerCase();
  }
  if (contentType === "application/pdf") {
    return ".pdf";
  }
  if (contentType === "application/msword") {
    return ".doc";
  }
  return ".docx";
}

export function storedResumePath(personId: string): string {
  return `/people/${personId}/resume`;
}

export function isStoredResumeUrl(url: string | null): boolean {
  return Boolean(url?.startsWith("/people/") && url.endsWith("/resume"));
}

export async function saveResumeFile(input: {
  storageDir: string;
  personId: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}): Promise<string> {
  const dir = join(input.storageDir, input.personId);
  await mkdir(dir, { recursive: true });
  const existing = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    existing.map((name) => unlink(join(dir, name)).catch(() => undefined)),
  );
  const storedName = `resume${extensionFor(input.filename, input.contentType)}`;
  await writeFile(join(dir, storedName), input.bytes);
  return storedName;
}

export async function readResumeFile(input: {
  storageDir: string;
  personId: string;
}): Promise<{ bytes: Buffer; filename: string } | null> {
  const dir = join(input.storageDir, input.personId);
  const existing = await readdir(dir).catch(() => [] as string[]);
  const storedName = existing[0];
  if (!storedName) {
    return null;
  }
  const bytes = await readFile(join(dir, storedName));
  return { bytes, filename: storedName };
}
