import { Connection } from "@solana/web3.js";
import {
  ACTIVE_AGENT_ACCOUNT_DATA_SIZE,
  decodeActiveAgentAccount,
  REGISTRY_PROGRAM_ID,
} from "@/lib/program";
import { getTorqueConfig, isTorqueEnabled } from "./config";
import type { TorqueEventPayload } from "./events";
import { serverRpcUrl } from "@/lib/rpc/server-rpc";
import { registeredRpcHttp } from "@/lib/config/network";

export interface LeaderboardEntry {
  userPubkey: string;
  rank: number;
  value: number;
  rewards?: number;
  source?: "torque" | "onchain-devnet";
  components?: {
    completedJobs: number;
    reputationScore: number;
    jobsFailed: number;
  };
}

async function getOnchainDevnetLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const conn = new Connection(serverRpcUrl() ?? registeredRpcHttp(), "confirmed");
    const accounts = await conn.getProgramAccounts(REGISTRY_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [{ dataSize: ACTIVE_AGENT_ACCOUNT_DATA_SIZE }],
    });

    return accounts
      .map(({ account }) => decodeActiveAgentAccount(Buffer.from(account.data)))
      .filter((agent): agent is NonNullable<typeof agent> =>
        agent != null && agent.active && (agent.jobsCompleted > 0n || agent.reputationScore > 0),
      )
      .map((agent) => {
        const completedJobs = Number(agent.jobsCompleted);
        const reputationScore = agent.reputationScore;
        const jobsFailed = Number(agent.jobsFailed);
        return {
          userPubkey: agent.owner,
          rank: 0,
          value: completedJobs,
          rewards: 0,
          source: "onchain-devnet" as const,
          components: { completedJobs, reputationScore, jobsFailed },
        };
      })
      .sort((a, b) =>
        b.value - a.value ||
        (b.components?.reputationScore ?? 0) - (a.components?.reputationScore ?? 0) ||
        a.userPubkey.localeCompare(b.userPubkey),
      )
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  } catch {
    return [];
  }
}

export async function emitTorqueEvent(payload: TorqueEventPayload): Promise<void> {
  if (!isTorqueEnabled()) return;

  const config = getTorqueConfig();
  try {
    await fetch(`${config.apiBase}/v1/events/custom`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify({
        projectId: config.projectId,
        userPubkey: payload.userPubkey,
        eventName: payload.eventName,
        fields: payload.fields,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Torque is non-critical — never throw, never block protocol flow
  }
}

export async function getLeaderboard(campaignId?: string): Promise<LeaderboardEntry[]> {
  if (!isTorqueEnabled()) return getOnchainDevnetLeaderboard();

  const config = getTorqueConfig();
  const id = campaignId ?? config.leaderboardCampaignId;
  if (!id) return getOnchainDevnetLeaderboard();

  try {
    const res = await fetch(`${config.apiBase}/v1/campaigns/${id}/leaderboard`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return getOnchainDevnetLeaderboard();
    const data = await res.json();
    const entries = data.entries ?? [];
    if (entries.length === 0) return getOnchainDevnetLeaderboard();
    return entries.map((entry: LeaderboardEntry) => ({ ...entry, source: entry.source ?? "torque" }));
  } catch {
    return getOnchainDevnetLeaderboard();
  }
}

