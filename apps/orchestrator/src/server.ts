import express from "express";
import { OrchestratorState } from "./state.js";
import { DatabaseManager } from "./database.js";

export function startServer(state: OrchestratorState, port: number): void {
  const app = express();
  const db = new DatabaseManager("./symphony.db");

  app.use(express.json());

  // Dashboard HTML
  app.get("/", (_req, res) => {
    const stats = db.getStats();
    const running = Object.keys(state.running);
    
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Symphony Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; background: #0d1117; color: #c9d1d9; }
    h1 { color: #58a6ff; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin: 16px 0; }
    .stat { display: inline-block; margin-right: 32px; }
    .stat-value { font-size: 32px; font-weight: bold; color: #58a6ff; }
    .stat-label { font-size: 14px; color: #8b949e; }
    .running { color: #3fb950; }
    .failed { color: #f85149; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #30363d; }
    th { color: #8b949e; font-weight: 600; }
    .refresh { float: right; background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .refresh:hover { background: #2ea043; }
  </style>
</head>
<body>
  <h1>Symphony Dashboard</h1>
  <button class="refresh" onclick="location.reload()">Refresh</button>
  
  <div class="card">
    <div class="stat">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total Runs</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #3fb950">${stats.succeeded}</div>
      <div class="stat-label">Succeeded</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #f85149">${stats.failed}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat">
      <div class="stat-value running">${state.runningCount}</div>
      <div class="stat-label">Active</div>
    </div>
  </div>

  <div class="card">
    <h2>Active Runs</h2>
    ${running.length === 0 ? '<p>No active runs</p>' : `
    <table>
      <tr><th>Issue ID</th><th>Port</th><th>Session</th><th>Workspace</th></tr>
      ${running.map(id => {
        const session = state.running[id];
        if (!session) return '';
        return `<tr><td>${id}</td><td>${session.serverPort}</td><td>${session.sessionId.slice(0, 8)}...</td><td>${session.workspacePath}</td></tr>`;
      }).join('')}
    </table>
    `}
  </div>

  <div class="card">
    <h2>Recent Runs</h2>
    <table>
      <tr><th>Issue</th><th>Status</th><th>Exit Code</th><th>Started</th></tr>
      ${db.getRuns({ limit: 10 }).map(run => `
        <tr>
          <td>${run.identifier}</td>
          <td class="${run.status}">${run.status}</td>
          <td>${run.exitCode ?? '-'}</td>
          <td>${new Date(run.startedAt).toLocaleString()}</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <script>
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>
    `);
  });

  // API endpoints
  app.get("/api/v1/state", (_req, res) => {
    res.json({
      running: Object.keys(state.running),
      claimed: Array.from(state.claimed),
      completed: Array.from(state.completed),
      runningCount: state.runningCount,
      totals: state.codexTotals,
    });
  });

  app.get("/api/v1/:issue_identifier", (_req, res) => {
    const runs = db.getRuns({ limit: 1 });
    res.json({ runs });
  });

  app.post("/api/v1/refresh", (_req, res) => {
    res.status(202).json({ message: "Refresh queued" });
  });

  app.listen(port, () => {
    console.log(`Dashboard server listening on port ${port}`);
  });
}
