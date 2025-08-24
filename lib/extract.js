// lib/extract.js  — cleaner + tolerant headings + contextual deadlines/budget

function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

// -------- preclean: strip headers/footers/nav junk ----------
function preclean(raw) {
  let t = (raw || "").replace(/\r/g, "");
  const lines = t.split("\n");
  const counts = {};
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    counts[s] = (counts[s] || 0) + 1;
  }
  const bad = [
    /EU Funding.*Tenders Portal/i,
    /Sign in/i,
    /^\s*EN\s*$/i,
    /Page \d+ of \d+/i,
    /^\d+\s*\/\s*\d+$/i,
    /^\s*Annex [A-Z]\b/i,
    /https?:\/\/\S+/i,               // URLs from nav (we're not using links yet)
    /^[A-Z]{2}.*[A-Z].*[A-Z].*$/i    // weird header gibberish like HF...P... etc.
  ];
  const filtered = lines.filter(ln => {
    const s = ln.trim();
    if (!s) return false;
    if (counts[s] >= 3) return false;       // drop lines repeated on many pages
    return !bad.some(r => r.test(s));
  });
  return filtered.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

// -------- date helpers ----------
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

function extractDeadlinesContext(text) {
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

// -------- text sectioning ----------
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
  const items = lines.filter(s =>
    /^[-–•·]/.test(s) || s.endsWith(";") || s.endsWith(".")
  );
  if (items.length === 0) {
    return block.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, 10);
  }
  return items.map(s => s.replace(/^[-–•·]\s*/, "")).slice(0, 12);
}

// -------- budget ----------
function parseEUR(s) {
  if (!s) return null;
  const m = s.match(/([€$]?\s?\d[\d.,\s]*)(\s?(m|million))?/i);
  if (!m) return null;
  let num = m[1].replace(/[€$\s,]/g, "");
  let val = parseFloat(num);
  if (isNaN(val)) return null;
  if (m[3]) val = val * 1_000_000;
  retur
