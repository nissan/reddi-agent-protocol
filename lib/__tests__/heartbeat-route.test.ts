jest.mock("@/lib/onboarding/specialist-index", () => ({
  updateSpecialistHealthcheck: jest.fn(),
  listSpecialistIndex: jest.fn(),
}));

jest.mock("fs", () => {
  const actual = jest.requireActual("fs") as typeof import("fs");
  return {
    ...actual,
    readFileSync: jest.fn((path: string, encoding: string) => {
      if (String(path).includes("specialist-index.json")) {
        return JSON.stringify([
          {
            walletAddress: "wallet-a",
            endpointUrl: "https://a.test",
            healthcheckStatus: "pass",
            updatedAt: "2026-04-23T00:00:00.000Z",
          },
        ]);
      }
      return actual.readFileSync(path, encoding as BufferEncoding);
    }),
  };
});

describe("heartbeat route (POST — probe)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("returns empty result when index has no endpoints", async () => {
    const fs = require("fs");
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([]));

    const { POST } = await import("@/app/api/heartbeat/route");
    const res = await POST(new Request("http://localhost/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.polled).toBe(0);
    expect(body.message).toContain("No endpoints");
  });

  it("probes each specialist endpoint and reports status", async () => {
    const fs = require("fs");
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([
      {
        walletAddress: "wallet-online",
        endpointUrl: "https://online.test",
        healthcheckStatus: "unknown",
      },
    ]));
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    const { POST } = await import("@/app/api/heartbeat/route");
    const res = await POST(new Request("http://localhost/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.polled).toBe(1);
    expect(body.passed).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results[0].newStatus).toBe("pass");
  });

  it("marks unreachable endpoints as fail", async () => {
    const fs = require("fs");
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([
      {
        walletAddress: "wallet-offline",
        endpointUrl: "https://offline.test",
        healthcheckStatus: "pass",
      },
    ]));
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const { POST } = await import("@/app/api/heartbeat/route");
    const res = await POST(new Request("http://localhost/api/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passed).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0].newStatus).toBe("fail");
  });
});

describe("heartbeat route (GET — snapshot)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("returns health snapshot without probing", async () => {
    const fs = require("fs");
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify([
      { walletAddress: "w1", endpointUrl: "https://w1.test", healthcheckStatus: "pass", updatedAt: "2026-04-23T00:00:00.000Z" },
      { walletAddress: "w2", endpointUrl: "https://w2.test", healthcheckStatus: "fail", updatedAt: "2026-04-23T00:00:00.000Z" },
      { walletAddress: "w3", endpointUrl: null, healthcheckStatus: "unknown", updatedAt: null },
    ]));

    const { GET } = await import("@/app/api/heartbeat/route");
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.total).toBe(3);
    expect(body.online).toBe(1);
    expect(body.offline).toBe(1);
    expect(body.unknown).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
