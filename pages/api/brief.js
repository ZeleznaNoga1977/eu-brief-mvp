// pages/api/brief.js
import formidable from "formidable";
import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { extractFields } from "../../lib/extract";
import OpenAI from "openai";

export const config = {
  api: { bodyParser: false }, // we handle multipart with formidable
};

// -------- helpers --------
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
  if (!process.env.OPENAI_API_KEY) {
    return { text: null, error: "NO_API_KEY" };
  }
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.MODEL_NAME || "gpt-4o-mini";

    const prompt = `You are a compliance-first editor. The input is trusted JSON extracted from an EU call.

Tasks:
1) Produce a concise 150–180 word brief.
2) Then output a 6–8 item "Key facts" list with: Programme (if known), Call ID, Deadlines, Budget, TRL, Eligibility, and Official link if present.

Rules:
- Use ONLY the provided JSON; if a field is missing, write "N/A".
- Do not speculate or invent facts.
- Keep tone neutral and factual.

JSON:
${JSON.stringify(fields, null, 2)}`;

    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const content = resp.choices?.[0]?.message?.content?.trim() || null;
    return { text: content, error: content ? null : "EMPTY_RESPONSE" };
  } catch (e) {
    return { text: null, error: e?.message || "OPENAI_ERROR" };
  }
}

// -------- handler --------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const form = formidable({
    multiples: false,
    maxFileSize: 100 * 1024 * 1024, // 100MB (actual Vercel upload limit may be lower)
    keepExtensions: false,
  });

  let filePath;
  try {
    // parse multipart form-data
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    // get uploaded file (field name: "pdf")
    const f = files?.pdf || files?.file;
    if (!f) return res.status(400).json({ error: "No PDF uploaded (use field name 'pdf')." });
    filePath = Array.isArray(f) ? f[0].filepath : f.filepath;

    // read file → extract text
    const data = await fs.readFile(filePath);
    const parsed = await pdfParse(data);
    const text = parsed.text || "";

    // deterministic extraction → fields JSON
    const fields = extractFields(text);

    // optional LLM polish
    const { text: llmText, error: llmError } = await polishWithLLM(fields);
    const usedLLM = !!llmText;
    const brief = usedLLM ? `【LLM polished】\n\n${llmText}` : basicBrief(fields);

    // clean up temp file
    try {
      await fs.writeFile(filePath, "");
      await fs.unlink(filePath);
    } catch {}

    // respond
    return res.status(200).json({ brief, fields, usedLLM, llmError: usedLLM ? null : llmError || null });
  } catch (e) {
    if (filePath) {
      try { await fs.unlink(filePath); } catch {}
    }
    return res.status(500).json({ error: "Failed to process PDF." });
  }
}
