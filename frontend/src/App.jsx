// frontend/src/App.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
import ParlayOptimizer from "./ParlayOptimizer";
import { MatchCard, ParlayCard, americanToDecimal, getCombinations } from "./AppComponents1";
import { BuilderTab, HistoryTab } from "./AppComponents2";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";
const HISTORY_KEY = "parlayedge_history_v2";

export default function App() {
  const [allSports, setAllSports]           = useState([]);
  const [selectedSports, setSelectedSports] = useState([]);
  const [matches, setMatches]               = useState([]);
  const [loading, setLoading]               = useState(false);
  const [sportsLoading, setSportsLoading]   = useState(true);
  const [error, setError]                   = useState("");
  const [picks, setPicks]                   = useState([]);
  const [stake, setStake]                   = useState(20);
  const [activeTab, setActiveTab]           = useState("matches");
  const [sortBy, setSortBy]                 = useState("value");
  const [filterEV, setFilterEV]             = useState(false);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }, [history]);

  useEffect(() => {
    fetch(`${API}/api/sports`)
      .then(r => r.json())
      .then(data => {
        setAllSports(data.sports || []);
        const defaults = ["soccer_france_ligue_one","soccer_france_ligue_2","soccer_france_ligue_nationale","soccer_epl","soccer_spain_la_liga","soccer_germany_bundesliga","soccer_italy_serie_a","soccer_spain_segunda_division","soccer_switzerland_superleague","soccer_switzerland_challenge_league","soccer_ireland_premier_division"];
        const available = (data.sports || []).map(s => s.key);
        setSelectedSports(defaults.filter(k => available.includes(k)));
      })
      .catch(() => setAllSports([]))
      .finally(() => setSportsLoading(false));
  }, []);

  const loadMatches = useCallback(async () => {
    if (!selectedSports.length) return;
    setLoading(true); setError(""); setMatches([]);
    try {
      const r = await fetch(`${API}/api/odds/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sports: selectedSports, days: 2 }),
      });
      if (!r.ok) throw new Error(`Erreur ${r.status}`);
      const data = await r.json();
      setMatches(data.matches || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [selectedSports]);

  function toggleSport(key) {
    setSelectedSports(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  function addPick(match, side) {
    const team = side === "home" ? match.homeTeam : match.awayTeam;
    setPicks(prev => {
      const without = prev.filter(p => p.matchId !== match.id);
      const already = prev.find(p => p.matchId === match.id && p.side === side);
      if (already) return without;
      return [...without, {
        matchId: match.id, side, team,
        matchup: `${match.homeTeam} vs ${match.awayTeam}`,
        odds: match.odds[side],
        edge: match.value?.[side] ?? null,
        stats: side === "home" ? match.homeStats : match.awayStats,
        modelProb: match.modelProb?.[side] ?? null,
      }];
    });
  }

  function removePick(index) { setPicks(prev => prev.filter((_, i) => i !== index)); }

  function saveToHistory(parlay) {
    setHistory(prev => [{
      id: Date.now(),
      date: new Date().toLocaleDateString("fr-CA", { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }),
      legs: parlay.legs, stake,
      payout: stake * parlay.combinedDec,
      american: Math.round((parlay.combinedDec - 1) * 100),
      result: "pending",
    }, ...prev]);
  }

  const sortedMatches = useMemo(() => {
    let list = [...matches];
    if (filterEV) list = list.filter(m => m.value && Math.max(m.value.home ?? -99, m.value.away ?? -99) > 0);
    if (sortBy === "value") list.sort((a, b) => Math.max(b.value?.home??-99, b.value?.away??-99) - Math.max(a.value?.home??-99, a.value?.away??-99));
    else if (sortBy === "rank") list.sort((a, b) => (b.rankGap ?? 0) - (a.rankGap ?? 0));
    else list.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
    return list;
  }, [matches, sortBy, filterEV]);

  const suggestions = useMemo(() => {
    const validPicks = matches.flatMap(m => {
      const results = [];
      for (const side of ["home", "away"]) {
        const odds = m.odds[side], edge = m.value?.[side], model = m.modelProb?.[side];
        if (odds == null || odds < -200 || odds > 350) continue;
        if (!m.hasModel || edge == null || edge <= 0 || model == null || model < 0.50) continue;
        results.push({ matchId: m.id, side, team: side === "home" ? m.homeTeam : m.awayTeam, matchup: `${m.homeTeam} vs ${m.awayTeam}`, odds, edge, modelProb: model, sport: m.sport, stats: side === "home" ? m.homeStats : m.awayStats });
      }
      return results;
    });
    return getCombinations(validPicks, 2)
      .filter(legs => new Set(legs.map(l => l.matchId)).size === legs.length)
      .map(legs => {
        const dec = legs.reduce((a, p) => a * americanToDecimal(p.odds), 1);
        const combinedModelProb = legs.reduce((a, l) => a * l.modelProb, 1);
        const modelEV = combinedModelProb * dec - 1;
        if (modelEV <= 0) return null;
        return { legs, combinedDec: dec, win: stake * dec - stake, avgEdge: legs.reduce((s,l)=>s+l.edge,0)/legs.length, combinedModelProb, modelEV, crossLeague: new Set(legs.map(l=>l.sport)).size > 1 };
      })
      .filter(Boolean).sort((a,b)=>b.modelEV-a.modelEV).slice(0,8);
  }, [matches, stake]);

  const tabs = [
    { id:"matches",     label:`Matchs${matches.length ? ` (${matches.length})` : ""}` },
    { id:"suggestions", label:`Sûrs (${suggestions.length})` },
    { id:"builder",     label:`Builder${picks.length ? ` (${picks.length})` : ""}` },
    { id:"optimizer",   label:"Optimizer ★" },
    { id:"history",     label:`Historique (${history.length})` },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#070b14", color:"#ccd", fontFamily:"'IBM Plex Mono','Courier New',monospace" }}>
      <header style={{ background:"#0a0f1c", borderBottom:"1px solid #1a2035", padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:"#00ff88", letterSpacing:2 }}>PARLAY<span style={{ color:"#fff" }}>EDGE</span></div>
          <div style={{ fontSize:10, color:"#445" }}>
            {matches.length > 0 ? <span style={{ color:"#00aa55" }}>✓ {matches.length} matchs · {matches.filter(m=>m.hasModel).length} avec modèle</span> : "Soccer · Value model · API-Football"}
          </div>
        </div>
        {picks.length > 0 && <div style={{ background:"#00ff8815", border:"1px solid #00ff8830", borderRadius:20, padding:"4px 12px", fontSize:11, color:"#00ff88" }}>{picks.length} pick{picks.length>1?"s":""}</div>}
      </header>

      {activeTab !== "optimizer" && (
        <div style={{ background:"#0a0f1c", borderBottom:"1px solid #1a2035", padding:"10px 20px" }}>
          {sportsLoading ? (
            <div style={{ fontSize:10, color:"#445" }}>Chargement des ligues...</div>
          ) : (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:8 }}>
              {allSports.map(s => {
                const active = selectedSports.includes(s.key);
                return (
                  <button key={s.key} onClick={() => toggleSport(s.key)} style={{ background:active?"#003322":"#0f1320", border:`1px solid ${active?"#00aa55":"#1e2535"}`, color:active?"#00ff88":"#445", padding:"4px 10px", borderRadius:20, cursor:"pointer", fontSize:10, display:"flex", alignItems:"center", gap:4 }}>
                    {s.label}{!s.hasModel && <span style={{ fontSize:8, color:"#334" }}>·no mdl</span>}
                  </button>
                );
              })}
            </div>
          )}
          <button onClick={loadMatches} disabled={loading || !selectedSports.length} style={{ background:loading?"#1a2035":"#00ff88", color:loading?"#445":"#000", border:"none", padding:"9px 20px", borderRadius:8, cursor:loading?"not-allowed":"pointer", fontSize:12, fontWeight:700 }}>
            {loading ? `Chargement ${selectedSports.length} ligues...` : `CHARGER (${selectedSports.length} ligues)`}
          </button>
          {error && <div style={{ color:"#ff6666", fontSize:11, marginTop:6 }}>⚠ {error}</div>}
        </div>
      )}

      <div style={{ display:"flex", borderBottom:"1px solid #1a2035", overflowX:"auto" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex:"0 0 auto", padding:"10px 14px", border:"none", cursor:"pointer", fontSize:10, background:activeTab===t.id?"#0f1320":"transparent", color:activeTab===t.id?(t.id==="optimizer"?"#f5a623":"#00ff88"):"#445", borderBottom:`2px solid ${activeTab===t.id?(t.id==="optimizer"?"#f5a623":"#00ff88"):"transparent"}`, whiteSpace:"nowrap" }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding:activeTab==="optimizer"?0:"16px 20px", maxWidth:activeTab==="optimizer"?"100%":900, margin:"0 auto" }}>

        {activeTab === "matches" && (
          <div>
            {matches.length > 0 && (
              <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
                <span style={{ fontSize:10, color:"#445" }}>Trier:</span>
                {[["value","Meilleur edge"],["rank","Écart rang"],["date","Date"]].map(([v,l]) => (
                  <button key={v} onClick={() => setSortBy(v)} style={{ background:sortBy===v?"#00ff8818":"transparent", color:sortBy===v?"#00ff88":"#445", border:`1px solid ${sortBy===v?"#00ff8840":"#1e2535"}`, borderRadius:4, padding:"4px 10px", cursor:"pointer", fontSize:10 }}>{l}</button>
                ))}
                <button onClick={() => setFilterEV(v=>!v)} style={{ background:filterEV?"#00ff8818":"transparent", color:filterEV?"#00ff88":"#445", border:`1px solid ${filterEV?"#00ff8840":"#1e2535"}`, borderRadius:4, padding:"4px 10px", cursor:"pointer", fontSize:10 }}>+EV seulement</button>
              </div>
            )}
            {loading && <div style={{ textAlign:"center", color:"#445", padding:40 }}>Analyse de {selectedSports.length} ligues...</div>}
            {!loading && !error && matches.length === 0 && <div style={{ textAlign:"center", color:"#334", padding:40 }}>Sélectionne des ligues et charge les matchs</div>}
            {sortedMatches.map(m => <MatchCard key={m.id} match={m} picks={picks} onPick={addPick} />)}
          </div>
        )}

        {activeTab === "suggestions" && (
          <div>
            <div style={{ background:"#0a1a0a", border:"1px solid #1a4a2a", borderRadius:10, padding:"12px 14px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#00ff88", fontWeight:700, marginBottom:4 }}>🎯 PARLAYS SÉCURITAIRES AUTO</div>
              <div style={{ fontSize:10, color:"#556", lineHeight:1.6 }}>2 jambes · prob &gt;50% · edge positif · EV positif · toutes ligues</div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>MISE ($)</div>
              <input type="number" value={stake} min="1" onChange={e => setStake(Math.max(1, Number(e.target.value)))} style={{ width:80, background:"#0f1320", border:"1px solid #1e2535", borderRadius:4, padding:"6px 10px", color:"#ccd", fontFamily:"monospace", fontSize:13 }} />
            </div>
            {suggestions.length === 0 ? (
              <div style={{ color:"#334", textAlign:"center", padding:40, fontSize:12 }}>{matches.length === 0 ? "Charge les matchs d'abord" : "Aucun parlay sécuritaire trouvé"}</div>
            ) : (
              suggestions.map((p, i) => <ParlayCard key={i} parlay={p} index={i} stake={stake} onLoad={parlay => { setPicks(parlay.legs.map(l=>({...l}))); setActiveTab("builder"); }} onSave={saveToHistory} />)
            )}
          </div>
        )}

        {activeTab === "builder" && <BuilderTab picks={picks} onRemove={removePick} stake={stake} setStake={setStake} />}
        {activeTab === "optimizer" && <ParlayOptimizer />}
        {activeTab === "history" && <HistoryTab history={history} onUpdate={(id,result) => setHistory(prev=>prev.map(h=>h.id===id?{...h,result}:h))} onClear={() => { if(confirm("Effacer?")) setHistory([]); }} />}
      </div>
    </div>
  );
}
