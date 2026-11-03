import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { PublicTools } from "@/components/PublicTools";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-10 flex items-center justify-between">
        <span className="text-xl font-bold text-teal-800">LendLoop</span>
        <Show when="signed-in">
          <Link href="/dashboard" className="btn-primary">Open your dashboard</Link>
        </Show>
      </header>
      <section className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">Borrow what you need. Lend what you don&apos;t.</h1>
        <p className="mt-3 max-w-xl text-stone-600">Neighbours share drills, ladders, tents and more. Request a tool for the dates you need, and the owner approves it.</p>
        <div className="mt-6">
          <Show when="signed-out">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <button className="btn-primary">Sign in to lend or borrow</button>
            </SignInButton>
          </Show>
        </div>
      </section>
      <PublicTools />
    </main>
  );
}
