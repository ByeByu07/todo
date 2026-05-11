import { AgentSession } from "@repo/agent-runner";

export interface RunAttempt {
  issueId: string;
  identifier: string;
  attempt: number;
  status: string;
  error?: string;
}

export interface RetryEntry {
  issueId: string;
  attempt: number;
  dueAt: number;
}

export class OrchestratorState {
  running: Record<string, AgentSession> = {};
  claimed: Set<string> = new Set();
  completed: Set<string> = new Set();
  retryQueue: Record<string, RetryEntry> = {};
  codexTotals = { inputTokens: 0, outputTokens: 0, runtimeSeconds: 0 };

  get runningCount(): number {
    return Object.keys(this.running).length;
  }

  isClaimed(issueId: string): boolean {
    return this.claimed.has(issueId) || !!this.running[issueId] || !!this.retryQueue[issueId];
  }

  claim(issueId: string): void {
    this.claimed.add(issueId);
  }

  unclaim(issueId: string): void {
    this.claimed.delete(issueId);
  }

  addRunning(issueId: string, session: AgentSession): void {
    this.running[issueId] = session;
  }

  removeRunning(issueId: string): void {
    delete this.running[issueId];
    this.claimed.delete(issueId);
    this.completed.add(issueId);
  }

  scheduleRetry(issueId: string, attempt: number, delayMs: number): void {
    this.retryQueue[issueId] = {
      issueId,
      attempt,
      dueAt: Date.now() + delayMs,
    };
  }

  clearRetry(issueId: string): void {
    delete this.retryQueue[issueId];
  }

  getRetryAttempt(issueId: string): number | undefined {
    return this.retryQueue[issueId]?.attempt;
  }
}
