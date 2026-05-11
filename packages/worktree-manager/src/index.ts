import { execSync, spawn } from "child_process";
import { mkdirSync, existsSync, rmSync } from "fs";
import { resolve, relative } from "path";

export interface Workspace {
  path: string;
  key: string;
  createdNow: boolean;
}

export interface WorktreeManagerOptions {
  root: string;
}

export class WorktreeManager {
  private root: string;

  constructor(options: WorktreeManagerOptions) {
    this.root = resolve(options.root);
  }

  create(identifier: string, branch: string, baseBranch: string = "main"): Workspace {
    const key = this.sanitizeIdentifier(identifier);
    const workspacePath = resolve(this.root, key);
    
    const createdNow = !existsSync(workspacePath);
    
    if (createdNow) {
      mkdirSync(workspacePath, { recursive: true });
      
      // Create git worktree
      try {
        execSync(`git worktree add "${workspacePath}" -b ${branch}`, {
          stdio: "pipe",
        });
      } catch (error) {
        // Branch might already exist, try adding worktree with existing branch
        try {
          execSync(`git worktree add "${workspacePath}" ${branch}`, {
            stdio: "pipe",
          });
        } catch {
          throw new Error(`Failed to create worktree for ${identifier}`);
        }
      }
    }

    // Safety invariant: workspace must be inside root
    const relPath = relative(this.root, workspacePath);
    if (relPath.startsWith("..") || relPath.startsWith("/")) {
      throw new Error(`Workspace path ${workspacePath} is outside root ${this.root}`);
    }

    return { path: workspacePath, key, createdNow };
  }

  remove(identifier: string): void {
    const key = this.sanitizeIdentifier(identifier);
    const workspacePath = resolve(this.root, key);

    try {
      execSync(`git worktree remove "${workspacePath}" --force`, {
        stdio: "pipe",
      });
    } catch {
      // Worktree might not exist, that's fine
    }

    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  }

  async runHook(script: string, cwd: string, timeoutMs: number = 60000): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-lc", script], { cwd });
      
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Hook timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Hook exited with code ${code}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  sanitizeIdentifier(identifier: string): string {
    return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
  }

  exists(identifier: string): boolean {
    const key = this.sanitizeIdentifier(identifier);
    return existsSync(resolve(this.root, key));
  }
}
