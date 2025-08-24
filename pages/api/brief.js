// pages/api/brief.js
import formidable from "formidable";
import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { extractFields } from "../../lib/extract";
import OpenAI from "openai";

export const config = {
  api: { bodyParser: false }, // handle multipart with formidable
};

// ---------- helpers ----------
function basicBrief(f) {
  const parts = [];
  if (f.callId) parts.push(`Call: ${f.callId}`);
  parts.push(`Deadlines: ${f.deadlines?.join(", ") || "N/A"}`);
  parts.push(`Budget (EUR): ${f.budget ?? "N/A"}`);

  const trl = f.trl || {};
  const trlText =
    trl.min != null && trl.max != null
      ? `${trl.min}–${trl.max}`
      : trl.min != null
      ? `${trl.min}`
      : "N/A";
  parts.push(`TRL: ${trlText}`);

  parts.push("\nSCOPE:\n" + (f.scope || "N/A"));
  parts.push("\nEXPECTED OUTCOMES:\n" + (f.expected_outcomes || "N/A"));
  parts.push("\nELIGIBILITY:\n" + (f.eligibility || "N/A"));
  return parts.join("\n");
}

async function polishWithLLM(fields) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { text: null, error: "NO_API_KEY" };
  }

  const client = new OpenAI({ apiKey });
  const model = (process.env.MODEL_NAME || "gpt-4o-mini").trim();

  const system = `You are a compliance-first editor. The input is trusted JSON extracted from an EU call.
Tasks:
1) Produce a concise 150–180 word brief.
2) Then output a 6–8 item "Key facts" list with: Programme (if known), Call ID, Deadlines, Budget, TRL, Eligibility, and Official link if present.
Rules: Use ONLY the provided JSON; if a field is missing, write "N/A". Do not speculate. Neutral, factual tone.`;

  const user = `JSON:\n${JSON.stringify(fields, null, 2)}`;

  try {
    // Use the Responses API (recommended in the current OpenAI Node SDK)
    const resp = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    });

    // Helper to get a single text string
    const content =
      resp.output_text ||
      resp?.output?.map?.(o =>
        o?.content?.map?.(c => c?.text?.value || "").join("")
      ).join("") ||
      null;

    return { text: content?.trim() || null, error: content ? null : "EMPTY_RESPONSE" };
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || "OPENAI_ERROR";
    return { text: null, error: msg };
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const form = formidable({
    multiples: false,
    maxFileSize: 100 * 1024 * 1024, // note: Vercel request limit may be lower
    keepExtensions: false,
  });

  let filePath;
  try {
    // 1) Parse multipart form-data
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    // 2) Get uploaded file
    const f = files?.pdf || files?.file;
    if (!f) return res.status(400).json({ error: "No PDF uploaded (use field name 'pdf')." });
    filePath = Array.isArray(f) ? f[0].filepath : f.filepath;

    // 3) Read file → extract text
    const data = await fs.readFile(filePath);
    const parsed = await pdfParse(data);
    const text = parsed.text || "";

    // 4) Deterministic extraction → fields JSON
    const fields = extractFields(text);

    // 5) Optional LLM polish
    const { text: llmText, error: llmError } = await polishWithLLM(fields);
    const usedLLM = !!ll
