import type { Database } from "@realm-labs/db";
import type { Env } from "../env.js";
import { fireAlert } from "../lib/alert.js";
import { drainOutboundSends } from "../lib/deliver.js";

export async function runOutboundDrain(
  db: Database,
  env: Env,
): Promise<void> {
  const result = await drainOutboundSends(db, env);
  if (result.halted) {
    await fireAlert(
      env,
      `outbound.drain halted=${result.halted} attempted=${result.attempted} sent=${result.sent} stuck_sending=${result.stuckSending}`,
    );
    return;
  }
  if (result.stuckSending > 0) {
    await fireAlert(
      env,
      `outbound.drain stuck_sending=${result.stuckSending} attempted=${result.attempted} sent=${result.sent}`,
    );
  }
  console.log(
    `outbound.drain attempted=${result.attempted} sent=${result.sent} enabled=${env.POSTMARK_SEND_ENABLED} stuck_sending=${result.stuckSending}`,
  );
}
