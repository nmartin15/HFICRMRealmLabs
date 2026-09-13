import {
  SCORE_FORMULA_V1,
  scoreFormulaConfigSchema,
  type ScoreFormulaConfig,
} from "@realm-labs/contracts";
import { scoreFormulaConfigs, type Database } from "@realm-labs/db";
import { desc } from "drizzle-orm";

export async function loadActiveScoreFormula(
  db: Database,
): Promise<ScoreFormulaConfig> {
  const rows = await db
    .select()
    .from(scoreFormulaConfigs)
    .orderBy(desc(scoreFormulaConfigs.createdAt))
    .limit(1);
  const parsed = rows[0]
    ? scoreFormulaConfigSchema.safeParse(rows[0].config)
    : null;
  if (parsed?.success) {
    return parsed.data;
  }
  try {
    await db.insert(scoreFormulaConfigs).values({
      version: SCORE_FORMULA_V1.version,
      config: SCORE_FORMULA_V1,
      createdBy: null,
    });
  } catch {
    // Unique version from a concurrent first boot.
  }
  return SCORE_FORMULA_V1;
}
