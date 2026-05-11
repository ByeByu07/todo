import { readFileSync, existsSync } from "fs";
import { watchFile } from "fs";
import { Liquid } from "liquidjs";
import YAML from "yaml";

export interface WorkflowConfig {
  tracker: {
    kind: string;
    token?: string;
    repo?: string;
    labels?: string[];
    activeStates?: string[];
    terminalStates?: string[];
  };
  polling: {
    intervalMs: number;
  };
  workspace: {
    root: string;
  };
  hooks: {
    afterCreate?: string;
    beforeRun?: string;
    afterRun?: string;
    beforeRemove?: string;
    timeoutMs: number;
  };
  agent: {
    maxConcurrentAgents: number;
    maxTurns: number;
    maxRetryBackoffMs: number;
  };
  codex: {
    command: string;
    model?: string;
    turnTimeoutMs: number;
    stallTimeoutMs: number;
  };
}

export interface WorkflowDefinition {
  config: WorkflowConfig;
  promptTemplate: string;
}

export interface Issue {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  url: string;
}

const DEFAULTS: Partial<WorkflowConfig> = {
  tracker: {
    kind: "github",
    labels: ["symphony"],
    activeStates: ["open"],
    terminalStates: ["closed"],
  },
  polling: { intervalMs: 30000 },
  workspace: { root: "./.symphony/workspaces" },
  hooks: { timeoutMs: 60000 },
  agent: {
    maxConcurrentAgents: 10,
    maxTurns: 20,
    maxRetryBackoffMs: 300000,
  },
  codex: {
    command: "opencode",
    turnTimeoutMs: 3600000,
    stallTimeoutMs: 300000,
  },
};

export function loadWorkflow(path: string): WorkflowDefinition {
  if (!existsSync(path)) {
    throw new Error(`missing_workflow_file: ${path}`);
  }

  const content = readFileSync(path, "utf-8");
  
  // Parse YAML front matter
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!match) {
    return {
      config: DEFAULTS as WorkflowConfig,
      promptTemplate: content.trim(),
    };
  }

  const frontMatter = match[1] || "";
  const promptTemplate = match[2]?.trim() || "";

  const rawConfig = YAML.parse(frontMatter);
  if (typeof rawConfig !== "object" || rawConfig === null) {
    throw new Error("workflow_front_matter_not_a_map");
  }

  const config = mergeDefaults(rawConfig);
  resolveEnvVars(config);

  return { config, promptTemplate };
}

export function watchWorkflow(path: string, callback: () => void): void {
  watchFile(path, { interval: 1000 }, () => {
    callback();
  });
}

export async function renderPrompt(
  template: string,
  variables: { issue: Issue; attempt?: number | null }
): Promise<string> {
  const engine = new Liquid();
  return engine.parseAndRender(template, {
    issue: {
      ...variables.issue,
      slugify: variables.issue.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    },
    attempt: variables.attempt,
  });
}

function mergeDefaults(raw: any): WorkflowConfig {
  return {
    tracker: {
      ...DEFAULTS.tracker,
      ...raw.tracker,
    },
    polling: {
      ...DEFAULTS.polling,
      ...raw.polling,
    },
    workspace: {
      ...DEFAULTS.workspace,
      ...raw.workspace,
    },
    hooks: {
      ...DEFAULTS.hooks,
      ...raw.hooks,
    },
    agent: {
      ...DEFAULTS.agent,
      ...raw.agent,
    },
    codex: {
      ...DEFAULTS.codex,
      ...raw.codex,
    },
  };
}

export function resolveEnvVars(obj: any): void {
  for (const key in obj) {
    if (typeof obj[key] === "string" && obj[key].startsWith("$")) {
      const varName = obj[key].slice(1);
      const value = process.env[varName];
      if (value !== undefined) {
        obj[key] = value;
      }
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      resolveEnvVars(obj[key]);
    }
  }
}
