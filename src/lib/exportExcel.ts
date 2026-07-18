import * as XLSX from "xlsx";
import { format } from "date-fns";

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

function leadToRow(lead: any) {
  const emails = toArray(lead.emails_found);
  const socials = toArray(lead.socials);
  return {
    Name: lead.title || lead.name || "",
    Platform: lead.platform || "gmaps",
    Score: lead.lead_score ?? "",
    Tier: lead.lead_category || "",
    "Business Category": lead.category || "",
    Rating: lead.rating && lead.rating !== "N/A" ? lead.rating : "",
    Reviews: lead.reviews && lead.reviews !== "N/A" ? lead.reviews : "",
    Phone: lead.phone || "",
    Email: emails[0] || "",
    "All Emails": emails.join(", "),
    Website: lead.website || "",
    "Google Maps Link": mapsLink(lead),
    Address: lead.address || lead.location || "",
    Socials: socials.join(", "),
    Group: lead.group_name || "",
    Author: lead.author || "",
    "Post URL": lead.post_url || "",
    "AI Pitch": lead.suggested_pitch || "",
    "Email Subject": lead.suggested_subject || "",
    Rationale: lead.rationale || "",
    "Pain Point": lead.pain_point && lead.pain_point !== "none" ? lead.pain_point : "",
    Status: lead.status || "",
    "Scraped At": lead.scraped_at || "",
  };
}

export interface ExportOptions {
  groupName?: string;
  cityState?: string;
  sheetName?: string;
}

/**
 * Build an .xlsx workbook from leads and trigger a browser download using the
 * structured filename convention. Returns the filename used.
 */
export function exportLeadsToExcel(leads: any[], opts: ExportOptions = {}): string {
  const rows = leads.map(leadToRow);
  const ws = XLSX.utils.json_to_sheet(rows);

  // Reasonable column widths so the sheet is readable on open.
  const widths: Record<string, number> = {
    Name: 28, Platform: 12, Score: 7, Tier: 10, "Business Category": 16,
    Rating: 8, Reviews: 9, Phone: 16, Email: 26, "All Emails": 34,
    Website: 30, "Google Maps Link": 40, Address: 30, Socials: 30, Group: 18,
    Author: 16, "Post URL": 34, "AI Pitch": 50, "Email Subject": 30,
    Rationale: 40, "Pain Point": 30, Status: 12, "Scraped At": 20,
  };
  ws["!cols"] = Object.keys(rows[0] || widths).map(k => ({ wch: widths[k] || 16 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (opts.sheetName || "Leads").slice(0, 31));

  const filename = buildLeadFilename(
    opts.groupName || "Leads",
    opts.cityState || "",
  );
  XLSX.writeFile(wb, filename);
  return filename;
}
