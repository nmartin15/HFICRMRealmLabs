import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export function clientErrorPayload(err: unknown, statusCode: number): {
  code: string;
  message: string;
} {
  const explicitStatus =
    typeof (err as { statusCode?: number }).statusCode === "number";
  if (!explicitStatus && statusCode >= 500) {
    return { code: "INTERNAL", message: "Unexpected error" };
  }
  const code =
    typeof (err as { code?: string }).code === "string"
      ? (err as { code: string }).code
      : statusCode === 500
        ? "INTERNAL"
        : "ERROR";
  return {
    code,
    message: err instanceof Error ? err.message : "Unexpected error",
  };
}

const errorPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err, req, reply) => {
    const statusCode =
      typeof (err as { statusCode?: number }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 500) {
      req.log.error({ err }, "request failed");
    } else {
      req.log.warn({ err }, "request rejected");
    }

    reply.status(statusCode).send({
      error: clientErrorPayload(err, statusCode),
    });
  });
};

export default fp(errorPlugin);

export function httpError(
  statusCode: number,
  code: string,
  message: string,
): Error & { statusCode: number; code: string } {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
