"use client";

import { isFirebaseConfigured } from "@/lib/firebase";
import { getDb } from "@/lib/firestore";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type EventRow = { id: string; name: string };
type GuestRow = {
  id: string;
  name: string;
  tickets: number;
  amountPaidKr: number | null;
  checkedIn: boolean;
  checkedInAt: Timestamp | null;
};

type FilterTab = "unchecked" | "checked";

/** Brand accent — stats + outlined controls */
const statNum = "font-semibold text-[#F16CB3]";
const statLabel = "text-zinc-400";

/** Outline-only controls */
const outlineBtn =
  "rounded-md border border-[#F16CB3] bg-transparent py-2 text-sm font-medium text-white transition hover:border-[#ff8cc8]";
const outlineBtnActive = "border-[#F16CB3] text-[#F16CB3]";

/** Filter: icon-only, same height as inline search */
const toolbarIconBtn = `${outlineBtn} flex h-10 w-10 shrink-0 items-center justify-center p-0 text-white`;

const searchInline =
  "h-10 min-h-10 min-w-[10rem] flex-1 rounded-md border border-[#F16CB3]/70 bg-transparent px-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#F16CB3]";

const settingsBtn =
  "flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#F16CB3] bg-transparent px-3.5 text-sm font-medium text-white transition hover:border-[#ff8cc8]";

const eventSelectHeader =
  "h-10 min-w-0 max-w-[min(240px,52vw)] cursor-pointer appearance-none rounded-md border border-[#F16CB3]/70 bg-transparent py-0 pl-3 pr-9 text-left text-sm text-white outline-none transition focus:border-[#F16CB3] sm:max-w-xs";

function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13 9 17 19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EventDashboard() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [filter, setFilter] = useState<FilterTab>("unchecked");
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestTickets, setGuestTickets] = useState("1");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      queueMicrotask(() => setEventsLoading(false));
      return;
    }
    const db = getDb();
    const q = query(collection(db, "events"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setFirestoreError(null);
        const rows: EventRow[] = [];
        snap.forEach((d) => {
          const name = typeof d.data().name === "string" ? d.data().name : "Untitled";
          rows.push({ id: d.id, name });
        });
        setEvents(rows);
        setEventsLoading(false);
      },
      (err) => {
        setFirestoreError(err.message);
        setEventsLoading(false);
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured() || !eventId) {
      queueMicrotask(() => {
        setGuests([]);
        setGuestsLoading(false);
      });
      return;
    }
    queueMicrotask(() => setGuestsLoading(true));
    const db = getDb();
    const q = query(collection(db, "events", eventId, "guests"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setFirestoreError(null);
        const rows: GuestRow[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const amountPaid = data.amountPaidKr;
          rows.push({
            id: d.id,
            name: typeof data.name === "string" ? data.name : "Guest",
            tickets: typeof data.tickets === "number" ? data.tickets : 0,
            amountPaidKr: typeof amountPaid === "number" && Number.isFinite(amountPaid) ? amountPaid : null,
            checkedIn: Boolean(data.checkedIn),
            checkedInAt: data.checkedInAt ?? null,
          });
        });
        setGuests(rows);
        setGuestsLoading(false);
      },
      (err) => {
        setFirestoreError(err.message);
        setGuestsLoading(false);
      },
    );
    return () => unsub();
  }, [eventId]);

  useEffect(() => {
    if (events.length === 0) return;
    const fromUrl = searchParams.get("event");
    queueMicrotask(() => {
      if (fromUrl && events.some((e) => e.id === fromUrl)) {
        setEventId(fromUrl);
        return;
      }
      setEventId((prev) => (prev && events.some((e) => e.id === prev) ? prev : events[0]!.id));
    });
  }, [searchParams, events]);

  const { total, checked, unchecked, filtered } = useMemo(() => {
    const checked = guests.filter((g) => g.checkedIn).length;
    const unchecked = guests.filter((g) => !g.checkedIn).length;
    const total = guests.length;
    let list =
      filter === "checked"
        ? guests.filter((g) => g.checkedIn)
        : guests.filter((g) => !g.checkedIn);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((g) => g.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return { total, checked, unchecked, filtered: list };
  }, [guests, filter, searchQuery]);

  const addEvent = useCallback(async () => {
    const name = newEventName.trim();
    if (!name || !isFirebaseConfigured()) return;
    const db = getDb();
    const ref = await addDoc(collection(db, "events"), { name, createdAt: serverTimestamp() });
    setNewEventName("");
    setEventId(ref.id);
  }, [newEventName]);

  const addGuest = useCallback(async () => {
    const name = guestName.trim();
    const tickets = Math.max(0, Math.floor(Number(guestTickets) || 0));
    if (!name || !eventId || !isFirebaseConfigured()) return;
    const db = getDb();
    await addDoc(collection(db, "events", eventId, "guests"), {
      name,
      tickets,
      amountPaidKr: null,
      checkedIn: false,
      createdAt: serverTimestamp(),
    });
    setGuestName("");
    setGuestTickets("1");
  }, [guestName, guestTickets, eventId]);

  const setCheckedIn = useCallback(async (guestId: string, next: boolean) => {
    if (!eventId || !isFirebaseConfigured()) return;
    setBusyId(guestId);
    try {
      const db = getDb();
      await updateDoc(doc(db, "events", eventId, "guests", guestId), {
        checkedIn: next,
        checkedInAt: next ? serverTimestamp() : null,
      });
    } finally {
      setBusyId(null);
    }
  }, [eventId]);

  if (!isFirebaseConfigured()) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Add Firebase keys in <code className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800">.env.local</code>{" "}
          and enable Firestore. Deploy <code className="font-mono text-xs">firestore.rules</code> from this repo in the Firebase
          console.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col bg-black px-4 py-6 text-zinc-100 sm:px-5">
      <header className="flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <h1 className="shrink-0 text-2xl font-bold tracking-tight text-white">Guestlist</h1>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3">
            <label htmlFor="header-event" className="sr-only">
              Event
            </label>
            <select
              id="header-event"
              className={eventSelectHeader}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23F16CB3'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 0.6rem center",
                backgroundSize: "1rem",
              }}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              disabled={eventsLoading || events.length === 0}
            >
              {events.length === 0 ? (
                <option value="">No events</option>
              ) : (
                events.map((ev) => (
                  <option key={ev.id} value={ev.id} className="bg-zinc-900">
                    {ev.name}
                  </option>
                ))
              )}
            </select>
            <Link
              href={eventId ? `/settings?event=${encodeURIComponent(eventId)}` : "/settings"}
              prefetch={false}
              className={settingsBtn}
              aria-label="Open CSV import"
            >
              <SettingsIcon className="shrink-0 text-[#F16CB3]" />
              <span>Settings</span>
            </Link>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <p>
            <span className={statNum}>{total}</span> <span className={statLabel}>on list</span>
          </p>
          <p>
            <span className={statNum}>{checked}</span> <span className={statLabel}>checked in</span>
          </p>
          <p>
            <span className={statNum}>{unchecked}</span> <span className={statLabel}>not checked in</span>
          </p>
        </div>

        <div
          className="mt-6 flex w-full flex-nowrap items-stretch gap-2"
          role="toolbar"
          aria-label="Guest filters and search"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "unchecked"}
            aria-label="Not checked in"
            title="Not checked in"
            onClick={() => setFilter("unchecked")}
            className={`${toolbarIconBtn} ${filter === "unchecked" ? outlineBtnActive : ""}`}
          >
            <XMarkIcon className="shrink-0" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "checked"}
            aria-label="Checked in"
            title="Checked in"
            onClick={() => setFilter("checked")}
            className={`${toolbarIconBtn} ${filter === "checked" ? outlineBtnActive : ""}`}
          >
            <CheckMarkIcon className="shrink-0" />
          </button>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search guests by name..."
            className={`${searchInline} min-w-0`}
            autoComplete="off"
          />
        </div>
      </header>

      {firestoreError ? (
        <p className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {firestoreError}
        </p>
      ) : null}

      <section className="mt-5 flex-1">
        {eventsLoading || (eventId && guestsLoading) ? (
          <p className="py-12 text-center text-sm text-zinc-500">Loading…</p>
        ) : events.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            Create an event from the Settings menu (drawer), then import guests via CSV import if you like.
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-zinc-500">
            {guests.length === 0
              ? "No guests yet."
              : searchQuery.trim()
                ? "No matching guests."
                : filter === "unchecked"
                  ? "Everyone is checked in."
                  : "No check-ins yet."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {filtered.map((g) => (
              <li
                key={g.id}
                className="flex flex-row items-center justify-between gap-3 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{g.name}</p>
                  <p className="text-sm text-zinc-500">
                    {g.tickets} ticket{g.tickets === 1 ? "" : "s"}
                    {g.amountPaidKr != null ? ` · Paid ${g.amountPaidKr} kr` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!g.checkedIn && filter === "unchecked" ? (
                    <button
                      type="button"
                      disabled={busyId === g.id}
                      onClick={() => setCheckedIn(g.id, true)}
                      className="rounded-md border border-[#F16CB3] bg-transparent px-4 py-2 text-sm font-medium text-[#F16CB3] transition hover:border-[#ff8cc8] hover:text-[#ff8cc8] disabled:opacity-50"
                    >
                      {busyId === g.id ? "…" : "Check in"}
                    </button>
                  ) : null}
                  {g.checkedIn && filter === "checked" ? (
                    <button
                      type="button"
                      disabled={busyId === g.id}
                      onClick={() => setCheckedIn(g.id, false)}
                      className="rounded-md border border-[#F16CB3]/80 bg-transparent px-4 py-2 text-sm text-[#F16CB3] transition hover:border-[#ff8cc8] hover:text-[#ff8cc8]"
                    >
                      {busyId === g.id ? "…" : "Undo check-in"}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="flex h-full w-full max-w-sm flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Settings</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded p-1 text-zinc-600 hover:bg-zinc-100 dark:text-white dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
              <div>
                <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">New event</h3>
                <div className="mt-2 flex gap-2">
                  <input
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    placeholder="Event name"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={addEvent}
                    className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Import guests</h3>
                <p className="mt-1 text-xs text-zinc-500">Import a WooCommerce orders CSV for the event selected in the header.</p>
                <Link
                  href={eventId ? `/settings?event=${encodeURIComponent(eventId)}` : "/settings"}
                  prefetch={false}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-[#F16CB3] py-2 text-sm font-medium text-[#F16CB3] transition hover:bg-[#F16CB3]/10 dark:text-[#F16CB3]"
                  onClick={() => setSettingsOpen(false)}
                >
                  CSV import
                </Link>
              </div>
              <div>
                <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Add guest</h3>
                <p className="mt-1 text-xs text-zinc-500">Guests are added to the event selected in the header.</p>
                <input
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Name"
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <input
                  type="number"
                  min={0}
                  value={guestTickets}
                  onChange={(e) => setGuestTickets(e.target.value)}
                  placeholder="Tickets"
                  className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  disabled={!eventId}
                  onClick={addGuest}
                  className="mt-2 w-full rounded-lg border border-[#F16CB3] bg-[#F16CB3] py-2 text-sm font-medium text-white transition hover:bg-[#e055a5] disabled:opacity-50"
                >
                  Add guest
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
