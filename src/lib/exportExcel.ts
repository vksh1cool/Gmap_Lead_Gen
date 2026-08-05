import { format } from "date-fns";
import type { Workbook as ExcelWorkbook } from "exceljs";

// Normalize emails_found / socials which may arrive as a real array (live scrape)
// or a JSON string / Postgres array literal (from the DB).
function toArray(data: any): string[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Postgres array literal like {a,b}
      if (data.startsWith("{") && data.endsWith("}")) {
        return data.slice(1, -1).split(",").map(s => s.replace(/^"|"$/g, "")).filter(Boolean);
      }
    }
  }
  return [];
}

// Build the Google Maps link for a lead. Prefer the real place URL captured at
// scrape time; otherwise fall back to a Maps search for name + address.
function mapsLink(lead: any): string {
  if (lead.google_maps_url) return lead.google_maps_url;
  if (lead.url && String(lead.url).includes("google.com/maps")) return lead.url;
  const q = [lead.name, lead.address].filter(Boolean).join(" ");
  if (!q) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// Sanitize a token for use in a filename: keep alnum, collapse the rest.
function sanitizeToken(s: string, fallback: string): string {
  const cleaned = (s || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 40);
  return cleaned || fallback;
}

/**
 * Structured filename: GroupName_CityState_DDMonYYYY.xlsx
 * e.g. RealEstateLeads_Mumbai_17Jul2026.xlsx
 */
export function buildLeadFilename(groupName: string, cityState: string, when: Date = new Date()): string {
  const g = sanitizeToken(groupName, "Leads");
  const c = sanitizeToken(cityState, "AllSources");
  const d = format(when, "ddMMMyyyy"); // 17Jul2026
  return `${g}_${c}_${d}.xlsx`;
}

/**
 * Call-outcome dropdowns, mirroring the client's live calling sheet.
 * NOTE: "INTRESTED" is misspelled on purpose — it matches the values already
 * typed into their existing sheets, so saved filters keep matching.
 */
export const CALL_STATUS_OPTIONS = ["P", "DNP", "CBL", "DNP 2", "DNP3", "NATC"];
export const LEAD_STATUS_OPTIONS = [
  "INTRESTED",
  "NOT INTRESTED",
  "FOLLOW UP",
  "BUSY",
  "FUTURE POTENTIAL LEAD",
  "SOLD",
  "JUNK LEAD",
];

/** Timestamps must land in the sheet as ISO strings, never as date cells. */
function toIsoString(value: any): string {
  if (!value) return "";
  if (value instanceof Date) return isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value);
}

export interface LeadColumn {
  /** Header text. Must stay byte-identical to the client's sheet. */
  header: string;
  width: number;
  value: (lead: any) => string | number;
  /** When set, the column gets a list dropdown on every data row. */
  options?: string[];
}

/**
 * The single source of truth for the exported sheet: order, headers, widths,
 * cell values and validation all derive from this array. Adding a column is a
 * one-line change here — nothing else needs touching.
 *
 * Columns A–W are the scraped/AI fields. X–AB are the call-centre tracking
 * columns: they export blank today, but read straight off the lead object, so
 * the day those become real fields they populate with no further changes.
 */
export const LEAD_COLUMNS: LeadColumn[] = [
  { header: "Name", width: 28, value: l => l.title || l.name || "" },
  { header: "Platform", width: 12, value: l => l.platform || "gmaps" },
  { header: "Score", width: 7, value: l => l.lead_score ?? "" },
  { header: "Tier", width: 10, value: l => l.lead_category || "" },
  { header: "Business Category", width: 16, value: l => l.category || "" },
  { header: "Rating", width: 8, value: l => (l.rating && l.rating !== "N/A" ? l.rating : "") },
  { header: "Reviews", width: 9, value: l => (l.reviews && l.reviews !== "N/A" ? l.reviews : "") },
  { header: "Phone", width: 16, value: l => l.phone || "" },
  { header: "Email", width: 26, value: l => toArray(l.emails_found)[0] || "" },
  { header: "All Emails", width: 34, value: l => toArray(l.emails_found).join(", ") },
  { header: "Website", width: 30, value: l => l.website || "" },
  { header: "Google Maps Link", width: 40, value: l => mapsLink(l) },
  { header: "Address", width: 30, value: l => l.address || l.location || "" },
  { header: "Socials", width: 30, value: l => toArray(l.socials).join(", ") },
  { header: "Group", width: 18, value: l => l.group_name || "" },
  { header: "Author", width: 16, value: l => l.author || "" },
  { header: "Post URL", width: 34, value: l => l.post_url || "" },
  { header: "AI Pitch", width: 50, value: l => l.suggested_pitch || "" },
  { header: "Email Subject", width: 30, value: l => l.suggested_subject || "" },
  { header: "Rationale", width: 40, value: l => l.rationale || "" },
  { header: "Pain Point", width: 30, value: l => (l.pain_point && l.pain_point !== "none" ? l.pain_point : "") },
  { header: "Status", width: 12, value: l => l.status || "" },
  // Always an ISO string. Both live paths deliver one already, but a pg Date
  // would otherwise become a real date cell (or a locale string via String()),
  // neither of which matches the sheet.
  { header: "Scraped At", width: 20, value: l => toIsoString(l.scraped_at) },
  { header: "CALL STATUS", width: 24, value: l => l.call_status ?? "", options: CALL_STATUS_OPTIONS },
  { header: "LEAD STATUS", width: 22, value: l => l.lead_status ?? "", options: LEAD_STATUS_OPTIONS },
  { header: "CALL DURATION", width: 17, value: l => l.call_duration ?? "" },
  { header: "Recording Link", width: 17, value: l => l.recording_link ?? "" },
  { header: "REVIEW", width: 15, value: l => l.review ?? "" },
];

/** 0-based column index -> spreadsheet letter (0 -> A, 27 -> AB). */
function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * exceljs is ~900KB, so it is pulled in only when an export actually runs.
 * Bundlers resolve the package's `browser` field to the prebuilt browser bundle.
 */
async function loadExcelJS(): Promise<{ Workbook: new () => ExcelWorkbook }> {
  const mod: any = await import("exceljs");
  return mod.default ?? mod;
}

function triggerDownload(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so Safari has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportOptions {
  groupName?: string;
  cityState?: string;
  sheetName?: string;
}

/**
 * Build the workbook from `LEAD_COLUMNS`. Kept free of browser APIs so it can
 * be exercised directly (e.g. from a Node script) to verify the sheet format.
 */
export async function buildLeadsWorkbook(leads: any[], sheetName = "Leads"): Promise<ExcelWorkbook> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((sheetName || "Leads").slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = LEAD_COLUMNS.map(c => ({ header: c.header, width: c.width }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle" };
  headerRow.commit();

  for (const lead of leads) {
    ws.addRow(LEAD_COLUMNS.map(c => c.value(lead)));
  }

  const lastCol = colLetter(LEAD_COLUMNS.length - 1);
  ws.autoFilter = { from: "A1", to: `${lastCol}${leads.length + 1}` };

  // Dropdowns on the populated range only, matching the client's sheet.
  LEAD_COLUMNS.forEach((col, idx) => {
    if (!col.options?.length) return;
    const formula = `"${col.options.join(",")}"`;
    for (let row = 2; row <= leads.length + 1; row++) {
      ws.getCell(row, idx + 1).dataValidation = {
        type: "list",
        allowBlank: true,
        showErrorMessage: true,
        formulae: [formula],
      };
    }
  });

  return wb;
}

/**
 * Build an .xlsx workbook from leads and trigger a browser download using the
 * structured filename convention. Returns the filename used.
 */
export async function exportLeadsToExcel(leads: any[], opts: ExportOptions = {}): Promise<string> {
  const wb = await buildLeadsWorkbook(leads, opts.sheetName || "Leads");

  const filename = buildLeadFilename(
    opts.groupName || "Leads",
    opts.cityState || "",
  );

  const buffer = await wb.xlsx.writeBuffer();
  triggerDownload(buffer as ArrayBuffer, filename);
  return filename;
}
