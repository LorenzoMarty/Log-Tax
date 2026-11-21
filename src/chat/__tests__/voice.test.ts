import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { browserRecognition, useVoiceInput, voiceErrorText, type Recognition } from "../voice";

function fake() {
  const r = {
    lang: "",
    interimResults: false,
    continuous: true,
    onresult: null,
    onerror: null,
    onend: null,
    start: vi.fn(),
    stop: vi.fn(() => r.onend?.()),
  } as unknown as Recognition & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  return r;
}
const say = (r: Recognition, parts: string[]) => r.onresult?.({ results: parts.map((t) => [{ transcript: t }]) });

describe("useVoiceInput", () => {
  it("is unsupported without a factory", () => {
    const { result } = renderHook(() => useVoiceInput(vi.fn()));
    expect(result.current.supported).toBe(false);
    act(() => result.current.start());
    expect(result.current.listening).toBe(false);
  });

  it("starts in pt-BR with interim results, reports transcripts and stops", () => {
    const r = fake();
    const factory = () => r;
    const onText = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onText, factory));
    expect(result.current.supported).toBe(true);
    act(() => result.current.start());
    expect(r.lang).toBe("pt-BR");
    expect(r.interimResults).toBe(true);
    expect(result.current.listening).toBe(true);
    act(() => say(r, ["quanto ", "pago"]));
    expect(onText).toHaveBeenLastCalledWith("quanto pago");
    act(() => say(r, ["quanto pago de imposto"]));
    expect(onText).toHaveBeenLastCalledWith("quanto pago de imposto");
    act(() => result.current.stop());
    expect(r.stop).toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("maps errors to pt-BR messages and ignores a user abort", () => {
    const r = fake();
    const factory = () => r;
    const { result } = renderHook(() => useVoiceInput(vi.fn(), factory));
    act(() => result.current.start());
    act(() => r.onerror?.({ error: "aborted" }));
    expect(result.current.error).toBe("");
    act(() => r.onerror?.({ error: "not-allowed" }));
    expect(result.current.error).toMatch(/bloqueado/);
    expect(voiceErrorText("no-speech")).toMatch(/Não ouvi/);
    expect(voiceErrorText("network")).toMatch(/conexão/);
    expect(voiceErrorText("audio-capture")).toMatch(/microfone/);
    expect(voiceErrorText("x")).toMatch(/Não consegui/);
  });

  it("reports an error when start throws, and can start again after the end", () => {
    const r = fake();
    r.start.mockImplementationOnce(() => {
      throw new Error("InvalidStateError");
    });
    const factory = () => r;
    const { result } = renderHook(() => useVoiceInput(vi.fn(), factory));
    act(() => result.current.start());
    expect(result.current.listening).toBe(false);
    expect(result.current.error).not.toBe("");
    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBe("");
  });
});

describe("browserRecognition", () => {
  it("uses the prefixed constructor when that is all there is", () => {
    expect(browserRecognition()).toBeUndefined();
    vi.stubGlobal("webkitSpeechRecognition", function () {});
    expect(browserRecognition()).toBeTypeOf("function");
    vi.unstubAllGlobals();
  });
});
