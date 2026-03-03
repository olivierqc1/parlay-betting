import { useState, useCallback, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
const HISTORY_KEY = "parlayedge_history";

const LEAGUES = [
  { key: "soccer_epl",                label: "Premier League",   flag: "PL" },
  { key: "soccer_uefa_champs_league", label: "Champions League", flag: "CL" },
  { key: "soccer_spain_la_liga",      label: "La Liga",          flag: "ES" },
  { key: "soccer_germany_bundesliga", label: "Bundesliga",       flag: "DE" },
  { key: "soccer_italy_serie_a",      label: "Serie A",          flag: "IT" },
  { key: "soccer_france_ligue_one",   label: "Ligue 1",          flag: "FR" },
  { key: "soccer_usa_mls",            label: "MLS",              flag: "US" },
];

const LEAGUE_KEY_MAP = {
  soccer_epl: "PL", soccer_uefa_champs_league: "CL",
  soccer_spain_la_liga: "ES", soccer_germany_bundesliga: "DE",
  soccer_italy_serie_a: "IT", soccer_france_ligue_one: "FR", soccer_usa_mls: "MLS",
};

function americanToDecimal(odds) {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function calcNoVigProbs(outcomes) {
  const raw = outcomes.map((o) => 1 / americanToDecimal(o.price));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / total);
}
function calcCombinedDecimal(legs) {
  return legs.reduce((acc, l) => acc * americanToDecimal(l.price), 1);
}
function fmtAmerican(odds) {
  return odds > 0 ? "+" + Math.round(odds) : "" + Math.round(odds);
}
function fmtPct(p) { return (p * 100).toFixed(1) + "%"; }
function evColor(ev) {
  if (ev > 0.05) return "#00ff88";
  if (ev > 0) return "#88ffcc";
  if (ev > -0.05) return "#ffcc44";
  return "#ff5555";
}
function edgeColor(edge) {
  if (edge > 0.04) return "#00ff88";
  if (edge > 0.01) return "#88ffcc";
  if (edge > -0.02) return "#ffcc44";
  return "#ff5555";
}
function confidenceLabel(prob) {
  if (prob >= 0.68) return { label: "TRÈS SÛR", color: "#00ff88" };
  if (prob >= 0.58) return { label: "SÛR", color: "#88ffcc" };
  if (prob >= 0.50) return { label: "PROBABLE", color: "#ffcc44" };
  return { label: "RISQUÉ", color: "#ff5555" };
}

function normalizeName(name) {
  return name.toLowerCase()
    .replace(/\b(fc|cf|sc|ac|as|rc|ss|afc|utd|united|city|town|sporting|athletic|real|club|calcio|inter|atletico)\b/g, "")
    .replace(/^(1\.|vfb|vfl|rb|bvb|sv|fsv|tsg|tsv|sc|fc|ac|as|ss|rc)\s+/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function teamMatchScore(nameA, nameB) {
  const a = normalizeName(nameA), b = normalizeName(nameB);
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const wordsA = a.split(" ").filter(w => w.length > 2);
  const wordsB = b.split(" ").filter(w => w.length > 2);
  if (!wordsA.length || !wordsB.length) return 0;
  return wordsA.filter(w => wordsB.includes(w)).length / Math.max(wordsA.length, wordsB.length);
}
function findTeamInStandings(teamName, standings) {
  let best = null, bestScore = 0;
  for (const [name, stats] of Object.entries(standings)) {
    const score = teamMatchScore(teamName, name);
    if (score > bestScore) { bestScore = score; best = { stats, matchedName: name, score }; }
  }
  return bestScore >= 0.5 ? best : null;
}

function calcModelProbsForGame(homeTeam, awayTeam, standings) {
  const hM = findTeamInStandings(homeTeam, standings);
  const aM = findTeamInStandings(awayTeam, standings);
  if (!hM || !aM) return null;
  const h = hM.stats, a = aM.stats;
  const maxPts = Math.max(h.played, a.played, 1) * 3;
  function formScore(f) {
    if (!f) return 0.45;
    const last5 = f.slice(-5); let s = 0, c = 0;
    for (const ch of last5) { if (ch === "W") s += 1; else if (ch === "D") s += 0.5; c++; }
    return c > 0 ? s / c : 0.45;
  }
  const homeXG = (h.homePlayed > 0 ? h.homeGoalsFor / h.homePlayed : 1.4) * ((a.awayPlayed > 0 ? a.awayGoalsAgainst / a.awayPlayed : 1.6) / 1.4);
  const awayXG = (a.awayPlayed > 0 ? a.awayGoalsFor / a.awayPlayed : 1.0) * ((h.homePlayed > 0 ? h.homeGoalsAgainst / h.homePlayed : 1.2) / 1.2);
  const hS = (h.points / maxPts * 0.40) + (formScore(h.form) * 0.35) + (Math.min(homeXG, 3) / 3 * 0.25);
  const aS = (a.points / maxPts * 0.40) + (formScore(a.form) * 0.35) + (Math.min(awayXG, 3) / 3 * 0.25);
  const tot = hS + aS;
  const rawH = (hS / tot) * 0.73 + 0.06, rawA = (aS / tot) * 0.73, rawD = 0.27;
  const rawTot = rawH + rawA + rawD;
  return {
    home: Math.max(0.10, Math.min(0.75, rawH / rawTot)),
    away: Math.max(0.10, Math.min(0.65, rawA / rawTot)),
    draw: Math.max(0.15, Math.min(0.35, rawD / rawTot)),
    matchConfidence: Math.min(hM.score, aM.score),
  };
}

function getCombinations(arr, k) {
  if (k === 1) return arr.map((x) => [x]);
  const result = [];
  for (let i = 0; i <= arr.length - k; i++) {
    getCombinations(arr.slice(i + 1), k - 1).forEach((rest) => result.push([arr[i], ...rest]));
  }
  return result;
}

function buildAllLegs(games, standingsMap) {
  const allLegs = [];
  games.forEach((game) => {
    const market = game.bookmakers?.[0]?.markets?.[0];
    if (!market) return;
    let modelProbs = null;
    for (const [, { standings }] of Object.entries(standingsMap)) {
      const mp = calcModelProbsForGame(game.home_team, game.away_team, standings);
      if (mp && mp.matchConfidence >= 0.6) { modelProbs = mp; break; }
    }
    const nvps = calcNoVigProbs(market.outcomes);
    market.outcomes.forEach((outcome, i) => {
      if (outcome.price < -200) return;
      const bookProb = nvps[i];
      let modelProb = bookProb, edge = 0, hasModel = false;
      if (modelProbs) {
        modelProb = outcome.name === game.home_team ? modelProbs.home
          : outcome.name === game.away_team ? modelProbs.away : modelProbs.draw;
        edge = modelProb - bookProb;
        hasModel = true;
      }
      // Détecter la ligue du match
      const leagueKey = Object.keys(LEAGUE_KEY_MAP).find(k =>
        game.sport_key === k || (game.sport_title || "").toLowerCase().includes(LEAGUE_KEY_MAP[k].toLowerCase())
      ) || "unknown";
      allLegs.push({
        gameId: game.id, sport_key: game.sport_key || leagueKey,
        gameLabel: game.home_team + " vs " + game.away_team,
        outcome: outcome.name, price: outcome.price,
        noVigProb: bookProb, modelProb, edge, hasModel,
      });
    });
  });
  return allLegs;
}

// Mode sécuritaire: prob modèle >55%, edge positif, cross-ligue prioritaire
function buildSafeParlays(games, standingsMap, topN = 8) {
  const safeLegs = buildAllLegs(games, standingsMap).filter(leg =>
    leg.hasModel && leg.modelProb >= 0.55 && leg.edge > 0 &&
    leg.price >= -200 && leg.price <= 250
  );

  const results = [];
  getCombinations(safeLegs, 2).forEach((combo) => {
    const ids = combo.map((l) => l.gameId);
    if (new Set(ids).size !== ids.length) return;
    const combinedDec = calcCombinedDecimal(combo);
    const modelProb = combo.reduce((acc, l) => acc * l.modelProb, 1);
    const modelEV = modelProb * combinedDec - 1;
    const avgEdge = combo.reduce((s, l) => s + l.edge, 0) / 2;
    const americanOdds = (combinedDec - 1) * 100;
    if (modelProb < 0.28 || modelProb > 0.72) return;
    if (americanOdds < 40) return;  // Min +40 rendement
    if (modelEV <= 0) return;       // EV doit être positif

    // Bonus si les deux legs viennent de ligues différentes
    const crossLeague = combo[0].sport_key !== combo[1].sport_key;
    const minLegProb = Math.min(...combo.map(l => l.modelProb));
    const valueScore = modelEV * modelProb * minLegProb * (1 + avgEdge) * (crossLeague ? 1.2 : 1.0);

    results.push({ legs: combo, combinedDec, modelProb, modelEV, avgEdge, americanOdds, valueScore, crossLeague, isSafe: true });
  });
  return results.sort((a, b) => b.valueScore - a.valueScore).slice(0, topN);
}

// Mode standard
function buildSuggestions(games, standingsMap, topN = 10) {
  const allLegs = buildAllLegs(games, standingsMap);
  const results = [];
  [2, 3].forEach((size) => {
    getCombinations(allLegs, size).forEach((combo) => {
      const ids = combo.map((l) => l.gameId);
      if (new Set(ids).size !== ids.length) return;
      const combinedDec = calcCombinedDecimal(combo);
      const modelProb = combo.reduce((acc, l) => acc * l.modelProb, 1);
      const bookProb = combo.reduce((acc, l) => acc * l.noVigProb, 1);
      const modelEV = modelProb * combinedDec - 1;
      const avgEdge = combo.reduce((s, l) => s + l.edge, 0) / combo.length;
      const hasModel = combo.some(l => l.hasModel);
      if (modelProb < 0.12 || modelProb > 0.55) return;
      if ((combinedDec - 1) * 100 < 120) return;
      if (modelEV > 0.60 || modelEV < -0.20) return;
      const crossLeague = new Set(combo.map(l => l.sport_key)).size > 1;
      const valueScore = modelEV * Math.sqrt(modelProb) * (1 + Math.max(0, avgEdge)) * (crossLeague ? 1.15 : 1.0);
      results.push({ legs: combo, combinedDec, modelProb, bookProb, modelEV, avgEdge, hasModel, crossLeague, valueScore });
    });
  });
  return results.sort((a, b) => b.valueScore - a.valueScore).slice(0, topN);
}

// ---- Composants UI ----

function LegRow({ leg, onRemove }) {
  const conf = confidenceLabel(leg.modelProb);
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"#1a1f2e", borderRadius:6, borderLeft:"3px solid #00ff88", marginBottom:6 }}>
      <div style={{ flex:1, marginRight:8 }}>
        <div style={{ fontSize:10, color:"#556", marginBottom:2 }}>{leg.gameLabel}</div>
        <div style={{ fontSize:13, color:"#eee", fontWeight:600 }}>{leg.outcome}</div>
        <div style={{ fontSize:10, marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
          <span style={{ color:"#445" }}>book {fmtPct(leg.noVigProb)}</span>
          {leg.hasModel && (
            <>
              <span style={{ color: leg.edge > 0.02 ? "#00ff88" : leg.edge < -0.02 ? "#ff6666" : "#778" }}>
                mdl {fmtPct(leg.modelProb)} ({leg.edge >= 0 ? "+" : ""}{fmtPct(leg.edge)})
              </span>
              <span style={{ color: conf.color, fontSize:9 }}>{conf.label}</span>
            </>
          )}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ color:"#00ff88", fontFamily:"monospace", fontSize:15, fontWeight:700 }}>{fmtAmerican(leg.price)}</span>
        <button onClick={() => onRemove(leg)} style={{ background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:20, lineHeight:1, padding:0 }}>×</button>
      </div>
    </div>
  );
}

function GameCard({ game, selectedLegs, onToggleLeg, standingsMap }) {
  const market = game.bookmakers?.[0]?.markets?.[0];
  if (!market) return null;
  const nvps = calcNoVigProbs(market.outcomes);
  const date = new Date(game.commence_time);
  const dateStr = date.toLocaleDateString("fr-CA", { month:"short", day:"numeric" });
  const timeStr = date.toLocaleTimeString("fr-CA", { hour:"2-digit", minute:"2-digit" });
  let modelProbs = null;
  for (const [, { standings }] of Object.entries(standingsMap)) {
    const mp = calcModelProbsForGame(game.home_team, game.away_team, standings);
    if (mp && mp.matchConfidence >= 0.6) { modelProbs = mp; break; }
  }
  function isSelected(name) { return selectedLegs.some((l) => l.gameId === game.id && l.outcome === name); }
  function outcomeLabel(name) {
    if (name === game.home_team) return "Dom."; if (name === game.away_team) return "Vis."; return "Nul";
  }
  function getModelProb(name) {
    if (!modelProbs) return null;
    if (name === game.home_team) return modelProbs.home;
    if (name === game.away_team) return modelProbs.away;
    return modelProbs.draw;
  }
  return (
    <div style={{ background:"#0f1320", border:"1px solid #1e2535", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:10, color:"#445" }}>{dateStr} - {timeStr}</span>
        <span style={{ fontSize:10, color: modelProbs ? "#00aa55" : "#334" }}>{modelProbs ? "✓ modèle" : game.sport_title}</span>
      </div>
      <div style={{ fontSize:12, color:"#aab", marginBottom:10, textAlign:"center", fontWeight:600 }}>
        {game.home_team} vs {game.away_team}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5 }}>
        {market.outcomes.map((outcome, idx) => {
          const sel = isSelected(outcome.name);
          const tooHeavy = outcome.price < -200;
          const mp = getModelProb(outcome.name);
          const edge = mp ? mp - nvps[idx] : 0;
          const conf = mp ? confidenceLabel(mp) : null;
          return (
            <button key={outcome.name}
              onClick={() => !tooHeavy && onToggleLeg(game, outcome, nvps[idx], mp || nvps[idx], edge, !!modelProbs)}
              style={{ background:sel?"#003322":tooHeavy?"#0a0c14":"#141927", border:"1px solid "+(sel?"#00aa55":tooHeavy?"#111":edge>0.03?"#1a4a2a":"#1e2535"), borderRadius:7, padding:"8px 4px", cursor:tooHeavy?"not-allowed":"pointer", textAlign:"center", opacity:tooHeavy?0.4:1 }}>
              <div style={{ fontSize:10, color:sel?"#00ff88":"#556", marginBottom:2 }}>{outcomeLabel(outcome.name)}</div>
              <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:sel?"#00ff88":tooHeavy?"#444":"#ddd" }}>{fmtAmerican(outcome.price)}</div>
              <div style={{ fontSize:9, color:"#445" }}>book {fmtPct(nvps[idx])}</div>
              {mp && (
                <>
                  <div style={{ fontSize:9, color: edge > 0.03 ? "#00ff88" : edge < -0.03 ? "#ff6666" : "#667", marginTop:1 }}>
                    mdl {fmtPct(mp)} {edge >= 0 ? "▲" : "▼"}
                  </div>
                  <div style={{ fontSize:8, color: conf.color, marginTop:1 }}>{conf.label}</div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuggestionCard({ parlay, index, onLoad }) {
  const evc = evColor(parlay.modelEV);
  const ec = edgeColor(parlay.avgEdge);
  const shortLabel = (label) => label.split(" vs ").map((t) => t.split(" ").slice(-1)[0]).join(" v ");
  const americanOdds = Math.round((parlay.combinedDec - 1) * 100);
  return (
    <div onClick={() => onLoad(parlay)} style={{ background:"#0a0f1a", border:"1px solid "+(parlay.modelEV>0?"#1a3a2a":"#1a1e2e"), borderRadius:10, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6, flexWrap:"wrap", gap:4 }}>
        <span style={{ fontSize:10, color:"#445" }}>
          #{index+1} · {parlay.legs.length} JAMBES
          {parlay.crossLeague && <span style={{ color:"#88aacc", marginLeft:6 }}>CROSS-LIGUE</span>}
        </span>
        <div style={{ display:"flex", gap:5 }}>
          <span style={{ fontSize:10, fontWeight:700, color:ec, background:ec+"22", padding:"2px 6px", borderRadius:20 }}>
            edge {parlay.avgEdge>=0?"+":""}{fmtPct(parlay.avgEdge)}
          </span>
          <span style={{ fontSize:10, fontWeight:700, color:evc, background:evc+"22", padding:"2px 6px", borderRadius:20 }}>
            EV {parlay.modelEV>=0?"+":""}{(parlay.modelEV*100).toFixed(1)}%
          </span>
        </div>
      </div>
      {parlay.legs.map((leg, i) => {
        const conf = confidenceLabel(leg.modelProb);
        return (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 0", borderBottom:i<parlay.legs.length-1?"1px solid #111":"none" }}>
            <div>
              <span style={{ fontSize:11, color:"#667" }}>{leg.outcome.split(" ").slice(-1)[0]} · {shortLabel(leg.gameLabel)}</span>
              {leg.hasModel && <span style={{ fontSize:9, color: conf.color, marginLeft:6 }}>{conf.label}</span>}
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              {leg.hasModel && <span style={{ fontSize:9, color: leg.edge > 0.02 ? "#00ff88" : leg.edge < -0.02 ? "#ff6666" : "#556" }}>{leg.edge>=0?"+":""}{fmtPct(leg.edge)}</span>}
              <span style={{ fontSize:11, color:"#00cc66", fontFamily:"monospace" }}>{fmtAmerican(leg.price)}</span>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop:8, display:"flex", gap:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, color:"#334" }}>Cote: <span style={{ color:"#fff", fontFamily:"monospace" }}>{fmtAmerican(americanOdds)}</span></span>
        <span style={{ fontSize:10, color:"#334" }}>Prob: <span style={{ color:"#88aacc" }}>{fmtPct(parlay.modelProb)}</span></span>
        <span style={{ fontSize:10, color:"#334" }}>{parlay.combinedDec.toFixed(2)}x</span>
      </div>
    </div>
  );
}

function SafeCard({ parlay, index, onLoad, stake }) {
  const gain = Math.round(stake * parlay.combinedDec - stake);
  const americanOdds = Math.round((parlay.combinedDec - 1) * 100);
  return (
    <div onClick={() => onLoad(parlay)} style={{ background:"#080f0a", border:"2px solid #1a4a2a", borderRadius:12, padding:"14px", marginBottom:10, cursor:"pointer" }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
        <span style={{ fontSize:10, color:"#445" }}>
          #{index+1} · 2 JAMBES
          {parlay.crossLeague && <span style={{ color:"#88aacc", marginLeft:6 }}>CROSS-LIGUE</span>}
        </span>
        <span style={{ fontSize:11, fontWeight:700, color:"#00ff88", background:"#00ff8822", padding:"2px 8px", borderRadius:20 }}>
          EV +{(parlay.modelEV*100).toFixed(1)}%
        </span>
      </div>
      {parlay.legs.map((leg, i) => {
        const conf = confidenceLabel(leg.modelProb);
        return (
          <div key={i} style={{ background:"#0f1a0f", borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:10, color:"#556" }}>{leg.gameLabel}</div>
                <div style={{ fontSize:13, color:"#eee", fontWeight:600, marginTop:2 }}>{leg.outcome}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontFamily:"monospace", fontSize:16, fontWeight:700, color:"#00cc66" }}>{fmtAmerican(leg.price)}</div>
                <div style={{ fontSize:9, color: conf.color }}>{conf.label}</div>
              </div>
            </div>
            <div style={{ marginTop:6, display:"flex", gap:12 }}>
              <span style={{ fontSize:10, color:"#445" }}>Modèle: <span style={{ color:"#88aacc" }}>{fmtPct(leg.modelProb)}</span></span>
              <span style={{ fontSize:10, color:"#445" }}>Edge: <span style={{ color:"#00ff88" }}>+{fmtPct(leg.edge)}</span></span>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop:8, background:"#0a1a0a", borderRadius:8, padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9, color:"#445" }}>COTE COMBINÉE</div>
          <div style={{ fontFamily:"monospace", fontSize:17, fontWeight:700, color:"#fff" }}>{fmtAmerican(americanOdds)}</div>
          <div style={{ fontSize:9, color:"#445", marginTop:2 }}>Prob victoire: {fmtPct(parlay.modelProb)}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:9, color:"#445" }}>GAIN POUR ${stake}</div>
          <div style={{ fontFamily:"monospace", fontSize:22, fontWeight:700, color:"#00ff88" }}>${gain}</div>
        </div>
      </div>
    </div>
  );
}

function HistoryTab({ history, onDelete, onClear }) {
  const wins = history.filter(h => h.result === "win").length;
  const losses = history.filter(h => h.result === "loss").length;
  const pending = history.filter(h => h.result === "pending").length;
  const totalStaked = 
export default function App() {
  const [selectedLeagues, setSelectedLeagues] = useState([
    "soccer_epl", "soccer_uefa_champs_league", "soccer_spain_la_liga",
    "soccer_germany_bundesliga", "soccer_italy_serie_a"
  ]);
  const [games, setGames] = useState([]);
  const [standingsMap, setStandingsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);
  const [selectedLegs, setSelectedLegs] = useState([]);
  const [stake, setStake] = useState(50);
  const [suggestions, setSuggestions] = useState([]);
  const [safeParlays, setSafeParlays] = useState([]);
  const [activeTab, setActiveTab] = useState("safe");
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  function saveToHistory(parlay) {
    const entry = {
      id: Date.now(),
      date: new Date().toLocaleDateString("fr-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }),
      legs: parlay.legs,
      stake,
      gain: stake * parlay.combinedDec,
      americanOdds: Math.round((parlay.combinedDec - 1) * 100),
      modelEV: parlay.modelEV,
      result: "pending",
    };
    setHistory(prev => [entry, ...prev]);
  }

  function updateResult(id, result) {
    setHistory(prev => prev.map(h => h.id === id ? { ...h, result } : h));
  }

  function clearHistory() {
    if (confirm("Effacer tout l'historique?")) setHistory([]);
  }

  const fetchOdds = useCallback(async () => {
    if (selectedLeagues.length === 0) return;
    setLoading(true); setError(""); setGames([]); setSuggestions([]); setSafeParlays([]);
    try {
      const all = [];
      for (const sport of selectedLeagues) {
        const res = await fetch(API_BASE + "/api/odds?sport=" + sport);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Erreur " + res.status);
        if (json.meta?.remainingRequests != null) setRemaining(json.meta.remainingRequests);
        // Tag chaque match avec son sport_key
        const tagged = (json.data || []).filter(g => g.bookmakers?.length > 0).map(g => ({ ...g, sport_key: sport }));
        all.push(...tagged);
      }
      all.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
      setGames(all);

      setModelLoading(true);
      const newStandings = {};
      await Promise.all(selectedLeagues.map(async (sport) => {
        try {
          const res = await fetch(API_BASE + "/api/model/" + sport);
          if (res.ok) {
            const json = await res.json();
            newStandings[sport] = { standings: json.standings, totalTeams: json.totalTeams };
          }
        } catch (e) { console.warn("Model failed for", sport); }
      }));
      setStandingsMap(newStandings);
      setModelLoading(false);
      if (all.length > 0) {
        setSuggestions(buildSuggestions(all, newStandings));
        setSafeParlays(buildSafeParlays(all, newStandings));
      }
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, [selectedLeagues]);

  function toggleLeague(key) {
    setSelectedLeagues(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function handleToggleLeg(game, outcome, noVigProb, modelProb, edge, hasModel) {
    setSelectedLegs(prev => {
      const already = prev.find(l => l.gameId === game.id && l.outcome === outcome.name);
      if (already) return prev.filter(l => !(l.gameId === game.id && l.outcome === outcome.name));
      return [...prev.filter(l => l.gameId !== game.id), {
        gameId: game.id, gameLabel: game.home_team + " vs " + game.away_team,
        outcome: outcome.name, price: outcome.price,
        noVigProb, modelProb: modelProb || noVigProb, edge: edge || 0, hasModel: hasModel || false,
      }];
    });
  }

  function removeLeg(leg) {
    setSelectedLegs(prev => prev.filter(l => !(l.gameId === leg.gameId && l.outcome === leg.outcome)));
  }

  function loadSuggestion(parlay) {
    setSelectedLegs(parlay.legs.map(l => ({ ...l })));
    setActiveTab("builder");
  }

  const hasLegs = selectedLegs.length >= 2;
  const combinedDec = hasLegs ? selectedLegs.reduce((acc, l) => acc * americanToDecimal(l.price), 1) : 1;
  const modelProb = hasLegs ? selectedLegs.reduce((acc, l) => acc * l.modelProb, 1) : 1;
  const bookProb = hasLegs ? selectedLegs.reduce((acc, l) => acc * l.noVigProb, 1) : 1;
  const modelEV = hasLegs ? modelProb * combinedDec - 1 : 0;
  const potentialWin = stake * combinedDec - stake;
  const avgEdge = hasLegs ? selectedLegs.reduce((s, l) => s + l.edge, 0) / selectedLegs.length : 0;

  const tabs = [
    { id:"safe", label:"Sûrs (" + safeParlays.length + ")" },
    { id:"suggestions", label:"Top EV (" + suggestions.length + ")" },
    { id:"builder", label:"Builder" },
    { id:"history", label:"Historique (" + history.length + ")" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#070b14", color:"#ccd", fontFamily:"'IBM Plex Mono','Courier New',monospace", display:"flex", flexDirection:"column" }}>
      <header style={{ background:"#0a0f1c", borderBottom:"1px solid #1a2035", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:"#00ff88", letterSpacing:2 }}>PARLAY<span style={{ color:"#fff" }}>EDGE</span></div>
          <div style={{ fontSize:10, letterSpacing:1 }}>
            {modelLoading ? <span style={{ color:"#ffcc44" }}>chargement modèle...</span>
              : Object.keys(standingsMap).length > 0 ? <span style={{ color:"#00aa55" }}>✓ modèle actif · {Object.keys(standingsMap).length} ligues</span>
              : <span style={{ color:"#445" }}>BETONLINE · API-FOOTBALL</span>}
          </div>
        </div>
        {remaining !== null && <span style={{ fontSize:11, color:"#445" }}><span style={{ color:"#88aacc" }}>{remaining.toLocaleString()}</span> req.</span>}
      </header>

      <div style={{ display:"flex", flex:1, overflow:"hidden", flexWrap:"wrap" }}>
        {/* Colonne gauche - matchs */}
        <div style={{ flex:1, minWidth:300, overflowY:"auto", padding:"16px 20px" }}>
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:10, color:"#445", letterSpacing:1, marginBottom:8 }}>LIGUES</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {LEAGUES.map(l => {
                const active = selectedLeagues.includes(l.key);
                return (
                  <button key={l.key} onClick={() => toggleLeague(l.key)}
                    style={{ background:active?"#003322":"#0f1320", border:"1px solid "+(active?"#00aa55":"#1e2535"), color:active?"#00ff88":"#556", padding:"5px 10px", borderRadius:20, cursor:"pointer", fontSize:11 }}>
                    {l.flag} {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={fetchOdds} disabled={loading}
            style={{ width:"100%", background:loading?"#1a2035":"#00ff88", color:loading?"#445":"#000", border:"none", padding:"10px", borderRadius:8, cursor:loading?"not-allowed":"pointer", fontSize:13, fontWeight:700, marginBottom:14 }}>
            {loading ? "Chargement..." : "CHARGER LES COTES + MODÈLE"}
          </button>

          {error && <div style={{ background:"#1a0a0a", border:"1px solid #aa2222", borderRadius:8, padding:"10px 14px", marginBottom:12, fontSize:12, color:"#ff6666" }}>{error}</div>}

          {games.length > 0 && (
            <div style={{ fontSize:10, color:"#445", marginBottom:10 }}>
              {games.length} MATCHS · {Object.keys(standingsMap).length > 0 ? <span style={{ color:"#00aa55" }}>✓ modèle actif</span> : <span style={{ color:"#ffcc44" }}>sans modèle</span>}
            </div>
          )}

          {games.map(game => (
            <GameCard key={game.id} game={game} selectedLegs={selectedLegs} onToggleLeg={handleToggleLeg} standingsMap={standingsMap} />
          ))}

          {!loading && games.length === 0 && (
            <div style={{ textAlign:"center", color:"#334", padding:"50px 0", fontSize:13 }}>Sélectionne des ligues et charge les cotes</div>
          )}
        </div>

        {/* Colonne droite */}
        <div style={{ width:390, minWidth:300, background:"#080c18", borderLeft:"1px solid #1a2035", display:"flex", flexDirection:"column", overflowY:"auto" }}>
          <div style={{ display:"flex", borderBottom:"1px solid #1a2035" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flex:1, padding:"10px 2px", border:"none", cursor:"pointer", fontSize:9.5, background:activeTab===tab.id?"#0f1320":"transparent", color:activeTab===tab.id?"#00ff88":"#445", borderBottom:activeTab===tab.id?"2px solid #00ff88":"2px solid transparent" }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding:16, flex:1 }}>

            {activeTab === "safe" && (
              <div>
                <div style={{ background:"#0a1a0a", border:"1px solid #1a4a2a", borderRadius:10, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:11, color:"#00ff88", fontWeight:700, marginBottom:6 }}>🎯 SÉLECTION SÉCURITAIRE</div>
                  <div style={{ fontSize:10, color:"#556", lineHeight:1.6 }}>
                    2 jambes où notre modèle prédit &gt;55% de chance de gagner + edge positif vs BetOnline. Cross-ligues prioritaires. EV positif garanti selon le modèle.
                  </div>
                </div>
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#445", marginBottom:6 }}>MISE ($)</div>
                  <input type="number" value={stake} onChange={e => setStake(Number(e.target.value))}
                    style={{ width:"100%", background:"#0f1320", border:"1px solid #1e2535", borderRadius:6, padding:"8px 10px", color:"#ccd", fontFamily:"monospace", fontSize:14, boxSizing:"border-box" }} />
                </div>
                {safeParlays.length === 0 ? (
                  <div style={{ color:"#334", fontSize:12, padding:"24px 0", textAlign:"center" }}>
                    {games.length === 0 ? "Charge des cotes d'abord" : "Aucun parlay sécuritaire — essaie plus de ligues"}
                  </div>
                ) : (
                  safeParlays.map((parlay, i) => (
                    <div key={i}>
                      <SafeCard parlay={parlay} index={i} onLoad={loadSuggestion} stake={stake} />
                      <button onClick={() => saveToHistory(parlay)}
                        style={{ width:"100%", background:"#0a0f1a", border:"1px solid #1a2035", color:"#445", padding:"5px", borderRadius:6, cursor:"pointer", fontSize:10, marginTop:-6, marginBottom:10 }}>
                        + Enregistrer dans l'historique
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "suggestions" && (
              <div>
                <div style={{ fontSize:10, color:"#445", marginBottom:4 }}>TOP PARLAYS PAR VALEUR MODÈLE</div>
                <div style={{ fontSize:9, color:"#334", marginBottom:12 }}>Cross-ligues priorisés · EV max +60% · Aucune jambe sous -200</div>
                {suggestions.length === 0 ? (
                  <div style={{ color:"#334", fontSize:12, padding:"24px 0", textAlign:"center" }}>Charge des cotes d'abord</div>
                ) : (
                  suggestions.map((parlay, i) => (
                    <SuggestionCard key={i} parlay={parlay} index={i} onLoad={loadSuggestion} />
                  ))
                )}
              </div>
            )}

            {activeTab === "builder" && (
              <div>
                <div style={{ fontSize:10, color:"#445", marginBottom:8 }}>JAMBES ({selectedLegs.length})</div>
                {selectedLegs.length === 0 ? (
                  <div style={{ color:"#334", fontSize:12, padding:"24px 0", textAlign:"center" }}>Clique sur les cotes à gauche ou charge une sélection</div>
                ) : (
                  selectedLegs.map(leg => <LegRow key={leg.gameId+leg.outcome} leg={leg} onRemove={removeLeg} />)
                )}
                {hasLegs && (
                  <div>
                    <div style={{ background:"#0a0f1a", border:"1px solid #1a2035", borderRadius:10, padding:"14px", marginTop:12, marginBottom:12 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>COTE COMBINÉE</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:"#fff" }}>{fmtAmerican(Math.round((combinedDec-1)*100))}</div>
                          <div style={{ fontSize:10, color:"#445" }}>{combinedDec.toFixed(2)}x</div>
                        </div>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>PROB MODÈLE</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:"#88aacc" }}>{fmtPct(modelProb)}</div>
                          <div style={{ fontSize:10, color:"#445" }}>book: {fmtPct(bookProb)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>EV MODÈLE</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:evColor(modelEV) }}>{modelEV>=0?"+":""}{(modelEV*100).toFixed(1)}%</div>
                        </div>
                        <div>
                          <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>EDGE MOY</div>
                          <div style={{ fontFamily:"monospace", fontSize:20, fontWeight:700, color:edgeColor(avgEdge) }}>{avgEdge>=0?"+":""}{fmtPct(avgEdge)}</div>
                        </div>
                      </div>
                      <div style={{ marginTop:12, borderTop:"1px solid #1a2035", paddingTop:10 }}>
                        <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>GAIN POTENTIEL</div>
                        <div style={{ fontFamily:"monospace", fontSize:22, fontWeight:700, color:"#fff" }}>${potentialWin.toFixed(2)}</div>
                        <div style={{ fontSize:10, color:"#445" }}>pour ${stake}</div>
                      </div>
                    </div>
                    <div style={{ marginBottom:12 }}>
                      <div style={{ fontSize:9, color:"#445", marginBottom:6 }}>MISE ($)</div>
                      <input type="number" value={stake} onChange={e => setStake(Number(e.target.value))}
                        style={{ width:"100%", background:"#0f1320", border:"1px solid #1e2535", borderRadius:6, padding:"8px 10px", color:"#ccd", fontFamily:"monospace", fontSize:14, boxSizing:"border-box" }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "history" && (
              <HistoryTab history={history} onDelete={updateResult} onClear={clearHistory} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
