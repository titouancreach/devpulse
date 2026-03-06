import { Context, Data, Effect, Layer, Schema, pipe } from "effect";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { ClaudeAgent, Pid, DirectoryPath, ProjectName } from "./domain";

export class AgentDetectionError extends Data.TaggedError(
  "AgentDetectionError"
)<{
  readonly message: string;
}> {}

export class ClaudeAgentService extends Context.Tag("ClaudeAgentService")<
  ClaudeAgentService,
  {
    readonly fetchAgents: () => Effect.Effect<
      ReadonlyArray<ClaudeAgent>,
      AgentDetectionError
    >;
  }
>() {}

const execCmd = (cmd: string, args: ReadonlyArray<string>) =>
  pipe(
    Command.make(cmd, ...args),
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError(
      (e) => new AgentDetectionError({ message: `exec failed (${cmd}): ${e}` })
    )
  );

const CLAUDE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CPU_BUSY_THRESHOLD = 1.0;

interface TmuxPane {
  readonly pid: number;
  readonly command: string;
  readonly path: string;
  readonly windowName: string;
  readonly sessionName: string;
}

const parseTmuxPanes = (output: string): ReadonlyArray<TmuxPane> =>
  output
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((line) => {
      const [pid, command, path, windowName, sessionName] = line.split("|");
      return {
        pid: parseInt(pid, 10),
        command,
        path,
        windowName,
        sessionName,
      };
    });

const findClaudePanes = (
  panes: ReadonlyArray<TmuxPane>
): ReadonlyArray<TmuxPane> =>
  panes.filter((p) => CLAUDE_VERSION_PATTERN.test(p.command));

interface CpuEntry {
  readonly pid: number;
  readonly cpu: number;
}

const parseCpuOutput = (output: string): ReadonlyArray<CpuEntry> =>
  output
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return { pid: parseInt(parts[0], 10), cpu: parseFloat(parts[1]) };
    })
    .filter((e) => !isNaN(e.pid) && !isNaN(e.cpu));

const findClaudeChildPid = (panePid: number) =>
  pipe(
    execCmd("/bin/ps", ["-o", "pid,command", "-p", String(panePid)]),
    Effect.flatMap(() =>
      execCmd("/usr/bin/pgrep", ["-P", String(panePid)])
    ),
    Effect.map((output) => {
      const firstPid = output.split("\n")[0]?.trim();
      return firstPid ? parseInt(firstPid, 10) : null;
    }),
    Effect.catchAll(() => Effect.succeed(null))
  );

const getCpuForPid = (pid: number) =>
  pipe(
    execCmd("/bin/ps", ["-o", "%cpu=", "-p", String(pid)]),
    Effect.map((output) => parseFloat(output.trim())),
    Effect.catchAll(() => Effect.succeed(0))
  );

const projectNameFromPath = (path: string): string => {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
};

const resolveProjectName = (pane: TmuxPane): string =>
  pane.windowName !== pane.sessionName &&
  !CLAUDE_VERSION_PATTERN.test(pane.windowName)
    ? pane.windowName
    : projectNameFromPath(pane.path);

const toClaudeAgent = (pane: TmuxPane) =>
  pipe(
    findClaudeChildPid(pane.pid),
    Effect.flatMap((claudePid) =>
      claudePid !== null
        ? getCpuForPid(claudePid).pipe(
            Effect.map((cpu) => ({ claudePid, cpu }))
          )
        : Effect.succeed({ claudePid: pane.pid, cpu: 0 })
    ),
    Effect.flatMap(({ claudePid, cpu }) =>
      pipe(
        Schema.decode(Pid)(claudePid),
        Effect.map(
          (pid) =>
            new ClaudeAgent({
              pid,
              cwd: pane.path as DirectoryPath,
              status: cpu > CPU_BUSY_THRESHOLD ? "running" : "idle",
              project: resolveProjectName(pane) as ProjectName,
            })
        )
      )
    ),
    Effect.tapError((e) =>
      Effect.logWarning(`Failed to resolve agent for pane ${pane.pid}: ${e}`)
    ),
    Effect.catchAll(() => Effect.succeed(null))
  );

const fetchAgentsProgram = pipe(
  execCmd("/opt/homebrew/bin/tmux", [
    "list-panes",
    "-a",
    "-F",
    "#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{window_name}|#{session_name}",
  ]),
  Effect.map(parseTmuxPanes),
  Effect.map(findClaudePanes),
  Effect.flatMap((panes) =>
    Effect.all(panes.map(toClaudeAgent), { concurrency: 5 })
  ),
  Effect.map((agents) => agents.filter((a): a is ClaudeAgent => a !== null)),
  Effect.tapError((e) =>
    Effect.logError(`Agent detection failed: ${e}`)
  ),
  Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<ClaudeAgent>)),
  Effect.provide(NodeContext.layer)
);

export const ClaudeAgentServiceLive = Layer.succeed(
  ClaudeAgentService,
  ClaudeAgentService.of({
    fetchAgents: () => fetchAgentsProgram,
  })
);
