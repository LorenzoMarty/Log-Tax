import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleDashboard } from "@/dashboard/fixtures";
import { ChatPanel } from "../chat-panel";

const reply = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body });
const setup = () =>
  render(<ChatPanel workspaceId="ws1" initialMessages={[{ role: "assistant", text: "Olá!" }]} initialDashboard={{ ...sampleDashboard, widgets: [] }} />);
const send = (text: string) => {
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
};

afterEach(() => vi.unstubAllGlobals());

describe("ChatPanel", () => {
  it("shows the history, sends the message and renders the reply and the updated dashboard", async () => {
    const fetchMock = reply({ text: "Você paga R$ 42.800.", pendingConfirmations: [], dashboard: sampleDashboard });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    expect(screen.getByText("Olá!")).toBeInTheDocument();
    expect(screen.getByText(/nenhum bloco/i)).toBeInTheDocument();

    send("quanto pago?");
    expect(await screen.findByText("Você paga R$ 42.800.")).toBeInTheDocument();
    expect(screen.getByText("quanto pago?")).toBeInTheDocument();
    expect(screen.getByTestId("widget-kpi")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ workspaceId: "ws1", message: "quanto pago?" });
  });

  it("offers confirm/cancel for pending confirmations and sends the approval key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "Confirma?", pendingConfirmations: [{ tool: "dashboard_remove_widget", key: "k1", summary: "Remover bloco kpi" }], dashboard: sampleDashboard }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "Removido.", pendingConfirmations: [], dashboard: { ...sampleDashboard, widgets: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    send("tira o kpi");
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Removido.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ approve: ["k1"] });
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
  });

  it("cancelling sends no approval", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "Confirma?", pendingConfirmations: [{ tool: "t", key: "k1", summary: "s" }], dashboard: sampleDashboard }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "Ok, cancelado.", pendingConfirmations: [], dashboard: sampleDashboard }) });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    send("tira");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).approve).toBeUndefined();
  });

  it("shows a friendly error when the AI is unavailable", async () => {
    vi.stubGlobal("fetch", reply({ error: "IA indisponível: configure OPENAI_API_KEY" }, false));
    setup();
    send("oi");
    expect(await screen.findByRole("alert")).toHaveTextContent(/indisponível/i);
  });
});
