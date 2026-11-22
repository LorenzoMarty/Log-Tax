"use client";

import { useEffect, useId, useRef, useState } from "react";
import { transferOwnership } from "./actions";

/** Owner-only. Not undoable on your own, so it takes an explicit confirmation that spells out what changes. */
export function TransferOwnership({ workspaceId, userId, email }: { workspaceId: string; userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const id = useId();

  useEffect(() => {
    if (open) cancel.current?.focus(); // the safe choice has the focus
    else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label={`Transferir propriedade para ${email}`} className="rounded-lg border border-line px-2 py-1 text-xs">
        Transferir propriedade
      </button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      className="w-full rounded-xl bg-danger-tint p-3 text-sm text-danger-ink"
    >
      <p id={`${id}-t`} className="font-medium">
        Transferir a propriedade para {email}?
      </p>
      <p id={`${id}-d`} className="mt-1">
        {email} passa a ser o dono deste espaço. Você vira administrador. O histórico da sua conversa com a IA passa para {email}, e você deixa de vê-lo. Só o novo dono pode
        desfazer isto, transferindo de volta.
      </p>
      <form action={transferOwnership.bind(null, workspaceId)} className="mt-2 flex flex-wrap gap-2">
        <input type="hidden" name="newOwnerId" value={userId} />
        <button type="submit" className="rounded-lg bg-inverse px-3 py-1.5 text-on-inverse">
          Sim, transferir a propriedade
        </button>
        <button ref={cancel} type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-1.5">
          Cancelar
        </button>
      </form>
    </div>
  );
}
