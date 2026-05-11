import { execSync } from "child_process";

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

export interface Comment {
  id: string;
  author: {
    login: string;
  };
  body: string;
  createdAt: string;
}

export interface PullRequest {
  number: number;
  state: string;
  url: string;
  headRefName: string;
  title: string;
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

  getComments(number: number): Comment[] {
    try {
      const output = execSync(
        `gh issue view ${number} --repo ${this.repo} --json comments`,
        { encoding: "utf-8" }
      );
      const data = JSON.parse(output);
      return (data.comments ?? []).map((c: any) => this.normalizeComment(c));
    } catch (error) {
      console.error(`[github-client] Failed to get comments for issue #${number}:`, error);
      return [];
    }
  }

  postComment(number: number, body: string): boolean {
    try {
      execSync(
        `gh issue comment ${number} --repo ${this.repo} --body "${this.escapeBody(body)}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      return true;
    } catch (error) {
      console.error(`[github-client] Failed to post comment on issue #${number}:`, error);
      return false;
    }
  }

  listPRs(branch?: string): PullRequest[] {
    try {
      const branchFilter = branch ? `--head ${branch}` : "";
      const output = execSync(
        `gh pr list --repo ${this.repo} --state all --json number,state,url,headRefName,title ${branchFilter}`,
        { encoding: "utf-8" }
      );
      const prs = JSON.parse(output);
      return prs.map((pr: any) => this.normalizePR(pr));
    } catch (error) {
      console.error("[github-client] Failed to list PRs:", error);
      return [];
    }
  }

  updatePR(number: number, body: string): boolean {
    try {
      execSync(
        `gh pr edit ${number} --repo ${this.repo} --body "${this.escapeBody(body)}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      return true;
    } catch (error) {
      console.error(`[github-client] Failed to update PR #${number}:`, error);
      return false;
    }
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

  private normalizeComment(comment: any): Comment {
    return {
      id: String(comment.id),
      author: { login: comment.author?.login ?? "unknown" },
      body: comment.body ?? "",
      createdAt: comment.createdAt,
    };
  }

  private normalizePR(pr: any): PullRequest {
    return {
      number: pr.number,
      state: pr.state,
      url: pr.url,
      headRefName: pr.headRefName,
      title: pr.title,
    };
  }

  private escapeBody(body: string): string {
    // Escape double quotes for shell
    return body.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }
}
