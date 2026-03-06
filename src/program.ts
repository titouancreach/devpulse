import { Effect, Layer, pipe } from "effect";
import { PullRequest, ClaudeAgent } from "./domain";
import { GitHubService, GitHubServiceLive } from "./github";
import { ClaudeAgentService, ClaudeAgentServiceLive } from "./claude-agents";
import { FileLoggerLive } from "./logger";

export interface ToolbarData {
  readonly myPRs: ReadonlyArray<PullRequest>;
  readonly reviewPRs: ReadonlyArray<PullRequest>;
  readonly agents: ReadonlyArray<ClaudeAgent>;
}

const fetchToolbarData: Effect.Effect<
  ToolbarData,
  never,
  GitHubService | ClaudeAgentService
> = pipe(
  Effect.all(
    {
      myPRs: pipe(
        Effect.flatMap(GitHubService, (svc) => svc.fetchMyPRs()),
        Effect.tapError((e) => Effect.logError(`fetchMyPRs failed: ${e.message}`)),
        Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<PullRequest>))
      ),
      reviewPRs: pipe(
        Effect.flatMap(GitHubService, (svc) => svc.fetchReviewPRs()),
        Effect.tapError((e) => Effect.logError(`fetchReviewPRs failed: ${e.message}`)),
        Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<PullRequest>))
      ),
      agents: pipe(
        Effect.flatMap(ClaudeAgentService, (svc) => svc.fetchAgents()),
        Effect.tapError((e) => Effect.logError(`fetchAgents failed: ${e.message}`)),
        Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<ClaudeAgent>))
      ),
    },
    { concurrency: 3 }
  )
);

const AppLayer = Layer.mergeAll(
  GitHubServiceLive,
  ClaudeAgentServiceLive,
  FileLoggerLive
);

export const runFetchToolbarData = (): Promise<ToolbarData> =>
  Effect.runPromise(
    pipe(
      fetchToolbarData,
      Effect.tap((data) =>
        Effect.logInfo(
          `Fetched ${data.myPRs.length} PRs, ${data.reviewPRs.length} reviews, ${data.agents.length} agents`
        )
      ),
      Effect.provide(AppLayer)
    )
  );
