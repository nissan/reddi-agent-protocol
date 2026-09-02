"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  Copy,
  Check,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { OnboardingVideoCard } from "@/components/onboarding/OnboardingVideoCard";
import { onboardingVideos } from "@/lib/onboarding/video-guides";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Parameter {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  enumValues: string;
  required: boolean;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: Parameter[];
  collapsed: boolean;
}

interface Skill {
  id: string;
  name: string;
  content: string;
  source: "typed" | "uploaded" | "url";
  collapsed: boolean;
}

type TestStatus = "pending" | "running" | "pass" | "fail" | "warn";

interface TestResult {
  status: TestStatus;
  message: string;
}

interface TestResults {
  reachability: TestResult;
  modelPresent: TestResult;
  simpleChat: TestResult;
  toolCalling: TestResult;
  embeddings: TestResult;
}

interface AgentConfig {
  endpoint: string;
  corsOk: boolean;
  model: string;
  tools: Tool[];
  skills: Skill[];
  specialisation: string;
  tags: string;
  rate: string;
}

// ─────────────────────────────────────────────
// Default data
// ─────────────────────────────────────────────

const DEFAULT_TOOLS: Tool[] = [
  {
    id: "tool-default-1",
    name: "web_search",
    description: "Search the web for current information",
    parameters: [
      {
        id: "param-default-1",
        name: "query",
        type: "string",
        description: "The search query",
        enumValues: "",
        required: true,
      },
    ],
    collapsed: false,
  },
];

const DEFAULT_SKILLS: Skill[] = [
  {
    id: "skill-default-1",
    name: "Research Specialist",
    content: `# Research Specialist
You are an expert research assistant. You excel at:
- Finding and synthesising information from multiple sources
- Providing accurate, cited responses
- Breaking complex topics into clear explanations

Always cite your sources. Prefer recent information. Flag uncertainty clearly.`,
    source: "typed",
    collapsed: true,
  },
];

const DEFAULT_TEST_RESULTS: TestResults = {
  reachability: { status: "pending", message: "" },
  modelPresent: { status: "pending", message: "" },
  simpleChat: { status: "pending", message: "" },
  toolCalling: { status: "pending", message: "" },
  embeddings: { status: "pending", message: "" },
};

const STORAGE_KEY = "reddi-agent-config";

// ─────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="text-[#9945FF] hover:text-[#14F195] transition-colors p-1 rounded"
      title="Copy"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function TestIcon({ status }: { status: TestStatus }) {
  if (status === "pending") return <span className="w-5 h-5 rounded-full border border-gray-600 inline-block" />;
  if (status === "running") return <Loader2 size={18} className="animate-spin text-[#9945FF]" />;
  if (status === "pass") return <CheckCircle2 size={18} className="text-[#14F195]" />;
  if (status === "warn") return <AlertTriangle size={18} className="text-yellow-400" />;
  return <XCircle size={18} className="text-red-400" />;
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

export default function SetupPage() {
  // ── State ──
  const [endpoint, setEndpoint] = useState("https://your-subdomain.ngrok-free.app");
  const [corsOk, setCorsOk] = useState(false);
  const [connectStatus, setConnectStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [connectMsg, setConnectMsg] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const [tools, setTools] = useState<Tool[]>(DEFAULT_TOOLS);
  const [showToolJson, setShowToolJson] = useState(false);

  const [skills, setSkills] = useState<Skill[]>(DEFAULT_SKILLS);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [skillModal, setSkillModal] = useState(false);
  const [skillModalName, setSkillModalName] = useState("");
  const [skillModalContent, setSkillModalContent] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlFetching, setUrlFetching] = useState(false);

  const [testModel, setTestModel] = useState("qwen3:8b");
  const [testResults, setTestResults] = useState<TestResults>(DEFAULT_TEST_RESULTS);
  const [testRunning, setTestRunning] = useState(false);

  const [specialisation, setSpecialisation] = useState("");
  const [tags, setTags] = useState("");
  const [rate, setRate] = useState("0.001");

  const [corsOpen, setCorsOpen] = useState(true);

  // ── LocalStorage persistence ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const cfg: AgentConfig = JSON.parse(saved);
        if (cfg.endpoint) setEndpoint(cfg.endpoint);
        if (cfg.corsOk) setCorsOk(cfg.corsOk);
        if (cfg.model) setTestModel(cfg.model);
        if (cfg.tools?.length) setTools(cfg.tools);
        if (cfg.skills?.length) setSkills(cfg.skills);
        if (cfg.specialisation) setSpecialisation(cfg.specialisation);
        if (cfg.tags) setTags(cfg.tags);
        if (cfg.rate) setRate(cfg.rate);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const cfg: AgentConfig = {
      endpoint,
      corsOk,
      model: testModel,
      tools,
      skills,
      specialisation,
      tags,
      rate,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {}
  }, [endpoint, corsOk, testModel, tools, skills, specialisation, tags, rate]);

  // ── Connect tab ──
  const testConnection = async () => {
    setConnectStatus("testing");
    setConnectMsg("");
    try {
      const res = await fetch(`${endpoint}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const models: string[] = (data.models ?? []).map((m: { name: string }) => m.name);
        setAvailableModels(models);
        setCorsOk(true);
        setCorsOpen(false);
        setConnectStatus("ok");
        setConnectMsg(`✓ Reachable · ${models.length} model${models.length !== 1 ? "s" : ""} available`);
      } else {
        setConnectStatus("error");
        setConnectMsg(`✗ Not reachable — server returned ${res.status}`);
      }
    } catch {
      setConnectStatus("error");
      setConnectMsg("✗ Not reachable — check URL and CORS setup");
    }
  };

  // ── Tools tab ──
  const addTool = () => {
    setTools((prev) => [
      ...prev,
      {
        id: uid(),
        name: "",
        description: "",
        parameters: [],
        collapsed: false,
      },
    ]);
  };

  const updateTool = (id: string, patch: Partial<Tool>) => {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const deleteTool = (id: string) => {
    setTools((prev) => prev.filter((t) => t.id !== id));
  };

  const addParam = (toolId: string) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId
          ? {
              ...t,
              parameters: [
                ...t.parameters,
                { id: uid(), name: "", type: "string", description: "", enumValues: "", required: false },
              ],
            }
          : t
      )
    );
  };

  const updateParam = (toolId: string, paramId: string, patch: Partial<Parameter>) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId
          ? { ...t, parameters: t.parameters.map((p) => (p.id === paramId ? { ...p, ...patch } : p)) }
          : t
      )
    );
  };

  const deleteParam = (toolId: string, paramId: string) => {
    setTools((prev) =>
      prev.map((t) =>
        t.id === toolId ? { ...t, parameters: t.parameters.filter((p) => p.id !== paramId) } : t
      )
    );
  };

  const buildOllamaTools = useCallback(() => {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name || "unnamed_tool",
        description: t.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            t.parameters.map((p) => {
              const def: Record<string, unknown> = { type: p.type, description: p.description };
              if (p.enumValues.trim()) {
                def.enum = p.enumValues.split(",").map((v) => v.trim()).filter(Boolean);
              }
              return [p.name || "param", def];
            })
          ),
          required: t.parameters.filter((p) => p.required).map((p) => p.name || "param"),
        },
      },
    }));
  }, [tools]);

  // ── Skills tab ──
  const addSkillTyped = () => {
    if (!skillModalName.trim() || !skillModalContent.trim()) return;
    setSkills((prev) => [
      ...prev,
      { id: uid(), name: skillModalName, content: skillModalContent, source: "typed", collapsed: true },
    ]);
    setSkillModalName("");
    setSkillModalContent("");
    setSkillModal(false);
  };

  const handleSkillUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        setSkills((prev) => [
          ...prev,
          { id: uid(), name: file.name.replace(/\.(md|txt)$/, ""), content, source: "uploaded", collapsed: true },
        ]);
      };
      reader.readAsText(file);
    });
    e.target.value = "";
  };

  const fetchSkillFromUrl = async () => {
    if (!urlInput.trim()) return;
    setUrlFetching(true);
    try {
      const res = await fetch(urlInput);
      const text = await res.text();
      const name = urlInput.split("/").pop()?.replace(/\.(md|txt)$/, "") ?? "Fetched Skill";
      setSkills((prev) => [
        ...prev,
        { id: uid(), name, content: text, source: "url", collapsed: true },
      ]);
      setUrlInput("");
    } catch {
      alert("Failed to fetch URL");
    } finally {
      setUrlFetching(false);
    }
  };

  const updateSkill = (id: string, patch: Partial<Skill>) => {
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const deleteSkill = (id: string) => {
    setSkills((prev) => prev.filter((s) => s.id !== id));
  };

  const moveSkill = (id: string, dir: "up" | "down") => {
    setSkills((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (dir === "up" && idx === 0) return prev;
      if (dir === "down" && idx === prev.length - 1) return prev;
      const arr = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return arr;
    });
  };

  const combinedSystemPrompt = skills.map((s) => s.content).join("\n\n---\n\n");

  // ── Test tab ──
  const setTestResult = (key: keyof TestResults, result: TestResult) => {
    setTestResults((prev) => ({ ...prev, [key]: result }));
  };

  const runAllTests = async () => {
    setTestRunning(true);
    setTestResults(DEFAULT_TEST_RESULTS);

    let models: string[] = [];

    // Test 1: Reachability
    setTestResult("reachability", { status: "running", message: "" });
    try {
      const res = await fetch(`${endpoint}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        models = (data.models ?? []).map((m: { name: string }) => m.name);
        setTestResult("reachability", { status: "pass", message: "✓ Reachable" });
      } else {
        setTestResult("reachability", { status: "fail", message: `✗ HTTP ${res.status} — check endpoint` });
        setTestRunning(false);
        return;
      }
    } catch {
      setTestResult("reachability", {
        status: "fail",
        message: "✗ Cannot reach endpoint — check URL and CORS",
      });
      setTestRunning(false);
      return;
    }

    // Test 2: Model present
    setTestResult("modelPresent", { status: "running", message: "" });
    const modelMatch = models.find((m) => m.startsWith(testModel.split(":")[0]));
    if (modelMatch) {
      setTestResult("modelPresent", { status: "pass", message: `✓ Model '${modelMatch}' found` });
    } else if (models.length === 0) {
      setTestResult("modelPresent", {
        status: "fail",
        message: `✗ No models found — run: ollama pull ${testModel}`,
      });
      setTestRunning(false);
      return;
    } else {
      setTestResult("modelPresent", {
        status: "warn",
        message: `⚠ '${testModel}' not found. Available: ${models.slice(0, 3).join(", ")}`,
      });
    }

    // Test 3: Simple chat
    setTestResult("simpleChat", { status: "running", message: "" });
    try {
      const res = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: testModel,
          stream: false,
          messages: [{ role: "user", content: "Reply with exactly: READY" }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message?.content) {
          setTestResult("simpleChat", { status: "pass", message: "✓ Chat working" });
        } else {
          setTestResult("simpleChat", { status: "fail", message: "✗ Empty response from model" });
        }
      } else {
        const errText = await res.text().catch(() => `${res.status}`);
        setTestResult("simpleChat", { status: "fail", message: `✗ Chat failed — ${errText}` });
      }
    } catch (e) {
      setTestResult("simpleChat", { status: "fail", message: `✗ Chat failed — ${e}` });
    }

    // Test 4: Tool calling
    setTestResult("toolCalling", { status: "running", message: "" });
    try {
      const res = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: testModel,
          stream: false,
          messages: [{ role: "user", content: "What is 42 plus 58? Use the calculator tool." }],
          tools: [
            {
              type: "function",
              function: {
                name: "calculate",
                description: "Perform arithmetic",
                parameters: {
                  type: "object",
                  properties: { expression: { type: "string", description: "Math expression" } },
                  required: ["expression"],
                },
              },
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message?.tool_calls?.length) {
          setTestResult("toolCalling", { status: "pass", message: "✓ Tool calling supported" });
        } else if (data.message?.content) {
          setTestResult("toolCalling", {
            status: "warn",
            message: "⚠ Model responded without tool call — may not support tool calling",
          });
        } else {
          setTestResult("toolCalling", { status: "fail", message: "✗ Unexpected response" });
        }
      } else {
        setTestResult("toolCalling", { status: "fail", message: `✗ Tool call test failed — HTTP ${res.status}` });
      }
    } catch (e) {
      setTestResult("toolCalling", { status: "fail", message: `✗ Tool call test failed — ${e}` });
    }

    // Test 5: Embeddings
    setTestResult("embeddings", { status: "running", message: "" });
    try {
      const res = await fetch(`${endpoint}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "test" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.embeddings?.length) {
          setTestResult("embeddings", { status: "pass", message: "✓ Embeddings available (nomic-embed-text)" });
        } else {
          setTestResult("embeddings", {
            status: "warn",
            message: "⚠ nomic-embed-text responded but no embeddings — check model",
          });
        }
      } else {
        setTestResult("embeddings", {
          status: "warn",
          message: "⚠ nomic-embed-text not found — run: ollama pull nomic-embed-text (needed for RAG)",
        });
      }
    } catch {
      setTestResult("embeddings", {
        status: "warn",
        message: "⚠ Embeddings test failed — run: ollama pull nomic-embed-text (needed for RAG)",
      });
    }

    setTestRunning(false);
  };

  const testPassCount = Object.values(testResults).filter(
    (r) => r.status === "pass" || r.status === "warn"
  ).length;

  // ── Register tab — build summary config for /register ──
  const saveToLocalStorageAndNavigate = () => {
    const regConfig = {
      endpoint,
      model: testModel,
      toolsJson: JSON.stringify(buildOllamaTools()),
      skillsText: combinedSystemPrompt,
      specialisation,
      tags,
      rate,
    };
    try {
      localStorage.setItem("reddi-register-config", JSON.stringify(regConfig));
    } catch {}
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            Configure Your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#9945FF] to-[#14F195]">
              Agent
            </span>
          </h1>
          <p className="text-gray-400 text-sm">
            Connect your Ollama endpoint, define tools and skills, run tests, then register on Solana.
          </p>
        </div>

        <section id="mcp-video" className="mb-8">
          <OnboardingVideoCard video={onboardingVideos.find((video) => video.id === "mcp-x402") ?? onboardingVideos[0]} layout="horizontal" hostRoute="/setup" />
        </section>

        <Tabs defaultValue="connect" className="w-full">
          <TabsList className="bg-[#111] border border-[#222] rounded-xl mb-6 w-full grid grid-cols-5">
            {["connect", "tools", "skills", "test", "register"].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="capitalize data-[state=active]:bg-[#9945FF]/20 data-[state=active]:text-[#9945FF] text-gray-400 text-xs sm:text-sm"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ══════════════════════════ CONNECT ══════════════════════════ */}
          <TabsContent value="connect">
            <div className="space-y-4">
              <div>
                <Label className="text-gray-300 text-sm mb-1 block">Your Ollama endpoint URL</Label>
                <Input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://your-subdomain.ngrok-free.app"
                  className="bg-[#111] border-[#333] text-white font-mono"
                />
              </div>

              <Button
                onClick={testConnection}
                disabled={connectStatus === "testing"}
                className="bg-[#9945FF] hover:bg-[#7a35d4] text-white"
              >
                {connectStatus === "testing" ? (
                  <><Loader2 size={14} className="mr-2 animate-spin" /> Testing…</>
                ) : (
                  "Test connection"
                )}
              </Button>

              {connectMsg && (
                <p
                  className={`text-sm font-mono ${
                    connectStatus === "ok" ? "text-[#14F195]" : "text-red-400"
                  }`}
                >
                  {connectMsg}
                </p>
              )}

              {/* CORS setup box */}
              {!corsOk && (
                <div className="border border-[#333] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setCorsOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[#111] text-sm text-gray-300 hover:text-white transition-colors"
                  >
                    <span>⚠ CORS setup required</span>
                    {corsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {corsOpen && (
                    <div className="p-4 space-y-4 bg-[#0d0d0d] text-sm text-gray-300">
                      <p>
                        Ollama blocks browser requests by default. Run this once:
                      </p>
                      <div className="bg-[#1a1a1a] rounded-md p-3 font-mono text-[#14F195] flex items-start justify-between gap-2">
                        <code>OLLAMA_ORIGINS=&quot;*&quot; ollama serve</code>
                        <CopyButton text={`OLLAMA_ORIGINS="*" ollama serve`} />
                      </div>
                      <p>Or set permanently in your environment:</p>
                      <div className="bg-[#1a1a1a] rounded-md p-3 font-mono text-[#14F195] flex items-start justify-between gap-2">
                        <code>export OLLAMA_ORIGINS=&quot;*&quot;</code>
                        <CopyButton text={`export OLLAMA_ORIGINS="*"`} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {availableModels.length > 0 && (
                <div className="border border-[#222] rounded-lg p-4 bg-[#111]">
                  <p className="text-xs text-gray-400 mb-2">Installed models:</p>
                  <div className="flex flex-wrap gap-2">
                    {availableModels.map((m) => (
                      <Badge key={m} className="bg-[#9945FF]/20 text-[#9945FF] border-[#9945FF]/40 text-xs">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ══════════════════════════ TOOLS ══════════════════════════ */}
          <TabsContent value="tools">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-400">{tools.length} tool{tools.length !== 1 ? "s" : ""} defined</p>
                <Button
                  onClick={addTool}
                  size="sm"
                  className="bg-[#9945FF]/20 text-[#9945FF] border border-[#9945FF]/40 hover:bg-[#9945FF]/30"
                  variant="outline"
                >
                  <Plus size={14} className="mr-1" /> Add tool
                </Button>
              </div>

              {tools.map((tool) => (
                <div key={tool.id} className="border border-[#2a2a2a] rounded-lg overflow-hidden">
                  {/* Tool header */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-[#111]">
                    <button
                      onClick={() => updateTool(tool.id, { collapsed: !tool.collapsed })}
                      className="text-gray-400 hover:text-white"
                    >
                      {tool.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                    <span className="font-mono text-sm text-[#14F195] flex-1 truncate">
                      {tool.name || "new_tool"}
                    </span>
                    <button
                      onClick={() => deleteTool(tool.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Tool body */}
                  {!tool.collapsed && (
                    <div className="p-4 space-y-3 bg-[#0d0d0d]">
                      <div>
                        <Label className="text-xs text-gray-400 mb-1 block">Function name (no spaces)</Label>
                        <Input
                          value={tool.name}
                          onChange={(e) => updateTool(tool.id, { name: e.target.value.replace(/\s/g, "_") })}
                          placeholder="my_function"
                          className="bg-[#111] border-[#333] text-white font-mono text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-400 mb-1 block">Description</Label>
                        <Textarea
                          value={tool.description}
                          onChange={(e) => updateTool(tool.id, { description: e.target.value })}
                          placeholder="What does this tool do?"
                          rows={2}
                          className="bg-[#111] border-[#333] text-white text-sm resize-none"
                        />
                      </div>

                      {/* Parameters */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs text-gray-400">Parameters</Label>
                          <button
                            onClick={() => addParam(tool.id)}
                            className="text-xs text-[#9945FF] hover:text-[#14F195] flex items-center gap-1"
                          >
                            <Plus size={12} /> Add parameter
                          </button>
                        </div>

                        {tool.parameters.length === 0 && (
                          <p className="text-xs text-gray-600 italic">No parameters yet.</p>
                        )}

                        <div className="space-y-2">
                          {tool.parameters.map((param) => (
                            <div
                              key={param.id}
                              className="border border-[#1e1e1e] rounded p-3 space-y-2 bg-[#111]"
                            >
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs text-gray-500 mb-1 block">Name</Label>
                                  <Input
                                    value={param.name}
                                    onChange={(e) =>
                                      updateParam(tool.id, param.id, { name: e.target.value.replace(/\s/g, "_") })
                                    }
                                    placeholder="param_name"
                                    className="bg-[#1a1a1a] border-[#333] text-white font-mono text-xs h-8"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-gray-500 mb-1 block">Type</Label>
                                  <select
                                    value={param.type}
                                    onChange={(e) =>
                                      updateParam(tool.id, param.id, {
                                        type: e.target.value as Parameter["type"],
                                      })
                                    }
                                    className="w-full bg-[#1a1a1a] border border-[#333] text-white text-xs rounded-md h-8 px-2"
                                  >
                                    {["string", "number", "boolean", "array"].map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs text-gray-500 mb-1 block">Description</Label>
                                <Input
                                  value={param.description}
                                  onChange={(e) =>
                                    updateParam(tool.id, param.id, { description: e.target.value })
                                  }
                                  placeholder="What is this parameter?"
                                  className="bg-[#1a1a1a] border-[#333] text-white text-xs h-8"
                                />
                              </div>
                              <div>
                                <Label className="text-xs text-gray-500 mb-1 block">
                                  Enum values (optional, comma-separated)
                                </Label>
                                <Input
                                  value={param.enumValues}
                                  onChange={(e) =>
                                    updateParam(tool.id, param.id, { enumValues: e.target.value })
                                  }
                                  placeholder="option1, option2"
                                  className="bg-[#1a1a1a] border-[#333] text-white text-xs h-8"
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={param.required}
                                    onChange={(e) =>
                                      updateParam(tool.id, param.id, { required: e.target.checked })
                                    }
                                    className="accent-[#9945FF]"
                                  />
                                  Required
                                </label>
                                <button
                                  onClick={() => deleteParam(tool.id, param.id)}
                                  className="text-gray-600 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* JSON Preview */}
              <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowToolJson((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-[#111] text-sm text-gray-300 hover:text-white transition-colors"
                >
                  <span>Preview JSON (Ollama format)</span>
                  {showToolJson ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showToolJson && (
                  <div className="bg-[#0d0d0d] p-4">
                    <div className="flex justify-end mb-2">
                      <CopyButton text={JSON.stringify(buildOllamaTools(), null, 2)} />
                    </div>
                    <pre className="text-xs text-[#14F195] font-mono overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(buildOllamaTools(), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ══════════════════════════ SKILLS ══════════════════════════ */}
          <TabsContent value="skills">
            <div className="space-y-4">
              {/* Add skill controls */}
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  onClick={() => setSkillModal(true)}
                  size="sm"
                  className="bg-[#9945FF]/20 text-[#9945FF] border border-[#9945FF]/40 hover:bg-[#9945FF]/30"
                  variant="outline"
                >
                  <Plus size={14} className="mr-1" /> New skill
                </Button>
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-1 text-sm border border-[#333] text-gray-400 hover:text-white hover:border-[#555] px-3 py-1.5 rounded-md transition-colors">
                    Upload .md / .txt
                  </span>
                  <input
                    type="file"
                    accept=".md,.txt"
                    multiple
                    className="hidden"
                    onChange={handleSkillUpload}
                  />
                </label>
              </div>

              {/* URL fetch */}
              <div className="flex gap-2">
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/... (skill URL)"
                  className="bg-[#111] border-[#333] text-white text-sm"
                />
                <Button
                  onClick={fetchSkillFromUrl}
                  disabled={urlFetching || !urlInput.trim()}
                  size="sm"
                  className="bg-[#111] border border-[#333] text-gray-300 hover:text-white"
                  variant="outline"
                >
                  {urlFetching ? <Loader2 size={14} className="animate-spin" /> : "Fetch"}
                </Button>
              </div>

              {/* Skills list */}
              {skills.length === 0 && (
                <p className="text-sm text-gray-600 italic">No skills yet. Add one above.</p>
              )}

              {skills.map((skill, idx) => (
                <div key={skill.id} className="border border-[#2a2a2a] rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 bg-[#111]">
                    <button
                      onClick={() => updateSkill(skill.id, { collapsed: !skill.collapsed })}
                      className="text-gray-400 hover:text-white"
                    >
                      {skill.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                    <span className="font-semibold text-sm text-white flex-1 truncate">{skill.name}</span>
                    <Badge
                      className={`text-xs ${
                        skill.source === "typed"
                          ? "bg-blue-900/40 text-blue-300 border-blue-700/40"
                          : skill.source === "uploaded"
                          ? "bg-green-900/40 text-green-300 border-green-700/40"
                          : "bg-purple-900/40 text-purple-300 border-purple-700/40"
                      }`}
                    >
                      {skill.source === "typed" ? "Typed" : skill.source === "uploaded" ? "Uploaded" : "URL"}
                    </Badge>
                    <div className="flex gap-1">
                      <button
                        onClick={() => moveSkill(skill.id, "up")}
                        disabled={idx === 0}
                        className="text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => moveSkill(skill.id, "down")}
                        disabled={idx === skills.length - 1}
                        className="text-gray-600 hover:text-gray-300 disabled:opacity-30 transition-colors"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                    <button
                      onClick={() => deleteSkill(skill.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {skill.collapsed ? (
                    <div className="px-4 py-2 bg-[#0d0d0d]">
                      <p className="text-xs text-gray-500 line-clamp-2 font-mono">
                        {skill.content.split("\n").slice(0, 2).join(" · ")}
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 bg-[#0d0d0d] space-y-2">
                      <Input
                        value={skill.name}
                        onChange={(e) => updateSkill(skill.id, { name: e.target.value })}
                        className="bg-[#111] border-[#333] text-white font-semibold text-sm"
                        placeholder="Skill name"
                      />
                      <Textarea
                        value={skill.content}
                        onChange={(e) => updateSkill(skill.id, { content: e.target.value })}
                        rows={10}
                        className="bg-[#111] border-[#333] text-white text-sm font-mono resize-y"
                      />
                    </div>
                  )}
                </div>
              ))}

              {/* Combined system prompt preview */}
              {skills.length > 0 && (
                <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setShowSystemPrompt((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[#111] text-sm text-gray-300 hover:text-white transition-colors"
                  >
                    <span>Preview combined system prompt</span>
                    {showSystemPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showSystemPrompt && (
                    <div className="bg-[#0d0d0d] p-4">
                      <div className="flex justify-end mb-2">
                        <CopyButton text={combinedSystemPrompt} />
                      </div>
                      <pre className="text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                        {combinedSystemPrompt}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Skill modal */}
            {skillModal && (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                <div className="bg-[#111] border border-[#333] rounded-xl w-full max-w-lg p-6 space-y-4">
                  <h3 className="text-lg font-semibold">New Skill</h3>
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">Skill name</Label>
                    <Input
                      value={skillModalName}
                      onChange={(e) => setSkillModalName(e.target.value)}
                      placeholder="e.g. Research Specialist"
                      className="bg-[#1a1a1a] border-[#333] text-white"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400 mb-1 block">Content (markdown)</Label>
                    <Textarea
                      value={skillModalContent}
                      onChange={(e) => setSkillModalContent(e.target.value)}
                      rows={10}
                      className="bg-[#1a1a1a] border-[#333] text-white font-mono text-sm resize-y"
                      placeholder="# My Skill&#10;You are an expert in..."
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => { setSkillModal(false); setSkillModalName(""); setSkillModalContent(""); }}
                      className="border-[#333] text-gray-400 hover:text-white"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={addSkillTyped}
                      disabled={!skillModalName.trim() || !skillModalContent.trim()}
                      className="bg-[#9945FF] hover:bg-[#7a35d4] text-white"
                    >
                      Add skill
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ══════════════════════════ TEST ══════════════════════════ */}
          <TabsContent value="test">
            <div className="space-y-4">
              <div>
                <Label className="text-gray-300 text-sm mb-1 block">Model to test</Label>
                <Input
                  value={testModel}
                  onChange={(e) => setTestModel(e.target.value)}
                  placeholder="qwen3:8b"
                  className="bg-[#111] border-[#333] text-white font-mono"
                />
                {availableModels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {availableModels.map((m) => (
                      <button
                        key={m}
                        onClick={() => setTestModel(m)}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          testModel === m
                            ? "bg-[#9945FF]/30 border-[#9945FF] text-[#9945FF]"
                            : "border-[#333] text-gray-500 hover:text-gray-300 hover:border-[#555]"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Button
                onClick={runAllTests}
                disabled={testRunning}
                className="bg-[#14F195] text-black hover:bg-[#10c97a] font-semibold w-full"
              >
                {testRunning ? (
                  <><Loader2 size={16} className="mr-2 animate-spin" /> Running tests…</>
                ) : (
                  "Run all tests"
                )}
              </Button>

              {/* Test rows */}
              <div className="space-y-2">
                {([
                  ["reachability", "Reachability", "GET /api/tags"],
                  ["modelPresent", "Model present", `Check for ${testModel}`],
                  ["simpleChat", "Simple chat", "POST /api/chat"],
                  ["toolCalling", "Tool calling", "POST /api/chat with tools"],
                  ["embeddings", "Embeddings", "POST /api/embed (nomic-embed-text)"],
                ] as [keyof TestResults, string, string][]).map(([key, label, hint]) => {
                  const result = testResults[key];
                  return (
                    <div
                      key={key}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        result.status === "pass"
                          ? "border-[#14F195]/30 bg-[#14F195]/5"
                          : result.status === "fail"
                          ? "border-red-500/30 bg-red-500/5"
                          : result.status === "warn"
                          ? "border-yellow-500/30 bg-yellow-500/5"
                          : result.status === "running"
                          ? "border-[#9945FF]/30 bg-[#9945FF]/5"
                          : "border-[#222] bg-[#0d0d0d]"
                      }`}
                    >
                      <div className="mt-0.5">
                        <TestIcon status={result.status} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{label}</p>
                        <p className="text-xs text-gray-500">{hint}</p>
                        {result.message && (
                          <p
                            className={`text-xs mt-1 font-mono ${
                              result.status === "pass"
                                ? "text-[#14F195]"
                                : result.status === "warn"
                                ? "text-yellow-400"
                                : "text-red-400"
                            }`}
                          >
                            {result.message}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {testPassCount > 0 && (
                <p className="text-sm text-gray-400 text-center">
                  {testPassCount}/5 tests passed
                </p>
              )}
            </div>
          </TabsContent>

          {/* ══════════════════════════ REGISTER ══════════════════════════ */}
          <TabsContent value="register">
            <div className="space-y-6">
              {/* Summary card */}
              <div className="border border-[#2a2a2a] rounded-lg p-4 bg-[#111] space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                  Configuration Summary
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">Endpoint</span>
                    <p className="text-white font-mono text-xs truncate">
                      {endpoint.length > 40 ? endpoint.slice(0, 37) + "…" : endpoint}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Model</span>
                    <p className="text-[#14F195] font-mono text-sm">{testModel}</p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Tools</span>
                    <p className="text-white text-sm">
                      {tools.length} tool{tools.length !== 1 ? "s" : ""}
                      {tools.length > 0 && (
                        <span className="text-gray-400 text-xs ml-1">
                          ({tools.map((t) => t.name || "unnamed").slice(0, 3).join(", ")}
                          {tools.length > 3 ? `+${tools.length - 3}` : ""})
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Skills</span>
                    <p className="text-white text-sm">
                      {skills.length} skill{skills.length !== 1 ? "s" : ""}
                      {skills.length > 0 && (
                        <span className="text-gray-400 text-xs ml-1">
                          ({skills.map((s) => s.name).slice(0, 2).join(", ")}
                          {skills.length > 2 ? `+${skills.length - 2}` : ""})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500 text-xs">Tests</span>
                    <p
                      className={`text-sm font-semibold ${
                        testPassCount === 5
                          ? "text-[#14F195]"
                          : testPassCount >= 3
                          ? "text-yellow-400"
                          : "text-gray-400"
                      }`}
                    >
                      {testPassCount}/5 passed
                      {testPassCount < 3 && (
                        <span className="text-gray-500 font-normal text-xs ml-2">
                          — run tests in the Test tab first
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Registration details */}
              <div className="space-y-4">
                <div>
                  <Label className="text-gray-300 text-sm mb-1 block">
                    Specialisation{" "}
                    <span className="text-gray-500 text-xs">(2–3 sentences)</span>
                  </Label>
                  <Textarea
                    value={specialisation}
                    onChange={(e) => setSpecialisation(e.target.value)}
                    placeholder="Describe what your agent specialises in and what makes it useful to hire."
                    rows={3}
                    className="bg-[#111] border-[#333] text-white text-sm resize-none"
                  />
                </div>

                <div>
                  <Label className="text-gray-300 text-sm mb-1 block">
                    Tags{" "}
                    <span className="text-gray-500 text-xs">(comma-separated)</span>
                  </Label>
                  <Input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="research, summarisation, web-search"
                    className="bg-[#111] border-[#333] text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-300 text-sm mb-1 block">Model</Label>
                    <Input
                      value={testModel}
                      onChange={(e) => setTestModel(e.target.value)}
                      className="bg-[#111] border-[#333] text-white font-mono"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-300 text-sm mb-1 block">
                      Rate (SOL per request)
                    </Label>
                    <Input
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="0.001"
                      className="bg-[#111] border-[#333] text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* CTA */}
              <Link href="/register" onClick={saveToLocalStorageAndNavigate}>
                <Button className="w-full bg-gradient-to-r from-[#9945FF] to-[#14F195] text-black font-bold hover:opacity-90 transition-opacity text-base py-3 h-auto">
                  Go to registration <ExternalLink size={16} className="ml-2" />
                </Button>
              </Link>

              <p className="text-xs text-gray-600 text-center">
                Configuration auto-saved — your wallet connects on the next page.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
