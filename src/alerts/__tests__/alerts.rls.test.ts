import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, createWorkspace, type TestUser } from "@/db/test-users";
import { handleChat } from "@/chat/handle-chat";
import { scriptedLlm } from "@/chat/scripted-llm";
import { loadWorkspaceState } from "@/chat/workspace-state";
import { alertStatuses } from "../evaluate";
import { mockEngine } from "@/engine";

let a: TestUser;
let ws: string;
const chat = (message: string) => handleChat(a.client, scriptedLlm, { workspaceId: ws, message });

beforeAll(async () => {
  a = await createTestUser("alerts");
  ws = await createWorkspace(a, "empresa");
});
afterAll(async () => {
  await admin.auth.admin.deleteUser(a.id);
});

describe("in-app alerts through the chat (real database)", () => {
  it("creates the alert from plain Portuguese and it already fires for the demo company", async () => {
    const r = (await chat("Me avise se meus impostos passarem de R$ 20 mil"))!;
    expect(r.events.map((e) => e.name)).toContain("create_alert");
    expect(r.text).toMatch(/20\.000/);
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ triggered: true, text: "Impostos por mês acima de R$ 20.000", currentText: "R$ 42.800" });
  });

  it("evaluates again when the data changes: clears, then fires again", async () => {
    const low = (await chat("Meu faturamento mensal é R$ 100 mil"))!;
    expect(low.alerts[0].triggered).toBe(false);
    expect(low.alerts[0].currentText).toBe("R$ 12.229");

    const high = (await chat("Meu faturamento mensal é R$ 400 mil"))!;
    expect(high.alerts[0].triggered).toBe(true);
  });

  it("evaluates on open from what is saved, without any chat turn", async () => {
    const s = (await loadWorkspaceState(a.client, ws))!;
    expect(s.alerts).toHaveLength(1);
    const statuses = alertStatuses(mockEngine, s.company, s.alerts);
    expect(statuses[0]).toMatchObject({ triggered: true });

    await chat("Meu faturamento mensal é R$ 50 mil");
    const later = (await loadWorkspaceState(a.client, ws))!;
    expect(alertStatuses(mockEngine, later.company, later.alerts)[0].triggered).toBe(false);
  });

  it("a below-threshold rule is created too ('abaixo de')", async () => {
    const r = (await chat("Me avise se meus impostos ficarem abaixo de R$ 5 mil"))!;
    expect(r.alerts).toHaveLength(2);
    expect(r.alerts[1].text).toBe("Impostos por mês abaixo de R$ 5.000");
  });
});
