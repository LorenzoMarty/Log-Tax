import type { Point, Widget } from "./types";

export const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

function BarChart({ data, label }: { data: Point[]; label: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div role="img" aria-label={label} className="flex h-32 items-end gap-1">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-t bg-current opacity-70" style={{ height: `${(d.value / max) * 100}%` }} title={`${d.label}: ${brl(d.value)}`} />
          <span className="text-[10px] opacity-60">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data, label }: { data: Point[]; label: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value));
  const span = Math.max(max - min, 1);
  const step = data.length > 1 ? 100 / (data.length - 1) : 0;
  const points = data.map((d, i) => `${i * step},${36 - ((d.value - min) / span) * 32}`).join(" ");
  return (
    <svg role="img" aria-label={label} viewBox="0 0 100 40" preserveAspectRatio="none" className="h-32 w-full">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Body({ w }: { w: Widget }) {
  switch (w.kind) {
    case "kpi":
      return (
        <div>
          <p className="whitespace-nowrap text-2xl font-semibold tracking-tight sm:text-3xl">{w.value}</p>
          {w.caption && <p className="text-sm opacity-70">{w.caption}</p>}
        </div>
      );
    case "bar":
      return <BarChart data={w.data} label={w.title} />;
    case "line":
      return <LineChart data={w.data} label={w.title} />;
    case "breakdown": {
      const max = Math.max(...w.items.map((i) => i.amount), 1);
      return (
        <ul className="space-y-2">
          {w.items.map((i) => (
            <li key={i.label} className="text-sm">
              <div className="flex justify-between">
                <span>{i.label}</span>
                <span>{brl(i.amount)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-current opacity-20">
                <div className="h-full rounded bg-current" style={{ width: `${(i.amount / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "opportunities":
      return (
        <ul className="space-y-2 text-sm">
          {w.items.map((i) => (
            <li key={i.title} className="flex justify-between gap-2">
              <span>{i.title}</span>
              <span className="whitespace-nowrap font-medium">{brl(i.monthlySavings)}/mês</span>
            </li>
          ))}
        </ul>
      );
    case "deadlines":
      return (
        <ul className="space-y-2 text-sm">
          {w.items.map((i) => (
            <li key={i.label} className="flex justify-between gap-2">
              <span>{i.label}</span>
              <time dateTime={i.date}>{new Date(`${i.date}T12:00:00`).toLocaleDateString("pt-BR")}</time>
            </li>
          ))}
        </ul>
      );
    case "compare":
      return (
        <div className="text-sm">
          <div className="grid grid-cols-3 gap-2 font-medium opacity-70">
            <span />
            <span>{w.labels?.[0] ?? "Hoje"}</span>
            <span>{w.labels?.[1] ?? "Potencial"}</span>
          </div>
          {w.rows.map((r) => (
            <div key={r.label} className="grid grid-cols-3 gap-2 py-1">
              <span>{r.label}</span>
              <span>{r.today}</span>
              <span>{r.potential}</span>
            </div>
          ))}
          {w.summary && <p className="mt-2 font-semibold">{w.summary}</p>}
        </div>
      );
    case "checklist":
      return (
        <ul className="space-y-1 text-sm">
          {w.items.map((i) => (
            <li key={i.label}>
              <span aria-hidden>{i.done ? "☑" : "☐"}</span> <span className={i.done ? "line-through opacity-60" : ""}>{i.label}</span>
              <span className="sr-only">{i.done ? " (feito)" : " (pendente)"}</span>
            </li>
          ))}
        </ul>
      );
    case "text":
      return <p className="text-sm">{w.body}</p>;
  }
}

export function WidgetView({ widget, showDisclaimer }: { widget: Widget; showDisclaimer: boolean }) {
  return (
    <section data-testid={`widget-${widget.id}`} className="rounded-2xl border border-current/15 p-4">
      <h3 className="mb-3 text-sm font-medium opacity-70">{widget.title}</h3>
      <Body w={widget} />
      {showDisclaimer && <p className="mt-3 text-[11px] opacity-60">Estimativa ilustrativa, valide com um contador.</p>}
    </section>
  );
}
