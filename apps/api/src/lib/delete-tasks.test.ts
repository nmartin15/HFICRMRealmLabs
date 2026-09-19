import { deleteTasks, personSignals, tasks } from "@realm-labs/db";
import { describe, expect, it } from "vitest";

describe("deleteTasks", () => {
  it("drops sourced signals before the task so the source check is not hit", async () => {
    const deleted: unknown[] = [];
    const db = {
      delete: (table: unknown) => {
        deleted.push(table);
        return { where: async () => undefined };
      },
    };
    await deleteTasks(db as never, ["11111111-1111-4111-8111-111111111111"]);
    expect(deleted[0]).toBe(personSignals);
    expect(deleted[1]).toBe(tasks);
  });

  it("no-ops for an empty id list", async () => {
    const db = {
      delete: () => {
        throw new Error("should not delete");
      },
    };
    await deleteTasks(db as never, []);
  });
});
