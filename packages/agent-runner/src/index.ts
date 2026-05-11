import { spawn, ChildProcess } from "child_process";

export interface AgentRunnerOptions {
  command: string;
}

export interface AgentSession {
  pid: number;
  process: ChildProcess;
  workspacePath: string;
}

export class AgentRunner {
  private command: string;

  constructor(options: AgentRunnerOptions) {
    this.command = options.command;
  }

  spawn(prompt: string, workspacePath: string): AgentSession {
    const args = ["-p", prompt, "-c", workspacePath, "-q"];
    const parts = this.command.split(" ");
    const cmd = parts[0] || "opencode";
    const cmdArgs = parts.slice(1);
    
    const child = spawn(cmd, [...cmdArgs, ...args], {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!child.pid) {
      throw new Error("Failed to spawn agent process");
    }

    return {
      pid: child.pid,
      process: child,
      workspacePath,
    };
  }

  kill(session: AgentSession): void {
    try {
      session.process.kill("SIGTERM");
      
      // Force kill after 5s if still running
      setTimeout(() => {
        try {
          session.process.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }, 5000);
    } catch {
      // Already dead
    }
  }

  streamOutput(
    session: AgentSession,
    onData: (data: string) => void
  ): void {
    session.process.stdout?.on("data", (chunk) => {
      onData(chunk.toString());
    });

    session.process.stderr?.on("data", (chunk) => {
      onData(`[stderr] ${chunk.toString()}`);
    });
  }

  waitForExit(session: AgentSession): Promise<number | null> {
    return new Promise((resolve) => {
      session.process.on("close", (code) => {
        resolve(code);
      });
    });
  }
}
