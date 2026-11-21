import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ReputationStars from "./ReputationStars";
import SolAmount from "./SolAmount";
import LinkButton from "./LinkButton";

export interface AgentData {
  pubkey: string;
  name?: string;
  agent_type: "primary" | "attestation" | "both";
  privacy_tier: "local" | "tee" | "cloud";
  rate_lamports: number;
  attestation_rate_lamports?: number;
  reputation_avg: number | null;
  reputation_count?: number;
  attestation_accuracy?: number | null;
  completed_jobs: number;
  endpoint_url?: string;
  model?: string;
  description?: string;
}

const agentTypeBadge = {
  primary: { label: "Specialist", class: "bg-brand-violet/20 text-brand-violet border-brand-violet/30" },
  attestation: { label: "Judge", class: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  both: { label: "Both", class: "bg-brand-green/20 text-brand-green border-brand-green/30" },
};

const privacyBadge = {
  local: { label: "Local", class: "bg-green-500/10 text-green-400 border-green-500/20" },
  tee: { label: "TEE", class: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  cloud: { label: "Cloud", class: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
};

interface Props {
  agent: AgentData;
  compact?: boolean;
}

export default function AgentCard({ agent, compact = false }: Props) {
  const typeBadge = agentTypeBadge[agent.agent_type];
  const privacy = privacyBadge[agent.privacy_tier];

  return (
    <Card className="bg-card/50 border-white/10 hover:border-white/20 transition-all hover:sol-glow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate">
              {agent.name || `Agent ${agent.pubkey.slice(0, 8)}...`}
            </h3>
            {agent.model && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{agent.model}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Badge
              variant="outline"
              className={`text-xs ${typeBadge.class}`}
            >
              {typeBadge.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Privacy + Rate */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={`text-xs ${privacy.class}`}>
            {privacy.label}
          </Badge>
          <div className="text-right">
            <SolAmount lamports={agent.rate_lamports} className="text-sm" />
            <span className="text-xs text-muted-foreground ml-1">/ call</span>
          </div>
        </div>

        {/* Reputation */}
        <div className="flex items-center justify-between">
          <ReputationStars
            score={agent.reputation_avg}
            count={agent.reputation_count}
            showCount
            size="sm"
          />
          <span className="text-xs text-muted-foreground">
            {agent.completed_jobs.toLocaleString()} jobs
          </span>
        </div>

        {/* Attestation accuracy if judge */}
        {(agent.agent_type === "attestation" || agent.agent_type === "both") &&
          agent.attestation_accuracy !== null &&
          agent.attestation_accuracy !== undefined && (
            <div className="text-xs text-muted-foreground flex items-center justify-between">
              <span>Attestation accuracy</span>
              <span className="font-mono text-brand-green">
                {(agent.attestation_accuracy * 100).toFixed(1)}%
              </span>
            </div>
          )}

        {!compact && agent.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
        )}

        {/* Attestation rate */}
        {(agent.agent_type === "attestation" || agent.agent_type === "both") &&
          agent.attestation_rate_lamports !== undefined && (
            <div className="text-xs text-muted-foreground flex items-center justify-between">
              <span>Judge rate</span>
              <SolAmount lamports={agent.attestation_rate_lamports} className="text-xs" />
            </div>
          )}

        {!compact && (
          <LinkButton
            href="/setup"
            variant="outline"
            size="sm"
            className="w-full border-white/10 text-muted-foreground hover:border-brand-violet/50 transition-all"
            disabled
          >
            Hire (coming soon)
          </LinkButton>
        )}
      </CardContent>
    </Card>
  );
}
