/** Requests a first-time user can make, taken from PRD §8 ("Comandos naturais"), #158. */
export const REQUEST_EXAMPLES = [
  "Mostre quanto estou pagando de imposto.",
  "Crie um painel para minha empresa.",
  "Me avise se meus impostos passarem de R$ 20 mil.",
  "Quero uma visão mais simples.",
  "Faça um relatório disso.",
] as const;

/**
 * Empty-conversation help: "O que posso pedir?" with examples that start the conversation when clicked.
 * Example: `<RequestExamples disabled={busy} onPick={(text) => send(text)} />`.
 */
export function RequestExamples({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <section aria-labelledby="request-examples-title" className="flex flex-col gap-2">
      <h3 id="request-examples-title" className="text-sm font-semibold text-ink">
        O que posso pedir?
      </h3>
      <ul className="flex flex-col gap-2">
        {REQUEST_EXAMPLES.map((text) => (
          <li key={text}>
            <button type="button" disabled={disabled} onClick={() => onPick(text)} className="lg-btn lg-btn-soft lg-btn-sm w-full justify-start text-left">
              {text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
