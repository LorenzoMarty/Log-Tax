import type { Agent } from "@/chat/types";

/** Switcher between the general assistant and the user's specialised agents. Hidden until one exists. */
export function AgentList({ workspaceId, agents, currentAgentId }: { workspaceId: string; agents: Agent[]; currentAgentId?: string }) {
  if (agents.length === 0) return null;
  const base = `/workspace/${workspaceId}`;
  const item = (key: string, href: string, title: string, lines: string[], current: boolean) => (
    <li key={key}>
      <a
        href={href}
        aria-current={current ? "page" : undefined}
        className={`block rounded-2xl border px-3 py-2 text-sm ${current ? "border-transparent bg-inverse text-on-inverse" : "border-line hover:border-ink-muted"}`}
      >
        <span className="block font-medium">{title}</span>
        {lines.map((l) => (
          <span key={l} className={`block text-xs ${current ? "text-on-inverse" : "text-ink-muted"}`}>
            {l}
          </span>
        ))}
      </a>
    </li>
  );
  return (
    <nav aria-label="Minhas IAs">
      <ul className="flex flex-wrap gap-2">
        {item("geral", base, "Assistente geral", ["Conversa com todo o espaço"], !currentAgentId)}
        {agents.map((a) =>
          item(a.id, `${base}?ia=${a.id}`, a.name, [a.objective, a.tools.length ? `${a.tools.length} ferramentas` : "sem ferramentas"], a.id === currentAgentId),
        )}
      </ul>
    </nav>
  );
}
