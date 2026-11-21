import { useId } from "react";
import { supportContact } from "@/lib/support";

/** Requests a first-time user can make, taken from PRD §8 ("Comandos naturais"), #158. */
export const REQUEST_EXAMPLES = [
  "Mostre quanto estou pagando de imposto.",
  "Crie um painel para minha empresa.",
  "Me avise se meus impostos passarem de R$ 20 mil.",
  "Quero uma visão mais simples.",
  "Faça um relatório disso.",
] as const;

/**
 * A titled list of requests that start (or continue) the conversation when clicked. Defaults to the
 * empty-conversation help "O que posso pedir?" (#158); the follow-up suggestions reuse it (#119).
 * Example: `<RequestExamples disabled={busy} onPick={(text) => send(text)} />`.
 */
export function RequestExamples({
  onPick,
  disabled,
  title = "O que posso pedir?",
  prompts = REQUEST_EXAMPLES,
  showContact = false,
  contactEmail,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
  title?: string;
  prompts?: readonly string[];
  /** Adds the support channel under the list (the empty-conversation help); it shows only when an address is configured (#158). */
  showContact?: boolean;
  contactEmail?: string;
}) {
  const titleId = useId();
  const contact = showContact ? supportContact(contactEmail ?? process.env.NEXT_PUBLIC_SUPPORT_EMAIL) : null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {prompts.map((text) => (
          <li key={text}>
            <button type="button" disabled={disabled} onClick={() => onPick(text)} className="lg-btn lg-btn-soft lg-btn-sm w-full justify-start text-left">
              {text}
            </button>
          </li>
        ))}
      </ul>
      {contact && (
        <p className="text-xs text-ink-muted">
          Precisa de ajuda de uma pessoa?{" "}
          <a href={contact.href} className="underline">
            Fale com o suporte
          </a>
          .
        </p>
      )}
    </section>
  );
}
