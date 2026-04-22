"use client";

import { isFirebaseConfigured } from "@/lib/firebase";
import {
  guessAmountColumnIndex,
  guessNameColumnIndex,
  guessTotalProductsColumnIndex,
  parseCsvMatrix,
  previewWooCommerceOrdersCsv,
  validImportRows,
  type ImportPreviewRow,
} from "@/lib/csv-guest-import";
import { getDb } from "@/lib/firestore";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = { eventId: string };

type EventOption = { id: string; name: string };

export function SettingsCsvImport({ eventId }: Props) {
  const router = useRouter();
  const [importTargetId, setImportTargetId] = useState(() => eventId.trim());
  const [events, setEvents] = useState<EventOption[]>([]);
  const [csvMatrix, setCsvMatrix] = useState<string[][] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [nameCol, setNameCol] = useState(0);
  const [amountCol, setAmountCol] = useState(0);
  const [ticketsCol, setTicketsCol] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = eventId.trim();
    if (!fromUrl) return;
    queueMicrotask(() => setImportTargetId(fromUrl));
  }, [eventId]);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const db = getDb();
    const q = query(collection(db, "events"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: EventOption[] = [];
      snap.forEach((d) => {
        const name = typeof d.data().name === "string" ? d.data().name : "Untitled";
        rows.push({ id: d.id, name });
      });
      setEvents(rows);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (importTargetId.trim() || events.length !== 1) return;
    const id = events[0]!.id;
    queueMicrotask(() => setImportTargetId(id));
  }, [events, importTargetId]);

  const headers = csvMatrix?.[0] ?? [];

  const previewRows: ImportPreviewRow[] = useMemo(() => {
    if (!csvMatrix || csvMatrix.length < 2) return [];
    const col = ticketsCol === "" ? null : ticketsCol;
    return previewWooCommerceOrdersCsv({
      matrix: csvMatrix,
      nameCol,
      amountCol,
      ticketsCol: col,
    });
  }, [csvMatrix, nameCol, amountCol, ticketsCol]);

  const readyRows = useMemo(() => validImportRows(previewRows), [previewRows]);

  const onFile = useCallback((file: File | null) => {
    setParseError(null);
    setCsvMatrix(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const matrix = parseCsvMatrix(text);
      if (!matrix || matrix.length < 2) {
        setParseError("Could not read CSV (need a header row and at least one data row).");
        return;
      }
      setCsvMatrix(matrix);
      const h = matrix[0] ?? [];
      setNameCol(Math.min(guessNameColumnIndex(h), Math.max(0, h.length - 1)));
      setAmountCol(Math.min(guessAmountColumnIndex(h), Math.max(0, h.length - 1)));
      const guessedProducts = guessTotalProductsColumnIndex(h);
      setTicketsCol(guessedProducts ?? "");
    };
    reader.onerror = () => setParseError("Failed to read file.");
    reader.readAsText(file, "UTF-8");
  }, []);

  const submit = useCallback(async () => {
    setSubmitError(null);
    if (!importTargetId.trim()) {
      setSubmitError("Select which event to import into (dropdown above).");
      return;
    }
    if (!csvMatrix || csvMatrix.length < 2) {
      setSubmitError("Choose a CSV file to import.");
      return;
    }
    if (readyRows.length === 0) {
      setSubmitError("No valid rows to import. Check the preview for errors.");
      return;
    }
    if (!isFirebaseConfigured()) {
      setSubmitError("Firebase is not configured.");
      return;
    }

    setBusy(true);
    try {
      const db = getDb();
      const chunkSize = 400;
      for (let i = 0; i < readyRows.length; i += chunkSize) {
        const batch = writeBatch(db);
        const slice = readyRows.slice(i, i + chunkSize);
        for (const r of slice) {
          const guestRef = doc(collection(db, "events", importTargetId, "guests"));
          batch.set(guestRef, {
            name: r.name,
            tickets: r.tickets ?? 1,
            amountPaidKr: r.amountPaidKr ?? 0,
            checkedIn: false,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      router.push(`/?event=${encodeURIComponent(importTargetId)}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }, [importTargetId, csvMatrix, readyRows, router]);

  if (!isFirebaseConfigured()) {
    return (
      <main className="mx-auto min-h-full w-full max-w-lg bg-black px-4 py-10 text-zinc-200">
        <p className="text-sm text-zinc-400">Configure Firebase in .env.local to import.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-violet-400">
          Back to guestlist
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-full w-full max-w-xl bg-black px-4 py-8 text-zinc-100 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">CSV import</h1>
        <Link
          href={importTargetId ? `/?event=${encodeURIComponent(importTargetId)}` : "/"}
          className="text-sm text-zinc-400 underline-offset-2 hover:text-white hover:underline"
        >
          Guestlist
        </Link>
      </div>

      <div className="mt-4">
        <label htmlFor="import-event" className="text-sm font-medium text-zinc-300">
          Import into event
        </label>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-amber-200/90">
            No events yet. Add one from the guestlist <span className="text-zinc-400">(Settings drawer → New event)</span>
            , then return here.
          </p>
        ) : (
          <select
            id="import-event"
            value={importTargetId}
            onChange={(e) => setImportTargetId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-400"
          >
            <option value="">Select an event…</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {importTargetId ? (
        <p className="mt-3 text-sm text-zinc-500">New guests are appended to this event.</p>
      ) : null}

      <section className="mt-8">
        <p className="text-xs text-zinc-500">
          WooCommerce exports: <span className="text-zinc-400">Full Name (Billing)</span>,{" "}
          <span className="text-zinc-400">Order Total Amount</span>, optional{" "}
          <span className="text-zinc-400">Total products</span>. When many rows share the same implied price per product
          (e.g. 95 kr), we use that as the ticket price and set tickets to at least{" "}
          <span className="text-zinc-400">max(total products, order total ÷ that price)</span> so 285 kr → 3 tickets at
          95 kr.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          className="mt-3 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border file:border-zinc-600 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:text-zinc-200 hover:file:border-zinc-500"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {parseError ? <p className="mt-2 text-sm text-red-400">{parseError}</p> : null}

        {csvMatrix && headers.length > 0 ? (
          <div className="mt-4 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="text-xs text-zinc-500">Map columns</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Name
                <select
                  value={nameCol}
                  onChange={(e) => setNameCol(Number(e.target.value))}
                  className="rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  {headers.map((h, i) => (
                    <option key={`n-${i}`} value={i}>
                      {h || `(column ${i + 1})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Order total
                <select
                  value={amountCol}
                  onChange={(e) => setAmountCol(Number(e.target.value))}
                  className="rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  {headers.map((h, i) => (
                    <option key={`a-${i}`} value={i}>
                      {h || `(column ${i + 1})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Tickets (total products)
                <select
                  value={ticketsCol === "" ? "" : String(ticketsCol)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTicketsCol(v === "" ? "" : Number(v));
                  }}
                  className="rounded border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  <option value="">None (assume 1 ticket when order total is positive)</option>
                  {headers.map((h, i) => (
                    <option key={`t-${i}`} value={i}>
                      {h || `(column ${i + 1})`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        {previewRows.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[22rem] text-left text-xs text-zinc-300">
              <thead className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Order total</th>
                  <th className="px-2 py-2 font-medium">CSV qty</th>
                  <th className="px-2 py-2 font-medium">Tickets</th>
                  <th className="px-2 py-2 font-medium">Implied kr/ticket</th>
                  <th className="px-2 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(0, 80).map((r, i) => (
                  <tr key={`${r.name}-${i}`} className="border-b border-zinc-900">
                    <td className="px-2 py-1.5 text-white">{r.name}</td>
                    <td className="px-2 py-1.5">{r.amountPaidKr ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.ticketTypeLabel ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.tickets ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.unitPriceKr ?? "—"}</td>
                    <td className="px-2 py-1.5 text-red-400/90">{r.error ?? "OK"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewRows.length > 80 ? (
              <p className="border-t border-zinc-800 px-2 py-2 text-xs text-zinc-500">
                Showing first 80 preview rows of {previewRows.length}.
              </p>
            ) : null}
            <p className="border-t border-zinc-800 px-2 py-2 text-xs text-zinc-500">
              {readyRows.length} row{readyRows.length === 1 ? "" : "s"} ready to import
              {previewRows.length > readyRows.length ? ` (${previewRows.length - readyRows.length} skipped)` : ""}.
            </p>
          </div>
        ) : null}
      </section>

      {submitError ? <p className="mt-4 text-sm text-red-400">{submitError}</p> : null}

      <div className="mt-8 flex flex-col gap-3 border-t border-zinc-800 pt-6 sm:flex-row sm:items-center">
        <button
          type="button"
          disabled={busy || !importTargetId.trim() || events.length === 0}
          onClick={submit}
          className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import guests"}
        </button>
        <Link
          href={importTargetId ? `/?event=${encodeURIComponent(importTargetId)}` : "/"}
          className="text-center text-sm text-zinc-500 hover:text-zinc-300 sm:text-left"
        >
          Cancel
        </Link>
      </div>
    </main>
  );
}
