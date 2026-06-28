// Extract plain text from an uploaded knowledge-base document (PDF / DOCX / text /
// HTML / markdown). These are parsing UTILITIES, not transport/AI provider SDKs,
// so they're allowed outside packages/adapters. Heavy parsers (pdf-parse, mammoth)
// are loaded lazily so importing this module is cheap and only the format actually
// used pulls its dependency.

/** The minimal shape we need from a Multer upload (avoids a @types/multer dep). */
export interface UploadedDoc {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Strip HTML to readable text (shared with the URL-ingestion path). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function parsePdf(buffer: Buffer): Promise<string> {
  // Import the lib entry directly (not the package index) to skip pdf-parse's
  // debug block that reads a sample file when run as main. A variable specifier
  // also keeps tsc from type-resolving the untyped subpath.
  const spec = "pdf-parse/lib/pdf-parse.js";
  const mod = (await import(spec)) as {
    default: (b: Buffer) => Promise<{ text?: string }>;
  };
  const data = await mod.default(buffer);
  return typeof data.text === "string" ? data.text : "";
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const res = await mammoth.extractRawText({ buffer });
  return res.value ?? "";
}

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".log"];

/**
 * Best-effort text extraction from an uploaded document. Throws a readable error
 * for unsupported types so the caller can surface a 400.
 */
export async function extractDocumentText(file: UploadedDoc): Promise<string> {
  const name = file.originalname.toLowerCase();
  const mime = file.mimetype.toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    return parsePdf(file.buffer);
  }
  if (
    name.endsWith(".docx") ||
    mime.includes("officedocument.wordprocessingml")
  ) {
    return parseDocx(file.buffer);
  }
  if (mime.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    return htmlToText(file.buffer.toString("utf8"));
  }
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return file.buffer.toString("utf8");
  }
  throw new Error(
    "Unsupported file type. Upload a PDF, DOCX, TXT, MD, CSV, JSON, or HTML file.",
  );
}
