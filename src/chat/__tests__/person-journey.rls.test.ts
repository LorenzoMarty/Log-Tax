import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { DISCLAIMER } from "@/engine";
import { handleChat } from "../handle-chat";
import { scriptedLlm } from "../scripted-llm";
import { loadWorkspaceState } from "../workspace-state";

let a: TestUser;
let pessoal: string;
let empresa: string;
const chat = (workspaceId: string, message: string) => handleChat(a.client, scriptedLlm, { workspaceId, message });
const widgets = async (ws: string) => (await loadWorkspaceState(a.client, ws))!.dashboard.widgets.map((w) => w.id);

beforeAll(async () => {
  a = await createTestUser("pf");
  pessoal = await createWorkspace(a, "pessoal");
  empresa = await createWorkspace(a, "empresa");
});
afterAll(async () => {
  await admin.auth.admin.deleteUser(a.id);
});

describe("personal income-tax journey through the chat (real database)", () => {
  it("a new personal workspace starts from the demo person and an empty dashboard", async () => {
    const s = (await loadWorkspaceState(a.client, pessoal))!;
    expect(s.kind).toBe("pessoal");
    expect(s.person).toMatchObject({ kind: "pessoa", annualGrossIncome: 180000, dependents: 2 });
    expect(s.dashboard.widgets).toEqual([]);
  });

  it("explains the IR, builds the dashboard and shows the refund", async () => {
    const r = (await chat(pessoal, "Quero entender meu imposto de renda"))!;
    expect(r.events.map((e) => e.name)).toContain("get_ir_diagnosis");
    expect(r.text).toContain("1.308");
    expect(r.text).toMatch(/completa/i);
    expect(r.text.endsWith(DISCLAIMER)).toBe(true);
    expect(await widgets(pessoal)).toEqual(["ir", "ir-modelos"]);
    expect(r.alerts).toEqual([]);
  });

  it("recalculates when the user gives new data, and keeps the dashboard in sync", async () => {
    const r = (await chat(pessoal, "Tenho 3 dependentes"))!;
    expect(r.events.map((e) => [e.name, e.status])).toEqual([
      ["save_person_data", "ok"],
      ["get_ir_diagnosis", "ok"],
      ["dashboard_update_widget", "ok"],
      ["dashboard_update_widget", "ok"],
    ]);
    expect(r.text).toContain("1.933");
    expect((await loadWorkspaceState(a.client, pessoal))!.person.dependents).toBe(3);
    expect(JSON.stringify(r.dashboard)).toContain("Restituição R$ 1.933");
    expect(await widgets(pessoal)).toEqual(["ir", "ir-modelos"]);
  });

  it("recommends the better model with the saving", async () => {
    const r = (await chat(pessoal, "Vale mais a pena a declaração completa ou a simplificada?"))!;
    expect(r.text).toMatch(/completa/i);
    expect(r.text).toMatch(/economiza R\$ 4\.\d{3}/);
  });

  it("company tools are refused in a personal workspace, and the other way around", async () => {
    const before = await widgets(pessoal);
    const r = (await chat(pessoal, "Empresa"))!;
    expect(r.events[0]).toMatchObject({ name: "get_tax_diagnosis", status: "refused" });
    expect(await widgets(pessoal)).toEqual(before);

    const c = (await chat(empresa, "Quero entender meu imposto de renda"))!;
    expect(c.events[0]).toMatchObject({ name: "get_ir_diagnosis", status: "refused" });
    expect(await widgets(empresa)).toEqual([]);
  });

  it("the company workspace still works and is unaffected by the personal data", async () => {
    const r = (await chat(empresa, "Empresa"))!;
    expect(r.text).toContain("42.800");
    const s = (await loadWorkspaceState(a.client, empresa))!;
    expect(s.company.monthlyRevenue).toBe(350000);
    expect(s.person.dependents).toBe(2); // demo person, not the personal workspace's data
  });
});
