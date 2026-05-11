import { Orchestrator } from "./orchestrator.js";
import { Logger } from "./logger.js";

const logger = new Logger();

async function main() {
  logger.info("Starting Symphony orchestrator...");

  const orchestrator = new Orchestrator({
    workflowPath: process.env.SYMPHONY_WORKFLOW_PATH || "../../WORKFLOW.md",
    dbPath: process.env.SYMPHONY_DB_PATH || "./symphony.db",
    dashboardPort: parseInt(process.env.SYMPHONY_DASHBOARD_PORT || "3456", 10),
  });

  // Handle shutdown gracefully
  process.on("SIGINT", () => {
    logger.info("Received SIGINT, shutting down...");
    orchestrator.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Received SIGTERM, shutting down...");
    orchestrator.stop();
    process.exit(0);
  });

  try {
    await orchestrator.start();
  } catch (error) {
    logger.error("Failed to start orchestrator:", error);
    process.exit(1);
  }
}

main();
