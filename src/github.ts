import { Context, Data, Effect, Layer, Schema, pipe } from "effect";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import {
  PullRequest,
  PrNumber,
  PrTitle,
  PrUrl,
  RepositoryFullName,
  BranchName,
  GitHubLogin,
  ApprovalCount,
  type CIStatus,
  type ReviewDecision,
} from "./domain";

export class GitHubApiError extends Data.TaggedError("GitHubApiError")<{
  readonly message: string;
}> {}

export class GitHubParseError extends Data.TaggedError("GitHubParseError")<{
  readonly message: string;
}> {}

const CheckNode = Schema.Union(
  Schema.Struct({ state: Schema.String }),
  Schema.Struct({
    conclusion: Schema.NullOr(Schema.String),
    status: Schema.String,
  })
);

const GqlReviewNode = Schema.Struct({
  state: Schema.String,
  author: Schema.Struct({ login: Schema.String }),
});

const GqlPrNode = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  headRefName: Schema.String,
  isDraft: Schema.Boolean,
  reviewDecision: Schema.NullOr(Schema.String),
  author: Schema.Struct({ login: Schema.String }),
  repository: Schema.Struct({ nameWithOwner: Schema.String }),
  reviews: Schema.Struct({
    nodes: Schema.Array(GqlReviewNode),
  }),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({
              contexts: Schema.Struct({
                nodes: Schema.Array(CheckNode),
              }),
            })
          ),
        }),
      })
    ),
  }),
});

const GqlSearchResponse = Schema.Struct({
  data: Schema.Struct({
    search: Schema.Struct({
      nodes: Schema.Array(GqlPrNode),
    }),
  }),
});

const GqlSearchResponseFromString = Schema.compose(
  Schema.parseJson(),
  GqlSearchResponse
);

const PrFieldsFromGql = Schema.Struct({
  number: PrNumber,
  title: PrTitle,
  url: PrUrl,
  repository: RepositoryFullName,
  headRefName: BranchName,
  author: GitHubLogin,
  approvalCount: ApprovalCount,
});

const checksToCIStatus = (
  checks: ReadonlyArray<typeof CheckNode.Type>
): CIStatus => {
  if (checks.length === 0) return "pending";
  for (const check of checks) {
    if ("state" in check) {
      if (check.state === "FAILURE" || check.state === "ERROR") return "failure";
      if (check.state === "PENDING") return "pending";
    } else {
      if (check.conclusion === "FAILURE" || check.conclusion === "TIMED_OUT")
        return "failure";
      if (check.status !== "COMPLETED") return "pending";
    }
  }
  return "success";
};

const extractCIStatus = (node: typeof GqlPrNode.Type): CIStatus => {
  const lastCommit = node.commits.nodes[node.commits.nodes.length - 1];
  if (!lastCommit?.commit.statusCheckRollup) return "pending";
  return checksToCIStatus(lastCommit.commit.statusCheckRollup.contexts.nodes);
};

const extractReviewDecision = (
  node: typeof GqlPrNode.Type
): ReviewDecision => {
  if (node.reviewDecision === "APPROVED") return "APPROVED";
  if (node.reviewDecision === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  return "REVIEW_REQUIRED";
};

const countApprovals = (node: typeof GqlPrNode.Type): number => {
  const latestByAuthor = new Map<string, string>();
  for (const review of node.reviews.nodes) {
    latestByAuthor.set(review.author.login, review.state);
  }
  return [...latestByAuthor.values()].filter((s) => s === "APPROVED").length;
};

const toPullRequest = (
  node: typeof GqlPrNode.Type
): Effect.Effect<PullRequest, GitHubParseError> =>
  pipe(
    Schema.decode(PrFieldsFromGql)({
      number: node.number,
      title: node.title,
      url: node.url,
      repository: node.repository.nameWithOwner,
      headRefName: node.headRefName,
      author: node.author.login,
      approvalCount: countApprovals(node),
    }),
    Effect.map(
      (fields) =>
        new PullRequest({
          ...fields,
          isDraft: node.isDraft,
          ciStatus: extractCIStatus(node),
          reviewDecision: extractReviewDecision(node),
        })
    ),
    Effect.mapError(
      (e) => new GitHubParseError({ message: `Failed to decode PR: ${e}` })
    )
  );

export class GitHubService extends Context.Tag("GitHubService")<
  GitHubService,
  {
    readonly fetchMyPRs: () => Effect.Effect<
      ReadonlyArray<PullRequest>,
      GitHubApiError | GitHubParseError
    >;
    readonly fetchReviewPRs: () => Effect.Effect<
      ReadonlyArray<PullRequest>,
      GitHubApiError | GitHubParseError
    >;
  }
>() {}

const GH_PATH = "/opt/homebrew/bin/gh";

const execGh = (args: ReadonlyArray<string>) =>
  pipe(
    Command.make(GH_PATH, ...args),
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError(
      (e) => new GitHubApiError({ message: `gh failed: ${e}` })
    )
  );

const buildQuery = (searchFilter: string): string => `query {
  search(query: "${searchFilter} state:open is:pr", type: ISSUE, first: 30) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        headRefName
        isDraft
        reviewDecision
        author { login }
        repository { nameWithOwner }
        reviews(first: 50) {
          nodes {
            state
            author { login }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    ... on StatusContext { state }
                    ... on CheckRun { conclusion status }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const fetchPRs = (searchFilter: string) =>
  pipe(
    execGh(["api", "graphql", "-f", `query=${buildQuery(searchFilter)}`]),
    Effect.flatMap((raw) =>
      pipe(
        Schema.decodeUnknown(GqlSearchResponseFromString)(raw),
        Effect.mapError(
          (e) => new GitHubParseError({ message: `Schema decode error: ${e}` })
        )
      )
    ),
    Effect.flatMap((response) =>
      Effect.all(response.data.search.nodes.map(toPullRequest), {
        concurrency: "unbounded",
      })
    ),
    Effect.provide(NodeContext.layer)
  );

export const GitHubServiceLive = Layer.succeed(
  GitHubService,
  GitHubService.of({
    fetchMyPRs: () => fetchPRs("author:@me"),
    fetchReviewPRs: () => fetchPRs("review-requested:@me"),
  })
);
