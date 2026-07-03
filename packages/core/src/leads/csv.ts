// Pure, dependency-free CSV parsing (RFC 4180-ish). Lives in packages/core so the
// SAME parser runs in the browser (column-mapping preview) and on the server
// (authoritative import parse) — there is ONE source of truth for how a CSV is
// read. ZERO provider/SDK or node imports (CLAUDE.md §5).

export interface ParsedCsv {
  /** First row, treated as the header. Empty if the input was blank. */
  headers: string[];
  /** Data rows (header excluded), each padded/truncated to headers.length. */
  rows: string[][];
}

export interface ParseCsvOptions {
  /** Field delimiter (default ","). */
  delimiter?: string;
}

/**
 * Parse CSV text into headers + rows. Handles quoted fields, escaped quotes
 * (""), embedded commas/newlines inside quotes, and CRLF or LF line endings.
 * Rows are normalized to the header width so downstream mapping is index-safe.
 */
export function parseCsv(text: string, options: ParseCsvOptions = {}): ParsedCsv {
  const delimiter = options.delimiter ?? ",";
  const records = parseRecords(text, delimiter);
  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0]!.map((h) => h.trim());
  const width = headers.length;
  const rows = records
    .slice(1)
    // Drop fully-empty trailing rows (common with a final newline).
    .filter((record) => !(record.length === 1 && record[0] === ""))
    .map((record) => normalizeWidth(record, width));

  return { headers, rows };
}

/** Convenience: parse into an array of header→value objects. */
export function parseCsvToObjects(
  text: string,
  options: ParseCsvOptions = {},
): Record<string, string>[] {
  const { headers, rows } = parseCsv(text, options);
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
}

/**
 * Serialize rows to RFC-4180 CSV text, with formula-injection defense: a cell
 * whose value starts with `= + - @` or a tab/CR is prefixed with a single quote
 * so a spreadsheet opens it as text, never as a live formula (CSV export is a
 * classic injection sink). Values containing a comma/quote/newline are quoted.
 */
export function serializeCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  // Trailing newline so the file ends cleanly.
  return `${lines.join("\r\n")}\r\n`;
}

/** Neutralize + quote a single CSV cell (see serializeCsv). */
export function escapeCsvCell(value: string | number | null | undefined): string {
  let str = value === null || value === undefined ? "" : String(value);
  // Formula-injection guard: leading formula/command trigger characters.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // RFC-4180 quoting: wrap + double any embedded quote when the cell contains a
  // delimiter, quote, or newline.
  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeWidth(record: string[], width: number): string[] {
  if (record.length === width) {
    return record;
  }
  if (record.length > width) {
    return record.slice(0, width);
  }
  return [...record, ...Array<string>(width - record.length).fill("")];
}

/** Tokenize raw CSV text into records (arrays of fields). */
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    record.push(field);
    field = "";
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote.
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Treat CRLF (and a lone CR) as one record terminator.
      pushRecord();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      pushRecord();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Flush the final field/record if the text did not end with a newline.
  if (field !== "" || record.length > 0) {
    pushRecord();
  }

  return records;
}
