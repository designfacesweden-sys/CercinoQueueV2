"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { submitSecretCode, type GateState } from "./actions";

const initial: GateState = { error: null };

function SecretCodeForm() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const safeNext =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

  const [state, formAction, pending] = useActionState(submitSecretCode, initial);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 py-12">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <input type="hidden" name="next" value={safeNext} />
        <h1 className="text-center text-xl font-semibold text-zinc-900 dark:text-zinc-50">Secret Code</h1>
        <input
          name="code"
          type="password"
          required
          autoComplete="off"
          placeholder="Enter code"
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {state.error ? <p className="text-center text-sm text-red-600">{state.error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-violet-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "…" : "Enter"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full flex-1 items-center justify-center text-sm text-zinc-500">Loading…</div>
      }
    >
      <SecretCodeForm />
    </Suspense>
  );
}
