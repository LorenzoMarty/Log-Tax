"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The slice of the browser's SpeechSynthesis that we use (#188). Everything runs in the browser: no audio or text is sent to us. */
export interface Utterance {
  text: string;
  lang: string;
  rate: number;
  volume: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
export interface Synthesis {
  speak(u: Utterance): void;
  cancel(): void;
  getVoices(): { lang: string }[];
}
export type SynthesisFactory = () => {
  synth: Synthesis;
  Utterance: new (text: string) => Utterance;
};

export function browserSynthesis(): SynthesisFactory | undefined {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  )
    return undefined;
  return () => ({
    synth: window.speechSynthesis as unknown as Synthesis,
    Utterance: SpeechSynthesisUtterance as unknown as new (
      text: string,
    ) => Utterance,
  });
}

/** Prefers a pt-BR voice, then any Portuguese one; undefined lets the browser pick from `lang`. */
export function pickVoice<T extends { lang: string }>(
  voices: T[],
): T | undefined {
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  return (
    voices.find((v) => norm(v.lang) === "pt-br") ??
    voices.find((v) => norm(v.lang).startsWith("pt"))
  );
}

/** Turns an answer (markdown, links, wrapped external data) into plain text that sounds right when read aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/<\/?\s*dados_externos[^>]*>/gi, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\/workspace\/[0-9a-f-]{36}(?:\/relatorio)?/gi, "link do espaço")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads an answer aloud, one at a time. `id` tells which message is speaking so its button can turn into "Parar". */
export function useSpeech(factory?: SynthesisFactory) {
  const [supported, setSupported] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const api = useRef<ReturnType<SynthesisFactory> | undefined>(undefined);
  const token = useRef(0); // ignores end/error events of an utterance that was replaced or cancelled

  const stop = useCallback(() => {
    token.current += 1;
    api.current?.synth.cancel();
    setSpeakingId(null);
  }, []);

  // Detected after mount so server and first client render agree.
  useEffect(() => {
    const make = factory ?? browserSynthesis();
    api.current = make?.();
    setSupported(!!api.current);
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop(); // leaving the screen silences it
    };
  }, [factory, stop]);

  const speak = useCallback((id: number, text: string) => {
    const a = api.current;
    const clean = cleanForSpeech(text);
    if (!a || !clean) return;
    a.synth.cancel();
    const mine = ++token.current;
    const u = new a.Utterance(clean);
    u.lang = "pt-BR";
    u.rate = 1;
    u.volume = 1;
    u.voice = pickVoice(a.synth.getVoices()) ?? null;
    const done = () => {
      if (token.current === mine) setSpeakingId(null);
    };
    u.onend = done;
    u.onerror = done;
    setSpeakingId(id);
    a.synth.speak(u);
  }, []);

  return { supported, speakingId, speak, stop };
}
