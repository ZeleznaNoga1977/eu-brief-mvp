// lib/extract.js
export function normalizeDates(text) {
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
  return Array.from(new Set(out));
}

export function extractBetween(s, a, b) {
  const r = new RegExp(`${a}[\\s\\S]*?${b}`, 'i');
  const m = s.match(r);
  if (!m) return null;
  let body = m[0];
  body = body.replace(new RegExp(`^\\s*${a}\\s*`, 'i'), '');
  body = body.replace(new RegExp(`${b}\\s*$`, 'i'), '');
  return body.trim();
}

export function extractFields(text) {
  const callId = (text.match(/\b(HORIZON|HE|LIFE|ERASMUS)[A-Z0-9\-_/.]+/i) || [])[0] || null;
  const deadlines = normalizeDates(text);

  const budgetMatch = text.match(/(budget|eu contribution|grant)[^€$]{0,30}([€$]?\s?\d[\d.,\s]*\s?(million|m)?)/i);
  let budget = null;
  if (budgetMatch) {
    let num = budgetMatch[2].replace(/[€$\s,]/g, '');
    let val = parseFloat(num);
    if (!isNaN(val)) {
      if (/million|m/i.test(budgetMatch[0])) val *= 1_000_000;
      budget = val;
    }
  }

  const trlMatch = text.match(/\bTRL\s*([1-9])\s*-\s*([1-9])\b/i) || text.match(/\bTRL\s*([1-9])\b/i);
  const trl = { min: null, max: null };
  if (trlMatch) {
    if (trlMatch.length >= 3) { trl.min = parseInt(trlMatch[1]); trl.max = parseInt(trlMatch[2]); }
    else { trl.min = parseInt(trlMatch[1]); trl.max = parseInt(trlMatch[1]); }
  }

  const scope = extractBetween(text, 'Scope', 'Expected outcomes') || extractBetween(text, 'Scope', 'Expected Outcomes') || null;
  const expected = extractBetween(text, 'Expected outcomes', 'Eligibility') || extractBetween(text, 'Expected Outcomes', 'Eligibility') || null;
  const eligibility = extractBetween(text, 'Eligibility', 'Evaluation') || extractBetween(text, 'Eligibility', 'Award criteria') || null;

  return { callId, deadlines, budget, trl, scope, expected_outcomes: expected, eligibility };
}
