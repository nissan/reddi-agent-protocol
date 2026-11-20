describe("register local-check route", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });

  afterAll(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  });

  it("blocks non-development environments", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const { POST } = await import("@/app/api/register/local-check/route");
    const res = await POST(new Request("http://localhost/api/register/local-check", {
      method: "POST",
      body: JSON.stringify({ check: "ollama" }),
      headers: { "content-type": "application/json" },
    }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });

  it("returns ollama health in development", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response);

    const { POST } = await import("@/app/api/register/local-check/route");
    const res = await POST(new Request("http://localhost/api/register/local-check", {
      method: "POST",
      body: JSON.stringify({ check: "ollama" }),
      headers: { "content-type": "application/json" },
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("matches model names with latest suffix normalization", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "qwen3:8b:latest" }] }),
    } as Response);

    const { POST } = await import("@/app/api/register/local-check/route");
    const res = await POST(new Request("http://localhost/api/register/local-check", {
      method: "POST",
      body: JSON.stringify({ check: "model", model: "qwen3:8b" }),
      headers: { "content-type": "application/json" },
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, models: ["qwen3:8b:latest"] });
  });

  it("rejects unknown check types", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const { POST } = await import("@/app/api/register/local-check/route");
    const res = await POST(new Request("http://localhost/api/register/local-check", {
      method: "POST",
      body: JSON.stringify({ check: "nope" }),
      headers: { "content-type": "application/json" },
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });
});
