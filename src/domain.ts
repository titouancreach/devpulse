import { Schema } from "effect";

export const PrNumber = Schema.Number.pipe(Schema.brand("PrNumber"));
export type PrNumber = typeof PrNumber.Type;

export const PrTitle = Schema.String.pipe(Schema.brand("PrTitle"));
export type PrTitle = typeof PrTitle.Type;

export const PrUrl = Schema.String.pipe(
  Schema.pattern(/^https:\/\//),
  Schema.brand("PrUrl")
);
export type PrUrl = typeof PrUrl.Type;

export const RepositoryFullName = Schema.String.pipe(
  Schema.pattern(/^[^/]+\/[^/]+$/),
  Schema.brand("RepositoryFullName")
);
export type RepositoryFullName = typeof RepositoryFullName.Type;

export const BranchName = Schema.String.pipe(Schema.brand("BranchName"));
export type BranchName = typeof BranchName.Type;

export const GitHubLogin = Schema.String.pipe(Schema.brand("GitHubLogin"));
export type GitHubLogin = typeof GitHubLogin.Type;

export const Pid = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("Pid")
);
export type Pid = typeof Pid.Type;

export const PositiveCount = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("PositiveCount")
);
export type PositiveCount = typeof PositiveCount.Type;

export const DirectoryPath = Schema.String.pipe(Schema.brand("DirectoryPath"));
export type DirectoryPath = typeof DirectoryPath.Type;

export const ProjectName = Schema.String.pipe(Schema.brand("ProjectName"));
export type ProjectName = typeof ProjectName.Type;

export const CIStatus = Schema.Literal("success", "failure", "pending");
export type CIStatus = typeof CIStatus.Type;

export const ReviewDecision = Schema.Literal(
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED"
);
export type ReviewDecision = typeof ReviewDecision.Type;

export const ApprovalCount = Schema.Number.pipe(
  Schema.int(),
  Schema.nonNegative(),
  Schema.brand("ApprovalCount")
);
export type ApprovalCount = typeof ApprovalCount.Type;

export const AgentStatus = Schema.Literal("running", "idle");
export type AgentStatus = typeof AgentStatus.Type;

export class PullRequest extends Schema.Class<PullRequest>("PullRequest")({
  number: PrNumber,
  title: PrTitle,
  url: PrUrl,
  repository: RepositoryFullName,
  headRefName: BranchName,
  isDraft: Schema.Boolean,
  ciStatus: CIStatus,
  reviewDecision: ReviewDecision,
  approvalCount: ApprovalCount,
  author: GitHubLogin,
}) {
  get repositoryShortName(): string {
    return (this.repository as string).split("/")[1] ?? (this.repository as string);
  }
}

export class ClaudeAgent extends Schema.Class<ClaudeAgent>("ClaudeAgent")({
  pid: Pid,
  cwd: DirectoryPath,
  status: AgentStatus,
  project: ProjectName,
}) {}
