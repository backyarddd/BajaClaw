import Database from "better-sqlite3";
import { profileDb, profileDir, ensureDir } from "./paths.js";

export type DB = Database.Database;

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        prompt_preview TEXT,
        response_preview TEXT,
        cost_usd REAL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        turns INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cycles_started ON cycles(started_at);
      CREATE INDEX IF NOT EXISTS idx_cycles_status ON cycles(status);

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        source_cycle_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_cycle_id) REFERENCES cycles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        kind UNINDEXED,
        memory_id UNINDEXED,
        content='memories',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, kind, memory_id) VALUES (new.id, new.content, new.kind, new.id);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, kind, memory_id) VALUES('delete', old.id, old.content, old.kind, old.id);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, kind, memory_id) VALUES('delete', old.id, old.content, old.kind, old.id);
        INSERT INTO memories_fts(rowid, content, kind, memory_id) VALUES (new.id, new.content, new.kind, new.id);
      END;

      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cron TEXT NOT NULL,
        task TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run TEXT,
        next_run TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'pending',
        body TEXT NOT NULL,
        source TEXT,
        cycle_id INTEGER,
        FOREIGN KEY (cycle_id) REFERENCES cycles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

      CREATE TABLE IF NOT EXISTS circuit_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        score REAL,
        samples INTEGER DEFAULT 0,
        UNIQUE(name, version)
      );
    `,
  },
  {
    version: 2,
    sql: `ALTER TABLE tasks ADD COLUMN attachments TEXT DEFAULT NULL;`,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        task TEXT NOT NULL,
        plan_text TEXT NOT NULL,
        plan_json TEXT,
        cycle_id INTEGER,
        approved_task_id INTEGER,
        FOREIGN KEY (cycle_id) REFERENCES cycles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
      CREATE INDEX IF NOT EXISTS idx_plans_created ON plans(created_at);
    `,
  },
];

export function openDb(profile: string): DB {
  ensureDir(profileDir(profile));
  const db = new Database(profileDb(profile));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);");
  const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null };
  const current = row.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.exec("BEGIN");
      try {
        db.exec(m.sql);
        db.prepare("INSERT INTO schema_version(version) VALUES (?)").run(m.version);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        process.stderr.write(`[error] db migration v${m.version} failed: ${(e as Error).message}\n`);
        throw e;
      }
    }
  }
}
