import { describe, expect, test } from "bun:test";
import { parse } from "smol-toml";
import { tomlConfigFormat } from "./toml-format";

describe("tomlConfigFormat.getValueAtPath / withValueAtPath", () => {
  test("round-trips a nested array-of-tables value (Codex's real hooks.SessionStart shape)", () => {
    const desired = [
      {
        matcher: "^(startup|resume|clear|compact)$",
        hooks: [{ type: "command", command: '"/bin/x" memory-hook-run --agent codex', additionalContextLimit: 4000 }],
      },
    ];
    const written = tomlConfigFormat.withValueAtPath("", ["hooks", "SessionStart"], desired);
    expect(tomlConfigFormat.getValueAtPath(written, ["hooks", "SessionStart"])).toEqual(desired);
    expect((parse(written) as any).hooks.SessionStart).toEqual(desired);
  });

  test("preserves an unrelated top-level table already in the file", () => {
    const raw = 'model = "gpt-5"\n\n[mcp_servers.forge614-engram]\ncommand = "/bin/engram"\nargs = ["mcp"]\n';
    const next = tomlConfigFormat.withValueAtPath(raw, ["hooks", "SessionStart"], [{ hooks: [{ type: "command", command: "x" }] }]);
    const parsed = parse(next) as any;
    expect(parsed.model).toBe("gpt-5");
    expect(parsed.mcp_servers["forge614-engram"]).toEqual({ command: "/bin/engram", args: ["mcp"] });
  });

  test("deletes the leaf key when value is undefined", () => {
    const raw = tomlConfigFormat.withValueAtPath("", ["hooks", "SessionStart"], [{ a: 1 }]);
    const next = tomlConfigFormat.withValueAtPath(raw, ["hooks", "SessionStart"], undefined);
    expect(tomlConfigFormat.getValueAtPath(next, ["hooks", "SessionStart"])).toBeUndefined();
  });
});
