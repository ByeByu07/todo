import { AgentSession } from "@repo/agent-runner";
import type { Comment } from "@repo/github-client";

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

export interface IssueMeta {
  issueId: string;
  prNumber?: number;
  prUrl?: string;
  branch: string;
  workspacePath: string;
  lastCommentCount: number;
  retryCount: number;
  lastRetryAt?: string;
  isRetryPending: boolean;
  hasStarted: boolean;
  commentHistory: Comment[];
}

export class OrchestratorState {
  running: Record<string, AgentSession> = {};
  claimed: Set<string> = new Set();
  completed: Set<string> = new Set();
  retryQueue: Record<string, RetryEntry> = {};
  issueMeta: Record<string, IssueMeta> = {};
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

  // IssueMeta tracking
  trackIssueMeta(issueId: string, meta: Partial<IssueMeta>): void {
    const existing = this.issueMeta[issueId];
    this.issueMeta[issueId] = {
      issueId,
      branch: meta.branch ?? existing?.branch ?? "",
      workspacePath: meta.workspacePath ?? existing?.workspacePath ?? "",
      lastCommentCount: meta.lastCommentCount ?? existing?.lastCommentCount ?? 0,
      retryCount: meta.retryCount ?? existing?.retryCount ?? 0,
      lastRetryAt: meta.lastRetryAt ?? existing?.lastRetryAt,
      isRetryPending: meta.isRetryPending ?? existing?.isRetryPending ?? false,
      hasStarted: meta.hasStarted ?? existing?.hasStarted ?? false,
      prNumber: meta.prNumber ?? existing?.prNumber,
      prUrl: meta.prUrl ?? existing?.prUrl,
      commentHistory: meta.commentHistory ?? existing?.commentHistory ?? [],
    };
  }

  getIssueMeta(issueId: string): IssueMeta | undefined {
    return this.issueMeta[issueId];
  }

  updateCommentCount(issueId: string, count: number, comments: Comment[]): void {
    this.trackIssueMeta(issueId, { lastCommentCount: count, commentHistory: comments });
  }

  markRetryPending(issueId: string): void {
    const meta = this.issueMeta[issueId];
    this.trackIssueMeta(issueId, {
      isRetryPending: true,
      retryCount: (meta?.retryCount ?? 0) + 1,
      lastRetryAt: new Date().toISOString(),
    });
  }

  clearRetryPending(issueId: string): void {
    this.trackIssueMeta(issueId, { isRetryPending: false });
  }

  setPR(issueId: string, prNumber: number, prUrl: string): void {
    this.trackIssueMeta(issueId, { prNumber, prUrl });
  }
}
