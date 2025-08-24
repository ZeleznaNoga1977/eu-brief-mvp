// pages/api/brief_url.js
import OpenAI from "openai";
import pdfParse from "pdf-parse";
import { extractFields } from "../../lib/extract";

export const config = { api: { bodyParser: true } };

function basicBrief(f){
  const parts=[]; if(f.callId) parts.push(`Call: ${f.callId}`);
  parts.push(`Deadlines: ${Array.isArray(f.deadlines)&&f.deadlines.length?f.deadlines.join(", "):"N/A"}`);
  parts.push(`Budget (EUR): ${f.budget ?? "N/A"}`);
  const t=f.trl||{}; const trl=t.min!=null&&t.max!=null?`${t.min}–${t.max}`:t.min??"N/A";
  parts.push(`TRL: ${trl}`); parts.push("\nSCOPE:\n"+(f.scope||"N/A")); parts.push("\nEXPECTED OUTCOMES:\n"+(f.expected_outcomes||"N/A")); parts.push("\nELIGIBILITY:\n"+(f.eligibility||"N/A"));
  return parts.join("\n");
}

async function polish(fields){
  const apiKey=process.env.OPENAI_API_KEY?.trim(); if(!apiKey) return {text:null,error:"NO_API_KEY"};
  const client=new OpenAI({apiKey}); const model=(process.env.MODEL_NAME||"gpt-4o-mini").trim();
  const system=`You are a compliance-first editor. Use ONLY the provided JSON. If a field is missing, write "N/A". Neutral tone.`;
  const user=`JSON:\n${JSON.stringify(fields,null,2)}\n\nWrite a 150–180 word brief, then a "Key facts" list (Programme, Call ID, Deadlines, Budget, TRL, Eligibility, Official link if present).`;
  try{
    const r=await client.responses.create({model, input:[{role:"system",content:system},{role:"user",content:user}], temperature:0.2});
    const text=r.output_text?.trim?.()||null; return {text, error:text?null:"EMPTY_RESPONSE"};
  }catch(e){ return {text:null,error:e?.message||"OPENAI_ERROR"}}
}

function htmlToText(html){ return (html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim(); }
function abs(href, base){ try{ return new URL(href, base).href; }catch{ return null; } }
function findWP(html, base){
  const out=[]; const re=/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi; let m;
  while((m=re.exec(html))!==null){ const href=m[1]; const text=(m[2]||"").replace(/<[^>]+>/g,"").trim(); const url=abs(href,base); if(!url) continue;
    const isPDF=/\.pdf(\?|#|$)/i.test(url); const looksText=/work\s*programme|work\s*program/i.test(text); const looksHref=/work|wp|programme/i.test(url);
    if(isPDF&&(looksText||looksHref)) out.push(url);
  }
  return Array.from(new Set(out));
}
async function fetchBuf(url){ const r=await fetch(url); if(!r.ok) throw new Error(`Fetch failed (${r.status})`); const ab=await r.arrayBuffer(); return Buffer.from(ab); }

function merge(topic, wp, topicUrl, wpUrl){
  const out={...(topic||{})};
  out.programme = out.programme || wp?.programme || "";
  out.callId = out.callId || wp?.callId || null;
  out.deadlines = (Array.isArray(out.deadlines)&&out.deadlines.length)? out.deadlines : (wp?.deadlines||[]);
  out.budget = (wp && wp.budget!=null)? wp.budget : (out.budget ?? null);
  out.trl = out.trl || {}; out.trl.min = (out.trl.min!=null)?out.trl.min:(wp?.trl?.min??null); out.trl.max = (out.trl.max!=null)?out.trl.max:(wp?.trl?.max??null);
  out.scope = out.scope || wp?.scope || null;
  if(!out.expected_outcomes || (Array.isArray(out.expected_outcomes)&&out.expected_outcomes.length===0)) out.expected_outcomes = wp?.expected_outcomes || null;
  out.eligibility = out.eligibility || wp?.eligibility || null;
  out.notes=[...(topic?.notes||[]), ...(wp?.notes||[])];
  if(wpUrl) out.notes.push(`Merged with Work Programme: ${wpUrl}`);
  if(topicUrl) out.official_link = topicUrl;
  if(wpUrl) out.work_programme_link = wpUrl;
  return out;
}

export default async function handler(req,res){
  if(req.method!=="POST"){ res.setHeader("Allow","POST"); return res.status(405).json({error:"Method Not Allowed"}); }
  try{
    const { url } = req.body || {};
    if(!url || typeof url!=="string"){ return res.status(400).json({error:"Provide { url } in JSON body."}); }

    const r = await fetch(url);
    if(!r.ok) return res.status(400).json({error:`Fetch failed (${r.status})`});
    const html = await r.text();
    const topicFields = extractFields(htmlToText(html));

    let wpFields=null, wpUrl=null;
    try{
      const links=findWP(html, url);
      if(links.length>0){
        wpUrl=links[0];
        const buf=await fetchBuf(wpUrl);
        const parsed=await pdfParse(buf);
        wpFields=extractFields(parsed.text||"");
      } else {
        topicFields.notes=[...(topicFields.notes||[]), "No Work Programme PDF link detected on the page."];
      }
    }catch{ topicFields.notes=[...(topicFields.notes||[]), "Work Programme fetch/parse failed."]; }

    const merged = merge(topicFields, wpFields, url, wpUrl);
    const { text: llmText, error: llmError } = await polish(merged);
    const usedLLM = !!llmText;
    const brief = usedLLM ? `【LLM polished】\n\n${llmText}` : basicBrief(merged);

    return res.status(200).json({
      brief, fields: merged, usedLLM,
      llmError: usedLLM ? null : llmError || null,
      model: process.env.MODEL_NAME || "gpt-4o-mini",
      hasApiKey: !!process.env.OPENAI_API_KEY
    });
  }catch{
    return res.status(500).json({error:"URL processing failed."});
  }
}
