import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import {
  personSignals,
  type personSignalKindEnum,
  type personSignalSourceEnum,
} from "./schema";

type SignalKind = (typeof personSignalKindEnum.enumValues)[number];
type SignalSource = (typeof personSignalSourceEnum.enumValues)[number];

export type ExtractedSignalInsert = {
  kind: SignalKind;
  value: Record<string, unknown>;
  excerpt: string | null;
};

function requireId(id: string | null | undefined, sourceType: SignalSource): string {
  if (!id) {
    throw new Error(`${sourceType} signals require a source row id`);
  }
  return id;
}

function sourceDedupClause(input: {
  sourceType: SignalSource;
  sourceEmailMessageId?: string | null;
  sourceTaskId?: string | null;
  sourceMeetingId?: string | null;
  sourceActivityId?: string | null;
}): SQL {
  if (input.sourceType === "email_message") {
    return eq(
      personSignals.sourceEmailMessageId,
      requireId(input.sourceEmailMessageId, input.sourceType),
    );
  }
  if (input.sourceType === "task") {
    return eq(personSignals.sourceTaskId, requireId(input.sourceTaskId, input.sourceType));
  }
  if (input.sourceType === "meeting") {
    return eq(
      personSignals.sourceMeetingId,
      requireId(input.sourceMeetingId, input.sourceType),
    );
  }
  if (input.sourceType === "activity_note") {
    return eq(
      personSignals.sourceActivityId,
      requireId(input.sourceActivityId, input.sourceType),
    );
  }
  return isNull(personSignals.sourceEmailMessageId);
}

export async function insertExtractedSignals(
  db: Database,
  input: {
    personId: string;
    extractor: string;
    sourceType: SignalSource;
    sourceEmailMessageId?: string | null;
    sourceTaskId?: string | null;
    sourceMeetingId?: string | null;
    sourceActivityId?: string | null;
    findings: readonly ExtractedSignalInsert[];
  },
): Promise<number> {
  const sourceClause = sourceDedupClause(input);
  let inserted = 0;
  for (const finding of input.findings) {
    const existing = await db
      .select({ id: personSignals.id })
      .from(personSignals)
      .where(
        and(
          eq(personSignals.personId, input.personId),
          eq(personSignals.kind, finding.kind),
          eq(personSignals.extractor, input.extractor),
          sourceClause,
        ),
      )
      .limit(1);
    if (existing[0]) {
      continue;
    }
    await db.insert(personSignals).values({
      personId: input.personId,
      kind: finding.kind,
      value: finding.value,
      excerpt: finding.excerpt,
      sourceType: input.sourceType,
      sourceEmailMessageId: input.sourceEmailMessageId ?? null,
      sourceTaskId: input.sourceTaskId ?? null,
      sourceMeetingId: input.sourceMeetingId ?? null,
      sourceActivityId: input.sourceActivityId ?? null,
      extractor: input.extractor,
    });
    inserted += 1;
  }
  return inserted;
}
