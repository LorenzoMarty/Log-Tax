"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-inverse px-4 py-2 text-on-inverse">
      Imprimir
    </button>
  );
}
