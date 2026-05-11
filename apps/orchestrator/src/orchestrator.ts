import { GitHubClient, type Comment } from "@repo/github-client";
import { loadWorkflow, watchWorkflow, renderPrompt, WorkflowConfig } from "@repo/symphony-config";
import { WorktreeManager } from "@repo/worktree-manager";
import { AgentRunner } from "@repo/agent-runner";
import { DatabaseManager } from "./database.js";
import { Logger } from "./logger.js";
import { OrchestratorState } from "./state.js";
import { startServer } from "./server.js";

export interface OrchestratorOptions {
  workflowPath: string;
  dbPath: string;
  dashboardPort: number;
}

export class Orchestrator {
  private options: OrchestratorOptions;
  private logger: Logger;
  private state: OrchestratorState;
  private db: DatabaseManager;
  private workflow: { config: WorkflowConfig; promptTemplate: string } | null = null;
  private githubClient: GitHubClient | null = null;
  private worktreeManager: WorktreeManager | null = null;
  private agentRunner: AgentRunner | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.logger = new Logger();
    this.state = new OrchestratorState();
    this.db = new DatabaseManager(options.dbPath);
  }

  async start(): Promise<void> {
    this.logger.info("Starting Symphony orchestrator...");

    this.loadWorkflow();
    if (!this.workflow) {
      throw new Error("Failed to load workflow");
    }

    this.initializeComponents();
    await this.validateEnvironment();

    startServer(this.state, this.options.dashboardPort);
    this.logger.info(`Dashboard available at http://localhost:${this.options.dashboardPort}`);

    this.running = true;
    this.scheduleTick();

    watchWorkflow(this.options.workflowPath, () => {
      this.logger.info("Workflow file changed, reloading...");
      this.loadWorkflow();
    });

    this.logger.info("Orchestrator started successfully");
  }

  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
    }
    for (const [issueId, session] of Object.entries(this.state.running)) {
      this.logger.info(`Stopping agent for ${issueId}`);
      this.agentRunner?.kill(session);
    }
  }

  private loadWorkflow(): void {
    try {
      this.workflow = loadWorkflow(this.options.workflowPath);
      this.logger.info("Workflow loaded successfully");
    } catch (error) {
      this.logger.error("Failed to load workflow:", error);
      if (!this.workflow) {
        throw error;
      }
    }
  }

  private initializeComponents(): void {
    if (!this.workflow) return;
    const config = this.workflow.config;

    this.githubClient = new GitHubClient({
      repo: config.tracker.repo || "owner/repo",
    });

    this.worktreeManager = new WorktreeManager({
      root: config.workspace.root,
    });

    this.agentRunner = new AgentRunner({
      model: config.codex.model,
      portRangeStart: 5000,
      portRangeEnd: 5999,
    });
  }

  private async validateEnvironment(): Promise<void> {
    if (!this.githubClient?.isAuthenticated()) {
      this.logger.error("GitHub CLI is not authenticated. Run: gh auth login");
      throw new Error("GH CLI not authenticated");
    }

    try {
      const result = await import("child_process").then((cp) =>
        cp.execSync("opencode --version", { encoding: "utf-8" })
      );
      this.logger.info(`OpenCode found: ${result.trim()}`);
    } catch {
      this.logger.error("OpenCode not found. Install it first.");
      throw new Error("OpenCode not installed");
    }
  }

  private scheduleTick(): void {
    if (!this.running) return;

    const interval = this.workflow?.config.polling.intervalMs || 30000;
    this.pollInterval = setTimeout(() => {
      this.tick().catch((err) => this.logger.error("Tick error:", err));
      this.scheduleTick();
    }, interval);
  }

  private async tick(): Promise<void> {
    if (!this.workflow || !this.githubClient || !this.worktreeManager || !this.agentRunner) {
      return;
    }

    this.logger.debug("Running poll tick...");

    // 1. Reconcile closed issues
    await this.reconcileRunning();

    // 2. Check running issues for new comments/commands
    await this.checkRunningComments();

    // 3. Fetch candidate issues
    const issues = this.githubClient.listIssues({
      labels: this.workflow.config.tracker.labels || ["symphony"],
      state: "open",
    });

    this.logger.info(`Found ${issues.length} candidate issues`);

    // 4. Filter and sort
    const eligible = issues
      .filter((issue) => !this.state.isClaimed(issue.id))
      .filter((issue) => this.state.runningCount < (this.workflow?.config.agent.maxConcurrentAgents || 10));

    // 5. Dispatch
    for (const issue of eligible) {
      if (this.state.runningCount >= (this.workflow?.config.agent.maxConcurrentAgents || 10)) {
        break;
      }
      await this.dispatch(issue);
    }
  }

  private async reconcileRunning(): Promise<void> {
    for (const [issueId, session] of Object.entries(this.state.running)) {
      const state = this.githubClient?.getIssueState(Number(issueId));

      if (state === "closed") {
        this.logger.info(`Issue ${issueId} is closed, stopping agent`);
        this.agentRunner?.kill(session);
        this.state.removeRunning(issueId);

        try {
          await this.worktreeManager?.runHook(
            this.workflow?.config.hooks.beforeRemove || "",
            session.workspacePath,
            this.workflow?.config.hooks.timeoutMs || 60000
          );
        } catch {
          // Ignore hook failures on cleanup
        }

        this.worktreeManager?.remove(issueId);
        this.state.issueMeta[issueId] = {
          ...this.state.issueMeta[issueId],
          isRetryPending: false,
        } as any;
      }
    }
  }

  private async checkRunningComments(): Promise<void> {
    if (!this.githubClient) return;

    for (const [issueId, session] of Object.entries(this.state.running)) {
      const issueNum = Number(issueId);
      const meta = this.state.getIssueMeta(issueId);
      if (!meta) continue;

      const comments = this.githubClient.getComments(issueNum);
      const lastCount = meta.lastCommentCount;

      if (comments.length > lastCount) {
        this.logger.info(`[${issueId}] New comments detected: ${comments.length - lastCount}`);
        this.state.updateCommentCount(issueId, comments.length, comments);

        // Check newest comments for commands
        const newComments = comments.slice(lastCount);
        for (const comment of newComments) {
          const cmd = this.parseCommand(comment.body);
          if (cmd) {
            this.logger.info(`[${issueId}] Command detected: /${cmd.command} from ${comment.author.login}`);
            await this.handleCommand(issueId, session, cmd);
          }
        }
      }
    }
  }

  private parseCommand(body: string): { command: string; args: string } | null {
    const trimmed = body.trim();
    if (!trimmed.startsWith("/")) return null;
    const match = trimmed.match(/^\/(\w+)(?:\s+(.*))?$/s);
    if (!match) return null;
    return { command: match[1]!.toLowerCase(), args: (match[2] ?? "").trim() };
  }

  private async handleCommand(
    issueId: string,
    session: any,
    cmd: { command: string; args: string }
  ): Promise<void> {
    const issueNum = Number(issueId);

    switch (cmd.command) {
      case "retry": {
        this.logger.info(`[${issueId}] Processing /retry command`);
        this.githubClient?.postComment(issueNum, "\u267b\ufe0f Retrying with your feedback...");
        this.state.markRetryPending(issueId);
        this.agentRunner?.kill(session);
        this.state.removeRunning(issueId);
        this.state.unclaim(issueId);
        // Trigger immediate retry
        setTimeout(() => this.tick().catch((err) => this.logger.error("Retry tick error:", err)), 2000);
        break;
      }
      case "stop": {
        this.logger.info(`[${issueId}] Processing /stop command`);
        this.githubClient?.postComment(issueNum, "\ud83d\uded1 Stopping agent as requested.");
        this.agentRunner?.kill(session);
        this.state.removeRunning(issueId);
        this.state.unclaim(issueId);
        break;
      }
      case "status": {
        this.logger.info(`[${issueId}] Processing /status command`);
        const meta = this.state.getIssueMeta(issueId);
        const statusMsg = meta?.prNumber
          ? `\ud83d\udcca Status: Working on PR #${meta.prNumber}. Session: ${session.sessionId?.slice(0, 8) ?? "N/A"}.`
          : `\ud83d\udcca Status: Working on issue. Session: ${session.sessionId?.slice(0, 8) ?? "N/A"}.`;
        this.githubClient?.postComment(issueNum, statusMsg);
        break;
      }
      default: {
        this.logger.info(`[${issueId}] Unknown command: /${cmd.command}`);
      }
    }
  }

  private async dispatch(issue: any): Promise<void> {
    this.logger.info(`Dispatching agent for issue ${issue.identifier}: ${issue.title}`);

    this.state.claim(issue.id);

    try {
      const meta = this.state.getIssueMeta(issue.id);
      const isRetry = meta?.isRetryPending ?? false;
      const branch = `symphony/${issue.number}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

      let workspacePath: string;
      let createdNow: boolean;

      if (isRetry && meta?.workspacePath && this.worktreeManager!.exists(issue.identifier)) {
        // Reuse existing worktree
        this.logger.info(`[${issue.identifier}] Reusing existing worktree at ${meta.workspacePath}`);
        workspacePath = meta.workspacePath;
        createdNow = false;
        this.state.clearRetryPending(issue.id);
      } else {
        // Create new workspace
        const workspace = this.worktreeManager!.create(issue.identifier, branch);
        workspacePath = workspace.path;
        createdNow = workspace.createdNow;

        if (createdNow && this.workflow?.config.hooks.afterCreate) {
          await this.worktreeManager!.runHook(
            this.workflow.config.hooks.afterCreate,
            workspacePath,
            this.workflow.config.hooks.timeoutMs
          );
        }
      }

      this.state.trackIssueMeta(issue.id, {
        branch,
        workspacePath,
      });

      // Run before_run hook
      if (this.workflow?.config.hooks.beforeRun) {
        await this.worktreeManager!.runHook(
          this.workflow.config.hooks.beforeRun,
          workspacePath,
          this.workflow.config.hooks.timeoutMs
        );
      }

      // Fetch comments for context
      const comments = this.githubClient!.getComments(issue.number);
      this.state.updateCommentCount(issue.id, comments.length, comments);

      // Build prompt with comment context
      const prompt = await this.buildPrompt(issue, comments, meta);

      // Post "starting" comment on first run
      if (!isRetry && !meta?.prNumber) {
        this.githubClient!.postComment(
          issue.number,
          "\ud83e\udd16 I'm working on this issue. I'll update you when I have a PR ready for review."
        );
      }

      // Spawn agent
      const session = await this.agentRunner!.spawn(prompt, workspacePath);
      this.state.addRunning(issue.id, session);

      // Stream output
      this.agentRunner!.streamOutput(session, (data) => {
        this.logger.info(`[${issue.identifier}] ${data.trim()}`);
      });

      // Wait for completion
      const exitCode = await this.agentRunner!.waitForExit(session);

      this.state.removeRunning(issue.id);

      // Run after_run hook
      if (this.workflow?.config.hooks.afterRun) {
        try {
          await this.worktreeManager!.runHook(
            this.workflow.config.hooks.afterRun,
            workspacePath,
            this.workflow.config.hooks.timeoutMs
          );
        } catch (err) {
          this.logger.error(`after_run hook failed:`, err);
        }
      }

      // Log result
      this.db.logRun({
        issueId: issue.id,
        identifier: issue.identifier,
        status: exitCode === 0 ? "succeeded" : "failed",
        exitCode,
        startedAt: new Date().toISOString(),
      });

      this.logger.info(`Agent for ${issue.identifier} completed with exit code ${exitCode}`);

      // Find PR if created
      const prs = this.githubClient!.listPRs(branch);
      const openPR = prs.find((p) => p.state === "OPEN" || p.state === "open");
      if (openPR) {
        this.state.setPR(issue.id, openPR.number, openPR.url);
        this.logger.info(`[${issue.identifier}] Tracked PR #${openPR.number}`);
      }

      // Post structured summary comment
      await this.postAgentComment(issue, exitCode, openPR);

      // Schedule retry if issue still active
      if (this.githubClient?.getIssueState(issue.number) === "open") {
        this.logger.info(`Issue ${issue.identifier} still active, scheduling retry`);
        setTimeout(() => this.tick(), 1000);
      }
    } catch (error) {
      this.logger.error(`Dispatch failed for ${issue.identifier}:`, error);
      this.state.unclaim(issue.id);

      const attempt = (this.state.getRetryAttempt(issue.id) || 0) + 1;
      const backoff = Math.min(
        10000 * Math.pow(2, attempt - 1),
        this.workflow?.config.agent.maxRetryBackoffMs || 300000
      );

      this.state.scheduleRetry(issue.id, attempt, backoff);

      setTimeout(() => {
        this.state.clearRetry(issue.id);
        this.tick().catch((err) => this.logger.error("Retry tick error:", err));
      }, backoff);
    }
  }

  private async buildPrompt(issue: any, comments: Comment[], meta?: any): Promise<string> {
    // Render base template
    let prompt = await renderPrompt(this.workflow!.promptTemplate, {
      issue,
      attempt: meta?.retryCount ?? null,
    });

    // Append comment context
    if (comments.length > 0) {
      const lastComment = comments[comments.length - 1]!;
      const commandRemoved = lastComment.body.replace(/^\/\w+\s*/, "").trim();

      prompt += `\n\n## Previous Comments / Review Feedback\n`;
      for (const c of comments) {
        prompt += `- **${c.author.login}** (${c.createdAt}): ${c.body}\n`;
      }

      prompt += `\n## Your Task (triggered by latest comment)\n`;
      prompt += commandRemoved || lastComment.body;

      if (meta?.prNumber) {
        prompt += `\n\n## Context\n`;
        prompt += `You are retrying this task. The previous attempt created PR #${meta.prNumber}.\n`;
        prompt += `Please update the existing branch \`${meta.branch}\` with improvements.\n`;
        prompt += `Keep previous work intact and build upon it.\n`;
      }
    }

    return prompt;
  }

  private async postAgentComment(
    issue: any,
    exitCode: number | null,
    pr?: { number: number; url: string } | undefined
  ): Promise<void> {
    const status = exitCode === 0 ? "\u2705 Completed" : "\u274c Failed";
    const meta = this.state.getIssueMeta(issue.id);
    const retryCount = meta?.retryCount ?? 0;

    let body = `## \ud83e\udd16 Symphony Agent Update\n\n`;
    body += `**Status:** ${status}\n`;

    if (pr) {
      body += `**PR:** #${pr.number} [View PR](${pr.url})\n`;
    }
    body += `**Branch:** \`symphony/${issue.number}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}\`\n`;
    if (retryCount > 0) {
      body += `**Retry:** #${retryCount}\n`;
    }

    body += `\n### \ud83d\udccb Summary\n`;
    body += `- [x] Analyze issue requirements\n`;
    body += exitCode === 0 ? `- [x] Implement changes\n` : `- [ ] Implement changes (failed)\n`;
    body += pr ? `- [x] Push changes to PR #${pr.number}\n` : `- [ ] Push changes\n`;

    body += `\n### \ud83d\udd04 Next Steps\n`;
    body += `- [ ] Human review\n`;
    body += `- [ ] Approve or comment \`/retry\` with feedback\n`;
    body += `- [ ] Merge PR to auto-close this issue\n`;

    body += `\n---\n*Generated by Symphony Agent*`;

    this.githubClient!.postComment(issue.number, body);
  }
}
