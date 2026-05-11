import Database from "better-sqlite3";

export interface RunLog {
  issueId: string;
  identifier: string;
  status: string;
  exitCode: number | null;
  startedAt: string;
  completedAt?: string;
}

export class DatabaseManager {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        status TEXT NOT NULL,
        exit_code INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_runs_issue_id ON runs(issue_id);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    `);
  }

  logRun(run: RunLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (issue_id, identifier, status, exit_code, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      run.issueId,
      run.identifier,
      run.status,
      run.exitCode,
      run.startedAt,
      run.completedAt || new Date().toISOString()
    );
  }

  getRuns(options: { limit?: number; status?: string } = {}): RunLog[] {
    let query = "SELECT * FROM runs";
    const params: any[] = [];

    if (options.status) {
      query += " WHERE status = ?";
      params.push(options.status);
    }

    query += " ORDER BY started_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Array<{
      issue_id: string;
      identifier: string;
      status: string;
      exit_code: number | null;
      started_at: string;
      completed_at?: string;
    }>;

    return rows.map((row) => ({
      issueId: row.issue_id,
      identifier: row.identifier,
      status: row.status,
      exitCode: row.exit_code,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }));
  }

  getStats(): { total: number; succeeded: number; failed: number } {
    const total = this.db.prepare("SELECT COUNT(*) as count FROM runs").get() as { count: number };
    const succeeded = this.db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'succeeded'").get() as { count: number };
    const failed = this.db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'failed'").get() as { count: number };

    return {
      total: total.count,
      succeeded: succeeded.count,
      failed: failed.count,
    };
  }
}
