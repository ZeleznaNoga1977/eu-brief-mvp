// pages/api/brief.js
import formidable from "formidable";
import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { extractFields } from "../../lib/extract";
import OpenAI from "openai";

export const config = {
  api: { bodyParser: false }, // needed for formidable (multipart)
};

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
  if (!process.env.OPENAI_API_KEY) return null; // optional for later
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.MODEL_NAME || "gpt-4o-mini";
    const prompt = `You are a compliance-first editor. Input is trusted JSON extracted from an EU call.
Tasks: (1) produce a crisp 150–180 word brief; (2) output a 6–8 item "Key facts" list with: Programme (if known), Call ID, Deadlines, Budget, TRL, Eligibility, Official link (if present).
Rules: use ONLY the provided JSON; if a field is missing, write "N/A"; do not speculate; neutral tone.
JSON:
${JSON.stringify(fields, null, 2)}`;

    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    return resp.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const form = formidable({
    multiples: false,
    maxFileSize: 100 * 1024 * 1024, // 100MB
    keepExtensions: false,
  });

  let filePath;
  try {
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const f = files?.pdf || files?.file;
    if (!f) return res.status(400).json({ error: "No PDF uploaded (use field name 'pdf')." });

    filePath = Array.isArray(f) ? f[0].filepath : f.filepath;

    const data = await fs.readFile(filePath);
    const parsed = await pdfParse(data);
    const text = parsed.text || "";

    const fields = extractFields(text);
    const llm = await polishWithLLM(fields);
    const brief = llm || basicBrief(fields);

    // best-effort wipe & delete temp file
    try {
      await fs.writeFile(filePath, "");
      await fs.unlink(filePath);
    } catch {}

    return res.status(200).json({ brief, fields });
  } catch (e) {
    if (filePath) {
      try { await fs.unlink(filePath); } catch {}
    }
    return res.status(500).json({ error: "Failed to process PDF." });
  }
}
