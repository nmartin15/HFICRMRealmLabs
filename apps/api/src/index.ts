import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
import { loadEnv } from "./env";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env"), override: true });

const env = loadEnv();
const app = await buildApp(env);

const envPort = Number.parseInt(process.env.PORT ?? "", 10);
const port = Number.isFinite(envPort) && envPort > 0 ? envPort : env.API_PORT;

await app.listen({ port, host: "0.0.0.0" });
