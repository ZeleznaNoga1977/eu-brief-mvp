import { useState } from "react";

export default function Home() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setResults([]);
    for (const f of files) {
      const body = new FormData();
      body.append("pdf", f);
      try {
        const res = await fetch("/api/brief", { method: "POST", body });
        const data = await res.json();
        setResults(prev => [
          ...prev,
          { name: f.name, brief: data.brief || data.error || "No result" }
        ]);
      } catch {
        setResults(prev => [...prev, { name: f.name, brief: "Upload failed." }]);
      }
    }
    setBusy(false);
  }

  function downloadTxt(name, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "eu-call").replace(/\.pdf$/i, "")}-brief.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ maxWidth: 760, margin: "40px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>EU Call Brief (MVP)</h1>
      <p>Select one or more PDFs. We extract key parts and optionally polish with an LLM. No email. No storage.</p>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={e => setFiles(Array.from(e.target.files || []))}
        />
        <button type="submit" disabled={busy} style={{ marginLeft: 12 }}>
          {busy ? "Processing..." : files.length ? `Create ${files.length} brief(s)` : "Create brief(s)"}
        </button>
      </form>

      {results.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2>Briefs</h2>
          {results.map(({ name, brief }, i) => (
            <div key={i} style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 8 }}>{name || `Document ${i + 1}`}</h3>
              <pre style={{ whiteSpace: "pre-wrap", background: "#f6f8fa", padding: 16, borderRadius: 8 }}>{brief}</pre>
              <button onClick={() => downloadTxt(name, brief)}>Download .txt</button>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
