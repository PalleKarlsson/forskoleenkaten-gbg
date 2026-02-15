import "dotenv/config";
import { ensureSchema } from "./db.js";

await ensureSchema();
process.exit(0);
