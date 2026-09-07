"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TASK_TYPES, PRIVACY_MODES } from "@/lib/capabilities/taxonomy";
import type { OrchestratorPolicy } from "@/lib/orchestrator/policy";

const DEFAULT_POLICY: OrchestratorPolicy = {
  enabled: false,
  maxPerTaskUsd: 0.10,
  dailyBudgetUsd: 1.00,
  allowedTaskTypes: [],
  minReputation: 0,
  requireAttestation: false,
  preferredPrivacyMode: "public",
  fallbackMode: "skip",
  updatedAt: "",
};

export default function OrchestratorSettingsPage() {
  const [policy, setPolicy] = useState<OrchestratorPolicy>(DEFAULT_POLICY);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestrator/policy");
      const data = await res.json();
      if (data.ok) setPolicy(data.policy);
    } catch { /* use defaults */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    setSaveNote("");
    try {
      const res = await fetch("/api/orchestrator/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      });
      const data = await res.json();
      if (data.ok) {
        setPolicy(data.policy);
        setSaveNote("✓ Settings saved.");
      } else {
        setSaveNote(`Error: ${data.error}`);
      }
    } catch (e) {
      setSaveNote(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleTaskType(id: string) {
    setPolicy((p) => {
      const types = p.allowedTaskTypes as string[];
      const next = types.includes(id) ? types.filter((t) => t !== id) : [...types, id];
      return { ...p, allowedTaskTypes: next as OrchestratorPolicy["allowedTaskTypes"] };
    });
  }

  if (loading) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-muted-foreground animate-pulse">Loading policy…</div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Orchestrator Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how your agent discovers and uses specialist services during planning.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="rounded-xl border border-white/10 bg-card/30 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Specialist directory policy</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, your agent can discover specialist metadata during planning, then apply policy before any paid-work path.
            </p>
          </div>
          <button
            onClick={() => setPolicy((p) => ({ ...p, enabled: !p.enabled }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              policy.enabled ? "bg-[#14F195]" : "bg-white/20"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200 ${
                policy.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        {policy.enabled && (
          <div className="text-xs text-[#14F195] bg-[#14F195]/10 border border-[#14F195]/20 rounded-lg px-3 py-2">
            ✓ Specialist directory policy active — agents can query candidates during planning, with payment still gated by policy.
          </div>
        )}
      </div>

      {/* Budget */}
      <div className="rounded-xl border border-white/10 bg-card/20 p-5 space-y-4">
        <h2 className="font-semibold">Spend limits</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max per task (USD)</Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={policy.maxPerTaskUsd}
              onChange={(e) => setPolicy((p) => ({ ...p, maxPerTaskUsd: parseFloat(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground/60">Tasks above this limit are skipped.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Daily budget (USD, 0 = unlimited)</Label>
            <Input
              type="number"
              min={0}
              step={0.10}
              value={policy.dailyBudgetUsd}
              onChange={(e) => setPolicy((p) => ({ ...p, dailyBudgetUsd: parseFloat(e.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground/60">Resets at midnight UTC.</p>
          </div>
        </div>
      </div>

      {/* Allowed task types */}
      <div className="rounded-xl border border-white/10 bg-card/20 p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Allowed task types</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Restrict which task categories your agent is allowed to outsource. Leave all unchecked to allow any.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TASK_TYPES.map((t) => {
            const active = (policy.allowedTaskTypes as string[]).includes(t.id) || policy.allowedTaskTypes.length === 0;
            const selected = (policy.allowedTaskTypes as string[]).includes(t.id);
            return (
              <button
                key={t.id}
                title={t.description}
                onClick={() => toggleTaskType(t.id)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  selected
                    ? "border-[#9945FF] bg-[#9945FF]/20 text-[#9945FF]"
                    : active
                    ? "border-white/10 bg-white/5 text-muted-foreground hover:border-[#9945FF]/40"
                    : "border-white/10 bg-white/5 text-muted-foreground/40"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {policy.allowedTaskTypes.length === 0 && (
          <p className="text-xs text-muted-foreground/60">All task types allowed (none explicitly restricted).</p>
        )}
      </div>

      {/* Quality requirements */}
      <div className="rounded-xl border border-white/10 bg-card/20 p-5 space-y-4">
        <h2 className="font-semibold">Quality requirements</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Min reputation score (0 = any)</Label>
            <Input
              type="number"
              min={0}
              max={1000}
              step={1}
              value={policy.minReputation}
              onChange={(e) => setPolicy((p) => ({ ...p, minReputation: parseInt(e.target.value, 10) || 0 }))}
            />
          </div>
          <div className="space-y-1.5 flex flex-col justify-between">
            <Label className="text-xs text-muted-foreground">Require attestation</Label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={policy.requireAttestation}
                onChange={(e) => setPolicy((p) => ({ ...p, requireAttestation: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm">Only use attested specialists</span>
            </label>
          </div>
        </div>
      </div>

      {/* Privacy + fallback */}
      <div className="rounded-xl border border-white/10 bg-card/20 p-5 space-y-4">
        <h2 className="font-semibold">Settlement & fallback</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Preferred privacy mode</Label>
            <select
              value={policy.preferredPrivacyMode}
              onChange={(e) => setPolicy((p) => ({ ...p, preferredPrivacyMode: e.target.value as OrchestratorPolicy["preferredPrivacyMode"] }))}
              className="w-full text-sm rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white"
            >
              {PRIVACY_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground/60">
              {PRIVACY_MODES.find((m) => m.id === policy.preferredPrivacyMode)?.description}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">When no candidate found</Label>
            <select
              value={policy.fallbackMode}
              onChange={(e) => setPolicy((p) => ({ ...p, fallbackMode: e.target.value as OrchestratorPolicy["fallbackMode"] }))}
              className="w-full text-sm rounded-md border border-white/15 bg-black/40 px-3 py-2 text-white"
            >
              <option value="skip">Skip (return no specialist)</option>
              <option value="error">Error (fail the task)</option>
              <option value="local">Local (use built-in model)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <Button
          onClick={save}
          disabled={saving}
          style={{ background: "linear-gradient(135deg,#9945FF,#14F195)", color: "#000", fontWeight: 600 }}
        >
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <Link href="/planner">
          <Button variant="outline">Go to Planner →</Button>
        </Link>
        {saveNote && <span className="text-xs text-muted-foreground">{saveNote}</span>}
      </div>

      {policy.updatedAt && (
        <p className="text-xs text-muted-foreground/50">
          Last saved: {new Date(policy.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
