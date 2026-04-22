export type ImportPreviewRow = {
  name: string;
  amountPaidKr: number | null;
  ticketTypeLabel: string | null;
  unitPriceKr: number | null;
  tickets: number | null;
  error: string | null;
};

/** Parse currency-ish cells: "300", "300 kr", "95.00", "1.234,56", "1234,50" */
export function parseKrAmount(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s/g, "")
    .replace(/kr/gi, "")
    .replace(/nok/gi, "")
    .replace(/[$€£]/g, "");
  if (!s) return null;
  let cleaned = s;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    cleaned = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    cleaned = s.replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    cleaned = s.replace(/,/g, "");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Product / ticket count from WooCommerce "Total products" style cells. */
export function parseProductCount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(/,/g, ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function delimiterFromLine(line: string): "," | ";" {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (c === ",") commas++;
      if (c === ";") semis++;
    }
  }
  return semis > commas ? ";" : ",";
}

/** Minimal CSV: supports quoted fields, comma or semicolon delimiter (WooCommerce-style exports). */
export function parseCsvMatrix(text: string): string[][] | null {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!normalized) return null;
  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const delimiter = delimiterFromLine(lines[0]!);

  const rows: string[][] = [];
  for (const line of lines) {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delimiter && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    rows.push(cells.map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"')));
  }
  return rows.length ? rows : null;
}

function normHeader(h: string): string {
  return h.trim().toLowerCase();
}

export function guessNameColumnIndex(headers: string[]): number {
  const normalized = headers.map((h) => normHeader(h));
  const billing = normalized.findIndex((h) =>
    /full\s*name\s*\(\s*billing\s*\)|full\s*name.*billing|billing.*full\s*name/i.test(h),
  );
  if (billing >= 0) return billing;

  const keys = [
    /^(name|navn|full_?name|attendee|deltaker|kunde)$/i,
    /^full\s*name$/i,
    /navn/i,
    /^(?!.*\border\b).*name/i,
    /name/i,
  ];
  for (let i = 0; i < headers.length; i++) {
    const h = normalized[i] ?? "";
    if (keys.some((re) => re.test(h))) return i;
  }
  return 0;
}

export function guessAmountColumnIndex(headers: string[]): number {
  const normalized = headers.map((h) => normHeader(h));
  const orderTotal = normalized.findIndex((h) =>
    /order\s*total\s*amount|^order\s*total$/i.test(h),
  );
  if (orderTotal >= 0) return orderTotal;

  const keys = [
    /^(amount|beløp|belop|total|paid|sum|kjøp|purchase)$/i,
    /order\s*total|line\s*total|cart\s*total/i,
    /beløp|belop|amount|total|paid/i,
  ];
  for (let i = 0; i < headers.length; i++) {
    const h = normalized[i] ?? "";
    if (keys.some((re) => re.test(h))) return i;
  }
  return Math.min(1, Math.max(0, headers.length - 1));
}

/** Match a user-typed export header to a CSV column index (exact or loose contains). */
export function matchHeaderColumnIndex(headers: string[], userLabel: string): number | null {
  const needle = userLabel.trim().toLowerCase();
  if (!needle) return null;
  const normalized = headers.map((h) => normHeader(h));
  const exact = normalized.findIndex((h) => h === needle);
  if (exact >= 0) return exact;
  const partial = normalized.findIndex((h) => h.includes(needle) || needle.includes(h));
  return partial >= 0 ? partial : null;
}

/** WooCommerce orders export: "Total products" / "Total items" (qty), etc. */
export function guessTotalProductsColumnIndex(headers: string[]): number | null {
  const normalized = headers.map((h) => normHeader(h));
  const idx = normalized.findIndex((h) =>
    /^total\s*products?$|^total\s*items?$|total\s*items?\s*qty|items?\s*qty|line\s*items?|product\s*qty|^qty$|^quantity$/i.test(
      h,
    ),
  );
  return idx >= 0 ? idx : null;
}

/**
 * From many orders, guess one ticket price (kr) as the most common rounded
 * `order total / max(total products, 1)`. Needs at least two matching rows to avoid guessing on tiny files.
 */
export function inferDominantUnitPriceKr(rows: { amount: number; products: number }[]): number | null {
  const counts = new Map<number, number>();
  for (const { amount, products } of rows) {
    if (amount <= 0) continue;
    const p = Math.max(1, products);
    const implied = Math.round(amount / p);
    if (implied <= 0 || !Number.isFinite(implied)) continue;
    counts.set(implied, (counts.get(implied) ?? 0) + 1);
  }
  let bestPrice: number | null = null;
  let bestCount = 0;
  for (const [price, c] of counts) {
    if (c > bestCount || (c === bestCount && bestPrice != null && price < bestPrice)) {
      bestCount = c;
      bestPrice = price;
    }
  }
  if (bestPrice == null || bestCount < 2) return null;
  return bestPrice;
}

/**
 * WooCommerce-style order CSV:
 * - Reads "Total products" when mapped (WooCommerce often counts lines, not tickets).
 * - When possible, infers a **dominant ticket price** from the file (e.g. many orders at 95 kr) and uses
 *   `max(total products, floor(order total ÷ that price))` so 285 kr at 95 kr/ticket → **3** tickets.
 */
export function previewWooCommerceOrdersCsv(params: {
  matrix: string[][];
  nameCol: number;
  amountCol: number;
  ticketsCol: number | null;
}): ImportPreviewRow[] {
  const { matrix, nameCol, amountCol, ticketsCol } = params;
  if (matrix.length < 2) return [];
  const dataRows = matrix.slice(1);

  type Parsed = {
    name: string;
    amountPaidKr: number | null;
    csvProducts: number;
    rawQty: string | null;
  };

  const parsed: Parsed[] = [];
  for (const row of dataRows) {
    const name = (row[nameCol] ?? "").trim();
    if (!name) continue;

    const amountPaidKr = parseKrAmount(row[amountCol] ?? "");
    let rawQty: string | null = null;
    let csvProducts = 1;
    if (ticketsCol != null) {
      rawQty = (row[ticketsCol] ?? "").trim() || null;
      const parsedQty = parseProductCount(row[ticketsCol] ?? "");
      if (parsedQty === 0) {
        parsed.push({ name, amountPaidKr, csvProducts: 0, rawQty });
        continue;
      }
      if (parsedQty != null && parsedQty > 0) {
        csvProducts = parsedQty;
      }
    }

    parsed.push({ name, amountPaidKr, csvProducts, rawQty });
  }

  const forInference = parsed
    .filter((r) => r.amountPaidKr != null && r.amountPaidKr > 0 && r.csvProducts > 0)
    .map((r) => ({ amount: r.amountPaidKr!, products: r.csvProducts }));

  const unitPriceKr = inferDominantUnitPriceKr(forInference);

  const out: ImportPreviewRow[] = [];
  for (const r of parsed) {
    if (r.amountPaidKr == null) {
      out.push({
        name: r.name,
        amountPaidKr: null,
        ticketTypeLabel: r.rawQty,
        unitPriceKr: unitPriceKr,
        tickets: null,
        error: "Could not read order total amount.",
      });
      continue;
    }

    if (r.csvProducts === 0) {
      out.push({
        name: r.name,
        amountPaidKr: r.amountPaidKr,
        ticketTypeLabel: r.rawQty,
        unitPriceKr: unitPriceKr,
        tickets: null,
        error: "Ticket / items quantity is 0.",
      });
      continue;
    }

    const fromCsv = Math.max(1, r.csvProducts);
    const fromMath =
      unitPriceKr != null && unitPriceKr > 0 ? Math.floor(r.amountPaidKr / unitPriceKr) : 0;
    const tickets =
      unitPriceKr != null && fromMath > 0
        ? Math.max(fromCsv, fromMath)
        : fromCsv > 0
          ? fromCsv
          : r.amountPaidKr > 0
            ? 1
            : null;

    if (tickets == null || tickets <= 0) {
      out.push({
        name: r.name,
        amountPaidKr: r.amountPaidKr,
        ticketTypeLabel: r.rawQty,
        unitPriceKr: unitPriceKr,
        tickets: null,
        error: "Could not determine ticket count.",
      });
      continue;
    }

    out.push({
      name: r.name,
      amountPaidKr: r.amountPaidKr,
      ticketTypeLabel: r.rawQty,
      unitPriceKr: unitPriceKr,
      tickets,
      error: null,
    });
  }

  return out;
}

export function validImportRows(rows: ImportPreviewRow[]): ImportPreviewRow[] {
  return rows.filter((r) => r.error == null && r.tickets != null && r.tickets > 0);
}
