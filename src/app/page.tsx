import { Button, Input, Logo } from "@/ui/log";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <h1 className="lg-display">O que você precisa resolver?</h1>
      <form className="flex gap-3" aria-label="Conversa com a IA">
        <Input aria-label="Mensagem" icon="search" placeholder="Quero entender meus impostos..." className="flex-1" />
        <Button variant="primary" icon="send">
          Enviar
        </Button>
      </form>
      <p className="text-sm text-ink-muted">Log Tax mostra estimativas ilustrativas. Valide qualquer decisão com um contador.</p>
    </main>
  );
}
