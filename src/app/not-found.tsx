import Link from "next/link";
import { Logo } from "@/ui/log";

export const metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <h1 className="lg-display">Não encontramos essa página</h1>
      <p className="text-ink">O endereço pode ter mudado, ou você não tem acesso a este espaço. Volte para os seus espaços e tente de novo.</p>
      <div>
        <Link href="/workspace" className="lg-btn lg-btn-primary">
          Ir para os meus espaços
        </Link>
      </div>
    </main>
  );
}
