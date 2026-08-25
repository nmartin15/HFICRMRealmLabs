import {
  canChangeUserRole,
  updateUserRoleBodySchema,
  userIdParamsSchema,
  userListResponseSchema,
  userSchema,
} from "@realm-labs/contracts";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { asc, eq } from "drizzle-orm";
import { users } from "@realm-labs/db";
import { serializeUser } from "../lib/serialize.js";
import { requireUser } from "../plugins/db.js";
import { httpError } from "../plugins/error.js";

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/users",
    {
      schema: {
        response: { 200: userListResponseSchema },
      },
    },
    async (req) => {
      requireUser(req);
      const rows = await app.db.select().from(users).orderBy(asc(users.name));
      return { data: rows.map((row) => userSchema.parse(serializeUser(row))) };
    },
  );

  app.patch(
    "/users/:id/role",
    {
      schema: {
        params: userIdParamsSchema,
        body: updateUserRoleBodySchema,
        response: { 200: userSchema },
      },
    },
    async (req) => {
      const actor = requireUser(req);
      if (!canChangeUserRole(actor.role)) {
        throw httpError(403, "FORBIDDEN", "Only admin can change user roles");
      }

      const { id } = req.params;
      const { role } = req.body;

      const existing = await app.db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const row = existing[0];
      if (!row) {
        throw httpError(404, "NOT_FOUND", "User not found");
      }

      const [updated] = await app.db
        .update(users)
        .set({ role })
        .where(eq(users.id, id))
        .returning();
      if (!updated) {
        throw httpError(404, "NOT_FOUND", "User not found");
      }

      // TODO: activities.person_id is required, so role changes cannot write an activity row.

      return userSchema.parse(serializeUser(updated));
    },
  );
};
