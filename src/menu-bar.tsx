import { Icon, MenuBarExtra, open, Color } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import {
  type PullRequest,
  type ClaudeAgent,
  type CIStatus,
  type ReviewDecision,
} from "./domain";
import { runFetchToolbarData, type ToolbarData } from "./program";

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

const menuBarTitle = (data: ToolbarData): string => {
  const failing = data.myPRs.filter((pr) => pr.ciStatus === "failure").length;
  const reviews = data.reviewPRs.length;
  const running = data.agents.length;

  const parts: string[] = [];
  if (failing > 0) parts.push(`${failing}!`);
  if (reviews > 0) parts.push(`${reviews}R`);
  if (running > 0) parts.push(`${running}A`);

  return parts.length > 0 ? parts.join(" ") : "";
};

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
        {toolbarData.agents.map((agent) => (
          <MenuBarExtra.Item
            key={agent.pid}
            icon={agentStatusIcon(agent.status)}
            title={agent.project as string}
            subtitle={`PID ${agent.pid}`}
            tooltip={(agent.cwd as string) || "Unknown directory"}
          />
        ))}
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
