// lib/extract.js — simple, robust extractor used by both API routes

function uniq(a) { return Array.from(new Set((a || []).filter(Boolean))); }

function clean(text) {
  const t = String(text || "");
  return t
    .replace(/\r/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeDates(s) {
  const months = {
    january:"01", february:"02", march:"03", april:"04", may:"05", june:"06",
    july:"07", august:"08", september:"09", october:"10", november:"11", december:"12"
  };
  const out = [];
  const re = /\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const d = m[1].padStart(2, "0");
    const mon = months[m[2].toLowerCase()];
    const y = m[3];
    if (mon) out.push(`${y}-${mon}-${d}`);
  }
  return uniq(out);
}

function parseEUR(line) {
  if (!line) return null;
  const m = line.match(/(?:EUR|€)\s*([\d.,]+)\s*(million|m)?/i);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  if (isNaN(base)) return null;
  const val = m[2] ? base * 1_000_000 : base;
  return Math.round(val);
}

function getBetween(text, startList, endList) {
  for (const a of startList) {
    for (const b of endList) {
      const re = new RegExp(`${a}[\\s\\S]*?${b}`, "i");
      const m = text.match(re);
      if (m) {
        let body = m[0];
        body = body.replace(new RegExp(`^\\s*${a}\\s*:?\\s*`, "i"), "");
        body = body.replace(new RegExp(`${b}\\s*$`, "i"), "");
        return body.trim();
      }
    }
  }
  return null;
}

export function extractFields(raw) {
  const text = clean(raw);

  // Programme (lightweight detection)
  let programme = "";
  if (/horizon europe/i.test(text)) programme = "Horizon Europe";
  else if (/erasmus\+/i.test(text)) programme = "Erasmus+";
  else if (/\bLIFE\b/i.test(text)) programme = "LIFE";
  else if (/digital europe/i.test(text)) programme = "Digital Europe";

  // Topic/Call ID
  const callId = (text.match(/\b(HORIZON|HE|LIFE|ERASMUS)[A-Z0-9\-_/\.]+/i) || [])[0] || null;

  // Deadlines only near “deadline/cut-off/closing/submission/opening”
  const lines = text.split(/\n+/);
  const dates = [];
  const ctx = /(deadline|cut-?off|closing|submission|opens|opening)/i;
  for (let i = 0; i < lines.length; i++) {
    if (ctx.test(lines[i])) {
      const win = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
      dates.push(...normalizeDates(win));
    }
  }

  // Budget candidates
  let budget = null;
  const budgetLine =
    (text.match(/indicative budget[^\n]{0,200}/i) || [])[0] ||
    (text.match(/total (?:indicative )?budget[^\n]{0,200}/i) || [])[0] ||
    (text.match(/EU contribution[^\n]{0,120}/i) || [])[0] ||
    null;
  if (budgetLine) budget = parseEUR(budgetLine);

  // TRL
  const trl = { min: null, max: null };
  const trlRange = text.match(/\bTRL\s*([1-9])\s*-\s*([1-9])\b/i);
  const trlSingle = text.match(/\bTRL\s*([1-9])\b/i);
  if (trlRange) { trl.min = parseInt(trlRange[1], 10); trl.max = parseInt(trlRange[2], 10); }
  else if (trlSingle) { trl.min = parseInt(trlSingle[1], 10); trl.max = parseInt(trlSingle[1], 10); }

  // Sections
  const scope = getBetween(
    text,
    ["Scope", "Objective", "Objectives", "Specific challenge"],
    ["Expected outcomes", "Expected impact", "Eligibility", "Type of Action", "Specific conditions"]
  );

  const expected_outcomes = getBetween(
    text,
    ["Expected outcomes", "Expected impact", "Expected EU"],
    ["Eligibility", "Specific conditions", "Evaluation", "Award criteria", "Type of Action"]
  );

  const eligibility = getBetween(
    text,
    ["Eligibility", "Eligibility conditions"],
    ["Evaluation", "Award criteria", "Budget", "Call conditions", "Specific conditions", "Type of Action"]
  );

  const notes = [];
  if (!callId) notes.push("No explicit Topic/Call ID detected — document may be broad.");
  if (/work programme/i.test(text) && dates.length > 4) {
    notes.push("Looks like a broad Work Programme; dates may include other topics.");
  }

  return {
    programme,
    callId,
    deadlines: uniq(dates).slice(0, 6),
    budget: budget ?? null,
    trl,
    scope: scope || null,
    expected_outcomes: expected_outcomes || null,
    eligibility: eligibility || null,
    notes
  };
}
