import { describe, expect, test } from "bun:test";

describe("forge614-engines CLI", () => {
  test("detect --json outputs a schemaVersion and an agents array", async () => {
    const proc = Bun.spawn(["bun", "src/interfaces/cli/main.ts", "detect"], {
      stdout: "pipe",
      env: { ...process.env },
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe(1);
    expect(Array.isArray(parsed.agents)).toBe(true);
    expect(parsed.agents.some((a: { id: string }) => a.id === "claude-code")).toBe(true);
  });
});
