"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** The slice of the browser's SpeechRecognition that we use (not in lib.dom). */
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export type RecognitionFactory = () => Recognition;

/** Chrome/Android and Safari/iOS expose it (the latter prefixed); Firefox does not. */
export function browserRecognition(): RecognitionFactory | undefined {
  const w = (typeof window === "undefined" ? {} : window) as unknown as Record<string, (new () => Recognition) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? () => new Ctor() : undefined;
}

const BLOCKED = "O microfone está bloqueado. Libere o acesso nas configurações do navegador e tente de novo.";
const ERRORS: Record<string, string> = {
  "not-allowed": BLOCKED,
  "service-not-allowed": BLOCKED,
  "no-speech": "Não ouvi nada. Toque em Falar e tente de novo.",
  "audio-capture": "Não encontrei um microfone neste aparelho.",
  network: "Sem conexão para reconhecer a voz. Verifique a internet ou digite a mensagem.",
};
export const voiceErrorText = (code: string) => ERRORS[code] ?? "Não consegui reconhecer sua voz. Tente de novo ou digite a mensagem.";

/**
 * Voice dictation (#187). `onTranscript(text)` receives everything said in this session (final + interim) so the caller
 * can put it in the input for review; nothing is ever sent from here. No audio is stored by us.
 */
export function useVoiceInput(onTranscript: (text: string) => void, factory?: RecognitionFactory) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const make = useRef<RecognitionFactory | undefined>(undefined);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onTranscript);
  cb.current = onTranscript;

  // Detected after mount so server and first client render agree.
  useEffect(() => {
    make.current = factory ?? browserRecognition();
    setSupported(!!make.current);
    return () => rec.current?.stop();
  }, [factory]);

  const start = useCallback(() => {
    if (!make.current || rec.current) return;
    setError("");
    const r = make.current();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => cb.current(Array.from(e.results, (res) => res[0]?.transcript ?? "").join("").trim());
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(voiceErrorText(e.error));
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError(voiceErrorText(""));
    }
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);
  return { supported, listening, error, start, stop };
}
