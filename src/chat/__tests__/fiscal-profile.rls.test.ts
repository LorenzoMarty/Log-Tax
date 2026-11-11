import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { mockEngine, seedCompany } from "@/engine";
import { createMemoryStore } from "../memory-store";
import { invokeTool } from "../tools";
import type { ToolContext } from "../types";
import { loadWorkspaceState, saveWorkspaceState } from "../workspace-state";

let user: TestUser;
let ws: string;
const CNPJ = "11222333000181";

beforeAll(async () => {
  user = await createTestUser("fiscal");
  ws = await createWorkspace(user);
});

const ctxOf = (store = createMemoryStore()): ToolContext => ({ scope: { workspaceId: "w", kind: "empresa" }, store, engine: mockEngine, approvals: new Set() });
const save = (ctx: ToolContext, args: object) => invokeTool(ctx, "save_company_data", JSON.stringify(args));

describe("save_company_data with the fiscal profile", () => {
  it("accepts the new fields and merges monthly series by month", async () => {
    const ctx = ctxOf();
    expect((await save(ctx, { cnpj: "11.222.333/0001-81", cnaes: ["4712100"], uf: "SP", municipio: { name: "São Paulo", ibge: "3550308" }, openedAt: "2020-03-10" })).status).toBe("ok");
    expect(ctx.store.getCompany().cnpj).toBe(CNPJ); // normalised to digits
    await save(ctx, { series: [{ month: "2026-01", revenue: { comercio: 1000 } }] });
    await save(ctx, { series: [{ month: "2026-01", purchases: 400 }, { month: "2026-02", revenue: { servico: 50 } }] });
    expect(ctx.store.getCompany().series).toEqual([{ month: "2026-01", revenue: { comercio: 1000 }, purchases: 400 }, { month: "2026-02", revenue: { servico: 50 } }]);
  });

  it("refuses inconsistencies and saves nothing", async () => {
    const ctx = ctxOf();
    const before = JSON.stringify(ctx.store.getCompany());
    const out = await save(ctx, { anexo: "III" }); // seed regime is presumido
    expect(out.status).toBe("error");
    expect((out as { message: string }).message).toMatch(/só existe no Simples/);
    expect((await save(ctx, { cnpj: "11222333000180" })).status).toBe("error");
    expect((await save(ctx, { openedAt: "2099-01-01" })).status).toBe("error");
    expect(JSON.stringify(ctx.store.getCompany())).toBe(before);
  });

  it("accepts the annex once the regime is the Simples", async () => {
    const ctx = ctxOf();
    expect((await save(ctx, { regime: "simples", anexo: "III" })).status).toBe("ok");
  });
});

describe("persistence", () => {
  it("stores the CNPJ encrypted, reads it back in clear, and keeps the series", async () => {
    const state = await loadWorkspaceState(user.client, ws);
    const store = createMemoryStore({ company: { ...seedCompany, cnpj: CNPJ, cnaes: ["4712100"], series: [{ month: "2026-01", revenue: { comercio: 1000 } }] } });
    await saveWorkspaceState(user.client, ws, { ...store.snapshot(), kind: "empresa", dashboardRowId: state!.dashboardRowId, history: [], messages: [] });

    const raw = (await admin.from("workspaces").select("profile").eq("id", ws).single()).data!.profile as Record<string, unknown>;
    expect(JSON.stringify(raw)).not.toContain(CNPJ);
    expect(String(raw.cnpj)).toMatch(/^enc:/);

    const back = await loadWorkspaceState(user.client, ws);
    expect(back!.company.cnpj).toBe(CNPJ);
    expect(back!.company.series).toEqual([{ month: "2026-01", revenue: { comercio: 1000 } }]);
  });

  it("loads a profile saved before the new fields existed", async () => {
    const legacy = await createWorkspace(user);
    await user.client.from("workspaces").update({ profile: { id: "x", name: "Antiga", regime: "presumido", activity: "comercio", monthlyRevenue: 123456, employees: 3, uf: "MG" } }).eq("id", legacy);
    const state = await loadWorkspaceState(user.client, legacy);
    expect(state!.company).toMatchObject({ name: "Antiga", monthlyRevenue: 123456, uf: "MG" });
    expect(state!.company.cnpj).toBeUndefined();
  });

  it("another person cannot read the profile", async () => {
    const stranger = await createTestUser("fiscal2");
    expect(await loadWorkspaceState(stranger.client, ws)).toBeNull();
  });
});
