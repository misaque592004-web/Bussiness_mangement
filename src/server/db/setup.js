import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

try {
  const schemaPath = new URL("./schema.sql", import.meta.url);
  const schema = await readFile(fileURLToPath(schemaPath), "utf8");
  const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log("Database schema is ready.");
} catch (error) {
  console.error("Could not initialize the database schema:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
