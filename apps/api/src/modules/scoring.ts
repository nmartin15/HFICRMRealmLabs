import {
  canInspectScoring,
  nextScoreFormulaVersion,
  operatorContribution,
  overrideRollupResponseSchema,
  personScoreSnapshotInputsSchema,
  replaySnapshotWithConfig,
  scoreConfigPreviewResponseSchema,
  scoreConfigResponseSchema,
  scoreConfigSaveBodySchema,
  scoreFormulaConfigSchema,
  summarizeOverrideRollup,
  summarizeScoreReplay,
  zonedIsoDate,
  type OverrideRollupResponse,
  type ScoreConfigPreviewResponse,
  type ScoreConfigResponse,
  type ScoreFormulaConfig,
} from "@realm-labs/contracts";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { desc, eq, sql } from "drizzle-orm";
import {
  personScoreSnapshots,
  scoreFormulaConfigs,
  users,
} from "@realm-labs/db";
import { writeActivity } from "../lib/activity.js";
import { loadActiveScoreFormula } from "../lib/score-formula.js";
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

export const scoringRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/scoring/config",
    {
      schema: { response: { 200: scoreConfigResponseSchema } },
    },
    async (req): Promise<ScoreConfigResponse> => {
      requireAdmin(req);
      const config = await loadActiveScoreFormula(app.db);
      const rows = await app.db
        .select({
          version: scoreFormulaConfigs.version,
          createdAt: scoreFormulaConfigs.createdAt,
          createdBy: scoreFormulaConfigs.createdBy,
          name: users.name,
          email: users.email,
        })
        .from(scoreFormulaConfigs)
        .leftJoin(users, eq(users.id, scoreFormulaConfigs.createdBy))
        .where(eq(scoreFormulaConfigs.version, config.version))
        .limit(1);
      const row = rows[0];
      return scoreConfigResponseSchema.parse({
        version: config.version,
        config,
        createdAt: row ? toIso(row.createdAt) : new Date().toISOString(),
        createdBy:
          row?.createdBy && row.email && row.name
            ? { id: row.createdBy, email: row.email, name: row.name }
            : null,
      });
    },
  );

  app.get(
    "/scoring/overrides",
    {
      schema: { response: { 200: overrideRollupResponseSchema } },
    },
    async (req): Promise<OverrideRollupResponse> => {
      requireAdmin(req);
      const formula = await loadActiveScoreFormula(app.db);
      const now = Date.now();
      const latest = await app.db
        .select()
        .from(personScoreSnapshots)
        .where(
          sql`${personScoreSnapshots.id} in (
            select distinct on (person_id) id
            from person_score_snapshots
            order by person_id, computed_at desc
          )`,
        );
      const rows = [];
      for (const snapshot of latest) {
        const inputs = personScoreSnapshotInputsSchema.safeParse(snapshot.inputs);
        if (!inputs.success || !inputs.data.operatorTemp) {
          continue;
        }
        const decayed = operatorContribution(
          inputs.data.operatorTemp,
          now,
          formula.operator,
        );
        rows.push({
          contribution: decayed.contribution,
          daysOld: decayed.daysOld,
          scoreWithoutOperator: Math.max(
            0,
            Math.min(100, snapshot.score - decayed.contribution),
          ),
        });
      }
      return overrideRollupResponseSchema.parse(summarizeOverrideRollup(rows));
    },
  );

  app.post(
    "/scoring/config/preview",
    {
      schema: {
        body: scoreConfigSaveBodySchema,
        response: { 200: scoreConfigPreviewResponseSchema },
      },
    },
    async (req): Promise<ScoreConfigPreviewResponse> => {
      requireAdmin(req);
      const candidate: ScoreFormulaConfig = scoreFormulaConfigSchema.parse({
        ...req.body.config,
        version: "preview",
      });
      const latest = await app.db
        .select()
        .from(personScoreSnapshots)
        .where(
          sql`${personScoreSnapshots.id} in (
            select distinct on (person_id) id
            from person_score_snapshots
            order by person_id, computed_at desc
          )`,
        );
      const diffs = [];
      for (const snapshot of latest) {
        const inputs = personScoreSnapshotInputsSchema.safeParse(snapshot.inputs);
        if (!inputs.success) {
          continue;
        }
        const replayed = replaySnapshotWithConfig(inputs.data, candidate);
        diffs.push({
          actualBucket: snapshot.bucket,
          replayedBucket: replayed.bucket,
        });
      }
      const summary = summarizeScoreReplay(diffs);
      return scoreConfigPreviewResponseSchema.parse({
        version: candidate.version,
        ...summary,
      });
    },
  );

  app.post(
    "/scoring/config",
    {
      schema: {
        body: scoreConfigSaveBodySchema,
        response: { 200: scoreConfigResponseSchema },
      },
    },
    async (req): Promise<ScoreConfigResponse> => {
      const actor = requireAdmin(req);
      const current = await loadActiveScoreFormula(app.db);
      const version = nextScoreFormulaVersion(
        current.version,
        zonedIsoDate(new Date()),
      );
      const config = scoreFormulaConfigSchema.parse({
        ...req.body.config,
        version,
      });
      const inserted = await app.db
        .insert(scoreFormulaConfigs)
        .values({
          version,
          config,
          createdBy: actor.id,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw httpError(500, "INTERNAL", "Failed to save scoring config");
      }
      await writeActivity(app.db, {
        personId: null,
        userId: actor.id,
        type: "field_change",
        payload: {
          who: { id: actor.id, email: actor.email },
          what: "scoring.config_save",
          when: new Date().toISOString(),
          before: { version: current.version },
          after: { version },
        },
      });
      return scoreConfigResponseSchema.parse({
        version,
        config,
        createdAt: toIso(row.createdAt),
        createdBy: {
          id: actor.id,
          email: actor.email,
          name: actor.name,
        },
      });
    },
  );
};
