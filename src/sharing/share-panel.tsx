import { changeMemberRole, removeMember, revokeInvite, inviteMember } from "./actions";
import { ROLE_LABEL } from "./schema";
import { TransferOwnership } from "./transfer-ownership";

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

const ASSIGNABLE = ["admin", "editor", "commenter", "reader"] as const;
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
            <option value="editor">Edição</option>
            <option value="admin">Administração</option>
          </select>
        </label>
        <button type="submit" className="rounded-xl bg-inverse px-4 py-2 text-on-inverse">
          Convidar
        </button>
      </form>
      <p className="mt-2 text-xs text-ink-muted">
        Leitura: vê painel, alertas e IAs. Comentário: também comenta. Edição: também edita o painel. Administração: quase tudo que o dono faz, menos transferir, apagar ou renomear o espaço e ver a sua conversa com a IA. Ninguém além de você conversa com a IA nem vê o seu histórico de conversa.
      </p>

      <ul aria-label="Quem tem acesso" className="mt-3 space-y-1">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">
              {m.email ?? "(sem email)"} — {ROLE_LABEL[m.role]}
            </span>
            {m.role !== "owner" && (
              <div className="flex flex-wrap items-center gap-2">
                <form action={changeMemberRole.bind(null, workspaceId, m.user_id)} className="flex items-center gap-1">
                  <select name="role" defaultValue={m.role} aria-label={`Papel de ${m.email ?? m.user_id}`} className="rounded-lg border border-line px-2 py-1 text-xs">
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" aria-label={`Salvar papel de ${m.email ?? m.user_id}`} className={small}>
                    Salvar papel
                  </button>
                </form>
                <form action={removeMember.bind(null, workspaceId, m.user_id)}>
                  <button type="submit" className={small}>
                    Remover acesso
                  </button>
                </form>
                <TransferOwnership workspaceId={workspaceId} userId={m.user_id} email={m.email ?? m.user_id} />
              </div>
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
