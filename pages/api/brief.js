// pages/api/brief.js
import formidable from "formidable";
import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { extractFields } from "../../lib/extract";
import OpenAI from "openai";

export const config = { api: { bodyParser: false } };

// ---------- helpers ----------
function basicBrief(f) {
  const parts = [];
  if (f.callId) parts.push(`Call: ${f.callId}`);
  parts.push(`Deadlines: ${Array.isArray(f.deadlines) && f.deadlines.length ? f.deadlines.join(", ") : "N/A"}`);
  parts.push(`Budget (EUR): ${f.budget ?? "N/A"}`);
  const trl = f.trl || {};
  const trlText =
    trl.min != null && trl.max != null ? `${trl.min}–${trl.max}`
    : trl.min != null ? `${trl.min}` : "N/A";
  parts.push(`TRL: ${trlText}`);
  parts.push("\nSCOPE:\n" + (f.scope || "N/A"));
  parts.push("\nEXPECTED OUTCOMES:\n" + (f.expected_outcomes || "N/A"));
  parts.push("\nELIGIBILITY:\n" + (f.eligibility || "N/A"));
  return parts.join("\n");
}

async function polishWithLLM(fields) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { text: null, error: "NO_API_KEY" };
  try {
    const client = new OpenAI({ apiKey });
    const model = (process.env.MODEL_NAME || "gpt-4o-mini").trim();
    const system = `You are a compliance-first editor. Use ONLY the provided JSON. If a field is missing, write "N/A". Neutral, factual tone.`;
    const user = `JSON:\n${JSON.stringify(fields, null, 2)}\n\nWrite a 150–180 word brief, then a "Key facts" list (Programme, Call ID, Deadlines, Budget, TRL, Eligibility, Official link if present).`;
    const resp = await client.responses.create({
      model,
      input: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2,
    });
    const text = resp.output_text?.trim?.() || null;
    return { text, error: text ? null : "EMPTY_RESPONSE" };
  } catch (e) {
    return { text: null, error: e?.message || "OPENAI_ERROR" };
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const form = formidable({ multiples: false, maxFileSize: 100 * 1024 * 1024, keepExtensions: false });

  let filePath;
  try {
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const f = files?.pdf || files?.file;
    if (!f) return res.status(400).json({ error: "No PDF uploaded (use field name 'pdf')." });
    filePath = Array.isArray(f) ? f[0].filepath : f.filepath;

    const data = await fs.readFile(filePath);
    const parsed = await pdfParse(data);
    const text = parsed.text || "";

    const fields = extractFields(text);

    const { text: llmText, error: llmError } = await polishWithLLM(fields);
    const usedLLM = !!llmText;
    const brief = usedLLM ? `【LLM polished】\n\n${llmText}` : basicBrief(fields);

    try { await fs.writeFile(filePath, ""); } catch {}
    try { await fs.unlink(filePath); } catch {}

    return res.status(200).json({
      brief,
      fields,
      usedLLM,
      llmError: usedLLM ? null : llmError || null,
      model: process.env.MODEL_NAME || "gpt-4o-mini",
      hasApiKey: !!process.env.OPENAI_API_KEY
    });
  } catch {
    if (filePath) { try { await fs.unlink(filePath); } catch {} }
    return res.status(500).json({ error: "Failed to process PDF." });
  }
}
