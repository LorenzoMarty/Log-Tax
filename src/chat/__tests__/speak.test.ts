import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  browserSynthesis,
  cleanForSpeech,
  pickVoice,
  useSpeech,
  type Utterance,
} from "../speak";

function fake(voices: { lang: string }[] = []) {
  const spoken: Utterance[] = [];
  const synth = {
    speak: vi.fn((u: Utterance) => spoken.push(u)),
    cancel: vi.fn(),
    getVoices: () => voices,
  };
  class U {
    lang = "";
    rate = 0;
    volume = 0;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  return { synth, spoken, factory: () => ({ synth, Utterance: U }) };
}

describe("useSpeech", () => {
  it("is unsupported without a factory and speaking does nothing", () => {
    const { result } = renderHook(() => useSpeech());
    expect(result.current.supported).toBe(false);
    act(() => result.current.speak(1, "oi"));
    expect(result.current.speakingId).toBeNull();
  });

  it("speaks cleaned text in pt-BR with the pt-BR voice and clears when it ends", () => {
    const br = { lang: "pt-BR" };
    const f = fake([{ lang: "en-US" }, { lang: "pt-PT" }, br]);
    const { result } = renderHook(() => useSpeech(f.factory));
    expect(result.current.supported).toBe(true);
    act(() => result.current.speak(3, "**Olá** [site](https://x.com)"));
    const u = f.spoken[0]!;
    expect(u.text).toBe("Olá site");
    expect(u.lang).toBe("pt-BR");
    expect(u.voice).toBe(br);
    expect(u.rate).toBe(1);
    expect(result.current.speakingId).toBe(3);
    act(() => u.onend?.());
    expect(result.current.speakingId).toBeNull();
  });

  it("stop cancels, and a late end event of the old utterance does not clear the new one", () => {
    const f = fake();
    const { result } = renderHook(() => useSpeech(f.factory));
    act(() => result.current.speak(1, "primeira"));
    act(() => result.current.speak(2, "segunda"));
    expect(f.synth.cancel).toHaveBeenCalledTimes(2);
    act(() => f.spoken[0]!.onend?.());
    expect(result.current.speakingId).toBe(2);
    act(() => result.current.stop());
    expect(f.synth.cancel).toHaveBeenCalledTimes(3);
    expect(result.current.speakingId).toBeNull();
  });

  it("cancels on unmount and skips empty text", () => {
    const f = fake();
    const { result, unmount } = renderHook(() => useSpeech(f.factory));
    act(() =>
      result.current.speak(1, '<dados_externos fonte="x"></dados_externos>'),
    );
    expect(f.synth.speak).not.toHaveBeenCalled();
    unmount();
    expect(f.synth.cancel).toHaveBeenCalled();
  });
});

describe("pickVoice / cleanForSpeech / browserSynthesis", () => {
  it("prefers pt-BR, then any pt, else nothing", () => {
    expect(pickVoice([{ lang: "pt_PT" }, { lang: "pt_BR" }])).toEqual({
      lang: "pt_BR",
    });
    expect(pickVoice([{ lang: "en-US" }, { lang: "pt-PT" }])).toEqual({
      lang: "pt-PT",
    });
    expect(pickVoice([{ lang: "en-US" }])).toBeUndefined();
  });

  it("strips markdown, wrappers, links and report paths", () => {
    expect(cleanForSpeech("# Título\n- item **um**\n- item `dois`")).toBe(
      "Título item um item dois",
    );
    expect(
      cleanForSpeech('<dados_externos fonte="doc.pdf">texto</dados_externos>'),
    ).toBe("texto");
    expect(
      cleanForSpeech(
        "veja https://a.com/x e /workspace/123e4567-e89b-12d3-a456-426614174000/relatorio",
      ),
    ).toBe("veja link e link do espaço");
    expect(cleanForSpeech("Pague R$ 1.234,56")).toBe("Pague R$ 1.234,56");
  });

  it("is undefined when the browser has no speechSynthesis", () => {
    expect(browserSynthesis()).toBeUndefined();
  });
});
