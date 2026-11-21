"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void> };

/** Registers the service worker (production only) and offers an "Instalar app" button when the browser allows it. */
export function Pwa() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // The event only fires when the app is installable and not installed yet, so no event means the button stays hidden.
  if (!installEvent) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void installEvent.prompt();
        setInstallEvent(null);
      }}
      className="fixed bottom-4 right-4 z-50 rounded-lg bg-inverse px-4 py-2 text-sm font-semibold text-on-inverse shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      Instalar app
    </button>
  );
}
