import { stat } from "node:fs/promises";
import type { AgentAdapter, AgentId } from "../../modules/agents/types";
import { findExecutableInPath } from "./path-scan";

export interface AgentDetectionResult {
  id: AgentId;
  label: string;
  installed: boolean;
  executable: string | undefined;
  configDir: string;
  configFound: boolean;
}

export async function detectAgent(
  adapter: AgentAdapter,
  home: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<AgentDetectionResult> {
  let executable = await findExecutableInPath(adapter.candidateExecutableNames(platform), env, platform);

  if (!executable) {
    for (const candidate of adapter.knownInstallPaths(platform, home)) {
      try {
        const info = await stat(candidate);
        if (info.isFile()) {
          executable = candidate;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  const configDirPath = adapter.configDir(home);
  let configFound = false;
  try {
    await stat(configDirPath);
    configFound = true;
  } catch {
    configFound = false;
  }

  return {
    id: adapter.id,
    label: adapter.label,
    installed: executable !== undefined,
    executable,
    configDir: configDirPath,
    configFound,
  };
}
