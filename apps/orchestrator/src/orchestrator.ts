import { GitHubClient } from "@repo/github-client";
import { loadWorkflow, watchWorkflow, renderPrompt, WorkflowConfig } from "@repo/symphony-config";
import { WorktreeManager } from "@repo/worktree-manager";
import { AgentRunner } from "@repo/agent-runner";
import { DatabaseManager } from "./database.js";
import { Logger } from "./logger.js";
import { OrchestratorState, RunAttempt } from "./state.js";
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
    this.logger.info("Orchestrator starting...");

    // Load workflow
    this.loadWorkflow();
    if (!this.workflow) {
      throw new Error("Failed to load workflow");
    }

    // Initialize components
    this.initializeComponents();

    // Validate environment
    await this.validateEnvironment();

    // Start HTTP server
    startServer(this.state, this.options.dashboardPort);
    this.logger.info(`Dashboard available at http://localhost:${this.options.dashboardPort}`);

    // Start polling
    this.running = true;
    this.scheduleTick();

    // Watch workflow for changes
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
    // Stop all running agents
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

    // 1. Reconcile running issues
    await this.reconcileRunning();

    // 2. Fetch candidate issues
    const issues = this.githubClient.listIssues({
      labels: this.workflow.config.tracker.labels || ["symphony"],
      state: "open",
    });

    this.logger.info(`Found ${issues.length} candidate issues`);

    // 3. Filter and sort
    const eligible = issues
      .filter((issue) => !this.state.isClaimed(issue.id))
      .filter((issue) => this.state.runningCount < (this.workflow?.config.agent.maxConcurrentAgents || 10));

    // 4. Dispatch
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
        
        // Cleanup workspace
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
      }
    }
  }

  private async dispatch(issue: any): Promise<void> {
    this.logger.info(`Dispatching agent for issue ${issue.identifier}: ${issue.title}`);

    this.state.claim(issue.id);

    try {
      // Create workspace
      const branch = `symphony/${issue.number}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      const workspace = this.worktreeManager!.create(issue.identifier, branch);

      // Run after_create hook
      if (workspace.createdNow && this.workflow?.config.hooks.afterCreate) {
        await this.worktreeManager!.runHook(
          this.workflow.config.hooks.afterCreate,
          workspace.path,
          this.workflow.config.hooks.timeoutMs
        );
      }

      // Run before_run hook
      if (this.workflow?.config.hooks.beforeRun) {
        await this.worktreeManager!.runHook(
          this.workflow.config.hooks.beforeRun,
          workspace.path,
          this.workflow.config.hooks.timeoutMs
        );
      }

      // Build prompt
      const prompt = await renderPrompt(this.workflow!.promptTemplate, {
        issue,
        attempt: null,
      });

      // Spawn agent
      const session = await this.agentRunner!.spawn(prompt, workspace.path);
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
            workspace.path,
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

      // Schedule retry if issue still active
      if (this.githubClient?.getIssueState(issue.number) === "open") {
        this.logger.info(`Issue ${issue.identifier} still active, scheduling retry`);
        setTimeout(() => this.tick(), 1000);
      }

    } catch (error) {
      this.logger.error(`Dispatch failed for ${issue.identifier}:`, error);
      this.state.unclaim(issue.id);
      
      // Schedule retry with backoff
      const attempt = (this.state.getRetryAttempt(issue.id) || 0) + 1;
      const backoff = Math.min(10000 * Math.pow(2, attempt - 1), this.workflow?.config.agent.maxRetryBackoffMs || 300000);
      
      this.state.scheduleRetry(issue.id, attempt, backoff);
      
      setTimeout(() => {
        this.state.clearRetry(issue.id);
        this.tick().catch((err) => this.logger.error("Retry tick error:", err));
      }, backoff);
    }
  }
}
