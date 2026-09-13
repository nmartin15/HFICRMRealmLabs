import {
  extractDocument,
  extractedSourceFor,
  type PersonSignalSource,
} from "@realm-labs/contracts";
import {
  insertExtractedSignals,
  persistEmailSuppression,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "./activity.js";

export async function ingestExtractedText(
  db: Database,
  input: {
    personId: string;
    personEmail: string;
    keyHex: string;
    resumeStorageDir?: string;
    text: string;
    sourceType: PersonSignalSource;
    sourceEmailMessageId?: string | null;
    sourceTaskId?: string | null;
    sourceMeetingId?: string | null;
    actor: { id: string; email: string };
    occurredAt: Date;
  },
): Promise<{ findings: number; optOut: boolean }> {
  const extracted = extractDocument({ text: input.text });
  if (extracted.optOut) {
    await persistEmailSuppression(db, {
      email: input.personEmail,
      keyHex: input.keyHex,
      reason: "unsubscribed",
      source: extractedSourceFor(input.sourceType),
      occurredAt: input.occurredAt,
      createdBy: input.actor.id,
      actorEmail: input.actor.email,
      personId: input.personId,
      resumeStorageDir: input.resumeStorageDir,
      payload: { excerpt: extracted.optOut.excerpt, extractor: extracted.extractor },
    });
    return { findings: 0, optOut: true };
  }
  if (extracted.findings.length === 0) {
    return { findings: 0, optOut: false };
  }
  const inserted = await insertExtractedSignals(db, {
    personId: input.personId,
    extractor: extracted.extractor,
    sourceType: input.sourceType,
    sourceEmailMessageId: input.sourceEmailMessageId,
    sourceTaskId: input.sourceTaskId,
    sourceMeetingId: input.sourceMeetingId,
    findings: extracted.findings,
  });
  if (inserted > 0) {
    await writeActivity(db, {
      personId: input.personId,
      userId: input.actor.id,
      type: "field_change",
      payload: {
        who: { id: input.actor.id, email: input.actor.email },
        what: "signal.extract",
        when: input.occurredAt.toISOString(),
        before: null,
        after: {
          sourceType: input.sourceType,
          extractor: extracted.extractor,
          kinds: extracted.findings.map((finding) => finding.kind),
          inserted,
        },
      },
    });
  }
  return { findings: inserted, optOut: false };
}
