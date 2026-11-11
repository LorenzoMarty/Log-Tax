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
  it("on an empty conversation, a clicked example starts the conversation (#158)", async () => {
    const fetchMock = reply({ text: "Você paga R$ 42.800.", pendingConfirmations: [], dashboard: sampleDashboard });
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatPanel workspaceId="ws1" initialMessages={[]} initialDashboard={{ ...sampleDashboard, widgets: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostre quanto estou pagando de imposto." }));
    expect(await screen.findByText("Você paga R$ 42.800.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).toBe("Mostre quanto estou pagando de imposto.");
    expect(screen.queryByRole("heading", { name: "O que posso pedir?" })).not.toBeInTheDocument();
  });

  it("does not show the examples once the conversation has messages", () => {
    setup();
    expect(screen.queryByRole("heading", { name: "O que posso pedir?" })).not.toBeInTheDocument();
  });

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

  it("turns a report path in the AI's reply into a link", async () => {
    const path = "/workspace/0a1b2c3d-0000-4000-8000-123456789abc/relatorio";
    vi.stubGlobal("fetch", reply({ text: `Gerei o relatório: ${path}. Abra para imprimir.`, pendingConfirmations: [], dashboard: sampleDashboard }));
    setup();
    send("gere o relatório");
    const link = await screen.findByRole("link", { name: "abrir o relatório" });
    expect(link).toHaveAttribute("href", path);
    expect(screen.queryByText(path)).not.toBeInTheDocument();
    expect(screen.getByText(/Abra para imprimir/)).toBeInTheDocument();
  });

  it("does not linkify arbitrary paths or other sites", async () => {
    vi.stubGlobal("fetch", reply({ text: "Veja /workspace/x/relatorio e https://example.com/workspace/0a1b2c3d-0000-4000-8000-123456789abc/relatorio", pendingConfirmations: [], dashboard: sampleDashboard }));
    setup();
    send("oi");
    expect(await screen.findByText(/Veja \/workspace\/x\/relatorio/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "abrir o relatório" })).not.toBeInTheDocument();
  });

  it("shows a friendly error when the AI is unavailable", async () => {
    vi.stubGlobal("fetch", reply({ error: "IA indisponível: configure OPENAI_API_KEY" }, false));
    setup();
    send("oi");
    expect(await screen.findByRole("alert")).toHaveTextContent(/indisponível/i);
  });
});
