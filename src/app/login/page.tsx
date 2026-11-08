import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Entrar no Log Tax</h1>
      {erro && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          Não foi possível entrar. Peça um novo link.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
