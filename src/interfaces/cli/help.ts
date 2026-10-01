/**
 * Plain-text help for `forge614-engines --help` / `-h`. It lives in a constant so it can be
 * tested: it lists the public commands (the same ones as docs/en/05-public-cli-reference.md) plus
 * `--version` and `--help`. It is plain text and not the JSON envelope of the other commands, like
 * Engram and Shell, because a person reads it in the terminal.
 */
export const HELP = `Usage: forge614-engines <command> [options]

Commands:
  detect                                   Detect the installed agents.
  agents list                              List the agents Engines knows.
  capabilities --agent <id>                Show what an agent supports.
  plan mcp-install --agent <id> --name <name> --command <cmd> [--args <arg>...]
                                           Plan adding an MCP server.
  plan mcp-remove --agent <id> --name <name> --command <cmd> [--args <arg>...]
                                           Plan removing an MCP server.
  plan memory-install --agent <id>         Plan installing the Engram memory (MCP, manual, hook, tool approval).
  plan memory-remove --agent <id>          Plan uninstalling the Engram memory, tool approval included.
  plan mcp-repair --agent <id>             Plan repairing a conflicting Engram MCP entry.
  apply --plan-id <id>                     Apply a saved plan, with a snapshot first.
  apply mcp-repair --plan-id <id> --confirm
                                           Apply a repair plan after explicit confirmation.
  headless --agent <id> --executable <path> --prompt <text>
                                           Build the command to run an agent without a screen.
  update                                   Update Forge614 Engines to the latest release.
  verify memory-integration --agent <id>   Check the Engram memory install, tool approval included.
  verify mcp-repair --agent <id> --plan-id <id>
                                           Check a repair after it was applied.
  memory-hook-run --agent <id>             Run the session-start hook (called by the agent, reads stdin).

Options:
  --version, -v                            Print the installed version.
  --help, -h                               Print this help.`;
