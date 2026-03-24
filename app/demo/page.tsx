"use client";

import { useState, useRef, useEffect } from "react";

interface TraceStep {
  delay: number;
  icon: string;
  section: string;
  lines: string[];
  type?: never;
}

interface HtmlPayload {
  type: "html";
  content: string;
}

interface TraceCapturePayload {
  type: "trace_capture";
  trace: TraceStep[];
  output: string;
  metadata: Record<string, unknown>;
}

interface ErrorPayload {
  type: "error";
  message: string;
}

type StreamPayload = TraceStep | HtmlPayload | TraceCapturePayload | ErrorPayload;

interface RenderedSection {
  icon: string;
  section: string;
  lines: string[];
}

const EXPLORER_BASE = "https://explorer.solana.com/tx";

function renderLine(line: string) {
  // Replace [EXPLORER:txhash] with a real link
  const match = line.match(/\[EXPLORER:([^\]]+)\]/);
  if (match) {
    const txHash = match[1];
    const before = line.slice(0, match.index);
    const linkText = "↗";
    return (
      <span>
        {before}
        <a
          href={`${EXPLORER_BASE}/${txHash}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#14F195] hover:underline ml-1"
        >
          {linkText}
        </a>
      </span>
    );
  }
  // Colour ✅ lines green
  if (line.startsWith("✅")) {
    return <span className="text-[#14F195]">{line}</span>;
  }
  // Colour ⚠️ lines yellow
  if (line.startsWith("⚠️")) {
    return <span className="text-yellow-400">{line}</span>;
  }
  // Colour ❌ lines red
  if (line.startsWith("❌")) {
    return <span className="text-red-400">{line}</span>;
  }
  // Colour arrow lines dimmed
  if (line.startsWith("→")) {
    return <span className="text-muted-foreground">{line}</span>;
  }
  return <span>{line}</span>;
}

type Mode = "demo" | "live";

export default function DemoPage() {
  const [mode, setMode] = useState<Mode>("demo");
  const [brief, setBrief] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [sections, setSections] = useState<RenderedSection[]>([]);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [traceCapture, setTraceCapture] = useState<TraceCapturePayload | null>(null);
  const [bakeStatus, setBakeStatus] = useState<"idle" | "baking" | "baked" | "error">("idle");
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [sections]);

  async function handleGenerate() {
    if (!brief.trim() || running) return;
    if (mode === "live" && !ollamaUrl.trim()) return;
    setRunning(true);
    setSections([]);
    setGeneratedHtml(null);
    setTraceCapture(null);
    setBakeStatus("idle");

    try {
      const endpoint = mode === "live" ? "/api/generate-live" : "/api/generate";
      const body =
        mode === "live"
          ? { brief, ollamaUrl: ollamaUrl.trim() }
          : { brief };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const payload = JSON.parse(line) as StreamPayload;
            if ("type" in payload) {
              if (payload.type === "html") {
                setGeneratedHtml(payload.content);
              } else if (payload.type === "trace_capture") {
                setTraceCapture(payload);
              } else if (payload.type === "error") {
                setSections((prev) => [
                  ...prev,
                  { icon: "❌", section: "Error", lines: [payload.message] },
                ]);
              }
            } else {
              const step = payload as TraceStep;
              setSections((prev) => [
                ...prev,
                { icon: step.icon, section: step.section, lines: step.lines },
              ]);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      console.error("Demo stream error:", err);
    } finally {
      setRunning(false);
    }
  }

  async function handleBakeTrace() {
    if (!traceCapture) return;
    setBakeStatus("baking");
    try {
      const res = await fetch("/api/bake-trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(traceCapture),
      });
      if (!res.ok) throw new Error(`Bake failed: ${res.status}`);
      setBakeStatus("baked");
    } catch {
      setBakeStatus("error");
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Mode toggle */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-1 bg-card/30 border border-white/10 rounded-full p-1">
          <button
            onClick={() => setMode("demo")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              mode === "demo"
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Demo mode
          </button>
          <button
            onClick={() => setMode("live")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              mode === "live"
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Live mode
          </button>
        </div>

        {/* Mode banner */}
        {mode === "live" ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#14F195] bg-[#14F195]/10 border border-[#14F195]/20 px-3 py-1.5 rounded-full">
            <span className="inline-block w-2 h-2 rounded-full bg-[#14F195] animate-pulse" />
            Live — real Ollama call · real devnet
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
            ⟳ Replay — recorded real run · all TX IDs verifiable on-chain
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* Left column — 40% */}
        <div className="lg:col-span-2 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold sol-gradient-text pb-1">
              Watch the agent economy work in real time
            </h1>
            <p className="text-muted-foreground text-sm">
              Enter a brief. The consumer agent coordinates specialists, handles escrow, and returns
              a scored result — all on-chain.
            </p>
          </div>

          <div className="space-y-3">
            {/* Live mode: Ollama URL input */}
            {mode === "live" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Ollama Funnel URL</label>
                <input
                  type="url"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="https://your-machine.ts.net"
                  className="w-full rounded-xl border border-white/10 bg-card/30 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#9945FF]/60"
                />
                <p className="text-xs text-muted-foreground">
                  Your Tailscale Funnel URL exposing Ollama on port 11434
                </p>
              </div>
            )}

            <label className="text-sm font-medium">What kind of landing page do you want?</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. A landing page for a Solana-native AI agent marketplace targeting developers"
              rows={4}
              className="w-full rounded-xl border border-white/10 bg-card/30 p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-[#9945FF]/60"
            />
            <button
              onClick={handleGenerate}
              disabled={!brief.trim() || running || (mode === "live" && !ollamaUrl.trim())}
              className="w-full py-3 px-6 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background:
                  !brief.trim() || running || (mode === "live" && !ollamaUrl.trim())
                    ? undefined
                    : "linear-gradient(135deg, #9945FF, #14F195)",
                color:
                  !brief.trim() || running || (mode === "live" && !ollamaUrl.trim())
                    ? undefined
                    : "#000",
                backgroundColor:
                  !brief.trim() || running || (mode === "live" && !ollamaUrl.trim())
                    ? "rgba(255,255,255,0.05)"
                    : undefined,
              }}
            >
              {running
                ? mode === "live"
                  ? "Running live pipeline..."
                  : "Running pipeline..."
                : mode === "live"
                ? "Run Live Pipeline →"
                : "Generate Landing Page →"}
            </button>
          </div>

          {/* Generated HTML preview */}
          {generatedHtml && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                Generated output
              </p>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <iframe
                  srcDoc={generatedHtml}
                  className="w-full h-64"
                  sandbox="allow-scripts"
                  title="Generated landing page preview"
                />
              </div>
            </div>
          )}

          {/* Bake trace button (live mode only, after a run) */}
          {mode === "live" && traceCapture && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Real run captured · slot {String(traceCapture.metadata?.devnetSlot ?? "—")}
              </p>
              <button
                onClick={handleBakeTrace}
                disabled={bakeStatus === "baking" || bakeStatus === "baked"}
                className="w-full py-2.5 px-4 rounded-xl text-sm font-medium border border-[#14F195]/40 text-[#14F195] hover:bg-[#14F195]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bakeStatus === "idle" && "⬇ Bake trace into demo replay"}
                {bakeStatus === "baking" && "Baking..."}
                {bakeStatus === "baked" && "✅ Trace baked — demo mode will replay this run"}
                {bakeStatus === "error" && "❌ Bake failed — check console"}
              </button>
            </div>
          )}
        </div>

        {/* Right column — 60% */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">Debug Trace</h2>
            {running && (
              <span className="flex items-center gap-1.5 text-xs text-[#14F195]">
                <span className="inline-block w-2 h-2 rounded-full bg-[#14F195] animate-pulse" />
                {mode === "live" ? "Live" : "Replaying"}
              </span>
            )}
            {!running && sections.length > 0 && (
              <span className="text-xs text-muted-foreground">Complete</span>
            )}
          </div>

          <div
            ref={logRef}
            className="h-[520px] overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a0a] p-4 font-mono text-xs space-y-4"
          >
            {sections.length === 0 && !running && (
              <p className="text-muted-foreground text-center mt-20">
                Enter a brief and click Generate to start the trace.
              </p>
            )}

            {sections.map((sec, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span>{sec.icon}</span>
                  <span>{sec.section}</span>
                </div>
                <div className="pl-6 space-y-0.5">
                  {sec.lines.map((line, j) => (
                    <div key={j} className="leading-relaxed">
                      {renderLine(line)}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {running && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#9945FF] animate-ping" />
                <span>Processing...</span>
              </div>
            )}
          </div>

          {sections.length > 0 && !running && (
            <p className="text-xs text-muted-foreground text-right">
              Pipeline complete · {sections.length} stages logged
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
