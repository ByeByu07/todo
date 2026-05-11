import { execSync, spawn } from "child_process";

export interface Issue {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubClientOptions {
  repo: string;
}

export class GitHubClient {
  private repo: string;

  constructor(options: GitHubClientOptions) {
    this.repo = options.repo;
  }

  isAuthenticated(): boolean {
    try {
      execSync("gh auth status", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  listIssues(options: { labels: string[]; state: string }): Issue[] {
    const labelFilter = options.labels.map((l) => `--label ${l}`).join(" ");
    const cmd = `gh issue list --repo ${this.repo} --state ${options.state} ${labelFilter} --json number,title,body,state,labels,url,createdAt,updatedAt`;
    
    try {
      const output = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      const issues = JSON.parse(output);
      return issues.map((issue: any) => this.normalizeIssue(issue));
    } catch (error) {
      console.error("[github-client] Failed to list issues:", error);
      return [];
    }
  }

  getIssue(number: number): Issue | null {
    try {
      const output = execSync(
        `gh issue view ${number} --repo ${this.repo} --json number,title,body,state,labels,url,createdAt,updatedAt`,
        { encoding: "utf-8" }
      );
      return this.normalizeIssue(JSON.parse(output));
    } catch {
      return null;
    }
  }

  getIssueState(number: number): string | null {
    const issue = this.getIssue(number);
    return issue?.state ?? null;
  }

  private normalizeIssue(issue: any): Issue {
    return {
      id: String(issue.number),
      identifier: `GH-${issue.number}`,
      number: issue.number,
      title: issue.title,
      description: issue.body,
      state: issue.state,
      labels: issue.labels.map((l: any) => l.name.toLowerCase()),
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  }
}
