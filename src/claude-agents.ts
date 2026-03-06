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

const projectNameFromCwd = (cwd: string): string => {
  const parts = cwd.split("/");
  return parts[parts.length - 1] || cwd;
};

const isClaudeProcess = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.includes("grep") || trimmed.includes("ps ax")) return false;
  if (trimmed.includes("ray")) return false;
  return (
    trimmed.includes("/claude") ||
    (trimmed.includes("node") && trimmed.includes("claude"))
  );
};

const parsePidFromLine = (line: string): number | null => {
  const match = line.trim().match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
};

const enrichWithCwd = (pid: Pid) =>
  pipe(
    execCmd("/usr/sbin/lsof", ["-p", String(pid), "-Fn"]),
    Effect.map((output) => {
      const cwdLine = output
        .split("\n")
        .find(
          (l) =>
            l.startsWith("ncwd:") ||
            (l.startsWith("n/") && output.indexOf("cwd") < output.indexOf(l))
        );
      const cwd = cwdLine ? cwdLine.slice(1) : "";
      return new ClaudeAgent({
        pid,
        cwd: cwd as DirectoryPath,
        status: "running" as const,
        project: (cwd
          ? projectNameFromCwd(cwd)
          : `claude (pid ${pid})`) as ProjectName,
      });
    }),
    Effect.catchAll(() =>
      Effect.succeed(
        new ClaudeAgent({
          pid,
          cwd: "" as DirectoryPath,
          status: "running" as const,
          project: `claude (pid ${pid})` as ProjectName,
        })
      )
    )
  );

const fetchAgentsProgram = pipe(
  execCmd("/bin/ps", ["ax", "-o", "pid,command"]),
  Effect.map((output) => {
    const seen = new Set<number>();
    return output
      .split("\n")
      .filter(isClaudeProcess)
      .flatMap((line) => {
        const pid = parsePidFromLine(line);
        if (pid === null || seen.has(pid)) return [];
        seen.add(pid);
        return [pid];
      });
  }),
  Effect.flatMap((pids) =>
    pipe(
      Effect.forEach(
        pids,
        (pid) =>
          pipe(
            Schema.decode(Pid)(pid),
            Effect.flatMap(enrichWithCwd),
            Effect.catchAll(() => Effect.succeed(null))
          ),
        { concurrency: 5 }
      ),
      Effect.map((agents) =>
        agents.filter((a): a is ClaudeAgent => a !== null)
      )
    )
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
