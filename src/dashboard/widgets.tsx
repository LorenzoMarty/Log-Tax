import { Icon } from "@/ui/log";
import { csvFileName, widgetCsv } from "./csv";
import type { Point, Widget } from "./types";

export const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

const compactBrl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Barras do design system Log: topo arredondado de 4px, até 28px de largura, grade em `chart-grid`, série `chart-1`. */
function BarChart({ data, label }: { data: Point[]; label: string }) {
  const W = 420, H = 170, padL = 40, padB = 20, padT = 6;
  const max = Math.max(...data.map((d) => d.value), 1);
  const ih = H - padB - padT, iw = W - padL;
  const y = (v: number) => padT + ih - (v / max) * ih;
  const bw = Math.min(28, (iw / Math.max(data.length, 1)) * 0.5);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${W} ${H}`} width="100%" className="block overflow-visible">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="lg-grid" x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} />
          <text className="lg-axis" x={padL - 6} y={y(max * f) + 4} textAnchor="end">
            {compactBrl(max * f)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = padL + (iw * (i + 0.5)) / data.length, x = cx - bw / 2, top = y(d.value), h = padT + ih - top, r = Math.min(4, h);
        return (
          <g key={d.label}>
            <path className="lg-bar lg-s1" d={`M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${top + h}Z`}>
              <title>{`${d.label}: ${brl(d.value)}`}</title>
            </path>
            <text className="lg-axis" x={cx} y={H - 4} textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
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
      {[4, 20, 36].map((gy) => (
        <line key={gy} className="lg-grid" x1="0" x2="100" y1={gy} y2={gy} vectorEffect="non-scaling-stroke" />
      ))}
      <polyline points={points} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Body({ w }: { w: Widget }) {
  switch (w.kind) {
    case "kpi":
      return (
        <div className="flex flex-col gap-2">
          <p className="lg-stat-value whitespace-nowrap">{w.value}</p>
          {w.caption && <p className="text-sm text-ink-muted">{w.caption}</p>}
        </div>
      );
    case "bar":
      return <BarChart data={w.data} label={w.title} />;
    case "line":
      return <LineChart data={w.data} label={w.title} />;
    case "breakdown": {
      const max = Math.max(...w.items.map((i) => i.amount), 1);
      return (
        <ul className="flex flex-col gap-3">
          {w.items.map((i) => (
            <li key={i.label} className="text-sm">
              <div className="flex justify-between gap-2">
                <span>{i.label}</span>
                <span className="tabular-nums">{brl(i.amount)}</span>
              </div>
              <div className="lg-stat-bar mt-2">
                <span style={{ width: `${(i.amount / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "opportunities":
      return (
        <ul className="flex flex-col gap-3 text-sm">
          {w.items.map((i) => (
            <li key={i.title} className="flex justify-between gap-2">
              <span>{i.title}</span>
              <span className="whitespace-nowrap font-semibold tabular-nums text-brand-ink">{brl(i.monthlySavings)}/mês</span>
            </li>
          ))}
        </ul>
      );
    case "deadlines":
      return (
        <ul className="flex flex-col gap-3 text-sm">
          {w.items.map((i) => (
            <li key={i.label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Icon name="calendar" className="text-ink-muted" />
                {i.label}
              </span>
              <time dateTime={i.date} className="tabular-nums text-ink-muted">
                {new Date(`${i.date}T12:00:00`).toLocaleDateString("pt-BR")}
              </time>
            </li>
          ))}
        </ul>
      );
    case "compare":
      return (
        <div className="text-sm">
          <div className="overflow-x-auto" role="region" aria-label={`${w.title} (tabela, role para o lado)`} tabIndex={0}>
          <table className="lg-table">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col" className="!text-right">{w.labels?.[0] ?? "Hoje"}</th>
                <th scope="col" className="!text-right">{w.labels?.[1] ?? "Potencial"}</th>
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td className="lg-num">{r.today}</td>
                  <td className="lg-num">{r.potential}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {w.summary && <p className="mt-3 font-semibold text-brand-ink">{w.summary}</p>}
        </div>
      );
    case "checklist":
      return (
        <ul className="flex flex-col gap-2 text-sm">
          {w.items.map((i) => (
            <li key={i.label} className="flex items-center gap-2">
              <span className={i.done ? "text-brand-ink" : "text-ink-subtle"}>
                <Icon name={i.done ? "checks" : "more"} />
              </span>
              <span className={i.done ? "text-ink-muted line-through" : ""}>{i.label}</span>
              <span className="sr-only">{i.done ? " (feito)" : " (pendente)"}</span>
            </li>
          ))}
        </ul>
      );
    case "text":
      return <p className="text-sm">{w.body}</p>;
  }
}

/** "Baixar CSV": a plain link with the file inline, so it works in server-rendered and shared views without JS (#132). */
function CsvLink({ widget }: { widget: Widget }) {
  const csv = widgetCsv(widget);
  if (!csv) return null;
  return (
    <a
      href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
      download={csvFileName(widget.title)}
      aria-label={`Baixar CSV de ${widget.title}`}
      className="mt-3 inline-block text-xs font-medium text-ink-muted underline print:hidden"
    >
      Baixar CSV
    </a>
  );
}

export function WidgetView({ widget, showDisclaimer, compact = false }: { widget: Widget; showDisclaimer: boolean; compact?: boolean }) {
  return (
    <section data-testid={`widget-${widget.id}`} className="lg-surface-card h-full text-ink" style={compact ? { padding: "var(--space-3)" } : undefined}>
      <h3 className="mb-3 text-[14px] leading-5 font-semibold text-ink">{widget.title}</h3>
      <Body w={widget} />
      {showDisclaimer && <p className="mt-3 text-xs font-medium text-ink-subtle">Estimativa ilustrativa, valide com um contador.</p>}
      <CsvLink widget={widget} />
    </section>
  );
}
