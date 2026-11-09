import { removeMember, revokeInvite, inviteMember } from "./actions";
import { ROLE_LABEL } from "./schema";

export interface MemberRow {
  user_id: string;
  email: string | null;
  role: keyof typeof ROLE_LABEL;
}
export interface InviteRow {
  id: string;
  email: string;
  role: keyof typeof ROLE_LABEL;
}

const small = "rounded-lg border border-line px-2 py-1 text-xs";

/** Owner-only: who has access to this workspace, and how to give or take it away. */
export function SharePanel({ workspaceId, members, invites, defaultOpen = false }: { workspaceId: string; members: MemberRow[]; invites: InviteRow[]; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-3xl border border-line p-4 text-sm">
      <summary className="cursor-pointer font-medium">Compartilhar este espaço ({members.length - 1 + invites.length})</summary>
      <form action={inviteMember.bind(null, workspaceId)} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          Email de quem vai receber o acesso
          <input name="email" type="email" required autoComplete="off" className="rounded-xl border border-line px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          Papel
          <select name="role" defaultValue="reader" className="rounded-xl border border-line px-3 py-2">
            <option value="reader">Leitura</option>
            <option value="commenter">Comentário</option>
          </select>
        </label>
        <button type="submit" className="rounded-xl bg-inverse px-4 py-2 text-on-inverse">
          Convidar
        </button>
      </form>
      <p className="mt-2 text-xs text-ink-muted">
        Leitura: vê painel, alertas e IAs. Comentário: também comenta. Ninguém além de você conversa com a IA nem vê o seu histórico de conversa.
      </p>

      <ul aria-label="Quem tem acesso" className="mt-3 space-y-1">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between gap-2">
            <span>
              {m.email ?? "(sem email)"} — {ROLE_LABEL[m.role]}
            </span>
            {m.role !== "owner" && (
              <form action={removeMember.bind(null, workspaceId, m.user_id)}>
                <button type="submit" className={small}>
                  Remover acesso
                </button>
              </form>
            )}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 text-ink-muted">
            <span>
              {i.email} — {ROLE_LABEL[i.role]} (convite pendente)
            </span>
            <form action={revokeInvite.bind(null, workspaceId, i.id)}>
              <button type="submit" className={small}>
                Cancelar convite
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
