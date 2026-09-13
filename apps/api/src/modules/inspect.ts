import {
  canInspectScoring,
  inspectOperatorLineSchema,
  inspectScoreView,
  operatorContribution,
  okInvalidateResponseSchema,
  personIdParamsSchema,
  personInspectResponseSchema,
  personScoreSnapshotSchema,
  personSignalParamsSchema,
  scoreComponentSchema,
  suppressionSourceSchema,
  warmthSignalValueSchema,
  type PersonInspectResponse,
} from "@realm-labs/contracts";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  people,
  personConsents,
  personScoreSnapshots,
  personSignals,
  type Database,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { enqueuePersonScore } from "../lib/score-enqueue.js";
import { loadActiveScoreFormula } from "../lib/score-formula.js";
import { emailSuppressionHash, findSuppression } from "../lib/suppression.js";
import { toIso } from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

function requireAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  if (!canInspectScoring(user.role)) {
    throw httpError(403, "FORBIDDEN", "Forbidden");
  }
  return user;
}

async function requirePerson(db: Database, id: string) {
  const existing = await db
    .select()
    .from(people)
    .where(and(eq(people.id, id), isNull(people.deletedAt)))
    .limit(1);
  const row = existing[0];
  if (!row) {
    throw httpError(404, "NOT_FOUND", "Person not found");
  }
  return row;
}

export const inspectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/people/:id/inspect",
    {
      schema: {
        params: personIdParamsSchema,
        response: { 200: personInspectResponseSchema },
      },
    },
    async (req): Promise<PersonInspectResponse> => {
      requireAdmin(req);
      const person = await requirePerson(app.db, req.params.id);
      const formula = await loadActiveScoreFormula(app.db);
      const now = Date.now();

      const [snapshotRows, consentRows, signalRows] = await Promise.all([
        app.db
          .select()
          .from(personScoreSnapshots)
          .where(eq(personScoreSnapshots.personId, person.id))
          .orderBy(desc(personScoreSnapshots.computedAt))
          .limit(1),
        app.db
          .select()
          .from(personConsents)
          .where(eq(personConsents.personId, person.id)),
        app.db
          .select()
          .from(personSignals)
          .where(eq(personSignals.personId, person.id))
          .orderBy(desc(personSignals.createdAt)),
      ]);

      const snapshotRow = snapshotRows[0] ?? null;
      const snapshot = snapshotRow
        ? personScoreSnapshotSchema.safeParse({
            id: snapshotRow.id,
            personId: snapshotRow.personId,
            formulaVersion: snapshotRow.formulaVersion,
            score: snapshotRow.score,
            bucket: snapshotRow.bucket,
            rawBucket: snapshotRow.rawBucket,
            hold: snapshotRow.hold,
            asOf: toIso(snapshotRow.asOf),
            trigger: snapshotRow.trigger,
            components: snapshotRow.components,
            inputs: snapshotRow.inputs,
            computedAt: toIso(snapshotRow.computedAt),
            computedBy: snapshotRow.computedBy,
            createdAt: toIso(snapshotRow.createdAt),
            updatedAt: toIso(snapshotRow.updatedAt),
          })
        : null;

      const parsedSnapshot = snapshot?.success ? snapshot.data : null;
      const score =
        person.score !== null && person.leadTemp
          ? inspectScoreView(person.score, person.leadTemp, formula.hysteresis)
          : parsedSnapshot
            ? inspectScoreView(
                parsedSnapshot.score,
                parsedSnapshot.bucket,
                formula.hysteresis,
              )
            : null;

      const components = scoreComponentSchema.array().safeParse(
        parsedSnapshot?.components ?? snapshotRow?.components ?? [],
      );

      const liveWarmth = signalRows.find(
        (row) => row.kind === "warmth" && !row.invalidatedAt,
      );
      const warmthValue = liveWarmth
        ? warmthSignalValueSchema.safeParse(liveWarmth.value)
        : null;
      const operatorTemp = warmthValue?.success
        ? { level: warmthValue.data.level, at: warmthValue.data.at }
        : parsedSnapshot?.inputs.operatorTemp ?? null;
      const decayed = operatorContribution(operatorTemp, now, formula.operator);
      const setBy = warmthValue?.success
        ? warmthValue.data.setBy ?? null
        : null;

      const hash = emailSuppressionHash(person.email, app.env.EMAIL_HASH_KEY);
      const suppression = await findSuppression(app.db, hash);
      const suppressionSource = suppression
        ? suppressionSourceSchema.safeParse(suppression.source)
        : null;

      return personInspectResponseSchema.parse({
        score,
        components: components.success ? components.data : [],
        operator: inspectOperatorLineSchema.parse({
          active: Boolean(operatorTemp),
          level: operatorTemp?.level ?? null,
          setAt: operatorTemp ? new Date(operatorTemp.at).toISOString() : null,
          setBy: setBy
            ? {
                id: setBy.id,
                email: setBy.email,
                name: setBy.name,
              }
            : null,
          contribution: decayed.contribution,
          raw: decayed.raw,
          daysOld: operatorTemp ? decayed.daysOld : null,
          daysUntilExpiry: operatorTemp ? decayed.daysUntilExpiry : null,
        }),
        consents: consentRows.map((row) => ({
          channel: row.channel,
          status: row.status,
          source: row.source,
          grantedAt: row.grantedAt ? toIso(row.grantedAt) : null,
          withdrawnAt: row.withdrawnAt ? toIso(row.withdrawnAt) : null,
        })),
        suppression:
          suppression && suppressionSource?.success
            ? {
                reason: suppression.reason,
                source: suppressionSource.data,
                occurredAt: toIso(suppression.occurredAt),
                purgedAt: suppression.purgedAt ? toIso(suppression.purgedAt) : null,
              }
            : null,
        signals: signalRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          sourceType: row.sourceType,
          extractor: row.extractor,
          excerpt: row.excerpt,
          value: row.value,
          createdAt: toIso(row.createdAt),
          invalidatedAt: row.invalidatedAt ? toIso(row.invalidatedAt) : null,
        })),
        snapshot: parsedSnapshot,
      });
    },
  );

  app.post(
    "/people/:id/signals/:signalId/invalidate",
    {
      schema: {
        params: personSignalParamsSchema,
        response: { 200: okInvalidateResponseSchema },
      },
    },
    async (req) => {
      const actor = requireAdmin(req);
      const person = await requirePerson(app.db, req.params.id);
      const rows = await app.db
        .select()
        .from(personSignals)
        .where(
          and(
            eq(personSignals.id, req.params.signalId),
            eq(personSignals.personId, person.id),
          ),
        )
        .limit(1);
      const signal = rows[0];
      if (!signal) {
        throw httpError(404, "NOT_FOUND", "Signal not found");
      }
      if (!signal.invalidatedAt) {
        const when = new Date();
        await app.db
          .update(personSignals)
          .set({
            invalidatedAt: when,
            invalidatedBy: actor.id,
          })
          .where(eq(personSignals.id, signal.id));
        await writeActivity(app.db, {
          personId: person.id,
          userId: actor.id,
          type: "field_change",
          payload: {
            who: { id: actor.id, email: actor.email },
            what: "signal.invalidate",
            when: when.toISOString(),
            before: { kind: signal.kind, excerpt: signal.excerpt },
            after: { invalidated: true },
          },
        });
      }
      await enqueuePersonScore(app.queues, {
        personId: person.id,
        trigger: "manual_edit",
        computedBy: actor.id,
        delayMs: 0,
      });
      return { ok: true as const };
    },
  );
};
