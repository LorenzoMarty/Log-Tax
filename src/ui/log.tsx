// Componentes do design system "Log", portados do bundle para React tipado.
// Estilos em src/styles/log.css (classes lg-*); valores em src/styles/log-tokens.css.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const PATHS = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  plus: "M12 5v14M5 12h14",
  share: "M12 15V4M8 8l4-4 4 4M5 13v6h14v-6",
  calendar: "M5 6h14v14H5zM5 10h14M9 3v4M15 3v4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  checks: "M2.5 12.5l4.5 4.5 9-9.5M10 16l1 1 9-9.5",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  moon: "M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z",
  file: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  chart: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4z",
  alert: "M12 4l9 16H3zM12 10v4M12 17.5h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={cx("lg-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "inverse" | "soft" | "ghost";
  size?: "md" | "sm";
  icon?: IconName;
};

export function Button({ variant = "soft", size = "md", icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest} className={cx("lg-btn", `lg-btn-${variant}`, size === "sm" && "lg-btn-sm", className)}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: string; icon?: IconName; hint?: string; error?: string };

/** Campo afundado. Com `label`, passe também `id`. */
export function Input({ label, icon, hint, error, className, ...rest }: InputProps) {
  return (
    <div className={cx("lg-field", error && "lg-field-error", className)}>
      {label && (
        <label className="lg-field-label" htmlFor={rest.id}>
          {label}
        </label>
      )}
      <div className="lg-input">
        {icon && <Icon name={icon} />}
        <input {...rest} />
      </div>
      {(error || hint) && <div className="lg-field-hint">{error || hint}</div>}
    </div>
  );
}

export type Tone = "neutral" | "brand" | "info" | "warning" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("lg-badge", `lg-badge-${tone}`)}>{children}</span>;
}

export function Panel(props: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={props.label} className={cx("lg-panel", props.className)}>
      {(props.title || props.actions) && (
        <header className="lg-panel-head">
          {props.title ? <h2 className="lg-panel-title">{props.title}</h2> : <span />}
          {props.actions && <div className="lg-panel-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

/** Logotipo Log: símbolo em degradê + "og" em `ink`, que acompanha o tema. */
export function Logo({ height = 32, symbolOnly = false, className }: { height?: number; symbolOnly?: boolean; className?: string }) {
  const vb = symbolOnly ? "0 0 125 145" : "-10 -10 390 210";
  const [, , w, h] = vb.split(" ").map(Number);
  return (
    <svg role="img" aria-label="Log" viewBox={vb} height={height} width={(height * w) / h} className={className}>
      <defs>
        <linearGradient id="log-g" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#5EE6B5" />
          <stop offset="1" stopColor="#1FBF8A" />
        </linearGradient>
      </defs>
      <path d="M0 40 L45 0 L45 105 L125 105 L85 145 L6 145 Q0 145 0 139 Z" fill="url(#log-g)" />
      <path d="M58 105 L125 105 L85 145 L18 145 Z" fill="#9AF0D0" opacity="0.55" />
      {!symbolOnly && (
        <text x="128" y="145" fontFamily="var(--font-sans)" fontWeight="600" fontSize="186" letterSpacing="-6" fill="var(--ink)">
          og
        </text>
      )}
    </svg>
  );
}
