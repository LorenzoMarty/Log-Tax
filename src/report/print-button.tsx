"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-neutral-900 px-4 py-2 text-white">
      Imprimir
    </button>
  );
}
