"use client";

import { isFirebaseConfigured } from "@/lib/firebase";
import {
  matchHeaderColumnIndex,
  parseCsvMatrix,
  previewWooCommerceOrdersCsv,
  validImportRows,
  type ImportPreviewRow,
} from "@/lib/csv-guest-import";
import { getDb } from "@/lib/firestore";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = { eventId: string };

type EventOption = { id: string; name: string };

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4h8v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6h12ZM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type EventTargetMode = "existing" | "new";

export function SettingsCsvImport({ eventId }: Props) {
  const router = useRouter();
  const [importTargetId, setImportTargetId] = useState(() => eventId.trim());
  const [eventTargetMode, setEventTargetMode] = useState<EventTargetMode>("existing");
  const [newEventName, setNewEventName] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [exportFieldsReady, setExportFieldsReady] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [nameHeader, setNameHeader] = useState("Full Name (Billing)");
  const [amountHeader, setAmountHeader] = useState("Order Total Amount");
  const [itemsHeader, setItemsHeader] = useState("Total items");
  const [useOrderTotal, setUseOrderTotal] = useState(true);
  const [useTotalItems, setUseTotalItems] = useState(true);

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
    if (eventTargetMode !== "existing") return;
    if (importTargetId.trim() || events.length !== 1) return;
    const id = events[0]!.id;
    queueMicrotask(() => setImportTargetId(id));
  }, [events, importTargetId, eventTargetMode]);

  useEffect(() => {
    if (events.length > 0) return;
    queueMicrotask(() => setEventTargetMode("new"));
  }, [events.length]);

  const headers = csvMatrix?.[0] ?? [];

  const previewRows: ImportPreviewRow[] = useMemo(() => {
    if (!csvMatrix || csvMatrix.length < 2) return [];
    const col = useTotalItems && ticketsCol !== "" ? ticketsCol : null;
    return previewWooCommerceOrdersCsv({
      matrix: csvMatrix,
      nameCol,
      amountCol,
      ticketsCol: col,
    });
  }, [csvMatrix, nameCol, amountCol, ticketsCol, useTotalItems]);

  const readyRows = useMemo(() => validImportRows(previewRows), [previewRows]);

  const confirmExportFields = useCallback(() => {
    if (!useOrderTotal) {
      setSubmitError("Order total is required for import. Turn the checkbox back on.");
      return;
    }
    setSubmitError(null);
    setExportFieldsReady(true);
  }, [useOrderTotal]);

  const resetExportFieldsStep = useCallback(() => {
    setExportFieldsReady(false);
    setCsvMatrix(null);
    setParseError(null);
    setFileInputKey((k) => k + 1);
  }, []);

  const onFile = useCallback(
    (file: File | null) => {
      setParseError(null);
      setCsvMatrix(null);
      setSubmitError(null);
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        const matrix = parseCsvMatrix(text);
        if (!matrix || matrix.length < 2) {
          setParseError("Could not read CSV (need a header row and at least one data row).");
          return;
        }
        const h = matrix[0] ?? [];

        const nc = matchHeaderColumnIndex(h, nameHeader);
        if (nc == null) {
          setParseError(
            `No column in the CSV matches "${nameHeader.trim()}". Edit the text to match your file’s header row exactly.`,
          );
          return;
        }
        if (!useOrderTotal) {
          setParseError("Order total must be enabled.");
          return;
        }
        const ac = matchHeaderColumnIndex(h, amountHeader);
        if (ac == null) {
          setParseError(
            `No column matches "${amountHeader.trim()}". Edit the label to match your CSV header (e.g. Order Total Amount).`,
          );
          return;
        }
        let tc: number | null = null;
        if (useTotalItems) {
          tc = matchHeaderColumnIndex(h, itemsHeader);
          if (tc == null) {
            setParseError(
              `No column matches "${itemsHeader.trim()}". Edit the label or turn off "Total items" to infer ticket counts from order totals only.`,
            );
            return;
          }
        }

        setNameCol(nc);
        setAmountCol(ac);
        setTicketsCol(tc === null ? "" : tc);
        setCsvMatrix(matrix);
      };
      reader.onerror = () => setParseError("Failed to read file.");
      reader.readAsText(file, "UTF-8");
    },
    [nameHeader, amountHeader, itemsHeader, useOrderTotal, useTotalItems],
  );

  const submit = useCallback(async () => {
    setSubmitError(null);
    if (eventTargetMode === "new") {
      const name = newEventName.trim();
      if (!name) {
        setSubmitError("Enter an event name for this import.");
        return;
      }
    } else if (!importTargetId.trim()) {
      setSubmitError("Select which existing event to import into.");
      return;
    }
    if (!exportFieldsReady) {
      setSubmitError('Use "Continue to upload CSV" first, then choose your file.');
      return;
    }
    if (!csvMatrix || csvMatrix.length < 2) {
      setSubmitError("Choose a CSV file.");
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
      let targetEventId = importTargetId.trim();
      if (eventTargetMode === "new") {
        const eventRef = await addDoc(collection(db, "events"), {
          name: newEventName.trim(),
          createdAt: serverTimestamp(),
        });
        targetEventId = eventRef.id;
      }

      const chunkSize = 400;
      for (let i = 0; i < readyRows.length; i += chunkSize) {
        const batch = writeBatch(db);
        const slice = readyRows.slice(i, i + chunkSize);
        for (const r of slice) {
          const guestRef = doc(collection(db, "events", targetEventId, "guests"));
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
      router.push(`/?event=${encodeURIComponent(targetEventId)}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }, [
    eventTargetMode,
    newEventName,
    importTargetId,
    exportFieldsReady,
    csvMatrix,
    readyRows,
    router,
  ]);

  const importBlockedReason = useMemo(() => {
    if (busy) return null;
    if (!exportFieldsReady) {
      return 'Confirm the three export fields below, then click "Continue to upload CSV".';
    }
    if (eventTargetMode === "new") {
      if (!newEventName.trim()) return "Enter an event name above (this names the new event for your import).";
    } else {
      if (!importTargetId.trim()) return "Select an existing event in the dropdown, or switch to Create new event.";
      if (events.length === 0) return "No events yet—use Create new event and type an event name.";
    }
    if (!csvMatrix) return "Upload your orders CSV file.";
    if (readyRows.length === 0) return "Preview has no valid rows—check headers and data.";
    return null;
  }, [
    busy,
    exportFieldsReady,
    eventTargetMode,
    newEventName,
    importTargetId,
    events.length,
    csvMatrix,
    readyRows.length,
  ]);

  if (!isFirebaseConfigured()) {
    return (
      <main className="mx-auto min-h-full w-full max-w-lg bg-black px-4 py-10 text-zinc-200">
        <p className="text-sm text-zinc-400">Configure Firebase in .env.local to import.</p>
        <Link href="/" prefetch={false} className="mt-4 inline-block text-sm text-[#F16CB3]">
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
          href={
            eventTargetMode === "existing" && importTargetId
              ? `/?event=${encodeURIComponent(importTargetId)}`
              : "/"
          }
          className="text-sm text-zinc-400 underline-offset-2 hover:text-white hover:underline"
        >
          Guestlist
        </Link>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h2 className="text-sm font-semibold text-white">Event for this import</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Name a new event to hold this import, or add guests to an event that already exists.
        </p>
        <fieldset className="mt-3 space-y-2 border-0 p-0">
          <legend className="sr-only">Import target</legend>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
            <input
              type="radio"
              name="event-target"
              className="mt-0.5"
              checked={eventTargetMode === "existing"}
              onChange={() => setEventTargetMode("existing")}
            />
            <span>Add guests to an existing event</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-200">
            <input
              type="radio"
              name="event-target"
              className="mt-0.5"
              checked={eventTargetMode === "new"}
              onChange={() => setEventTargetMode("new")}
            />
            <span>Create new event and import into it</span>
          </label>
        </fieldset>

        {eventTargetMode === "new" ? (
          <div className="mt-3">
            <label htmlFor="new-event-name" className="text-sm font-medium text-zinc-300">
              Event name
            </label>
            <input
              id="new-event-name"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              placeholder="e.g. Spring party door list"
              className="mt-2 w-full rounded-lg border border-zinc-600 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-400"
              autoComplete="off"
            />
            <p className="mt-1.5 text-xs text-zinc-500">This name appears in the guestlist header after import.</p>
          </div>
        ) : events.length === 0 ? (
          <p className="mt-3 text-sm text-amber-200/90">
            You have no events yet. Choose <span className="text-amber-100">Create new event</span> and enter an
            event name, or add an event from the guestlist drawer first.
          </p>
        ) : (
          <div className="mt-3">
            <label htmlFor="import-event" className="text-sm font-medium text-zinc-300">
              Existing event
            </label>
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
            <p className="mt-1.5 text-xs text-zinc-500">New guests from the CSV are appended to this event.</p>
          </div>
        )}
      </div>

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        <h2 className="text-sm font-semibold text-white">1. Select export fields</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Match your WooCommerce order export: turn on each column you use, and make the text match your CSV header
          row (e.g. <span className="text-zinc-400">Total items</span> for ticket quantity).
        </p>

        <ul className="mt-4 flex flex-col gap-2">
          <li className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 sm:flex-nowrap">
            <span className="w-full shrink-0 text-sm text-zinc-300 sm:w-52">Full Name (Billing)</span>
            <input
              value={nameHeader}
              onChange={(e) => setNameHeader(e.target.value)}
              className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-white outline-none focus:border-zinc-400"
              aria-label="CSV header for guest name"
            />
            <span className="shrink-0 text-xs text-zinc-500">Required</span>
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Reset to default"
              onClick={() => setNameHeader("Full Name (Billing)")}
            >
              <TrashIcon />
            </button>
          </li>

          <li className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 sm:flex-nowrap">
            <span className="w-full shrink-0 text-sm text-zinc-300 sm:w-52">Order Total Amount</span>
            <input
              value={amountHeader}
              onChange={(e) => setAmountHeader(e.target.value)}
              disabled={!useOrderTotal}
              className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-white outline-none focus:border-zinc-400 disabled:opacity-40"
              aria-label="CSV header for order total"
            />
            <input
              type="checkbox"
              checked={useOrderTotal}
              onChange={(e) => setUseOrderTotal(e.target.checked)}
              className="h-4 w-4 shrink-0 rounded border-zinc-500"
              title="Include order total"
              aria-label="Include order total column"
            />
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Clear and turn off"
              onClick={() => {
                setAmountHeader("Order Total Amount");
                setUseOrderTotal(false);
              }}
            >
              <TrashIcon />
            </button>
          </li>

          <li className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 sm:flex-nowrap">
            <span className="w-full shrink-0 text-sm text-zinc-300 sm:w-52">Total items</span>
            <input
              value={itemsHeader}
              onChange={(e) => setItemsHeader(e.target.value)}
              disabled={!useTotalItems}
              className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-sm text-white outline-none focus:border-zinc-400 disabled:opacity-40"
              aria-label="CSV header for total items"
            />
            <input
              type="checkbox"
              checked={useTotalItems}
              onChange={(e) => setUseTotalItems(e.target.checked)}
              className="h-4 w-4 shrink-0 rounded border-zinc-500"
              title="Import ticket count from this column"
              aria-label="Include total items column"
            />
            <button
              type="button"
              className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Clear and turn off"
              onClick={() => {
                setItemsHeader("Total items");
                setUseTotalItems(false);
              }}
            >
              <TrashIcon />
            </button>
          </li>
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          {!exportFieldsReady ? (
            <button
              type="button"
              onClick={confirmExportFields}
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Continue to upload CSV
            </button>
          ) : (
            <button
              type="button"
              onClick={resetExportFieldsStep}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
            >
              Change export fields
            </button>
          )}
        </div>
      </section>

      <section className={`mt-8 ${exportFieldsReady ? "" : "pointer-events-none opacity-40"}`}>
        <h2 className="text-sm font-semibold text-white">2. Upload CSV</h2>
        <p className="mt-1 text-xs text-zinc-500">
          File must include the headers you confirmed above. Same format as WooCommerce orders export with Total
          items.
        </p>
        <input
          key={fileInputKey}
          type="file"
          accept=".csv,text/csv"
          disabled={!exportFieldsReady}
          className="mt-3 block w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border file:border-zinc-600 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:text-zinc-200 hover:file:border-zinc-500 disabled:opacity-50"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {parseError ? <p className="mt-2 text-sm text-red-400">{parseError}</p> : null}

        {csvMatrix && headers.length > 0 ? (
          <p className="mt-3 text-xs text-zinc-500">
            Using columns: <span className="text-zinc-300">{headers[nameCol] || `#${nameCol + 1}`}</span>,{" "}
            <span className="text-zinc-300">{headers[amountCol] || `#${amountCol + 1}`}</span>
            {useTotalItems && ticketsCol !== "" ? (
              <>
                , <span className="text-zinc-300">{headers[ticketsCol as number]}</span>
              </>
            ) : null}
            .
          </p>
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
          disabled={Boolean(importBlockedReason)}
          onClick={submit}
          className="rounded-lg border border-[#F16CB3] bg-[#F16CB3] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#e055a5] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import guests"}
        </button>
        <Link
          href={
            eventTargetMode === "existing" && importTargetId
              ? `/?event=${encodeURIComponent(importTargetId)}`
              : "/"
          }
          className="text-center text-sm text-zinc-500 hover:text-zinc-300 sm:text-left"
        >
          Cancel
        </Link>
      </div>
      {importBlockedReason ? (
        <p className="mt-2 text-sm text-amber-200/90">{importBlockedReason}</p>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Import is ready—click Import guests.</p>
      )}
    </main>
  );
}
