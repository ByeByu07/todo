import { spawn, type ChildProcess } from "child_process";
import {
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk";

export interface AgentRunnerOptions {
  model?: string;
  portRangeStart?: number;
  portRangeEnd?: number;
  serverStartTimeoutMs?: number;
}

export interface AgentSession {
  workspacePath: string;
  serverPort: number;
  sessionId: string;
  serverProcess: ChildProcess;
  client: OpencodeClient;
  logs: string[];
  status: "running" | "completed" | "failed" | "killed";
  exitCode: number | null;
  /** @internal */
  _promptPromise?: Promise<unknown>;
  /** @internal */
  _onData?: (data: string) => void;
}

export class AgentRunner {
  private model?: string;
  private nextPort: number;
  private maxPort: number;
  private serverStartTimeoutMs: number;

  constructor(options: AgentRunnerOptions) {
    this.model = options.model;
    this.nextPort = options.portRangeStart ?? 5000;
    this.maxPort = options.portRangeEnd ?? 6000;
    this.serverStartTimeoutMs = options.serverStartTimeoutMs ?? 15000;
  }

  private getPort(): number {
    const port = this.nextPort++;
    if (this.nextPort > this.maxPort) {
      this.nextPort = 5000;
    }
    return port;
  }

  private async waitForServer(port: number): Promise<void> {
    const deadline = Date.now() + this.serverStartTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await fetch(`http://127.0.0.1:${port}`);
        return;
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `OpenCode server on port ${port} failed to start within ${this.serverStartTimeoutMs}ms`
    );
  }

  async spawn(prompt: string, workspacePath: string): Promise<AgentSession> {
    const port = this.getPort();

    // Start OpenCode server in the worktree directory
    const serverProcess = spawn(
      "opencode",
      ["serve", "--port", String(port)],
      {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENCODE_LOG_LEVEL: "WARN" },
      }
    );

    // Capture early stderr for debugging
    let startupError = "";
    serverProcess.stderr?.on("data", (chunk: Buffer) => {
      startupError += chunk.toString();
    });

    try {
      await this.waitForServer(port);
    } catch (err) {
      try {
        serverProcess.kill();
      } catch {}
      throw new Error(
        `Failed to start OpenCode server in ${workspacePath}: ${err instanceof Error ? err.message : String(err)}. Stderr: ${startupError}`
      );
    }

    // Create SDK client
    const client = createOpencodeClient({
      baseUrl: `http://127.0.0.1:${port}`,
    });

    // Create session
    const createResult = await client.session.create({
      body: { title: "Symphony Agent" },
    });

    if (createResult.error) {
      throw new Error(
        `Failed to create session: ${JSON.stringify(createResult.error)}`
      );
    }

    if (!createResult.data?.id) {
      throw new Error("Failed to create OpenCode session: no session ID returned");
    }

    const sessionId = createResult.data.id;

    // Fire off prompt without awaiting
    const promptPromise = client.session
      .prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
      })
      .then((result) => {
        if (result.error) {
          sessionData.status = "failed";
          sessionData.exitCode = 1;
          sessionData.logs.push(
            `[prompt-error] ${JSON.stringify(result.error)}`
          );
        } else {
          sessionData.status = "completed";
          sessionData.exitCode = 0;
        }
      })
      .catch((err: unknown) => {
        sessionData.status = "failed";
        sessionData.exitCode = 1;
        sessionData.logs.push(
          `[prompt-error] ${err instanceof Error ? err.message : String(err)}`
        );
      });

    const sessionData: AgentSession = {
      workspacePath,
      serverPort: port,
      sessionId,
      serverProcess,
      client,
      logs: [],
      status: "running",
      exitCode: null,
      _promptPromise: promptPromise,
    };

    // Start event streaming in background
    this.startEventStreaming(sessionData).catch((err) => {
      sessionData.logs.push(
        `[event-stream-error] ${err instanceof Error ? err.message : String(err)}`
      );
    });

    return sessionData;
  }

  private async startEventStreaming(session: AgentSession): Promise<void> {
    try {
      const events = await session.client.event.subscribe();
      for await (const event of events.stream) {
        const ev = event as { type: string; properties: unknown };
        const line = `[${ev.type}] ${JSON.stringify(ev.properties)}`;
        session.logs.push(line);
        if (session._onData) {
          session._onData(line);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      session.logs.push(`[event-stream-error] ${msg}`);
    }
  }

  streamOutput(session: AgentSession, onData: (data: string) => void): void {
    session._onData = onData;
    // Replay existing logs
    for (const line of session.logs) {
      onData(line);
    }
  }

  async waitForExit(session: AgentSession): Promise<number | null> {
    if (session._promptPromise) {
      try {
        await session._promptPromise;
      } catch {
        // Error already logged in promise catch handler
      }
    }
    return session.exitCode;
  }

  kill(session: AgentSession): void {
    // Try graceful abort first
    session.client.session
      .abort({ path: { id: session.sessionId } })
      .catch(() => {
        /* ignore */
      });

    // Then kill the server process
    try {
      session.serverProcess.kill("SIGTERM");
      setTimeout(() => {
        try {
          if (!session.serverProcess.killed) {
            session.serverProcess.kill("SIGKILL");
          }
        } catch {}
      }, 5000);
    } catch {}

    session.status = "killed";
    session.exitCode = 1;
  }
}
