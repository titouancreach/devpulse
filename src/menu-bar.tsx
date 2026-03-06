import { Icon, MenuBarExtra, open, Color } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState, useEffect } from "react";
import { Array, Option, Order, pipe, Schema } from "effect";
import { Monoid, Semigroup } from "@effect/typeclass";
import {
  type PullRequest,
  type ClaudeAgent,
  type CIStatus,
  type ReviewDecision,
  type AgentStatus,
  PositiveCount,
} from "./domain";
import { runFetchToolbarData, type ToolbarData } from "./program";

const AgentStatusOrder: Order.Order<AgentStatus> = Order.make((a, b) =>
  a === b ? 0 : a === "running" ? -1 : 1
);

const ClaudeAgentOrder: Order.Order<ClaudeAgent> = Order.mapInput(
  AgentStatusOrder,
  (agent: ClaudeAgent) => agent.status
);

const SPINNER_FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

const useSpinner = (active: boolean): string => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 120);
    return () => clearInterval(interval);
  }, [active]);
  return active ? SPINNER_FRAMES[frame] : "";
};

const ciLabel = (status: CIStatus): string => {
  switch (status) {
    case "success":
      return "CI: Passed";
    case "failure":
      return "CI: Failed";
    case "pending":
      return "CI: Running";
  }
};

const reviewLabel = (decision: ReviewDecision, approvals: number): string => {
  switch (decision) {
    case "APPROVED":
      return `Review: Approved (${approvals})`;
    case "CHANGES_REQUESTED":
      return `Review: Changes Requested (${approvals})`;
    case "REVIEW_REQUIRED":
      return approvals > 0
        ? `Review: ${approvals} approved, waiting for more`
        : "Review: Waiting";
  }
};

const ciStatusIcon = (
  status: CIStatus
): { source: Icon; tintColor: Color } => {
  switch (status) {
    case "success":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    case "failure":
      return { source: Icon.XMarkCircle, tintColor: Color.Red };
    case "pending":
      return { source: Icon.Clock, tintColor: Color.Yellow };
  }
};

const reviewIcon = (
  decision: ReviewDecision
): { source: Icon; tintColor: Color } => {
  switch (decision) {
    case "APPROVED":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    case "CHANGES_REQUESTED":
      return { source: Icon.XMarkCircle, tintColor: Color.Red };
    case "REVIEW_REQUIRED":
      return { source: Icon.Clock, tintColor: Color.Yellow };
  }
};

const agentStatusIcon = (
  status: "running" | "idle"
): { source: Icon; tintColor: Color } => {
  switch (status) {
    case "running":
      return { source: Icon.CircleProgress, tintColor: Color.Blue };
    case "idle":
      return { source: Icon.Circle, tintColor: Color.SecondaryText };
  }
};

const SumPositive: Monoid.Monoid<Option.Option<PositiveCount>> = Monoid.fromSemigroup(
  Semigroup.make((a, b) =>
    pipe(
      Option.all([a, b]),
      Option.map(([x, y]) => (x + y) as unknown as PositiveCount),
      Option.orElse(() => Option.orElse(a, () => b))
    )
  ),
  Option.none()
);

interface MenuBarSummary {
  readonly failing: Option.Option<PositiveCount>;
  readonly reviews: Option.Option<PositiveCount>;
  readonly agents: Option.Option<PositiveCount>;
}

const MenuBarSummaryMonoid: Monoid.Monoid<MenuBarSummary> = Monoid.struct({
  failing: SumPositive,
  reviews: SumPositive,
  agents: SumPositive,
});

const one = Schema.decodeOption(PositiveCount)(1);

const summaryFromPR = (pr: PullRequest): MenuBarSummary => ({
  failing: pr.ciStatus === "failure" ? one : Option.none(),
  reviews: Option.none(),
  agents: Option.none(),
});

const summaryFromReview = (_pr: PullRequest): MenuBarSummary => ({
  failing: Option.none(),
  reviews: one,
  agents: Option.none(),
});

const summaryFromAgent = (agent: ClaudeAgent): MenuBarSummary => ({
  failing: Option.none(),
  reviews: Option.none(),
  agents: agent.status === "running" ? one : Option.none(),
});

const summaryFromData = (data: ToolbarData): MenuBarSummary =>
  MenuBarSummaryMonoid.combineAll([
    ...pipe(data.myPRs, Array.map(summaryFromPR)),
    ...pipe(data.reviewPRs, Array.map(summaryFromReview)),
    ...pipe(data.agents, Array.map(summaryFromAgent)),
  ]);

const summaryToString = (summary: MenuBarSummary): string =>
  pipe(
    [
      Option.map(summary.failing, (n) => `${n}!`),
      Option.map(summary.reviews, (n) => `${n}R`),
      Option.map(summary.agents, (n) => `${n}A`),
    ],
    Array.getSomes,
    Array.join(" ")
  );

const menuBarTitle = (data: ToolbarData): string =>
  pipe(data, summaryFromData, summaryToString);

const menuBarIcon = "command-icon.png";

function PRSection({
  prs,
  showAuthor,
}: {
  readonly prs: ReadonlyArray<PullRequest>;
  readonly showAuthor: boolean;
}) {
  return (
    <>
      {prs.length === 0 && <MenuBarExtra.Item title="None" />}
      {prs.flatMap((pr) => [
        <MenuBarExtra.Item
          key={`${pr.url}-main`}
          title={`#${pr.number} ${pr.title}`}
          subtitle={
            showAuthor
              ? `${pr.repositoryShortName} by ${pr.author}`
              : pr.repositoryShortName
          }
          onAction={() => open(pr.url)}
        />,
        <MenuBarExtra.Item
          key={`${pr.url}-ci`}
          icon={ciStatusIcon(pr.ciStatus)}
          title={`    ${ciLabel(pr.ciStatus)}`}
          onAction={() => open(pr.url)}
        />,
        <MenuBarExtra.Item
          key={`${pr.url}-review`}
          icon={reviewIcon(pr.reviewDecision)}
          title={`    ${reviewLabel(pr.reviewDecision, pr.approvalCount as number)}`}
          onAction={() => open(pr.url)}
        />,
      ])}
    </>
  );
}

function AgentItem({ agent }: { readonly agent: ClaudeAgent }) {
  const spinner = useSpinner(agent.status === "running");

  return agent.status === "running" ? (
    <MenuBarExtra.Item
      title={`${spinner} ${agent.project}: Working`}
      subtitle={agent.cwd as string}
      onAction={() => {}}
    />
  ) : (
    <MenuBarExtra.Item
      icon={agentStatusIcon(agent.status)}
      title={`${agent.project}: Idle`}
      subtitle={agent.cwd as string}
    />
  );
}

export default function MenuBar() {
  const { data, isLoading } = useCachedPromise(runFetchToolbarData, [], {
    keepPreviousData: true,
  });

  const toolbarData: ToolbarData = data ?? {
    myPRs: [],
    reviewPRs: [],
    agents: [],
  };

  return (
    <MenuBarExtra
      icon={menuBarIcon}
      title={menuBarTitle(toolbarData)}
      isLoading={isLoading}
      tooltip="DevPulse"
    >
      <MenuBarExtra.Section title={`My PRs (${toolbarData.myPRs.length})`}>
        <PRSection prs={toolbarData.myPRs} showAuthor={false} />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section
        title={`Review Requested (${toolbarData.reviewPRs.length})`}
      >
        <PRSection prs={toolbarData.reviewPRs} showAuthor={true} />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section
        title={`Claude Agents (${toolbarData.agents.length})`}
      >
        {toolbarData.agents.length === 0 && (
          <MenuBarExtra.Item title="No agents running" />
        )}
        {pipe(toolbarData.agents, Array.sortBy(ClaudeAgentOrder)).map((agent) => (
            <AgentItem key={agent.pid} agent={agent} />
          ))}
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
