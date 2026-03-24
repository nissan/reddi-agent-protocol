"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import seedAgents, { SeedAgent, formatLamportsUsd } from "@/lib/agents";

// ── helpers ──────────────────────────────────────────────────────────────────

const agentTypeBadge: Record<string, string> = {
  Primary: "bg-[#9945FF]/20 text-[#9945FF] border-[#9945FF]/30",
  Specialist: "bg-[#14F195]/20 text-[#14F195] border-[#14F195]/30",
};

function taskTypeLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Seed Agent Card ───────────────────────────────────────────────────────────

function SeedAgentCard({ agent }: { agent: SeedAgent }) {
  const online = agent.available_by_default;
  const typeCls = agentTypeBadge[agent.agent_type] ?? agentTypeBadge.Specialist;

  return (
    <div data-testid="agent-card" className="rounded-xl border border-white/10 bg-card/30 hover:border-white/20 transition-all flex flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div>
            <h3 className="font-semibold text-base">{agent.name}</h3>
            <p className="text-xs text-muted-foreground italic">{agent.title}</p>
            <p className="text-xs font-mono text-muted-foreground/60">{agent.handle}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{agent.specialty}</p>
        </div>
        {/* Availability badge */}
        <span
          className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${
            online
              ? "text-green-400 border-green-500/30 bg-green-500/10"
              : "text-muted-foreground border-white/10 bg-white/5"
          }`}
        >
          {online ? "● Online" : "○ Offline"}
        </span>
      </div>

      {/* Model + Provider */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs px-2 py-0.5 rounded border border-white/10 bg-white/5 text-muted-foreground">
          {agent.ollama_model}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded border border-white/10 bg-white/5 text-muted-foreground"
          title="Groq fallback enabled"
        >
          Ollama · Groq ↩
        </span>
        <Badge variant="outline" className={`text-xs ${typeCls}`}>
          {agent.agent_type}
        </Badge>
      </div>

      {/* Rate + Reputation + Jobs */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-mono">
          {formatLamportsUsd(agent.rate_lamports)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: "#14F195" }}>
          {"★".repeat(Math.round(agent.reputation_seed))}
          <span className="text-muted-foreground ml-1">{agent.reputation_seed.toFixed(1)}</span>
        </span>
        <span className="text-muted-foreground">{agent.job_count_seed} jobs</span>
      </div>

      {/* Task type tags (first 3) */}
      <div className="flex flex-wrap gap-1">
        {agent.task_types.slice(0, 3).map((t) => (
          <span
            key={t}
            className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground"
          >
            {taskTypeLabel(t)}
          </span>
        ))}
        {agent.task_types.length > 3 && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-muted-foreground">
            +{agent.task_types.length - 3}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [demoMode, setDemoMode] = useState(false);

  const visibleAgents = demoMode
    ? seedAgents.filter((a) => a.available_by_default)
    : seedAgents;

  const onlineCount = seedAgents.filter((a) => a.available_by_default).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Page header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Browse Specialists</h1>
          <p className="text-muted-foreground mt-1">
            {seedAgents.length} agents registered ·{" "}
            <span className="text-green-400">{onlineCount} online now</span>
          </p>
        </div>

        {/* Demo mode toggle */}
        <button
          onClick={() => setDemoMode((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
            demoMode
              ? "border-[#14F195]/50 bg-[#14F195]/10 text-[#14F195]"
              : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/30"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${demoMode ? "bg-[#14F195]" : "bg-muted-foreground"}`}
          />
          Demo mode
        </button>
      </div>

      {/* Demo mode banner */}
      {demoMode && (
        <div className="mb-6 flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-[#14F195]/30 bg-[#14F195]/5 text-sm text-[#14F195]">
          <span>
            Demo mode — showing {visibleAgents.length} active specialists. Toggle to see all{" "}
            {seedAgents.length}.
          </span>
          <button
            onClick={() => setDemoMode(false)}
            className="text-xs underline opacity-70 hover:opacity-100"
          >
            Show all
          </button>
        </div>
      )}

      {/* Agent grid */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibleAgents.map((agent) => (
          <SeedAgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
