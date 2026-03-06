# DevPulse

A Raycast menu bar extension that shows your GitHub PRs, CI status, review state, and running Claude agents at a glance.

![DevPulse Icon](assets/command-icon.png)

## Features

- **My PRs** with CI status (passed/failed/running) and review state (approved/changes requested/waiting)
- **Review requests** assigned to you
- **Claude Code agents** currently running on your machine
- Click any PR to open it in your browser
- Auto-refreshes every 30 seconds
- Logs to `~/.devpulse/devpulse.log` for debugging

## Menu bar indicators

| Indicator | Meaning |
|-----------|---------|
| `2!` | 2 PRs with failing CI |
| `1R` | 1 review requested |
| `3A` | 3 Claude agents running |
| Icon color | Green = all CI pass, Yellow = pending, Red = failures |

## Prerequisites

- [Raycast](https://raycast.com) installed
- [GitHub CLI](https://cli.github.com) (`gh`) installed and authenticated
- Node.js 22+
- pnpm

## Install

```bash
git clone https://github.com/titouancreach/devpulse.git
cd devpulse
pnpm install
pnpm dev
```

This opens the extension in Raycast dev mode. It will appear in your menu bar.

## Architecture

Built with [Effect.ts](https://effect.website) following DDD principles:

```
src/
  domain.ts          Branded value objects + aggregate classes
  github.ts          GitHubService (Effect Context.Tag + Layer)
  claude-agents.ts   ClaudeAgentService (Effect Context.Tag + Layer)
  program.ts         Composes services, single Promise boundary
  logger.ts          File logger via Effect Logger
  menu-bar.tsx       React view (Raycast MenuBarExtra)
```

- **Branded types** for all domain values (PrNumber, PrUrl, GitHubLogin, Pid, etc.)
- **Tagged errors** (GitHubApiError, GitHubParseError, AgentDetectionError)
- **Effect services** with `Context.Tag` + `Layer.succeed`
- **@effect/platform** `Command` for subprocess execution, `FileSystem` for I/O
- **Schema.parseJson()** for type-safe JSON decoding
- Promise conversion only at the Raycast boundary

## License

MIT
