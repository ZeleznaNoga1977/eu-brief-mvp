import { useState } from "react";

export default function Home() {
  const [pdf, setPdf] = useState(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pdf) return;
    setBusy(true);
    setResult("");
    const body = new FormData();
    body.append("pdf", pdf);
    const res = await fetch("/api/brief", { method: "POST", body });
    const data = await res.json();
    setResult(data.brief || data.error || "No result");
    setBusy(false);
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

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>EU Call Brief (MVP)</h1>
      <p>Upload a PDF. We extract key parts and optionally polish with an LLM. No email. No storage.</p>
      <form onSubmit={handleSubmit}>
        <input type="file" accept="application/pdf" onChange={e => setPdf(e.target.files?.[0] || null)} />
        <button type="submit" disabled={busy} style={{ marginLeft: 12 }}>
          {busy ? "Processing..." : "Create brief"}
        </button>
      </form>

      {result && (
        <section style={{ marginTop: 24 }}>
          <h2>Brief</h2>
          <pre style={{ whiteSpace: "pre-wrap", background: "#f6f8fa", padding: 16, borderRadius: 8 }}>{result}</pre>
          <button onClick={downloadTxt}>Download .txt</button>
        </section>
      )}
    </main>
  );
}
