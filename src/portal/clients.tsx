"use client";

import { apiGet } from "@/api/client";
import type { components } from "@/api/schema";
import { Badge } from "@/ui/log";
import Link from "next/link";
import { useEffect, useState } from "react";
import { baseOf, specOf } from "@/workspace/kinds";

type Client = components["schemas"]["PortalClient"];

const brDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Pending count text; `null` means the invite does not let the accountant see it. */
const count = (n: number | null, one: string, many: string, none: string) => (n === null ? "não compartilhado" : n === 0 ? none : `${n} ${n === 1 ? one : many}`);

export function PortalClients() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    apiGet("/v1/portal/clients")
      .then(setClients)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p role="alert" className="text-sm text-danger-ink">Não foi possível carregar seus clientes. Tente de novo em instantes.</p>;
  if (!clients) return <p role="status" className="text-sm text-ink-muted">Carregando clientes...</p>;
  if (clients.length === 0) return <p className="text-sm text-ink-muted">Você ainda não foi convidada(o) para o espaço de nenhum cliente.</p>;

  const shown = clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Buscar cliente
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="rounded-[var(--radius-md)] border border-line px-3 py-2" />
      </label>
      <ul aria-label="Clientes" className="flex flex-col gap-3">
        {shown.map((c) => (
          <li key={c.workspaceId} data-testid="portal-client" className="lg-surface-card flex flex-col gap-2">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/workspace/${c.workspaceId}`} className="font-semibold text-ink underline">
                {c.name}
              </Link>
              <Badge tone={baseOf(c.kind) === "empresa" ? "info" : "brand"}>{specOf(c.kind).label}</Badge>
            </span>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-ink-muted">Avisos: </dt>
                <dd className="inline">{count(c.unreadNotices, "não lido", "não lidos", "nenhum pendente")}</dd>
              </div>
              <div>
                <dt className="inline text-ink-muted">Documentos: </dt>
                <dd className="inline">{count(c.missingDocuments, "faltando", "faltando", "em dia")}</dd>
              </div>
              <div>
                <dt className="inline text-ink-muted">Próximo vencimento: </dt>
                <dd className="inline">{c.nextDeadline ? `${c.nextDeadline.label}, ${brDate(c.nextDeadline.date)}` : "—"}</dd>
              </div>
              <div>
                <dt className="inline text-ink-muted">Última validação: </dt>
                <dd className="inline">{c.lastValidationAt ? brDate(c.lastValidationAt) : "—"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
