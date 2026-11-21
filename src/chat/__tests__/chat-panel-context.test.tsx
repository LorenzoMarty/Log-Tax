import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleDashboard } from "@/dashboard/fixtures";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CHAT_API = "fastapi"; // the Python API is the one that reads the clicked block (#118)
});
vi.mock("../actions", () => ({ clearConversation: vi.fn(), rateAnswer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChatPanel } from "../chat-panel";

// The version history also fetches on this backend: only the chat call answers with a reply.
const reply = () =>
  vi.fn(async (url: string, init?: { body?: string }) => ({ ok: true, headers: new Headers(), body: init?.body, json: async () => (url === "/api/v1/chat" ? { text: "ok", pendingConfirmations: [], dashboard: sampleDashboard } : { versions: [] }) }));
const chatBody = (m: ReturnType<typeof reply>) => JSON.parse(m.mock.calls.find((c) => c[0] === "/api/v1/chat")![1]!.body ?? "");
afterEach(() => vi.unstubAllGlobals());

describe("ChatPanel asking about a block or a line (#118)", () => {
  it("sends only the ids, never the block data, and keeps the question as the message", async () => {
    const fetchMock = reply();
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatPanel workspaceId="ws1" initialMessages={[]} initialDashboard={sampleDashboard} />);
    const ask = screen.getByRole("button", { name: "Perguntar sobre esta linha: ICMS" });
    ask.focus();
    expect(ask).toHaveFocus();
    fireEvent.click(ask); // Enter or Space on a focused button fires this same click
    expect(screen.getByRole("status")).toHaveTextContent("ICMS (Para onde está indo?)");
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "por quê?" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/chat", expect.anything()));
    const body = chatBody(fetchMock);
    expect(body.message).toBe("por quê?");
    expect(body.context).toEqual({ blockId: "breakdown", row: "ICMS" });
    expect(await screen.findByText('Sobre "ICMS" em "Para onde está indo?": por quê?')).toBeInTheDocument();
  });

  it("asking about the whole block sends no line", async () => {
    const fetchMock = reply();
    vi.stubGlobal("fetch", fetchMock);
    render(<ChatPanel workspaceId="ws1" initialMessages={[]} initialDashboard={sampleDashboard} />);
    fireEvent.click(screen.getByRole("button", { name: "Perguntar sobre isto: Para onde está indo?" }));
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "explique" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/chat", expect.anything()));
    expect(chatBody(fetchMock).context).toEqual({ blockId: "breakdown" });
  });
});
