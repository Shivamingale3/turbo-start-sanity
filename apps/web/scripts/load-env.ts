// Imported first by scripts so apps/web/.env is in process.env before any
// module that validates env at import time (@workspace/env) is evaluated.
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(import.meta.dirname, "../.env"),
  quiet: true,
});