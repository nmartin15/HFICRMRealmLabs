import {
  campaignTagPayloadSchema,
  hasNewsletterGrant,
  hasStayInTouch,
  parseCampaignTag,
  planCampaignSequence,
  resolveCampaignTag,
  staleCampaignAsOf,
  type LeadTemp,
  type SuppressionReason,
} from "@realm-labs/contracts";
import {
  allocationCards,
  incubatorCards,
  people,
  personCampaignTags,
  personConsents,
  type Database,
} from "@realm-labs/db";
import { createHmac } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { writeActivity } from "./activity.js";

export type CampaignTagEnv = {
  EMAIL_HASH_KEY: string;
  CAMPAIGN_TAG_WEBHOOK_URL?: string;
  CAMPAIGN_TAG_WEBHOOK_SECRET?: string;
};

async function loadStage(
  db: Database,
  personId: string,
): Promise<string | null> {
  const [alloc, incub] = await Promise.all([
    db
      .select({ stage: allocationCards.stage })
      .from(allocationCards)
      .where(eq(allocationCards.personId, personId))
      .limit(1),
    db
      .select({ stage: incubatorCards.stage })
      .from(incubatorCards)
      .where(eq(incubatorCards.personId, personId))
      .limit(1),
  ]);
  return alloc[0]?.stage ?? incub[0]?.stage ?? null;
}

export async function persistCampaignTag(
  db: Database,
  env: CampaignTagEnv,
  input: {
    person: typeof people.$inferSelect;
    bucket: LeadTemp | null;
    suppressionReason: SuppressionReason | null;
    asOf: Date;
  },
): Promise<void> {
  const [consentRows, stage, existingRows] = await Promise.all([
    db
      .select({
        channel: personConsents.channel,
        status: personConsents.status,
      })
      .from(personConsents)
      .where(eq(personConsents.personId, input.person.id)),
    loadStage(db, input.person.id),
    db
      .select()
      .from(personCampaignTags)
      .where(eq(personCampaignTags.personId, input.person.id))
      .limit(1),
  ]);

  const resolved =
    input.bucket === null
      ? null
      : resolveCampaignTag({
          bucket: input.bucket,
          programTrack: input.person.programTrack,
          stage,
          suppressionReason: input.suppressionReason,
          stayInTouch: hasStayInTouch(consentRows),
          doNotContact: input.person.doNotContact,
          newsletterGranted: hasNewsletterGrant(consentRows),
        });

  const existing = existingRows[0] ?? null;
  if (
    existing &&
    staleCampaignAsOf(input.asOf.getTime(), existing.asOf.getTime())
  ) {
    return;
  }
  if (!resolved && !existing) {
    return;
  }

  const planned = planCampaignSequence({
    previous: existing
      ? {
          tag: existing.tag,
          intensity: existing.intensity,
          programStageKey: existing.programStageKey,
          lastSequenceStartAt: existing.lastSequenceStartAt?.getTime() ?? null,
          lastStartProgramStageKey: existing.lastStartProgramStageKey,
          programStageStartCount: existing.programStageStartCount,
          programStageStartWindowAt:
            existing.programStageStartWindowAt?.getTime() ?? null,
        }
      : null,
    next: resolved,
    asOf: input.asOf.getTime(),
  });

  if (existing?.tag === planned.tag && existing.sequenceAction === planned.action) {
    await db
      .update(personCampaignTags)
      .set({
        computedAt: input.asOf,
        asOf: input.asOf,
      })
      .where(
        and(
          eq(personCampaignTags.id, existing.id),
          lte(personCampaignTags.asOf, input.asOf),
        ),
      );
    return;
  }

  const revision = (existing?.revision ?? 0) + 1;
  const parsed = planned.tag ? parseCampaignTag(planned.tag) : null;
  const row = {
    tag: planned.tag,
    previousTag: existing?.tag ?? null,
    lane: parsed?.lane ?? null,
    program: parsed?.program ?? null,
    stage: parsed?.stage ?? null,
    intensity: planned.intensity,
    sequenceId: planned.sequenceId,
    sequenceAction: planned.action,
    bucket: input.bucket,
    programStageKey: planned.programStageKey,
    lastSequenceStartAt: planned.lastSequenceStartAt
      ? new Date(planned.lastSequenceStartAt)
      : null,
    lastStartProgramStageKey: planned.lastStartProgramStageKey,
    programStageStartCount: planned.programStageStartCount,
    programStageStartWindowAt: planned.programStageStartWindowAt
      ? new Date(planned.programStageStartWindowAt)
      : null,
    revision,
    asOf: input.asOf,
    computedAt: input.asOf,
  };

  if (existing) {
    const [updated] = await db
      .update(personCampaignTags)
      .set(row)
      .where(
        and(
          eq(personCampaignTags.id, existing.id),
          lte(personCampaignTags.asOf, input.asOf),
        ),
      )
      .returning({ id: personCampaignTags.id });
    if (!updated) {
      return;
    }
  } else {
    await db.insert(personCampaignTags).values({
      personId: input.person.id,
      ...row,
    });
  }

  await writeActivity(db, {
    personId: input.person.id,
    userId: null,
    type: "field_change",
    payload: {
      who: { id: "system", email: "campaign.tag" },
      what: "campaign.tag_change",
      when: input.asOf.toISOString(),
      before: existing ? { tag: existing.tag, action: existing.sequenceAction } : null,
      after: {
        tag: planned.tag,
        action: planned.action,
        revision,
        churnHeld: planned.programStageChurnHeld,
        programStageStartCount: planned.programStageStartCount,
      },
    },
  });

  const payload = campaignTagPayloadSchema.parse({
    schemaVersion: "v1",
    personId: input.person.id,
    email: input.person.email,
    tag: planned.tag,
    previousTag: existing?.tag ?? null,
    sequenceId: planned.sequenceId,
    sequenceAction: planned.action,
    lane: parsed?.lane ?? null,
    program: parsed?.program ?? null,
    stage: parsed?.stage ?? null,
    intensity: planned.intensity,
    bucket: input.bucket,
    revision,
    computedAt: input.asOf.toISOString(),
    asOf: input.asOf.toISOString(),
  });
  await postCampaignTagWebhook(env, payload);
}

async function postCampaignTagWebhook(
  env: CampaignTagEnv,
  payload: ReturnType<typeof campaignTagPayloadSchema.parse>,
): Promise<void> {
  const url = env.CAMPAIGN_TAG_WEBHOOK_URL?.trim();
  if (!url) {
    return;
  }
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const secret = env.CAMPAIGN_TAG_WEBHOOK_SECRET?.trim();
  if (secret) {
    headers["x-realm-signature"] = createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
  }
  try {
    await fetch(url, { method: "POST", headers, body });
  } catch {
    // Tag persist must not fail the score write if the sequence tool is down.
  }
}
