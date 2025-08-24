import { useState } from "react";

function eur(n) {
  if (n == null) return "N/A";
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " €";
  } catch {
    return `${n} €`;
  }
}

function trlText(trl) {
  if (!trl) return "N/A";
  const { min, max } = trl;
  if (min != null && max != null) return `${min}–${max}`;
  if (min != null) return String(min);
  return "N/A";
}

export default function Home() {
  const [pdf, setPdf] = useState(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState(null); // { usedLLM, llmError, model, hasApiKey, fields }
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResult("");
    setDebug(null);
    if (!pdf) {
      setError("Please select a PDF first.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("pdf", pdf);
      const res = await fetch("/api/brief", { method: "POST", body });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || `Upload failed (${res.status}).`);
      } else {
        setResult(data?.brief || "No brief returned.");
        setDebug({
          usedLLM: data?.usedLLM ?? false,
          llmError: data?.llmError ?? null,
          model: data?.model ?? null,
          hasApiKey: data?.hasApiKey ?? null,
          fields: data?.fields ?? null,
        });
      }
    } catch {
      setError("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function downloadTxt() {
    if (!result) return;
    const blob = new Blob([result], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "eu-call-brief.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const f = debug?.fields || null;

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>EU Call Brief (MVP)</h1>
      <p>Upload a PDF. We extract key parts and optionally polish with an LLM. No email. No storage.</p>

      <form onSubmit={handleSubmit}>
        <input type="file" accept="application/pdf" onChange={e => setPdf(e.target.files?.[0] || null)} />
        <button type="submit" disabled={busy} style={{ marginLeft: 12 }}>
          {busy ? "Processing..." : "Create brief"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 16, color: "#b00020" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Key facts card */}
      {f && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ marginBottom: 8 }}>Key facts</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, background: "#f7fbff", padding: 16, borderRadius: 8, border: "1px solid #dbeafe" }}>
            <div><strong>Programme</strong></div><div>{f.programme || "N/A"}</div>
            <div><strong>Call / Topic ID</strong></div><div>{f.callId || "N/A"}</div>
            <div><strong>Deadlines</strong></div><div>{Array.isArray(f.deadlines) && f.deadlines.length ? f.deadlines.join(", ") : "N/A"}</div>
            <div><strong>Budget</strong></div><div>{eur(f.budget)}</div>
            <div><strong>TRL</strong></div><div>{trlText(f.trl)}</div>
            <div><strong>Eligibility</strong></div><div>{f.eligibility ? (f.eligibility.length > 260 ? f.eligibility.slice(0, 260) + "…" : f.eligibility) : "N/A"}</div>
            {Array.isArray(f.notes) && f.notes.length > 0 && (
              <>
                <div><strong>Notes</strong></div><div>{f.notes.join(" • ")}</div>
              </>
            )}
          </div>
        </section>
      )}

      {result && (
        <section style={{ marginTop: 24 }}>
          <h2>Brief</h2>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f6f8fa", padding: 16, borderRadius: 8 }}>{result}</pre>
          <button onClick={downloadTxt}>Download .txt</button>
        </section>
      )}

      {/* Debug panel (collapsible info) */}
      {debug && (
        <section style={{ marginTop: 24, background: "#fffbe6", padding: 12, borderRadius: 8, border: "1px solid #ffe58f" }}>
          <h3 style={{ marginTop: 0 }}>Debug</h3>
          <div>usedLLM: <strong>{String(debug.usedLLM)}</strong></div>
          <div>llmError: <code>{debug.llmError ?? "null"}</code></div>
          <div>model: <code>{debug.model ?? "null"}</code></div>
          <div>hasApiKey: <strong>{String(debug.hasApiKey)}</strong></div>
          <details style={{ marginTop: 8 }}>
            <summary>Show extracted fields JSON</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(debug.fields, null, 2)}</pre>
          </details>
        </section>
      )}
    </main>
  );
}
