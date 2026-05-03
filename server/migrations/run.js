#!/usr/bin/env node

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

async function runMigrations() {
  const pool = new pg.Pool({ connectionString });

  try {
    await pool.query("SELECT 1");
    console.log("Connected to database");

    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf8");

      console.log(`Applying migration: ${file}`);
      await pool.query(sql);
      console.log(`Completed: ${file}`);
    }

    console.log("All migrations applied successfully");
  } catch (error) {
    console.error("Migration failed:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();