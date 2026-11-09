// Gera src/styles/log-tokens.css a partir do tokens.json exportado do design system "Log".
// Uso: node scripts/gen-log-tokens.mjs src/styles/log-tokens.json src/styles/log-tokens.css
import fs from "node:fs";
const [src, out] = process.argv.slice(2);
const t = JSON.parse(fs.readFileSync(src, "utf8"));
const themed = [...t.color.tokens, ...t.shadow.tokens];
const flat = [
  ...t.spacing.tokens, ...t.radius.tokens, ...t.gradient.tokens,
];
const decl = (theme) => themed.map((x) => `  --${x.name}: ${typeof x.value === "string" ? x.value : x.value[theme] ?? x.value.light};`).join("\n");
const css = `/* Log — gerado de log-tokens.json (design system "Log"). Não edite à mão. */
:root {
  --font-sans: var(--font-inter), ${t.type.families.sans};
${flat.map((x) => `  --${x.name}: ${x.value};`).join("\n")}
}

:root,
[data-theme="light"] {
  color-scheme: light;
${decl("light")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${decl("dark").replace(/^/gm, "  ")}
  }
}

[data-theme="dark"] {
  color-scheme: dark;
${decl("dark")}
}
`;
fs.writeFileSync(out, css);
