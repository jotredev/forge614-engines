import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFormats } from "../infrastructure/config-io/formats";
import type { AgentId } from "../modules/agents/types";
import { applyPlan } from "./apply-plan";
import { buildDefaultRegistry } from "./default-registry";
import { planMcpInstall } from "./plan-mcp-install";
import { planMcpRemove } from "./plan-mcp-remove";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "engines-pipeline-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const AGENT_IDS: AgentId[] = ["claude-code", "codex", "cursor"];

describe("install → apply → remove → apply, against a home with no agent config directory", () => {
  for (const agentId of AGENT_IDS) {
    test(`${agentId}`, async () => {
      const registry = buildDefaultRegistry();
      const adapter = registry.get(agentId)!;
      const configPath = adapter.configFile(home);
      const format = configFormats[adapter.configFormat];
      const server = { name: "forge614", command: "/bin/forge614", args: ["mcp"] };

      // Precondition: this is a fresh machine — neither the config file nor its
      // parent directory exists yet.
      expect(existsSync(configPath)).toBe(false);

      const installPlan = await planMcpInstall(registry, { agentId, home, server });
      expect(installPlan.noop).toBe(false);

      const installResult = await applyPlan(home, installPlan.planId);
      expect(installResult.changedFiles).toEqual([configPath]);
      expect(existsSync(configPath)).toBe(true);
      expect(format.getMcpEntry(readFileSync(configPath, "utf8"), adapter.mcpEntryPath, server.name)).toEqual(
        adapter.mcpEntryShape(server) as never,
      );

      const removePlan = await planMcpRemove(registry, { agentId, home, server });
      expect(removePlan.noop).toBe(false);

      const removeResult = await applyPlan(home, removePlan.planId);
      expect(removeResult.changedFiles).toEqual([configPath]);
      expect(
        format.getMcpEntry(readFileSync(configPath, "utf8"), adapter.mcpEntryPath, server.name),
      ).toBeUndefined();
    });
  }
});
