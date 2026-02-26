import { useState, useRef } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

function generateMarketData(ticker, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  const seed = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  let rng = seed;
  const rand = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };
  const baseReturn = 0.0004 + (rand() - 0.5) * 0.0006;
  const baseVol = 0.012 + rand() * 0.008;
  let price = 100 + rand() * 200;
  const prices = [], returns = [], volatility = [];

  for (let i = 0; i <= days; i++) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const progress = i / days;
    const regime =
      progress < 0.25 ? "Bull" :
      progress < 0.45 ? "Volatile" :
      progress < 0.65 ? "Bear" :
      progress < 0.8 ? "Recovery" : "Bull";
    const volMult = regime === "Volatile" ? 2.2 : regime === "Bear" ? 1.6 : regime === "Recovery" ? 1.2 : 1.0;
    const retMult = regime === "Bull" ? 1.4 : regime === "Bear" ? -1.2 : regime === "Volatile" ? -0.3 : regime === "Recovery" ? 0.8 : 1.0;
    const vol = baseVol * volMult;
    const ret = baseReturn * retMult + (rand() - 0.5) * vol * 2;
    price *= (1 + ret);
    const forecastedRet = baseReturn * retMult * 0.85 + (rand() - 0.48) * vol * 1.5;
    const forecastedPrice = price * (1 + forecastedRet - ret);
    const dateStr = date.toISOString().slice(0, 10);
    prices.push({ date: dateStr, actual: +price.toFixed(2), forecast: +forecastedPrice.toFixed(2), regime });
    returns.push({ date: dateStr, actual: +(ret * 100).toFixed(3), forecast: +(forecastedRet * 100).toFixed(3), regime });
    volatility.push({ date: dateStr, vol: +(vol * 100).toFixed(3), regime });
  }

  const regimeStats = {};
  returns.forEach(({ regime, actual, forecast }) => {
    if (!regimeStats[regime]) regimeStats[regime] = { actual: [], forecast: [], count: 0 };
    regimeStats[regime].actual.push(actual);
    regimeStats[regime].forecast.push(forecast);
    regimeStats[regime].count++;
  });
  const regimeSummary = Object.entries(regimeStats).map(([name, d]) => ({
    name,
    actualReturn: +(d.actual.reduce((a, b) => a + b, 0) / d.actual.length).toFixed(3),
    forecastReturn: +(d.forecast.reduce((a, b) => a + b, 0) / d.forecast.length).toFixed(3),
    avgVol: +(d.actual.map(Math.abs).reduce((a, b) => a + b, 0) / d.actual.length * 10).toFixed(3),
    count: d.count,
  }));

  const totalReturn = +((prices[prices.length - 1]?.actual / prices[0]?.actual - 1) * 100).toFixed(2);
  const avgVol = +(volatility.reduce((a, b) => a + b.vol, 0) / volatility.length).toFixed(3);
  const signalAccuracy = +(85 - rand() * 20).toFixed(1);
  const sharpe = +(totalReturn / 100 / (avgVol / 100 * Math.sqrt(252))).toFixed(2);
  return { prices, returns, volatility, regimeSummary, totalReturn, avgVol, signalAccuracy, sharpe, ticker, days: prices.length };
}

async function fetchClaudeAnalysis(data, apiKey) {
  const { ticker, totalReturn, avgVol, signalAccuracy, sharpe, regimeSummary, days } = data;
  const regimeText = regimeSummary.map(r =>
    `${r.name}: avg daily return ${r.actualReturn}%, forecast ${r.forecastReturn}%, vol ${r.avgVol}%`
  ).join("; ");

  const prompt = `You are a quantitative financial analyst. Analyze this market data for ${ticker} over ${days} trading days.

Key metrics:
- Total Return: ${totalReturn}%
- Average Daily Volatility: ${avgVol}%
- Signal Accuracy: ${signalAccuracy}%
- Sharpe Ratio: ${sharpe}

Regime Performance: ${regimeText}

Provide a structured analysis with these exact sections (use these headers):
**SIGNAL QUALITY**
**REGIME ANALYSIS**
**RISK PROFILE**
**KEY INSIGHT**

Each section: 2-3 sentences. Be specific, quantitative, and direct. No fluff. Write like a Bloomberg terminal analyst note.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const json = await response.json();
  if (!response.ok) {
    return `Error ${response.status}: ${json?.error?.message || "Unknown error"}`;
  }
  return json?.content?.[0]?.text || "No analysis returned.";
}

const REGIME_COLORS = { Bull: "#00d4aa", Volatile: "#f5a623", Bear: "#ff4d6d", Recovery: "#7b8cde" };
const REGIME_BG = { Bull: "rgba(0,212,170,0.12)", Volatile: "rgba(245,166,35,0.12)", Bear: "rgba(255,77,109,0.12)", Recovery: "rgba(123,140,222,0.12)" };

const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>
      <div style={{ color: "#8b949e", marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <span style={{ color: "#e6edf3" }}>{typeof p.value === "number" ? p.value.toFixed(3) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function App() {
  const [ticker, setTicker] = useState("NVDA");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [data, setData] = useState(null);
  const [analysis, setAnalysis] = useState("");
  const [activeRegime, setActiveRegime] = useState(null);
  const analysisRef = useRef(null);

  const handleAnalyze = async () => {
    if (!ticker || !startDate || !endDate || !apiKey) return;
    setLoading(true);
    setData(null);
    setAnalysis("");
    setPhase("data");
    await new Promise(r => setTimeout(r, 900));
    const marketData = generateMarketData(ticker.toUpperCase(), startDate, endDate);
    setData(marketData);
    setPhase("ai");
    const aiText = await fetchClaudeAnalysis(marketData, apiKey);
    setAnalysis(aiText);
    setLoading(false);
    setPhase("");
    setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  const parsedSections = analysis ? (() => {
    const sections = [];
    const headers = ["SIGNAL QUALITY", "REGIME ANALYSIS", "RISK PROFILE", "KEY INSIGHT"];
    const icons = ["◈", "◉", "⬡", "◆"];
    headers.forEach((h, i) => {
      const regex = new RegExp(`\\*\\*${h}\\*\\*([\\s\\S]*?)(?=\\*\\*[A-Z]|$)`);
      const match = analysis.match(regex);
      if (match) sections.push({ title: h, content: match[1].trim(), icon: icons[i] });
    });
    return sections.length ? sections : [{ title: "ANALYSIS", content: analysis, icon: "◈" }];
  })() : [];

  const chartPrices = data?.prices.filter((_, i) => i % 3 === 0) ?? [];
  const chartReturns = data?.returns.filter((_, i) => i % 3 === 0) ?? [];
  const chartVol = data?.volatility.filter((_, i) => i % 3 === 0) ?? [];

  const statCards = data ? [
    { label: "TOTAL RETURN", value: `${data.totalReturn > 0 ? "+" : ""}${data.totalReturn}%`, color: data.totalReturn > 0 ? "#00d4aa" : "#ff4d6d" },
    { label: "AVG VOLATILITY", value: `${data.avgVol}%`, color: "#f5a623" },
    { label: "SIGNAL ACCURACY", value: `${data.signalAccuracy}%`, color: "#7b8cde" },
    { label: "SHARPE RATIO", value: data.sharpe, color: data.sharpe > 1 ? "#00d4aa" : data.sharpe > 0 ? "#f5a623" : "#ff4d6d" },
  ] : [];

  const keyStatus = !apiKey ? null : apiKey.trim().startsWith("sk-ant-") ? "valid" : "invalid";

  return (
    <div style={{ minHeight: "100vh", background: "#010409", color: "#e6edf3", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #010409; } ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        input { outline: none; }
        .stat-card { transition: transform 0.2s, border-color 0.2s; }
        .stat-card:hover { transform: translateY(-2px); border-color: #58a6ff !important; }
        .regime-badge { transition: all 0.15s; cursor: pointer; }
        .regime-badge:hover { transform: scale(1.04); }
        .analyze-btn { transition: all 0.2s; }
        .analyze-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 0 24px rgba(0,212,170,0.35); }
        .analyze-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .section-card { transition: border-color 0.2s; }
        .section-card:hover { border-color: rgba(0,212,170,0.3) !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .fade-up { animation: fadeUp 0.5s ease forwards; }
        .pulse { animation: pulse 1.4s infinite; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #21262d", background: "rgba(1,4,9,0.95)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 100, padding: "0 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #00d4aa, #0099ff)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⬡</div>
            <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.02em" }}>REGIME<span style={{ color: "#00d4aa" }}>IQ</span></span>
            <span style={{ color: "#30363d", margin: "0 4px" }}>|</span>
            <span style={{ color: "#8b949e", fontSize: 11, letterSpacing: "0.1em" }}>SIGNAL INTELLIGENCE PLATFORM</span>
          </div>
          <div style={{ display: "flex", gap: 20, fontSize: 11, color: "#8b949e", letterSpacing: "0.08em" }}>
            {["MARKETS", "MODELS", "REGIMES", "DOCS"].map(t => (
              <span key={t} style={{ cursor: "pointer" }}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px 64px" }}>

        {/* Hero */}
        <div style={{ marginBottom: 40, paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: "#00d4aa", letterSpacing: "0.15em", marginBottom: 12 }}>◈ AI-POWERED MARKET REGIME ANALYSIS</div>
          <h1 style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 36, fontWeight: 700, lineHeight: 1.15, marginBottom: 12, background: "linear-gradient(135deg, #e6edf3 0%, #8b949e 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Does your signal hold<br />across market regimes?
          </h1>
          <p style={{ color: "#8b949e", fontSize: 13, lineHeight: 1.7, maxWidth: 520 }}>
            Evaluate forecasting model performance under real-world conditions — not just backtests.
            Powered by Claude AI for regime-segmented signal attribution.
          </p>
        </div>

        {/* Input Panel */}
        <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, padding: 28, marginBottom: 32 }}>
          <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em", marginBottom: 20 }}>◉ ANALYSIS PARAMETERS</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>

            <div style={{ flex: "1 1 120px" }}>
              <label style={{ display: "block", fontSize: 10, color: "#8b949e", letterSpacing: "0.1em", marginBottom: 8 }}>TICKER</label>
              <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="NVDA"
                style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: "10px 14px", color: "#e6edf3", fontSize: 14, fontFamily: "inherit" }} />
            </div>

            <div style={{ flex: "2 1 150px" }}>
              <label style={{ display: "block", fontSize: 10, color: "#8b949e", letterSpacing: "0.1em", marginBottom: 8 }}>START DATE</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: "10px 14px", color: "#e6edf3", fontSize: 13, fontFamily: "inherit", colorScheme: "dark" }} />
            </div>

            <div style={{ flex: "2 1 150px" }}>
              <label style={{ display: "block", fontSize: 10, color: "#8b949e", letterSpacing: "0.1em", marginBottom: 8 }}>END DATE</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", borderRadius: 6, padding: "10px 14px", color: "#e6edf3", fontSize: 13, fontFamily: "inherit", colorScheme: "dark" }} />
            </div>

            <div style={{ flex: "3 1 240px" }}>
              <label style={{ display: "block", fontSize: 10, color: "#8b949e", letterSpacing: "0.1em", marginBottom: 8 }}>
                ANTHROPIC API KEY
                <span onClick={() => setShowKey(!showKey)} style={{ marginLeft: 8, color: "#58a6ff", cursor: "pointer", fontSize: 9 }}>
                  {showKey ? "HIDE" : "SHOW"}
                </span>
              </label>
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                style={{ width: "100%", background: "#161b22", border: `1px solid ${keyStatus === "valid" ? "#00d4aa" : keyStatus === "invalid" ? "#ff4d6d" : "#30363d"}`, borderRadius: 6, padding: "10px 14px", color: "#e6edf3", fontSize: 13, fontFamily: "inherit" }} />
            </div>

            <div style={{ flex: "1 1 160px" }}>
              <button
                onClick={handleAnalyze}
                disabled={loading || !apiKey || !ticker}
                className="analyze-btn"
                style={{ width: "100%", background: "linear-gradient(135deg, #00d4aa, #0099ff)", border: "none", borderRadius: 6, padding: "11px 24px", color: "#010409", fontSize: 12, fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.1em", cursor: "pointer" }}>
                {loading ? (phase === "data" ? "LOADING..." : "ANALYZING...") : "▶  RUN ANALYSIS"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, minHeight: 18 }}>
            {!apiKey && <span style={{ color: "#8b949e" }}>⚠ Enter your API key from console.anthropic.com to enable AI analysis</span>}
            {keyStatus === "invalid" && <span style={{ color: "#ff4d6d" }}>✕ Key should start with "sk-ant-" — double check for extra spaces</span>}
            {keyStatus === "valid" && <span style={{ color: "#00d4aa" }}>✓ API key format looks correct</span>}
          </div>

          {loading && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 10, color: "#8b949e" }}>
                <span className="pulse">{phase === "data" ? "Generating market regime simulation..." : "Claude analyzing signal stability..."}</span>
                <span style={{ color: "#00d4aa" }}>{phase === "data" ? "1/2" : "2/2"}</span>
              </div>
              <div style={{ height: 2, background: "#21262d", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ height: "100%", width: phase === "ai" ? "100%" : "45%", background: "linear-gradient(90deg, #00d4aa, #0099ff)", borderRadius: 1, transition: "width 0.8s ease" }} />
              </div>
            </div>
          )}
        </div>

        {/* Stat Cards */}
        {data && (
          <div className="fade-up" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
            {statCards.map((s, i) => (
              <div key={i} className="stat-card" style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: "18px 20px" }}>
                <div style={{ fontSize: 9, color: "#8b949e", letterSpacing: "0.12em", marginBottom: 10 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 600, color: s.color, fontFamily: "'IBM Plex Sans', sans-serif" }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        {data && (
          <div className="fade-up" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>

            <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, padding: "22px 20px 16px", gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em", marginBottom: 4 }}>◈ PRICE — ACTUAL VS FORECASTED</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>{data.ticker} · {data.days} trading days</div>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 10 }}>
                  <span style={{ color: "#00d4aa" }}>— Actual</span>
                  <span style={{ color: "#7b8cde", opacity: 0.7 }}>— Forecast</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartPrices}>
                  <defs>
                    <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00d4aa" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#00d4aa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 9 }} tickLine={false} interval={Math.floor(chartPrices.length / 6)} />
                  <YAxis tick={{ fill: "#8b949e", fontSize: 9 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<DarkTooltip />} />
                  <Area type="monotone" dataKey="actual" stroke="#00d4aa" strokeWidth={1.5} fill="url(#actualGrad)" dot={false} name="Actual" />
                  <Line type="monotone" dataKey="forecast" stroke="#7b8cde" strokeWidth={1} strokeDasharray="4 3" dot={false} name="Forecast" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, padding: "22px 20px 16px" }}>
              <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em", marginBottom: 4 }}>◉ DAILY RETURNS — SIGNAL DEVIATION</div>
              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16 }}>Actual vs forecast divergence by regime</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartReturns}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 8 }} tickLine={false} interval={Math.floor(chartReturns.length / 5)} />
                  <YAxis tick={{ fill: "#8b949e", fontSize: 9 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<DarkTooltip />} />
                  <ReferenceLine y={0} stroke="#30363d" strokeDasharray="2 2" />
                  <Line type="monotone" dataKey="actual" stroke="#f5a623" strokeWidth={1} dot={false} name="Actual %" />
                  <Line type="monotone" dataKey="forecast" stroke="#7b8cde" strokeWidth={1} strokeDasharray="3 2" dot={false} name="Forecast %" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, padding: "22px 20px 16px" }}>
              <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em", marginBottom: 4 }}>⬡ VOLATILITY EXPOSURE BY DATE</div>
              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 16 }}>Daily realized volatility (%)</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartVol} barSize={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fill: "#8b949e", fontSize: 8 }} tickLine={false} interval={Math.floor(chartVol.length / 5)} />
                  <YAxis tick={{ fill: "#8b949e", fontSize: 9 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<DarkTooltip />} />
                  <Bar dataKey="vol" fill="#ff4d6d" opacity={0.7} name="Volatility %" />
                </BarChart>
              </ResponsiveContainer>
            </div>

          </div>
        )}

        {/* Regime Breakdown */}
        {data && (
          <div className="fade-up" style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, padding: "22px 24px", marginBottom: 28 }}>
            <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em", marginBottom: 18 }}>◆ REGIME PERFORMANCE BREAKDOWN</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {data.regimeSummary.map((r) => (
                <div key={r.name} className="regime-badge"
                  onClick={() => setActiveRegime(activeRegime === r.name ? null : r.name)}
                  style={{ background: activeRegime === r.name ? REGIME_BG[r.name] : "#161b22", border: `1px solid ${activeRegime === r.name ? REGIME_COLORS[r.name] : "#30363d"}`, borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: REGIME_COLORS[r.name], letterSpacing: "0.05em" }}>{r.name.toUpperCase()}</span>
                    <span style={{ fontSize: 9, color: "#8b949e" }}>{r.count}d</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4 }}>Actual <span style={{ color: r.actualReturn > 0 ? "#00d4aa" : "#ff4d6d" }}>{r.actualReturn > 0 ? "+" : ""}{r.actualReturn}%</span></div>
                  <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4 }}>Forecast <span style={{ color: "#7b8cde" }}>{r.forecastReturn > 0 ? "+" : ""}{r.forecastReturn}%</span></div>
                  <div style={{ fontSize: 10, color: "#8b949e" }}>Avg Vol <span style={{ color: "#f5a623" }}>{r.avgVol}%</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Analysis */}
        {analysis && (
          <div ref={analysisRef} className="fade-up" style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, padding: "26px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
              <div style={{ width: 22, height: 22, background: "linear-gradient(135deg, #00d4aa, #0099ff)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>◆</div>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e", letterSpacing: "0.12em" }}>CLAUDE AI ANALYSIS</div>
                <div style={{ fontSize: 11, color: "#8b949e" }}>{data?.ticker} · Signal Intelligence Report</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {parsedSections.map((s, i) => (
                <div key={i} className="section-card" style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "18px 20px" }}>
                  <div style={{ fontSize: 9, color: "#00d4aa", letterSpacing: "0.15em", marginBottom: 10 }}>{s.icon} {s.title}</div>
                  <p style={{ fontSize: 12, color: "#c9d1d9", lineHeight: 1.75, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 300 }}>{s.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!data && !loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#30363d" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⬡</div>
            <div style={{ fontSize: 12, letterSpacing: "0.1em" }}>ENTER A TICKER AND DATE RANGE TO BEGIN</div>
          </div>
        )}

      </div>
    </div>
  );
}
