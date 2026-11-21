import { expect, test } from "@playwright/test";
import { createAndOpen, login } from "./helpers";

type SpeechLog = { spoken: { text: string; lang: string }[]; cancels: number };

// #188: Playwright cannot hear audio, so a fake speechSynthesis records what would be spoken.
test("an answer is read on demand, 'Parar' cancels, and nothing speaks by itself", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const log = { spoken: [] as { text: string; lang: string }[], cancels: 0 };
    w.__speech = log;
    w.SpeechSynthesisUtterance = class {
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    };
    w.speechSynthesis = {
      speak: (u: { text: string; lang: string }) =>
        log.spoken.push({ text: u.text, lang: u.lang }),
      cancel: () => (log.cancels += 1),
      getVoices: () => [{ lang: "pt-BR" }],
    };
  });
  await login(page, "speak");
  await createAndOpen(page, /Minha Empresa/);
  const read = () =>
    page.evaluate(
      () => (window as unknown as { __speech: SpeechLog }).__speech,
    );
  await page.getByLabel("Mensagem").fill("oi");
  await page.getByRole("button", { name: "Enviar" }).click();
  const listen = page.getByRole("button", { name: "Ouvir resposta" }).first();
  await expect(listen).toBeVisible({ timeout: 30_000 });
  expect((await read()).spoken).toHaveLength(0); // default OFF: does not speak by itself
  await listen.click();
  const spoken = (await read()).spoken;
  expect(spoken).toHaveLength(1);
  expect(spoken[0]!.lang).toBe("pt-BR");
  expect(spoken[0]!.text.length).toBeGreaterThan(0);
  await expect(page.getByText("Lendo a resposta em voz alta.")).toBeAttached();
  const before = (await read()).cancels;
  await page.getByRole("button", { name: "Parar leitura" }).click();
  expect((await read()).cancels).toBeGreaterThan(before);
  await expect(
    page.getByRole("button", { name: "Ouvir resposta" }).first(),
  ).toBeVisible();
});

test("automatic reading is opt-in and remembered", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.SpeechSynthesisUtterance = class {};
    w.speechSynthesis = {
      speak: () => {},
      cancel: () => {},
      getVoices: () => [],
    };
  });
  await login(page, "speak-auto");
  await createAndOpen(page, /Minha Empresa/);
  const toggle = page.getByLabel("Ler respostas automaticamente");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.reload();
  await expect(page.getByLabel("Ler respostas automaticamente")).toBeChecked();
});

test("without speechSynthesis the listen controls are hidden with an explanation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).speechSynthesis;
  });
  await login(page, "speak-off");
  await createAndOpen(page, /Minha Empresa/);
  await expect(page.getByText(/não consegue ler as respostas/)).toBeVisible();
  await expect(page.getByLabel("Ler respostas automaticamente")).toHaveCount(0);
});
