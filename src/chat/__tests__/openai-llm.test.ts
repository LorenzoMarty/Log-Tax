import { describe, expect, it, vi } from "vitest";
import { createOpenAiLlm, openAiLlm } from "../openai-llm";
import type { Msg } from "../types";

const response = (output: unknown[], output_text = "") => ({ output, output_text, status: "completed" });
const fakeClient = (res: unknown) => {
  const create = vi.fn().mockResolvedValue(res);
  return { client: { responses: { create } } as never, create };
};
const tools = [{ name: "get_tax_diagnosis", description: "d", parameters: { type: "object", properties: {} } }];

describe("openAiLlm", () => {
  it("sends instructions, tools, store:false and no previous_response_id", async () => {
    const { client, create } = fakeClient(response([], "oi"));
    const turn = await openAiLlm(client, "test-model").respond({ system: "SYS", history: [{ role: "user", content: "olá" }], tools });
    const req = create.mock.calls[0][0];
    expect(req).toMatchObject({ model: "test-model", instructions: "SYS", store: false });
    expect(req.previous_response_id).toBeUndefined();
    expect(req.input).toEqual([{ role: "user", content: "olá" }]);
    expect(req.tools).toEqual([{ type: "function", name: "get_tax_diagnosis", description: "d", parameters: tools[0].parameters, strict: false }]);
    expect(turn).toMatchObject({ text: "oi", calls: [] });
  });

  it("maps function_call items to tool calls and keeps the raw output for replay", async () => {
    const out = [{ type: "function_call", call_id: "c1", name: "get_tax_diagnosis", arguments: "{}", id: "fc_1", status: "completed" }];
    const { client } = fakeClient(response(out));
    const turn = await openAiLlm(client, "m").respond({ system: "s", history: [], tools });
    expect(turn.calls).toEqual([{ id: "c1", name: "get_tax_diagnosis", args: "{}" }]);
    expect(turn.items).toEqual(out);
  });

  it("replays raw items and tool results as Responses input items", async () => {
    const { client, create } = fakeClient(response([], "fim"));
    const raw = { type: "function_call", call_id: "c1", name: "get_tax_diagnosis", arguments: "{}", id: "fc_1", status: "completed" };
    const history: Msg[] = [
      { role: "user", content: "quanto pago?" },
      { role: "llm", items: [raw] },
      { role: "tool_result", callId: "c1", output: '{"ok":true}' },
    ];
    await openAiLlm(client, "m").respond({ system: "s", history, tools });
    const input = create.mock.calls[0][0].input;
    expect(input[0]).toEqual({ role: "user", content: "quanto pago?" });
    expect(input[1]).toMatchObject({ type: "function_call", call_id: "c1", name: "get_tax_diagnosis" });
    expect(input[2]).toEqual({ type: "function_call_output", call_id: "c1", output: '{"ok":true}' });
  });

  it("never sends a full CPF, CNPJ, NF-e key or account number (system, messages and tool results)", async () => {
    const { client, create } = fakeClient(response([], "ok"));
    const history: Msg[] = [
      { role: "user", content: "Meu CPF é 529.982.247-25 e a conta corrente 98765-4" },
      { role: "tool_result", callId: "c1", output: JSON.stringify({ cnpj: "11222333000181", chave: "35200114200166000187550010000000046000000047" }) },
    ];
    await openAiLlm(client, "m").respond({ system: "Empresa CNPJ 11.222.333/0001-81", history, tools });
    const sent = JSON.stringify(create.mock.calls[0][0]);
    for (const secret of ["529.982.247-25", "52998224725", "11222333000181", "11.222.333/0001-81", "35200114200166000187550010000000046000000047", "98765-4"]) expect(sent).not.toContain(secret);
    expect(sent).toContain("***.***.***-25");
    expect(sent).toContain("**.***.***/****-81");
  });

  it("fails loudly without an API key", () => {
    expect(() => createOpenAiLlm({})).toThrow(/OPENAI_API_KEY/);
  });
});
