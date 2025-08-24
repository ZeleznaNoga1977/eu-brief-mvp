// lib/extract.js  (tolerant headings + contextual deadlines/budget)
function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function normalizeDates(text) {
  const months = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
  };
  const re = /\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/g;
  let m, out = [];
  while ((m = re.exec(text)) !== null) {
    const d = m[1].padStart(2, "0");
    const mon = months[m[2].toLowerCase()];
    const y = m[3];
    if (mon) out.push(`${y}-${mon}-${d}`);
  }
  return uniq(out);
}

function getSection(text, starts, ends) {
  for (const a of starts) {
    for (const b of ends) {
      const re = new RegExp(`${a}[\\s\\S]*?${b}`, "i");
      const m = text.match(re);
      if (m) {
        let body = m[0];
        body = body.replace(new RegExp(`^\\s*${a}\\s*:?\s*`, "i"), "");
        body = body.replace(new RegExp(`${b}\\s*$`, "i"), "");
        return body.trim();
      }
    }
  }
  return null;
}

function extractExpectedList(block) {
  if (!block) return null;
  const lines = block
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/^\d+\s*(of|page)/i.test(s)); // drop page headers
  // keep bullet-like lines
  const items = lines.filter(s => /^[-–•·]/.test(s) || s.endsWith(";") || s.endsWith("."));
  // if nothing matched, fallback to paragraphs
  if (items.length === 0) {
    return block.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, 10);
  }
  // clean leading bullets
  return items.map(s => s.replace(/^[-–•·]\s*/, "")).slice(0, 12);
}

function parseEUR(s) {
  if (!s) return null;
  const m = s.match(/([€$]?\s?\d[\d.,\s]*)(\s?(m|million))?/i);
  if (!m) return null;
  let num = m[1].replace(/[€$\s,]/g, "");
  let val = parseFloat(num);
  if (isNaN(val)) return null;
  if (m[3]) val = val * 1_000_000;
  return val;
}

function extractDeadlinesContext(text) {
  // only dates near lines that mention deadline(s)/cut-off/closing
  const lines = text.split(/\r?\n/);
  const hits = [];
  const ctxRe = /(deadline|cut-?off|closing|submission|opens|opening)/i;
  for (let i = 0; i < lines.length; i++) {
    if (ctxRe.test(lines[i])) {
      const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
      hits.push(...normalizeDates(window));
    }
  }
  const stage = /two[-\s]?stage|2[-\s]?stage/i.test(text)
    ? "two-stage"
    : /single[-\s]?stage/i.test(text)
    ? "single-stage"
    : "unknown";
  return { dates: uniq(hits).slice(0, 6), stage };
}

function detectProgramme(text) {
  if (/horizon europe/i.test(text)) return "Horizon Europe";
  if (/erasmus\+/i.test(text)) return "Erasmus+";
  if (/\bLIFE\b/i.test(text)) return "LIFE";
  if (/digital europe/i.test(text)) return "Digital Europe";
  return "";
}

export function extractFields(text) {
  const notes = [];

  // Basic IDs
  const callId = (text.match(/\b(HORIZON|HE|LIFE|ERASMUS)[A-Z0-9\-_/.]+/i) || [])[0] || null;
  if (!callId) notes.push("No explicit Topic/Call ID detected — document may be too broad.");

  // Programme
  const programme = detectProgramme(text);

  // Sections (tolerant synonyms)
  const scope = getSection(
    text,
    ["Scope", "Objective", "Objectives", "Specific challenge"],
    ["Expected outcomes", "Expected impact", "Eligibility", "Type of Action", "Specific conditions"]
  );

  const expectedBlock = getSection(
    text,
    ["Expected outcomes", "Expected impact", "Expected EU"],
    ["Eligibility", "Specific conditions", "Evaluation", "Award criteria", "Type of Action"]
  );
  const expected_outcomes = extractExpectedList(expectedBlock);

  const eligibility = getSection(
    text,
    ["Eligibility", "Eligibility conditions"],
    ["Evaluation", "Award criteria", "Budget", "Call conditions", "Specific conditions", "Type of Action"]
  );

  // Deadlines (contextual)
  const { dates: deadlineDates, stage } = extractDeadlinesContext(text);
  const deadlines = deadlineDates;

  // Budget (try to keep topic-level “indicative budget” or per-project EU contribution)
  let budget = null;
  const budgetLine =
    text.match(/indicative budget[^.\n]*?(€|eur|\d)/i)?.[0] ||
    text.match(/EU contribution[^.\n]*?(between|up to|of)\s+[^.\n]*/i)?.[0] ||
    text.match(/total (indicative )?budget[^.\n]*?(€|eur|\d)/i)?.[0];
  if (budgetLine) {
    const parsed = parseEUR(budgetLine);
    if (parsed) budget = parsed;
  }

  // TRL
  const trlMatch = text.match(/\bTRL\s*([1-9])\s*-\s*([1-9])\b/i) || text.match(/\bTRL\s*([1-9])\b/i);
  const trl = { min: null, max: null };
  if (trlMatch) {
    if (trlMatch.length >= 3) { trl.min = parseInt(trlMatch[1]); trl.max = parseInt(trlMatch[2]); }
    else { trl.min = parseInt(trlMatch[1]); trl.max = parseInt(trlMatch[1]); }
  }

  // Work Programme “broad doc” hint
  const looksBroad = /work programme/i.test(text) && (deadlineDates.length > 4);
  if (looksBroad) {
    notes.push("This looks like a broad Work Programme; results may include unrelated dates. Prefer printing the Topic page to PDF.");
  }

  return {
    programme,
    callId,
    deadlines,
    budget,
    trl,
    scope: scope || null,
    expected_outcomes: expected_outcomes || null,
    eligibility: eligibility || null,
    notes
  };
}
