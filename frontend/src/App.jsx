// frontend/src/App.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
import ParlayOptimizer from "./ParlayOptimizer";
import { MatchCard, ParlayCard, BuilderTab, HistoryTab, americanToDecimal, getCombinations } from "./AppComponents";


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
  const [days, setDays]                     = useState(2);
  const [maxParlays, setMaxParlays]         = useState(8);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });

  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }, [history]);

  useEffect(() => {
    fetch(`${API}/api/sports`)
      .then(r => r.json())
      .then(data => {
        setAllSports(data.sports || []);
        
        const available = (data.sports || []).map(s => s.key);
        setSelectedSports(available);
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
        body: JSON.stringify({ sports: selectedSports, days }),
      });
      if (!r.ok) throw new Error(`Erreur ${r.status}`);
      const data = await r.json();
      setMatches(data.matches || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [selectedSports, days]);

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
        // Cotes raisonnables pour parlays: -300 à +200
        if (odds == null || odds > 200 || odds < -300) continue;
        // On se fie au modèle de prob
        if (!m.hasModel || model == null || model < 0.52) continue;
        // Exclure ligues début de saison: PPG trop bas = peu de matchs joués
        const stats = side === "home" ? m.homeStats : m.awayStats;
        if (stats && stats.ppg < 0.8) continue;
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
        // Max +300 pour les parlays "sûrs" - au-delà c'est trop risqué
        const americanOdds = Math.round((dec - 1) * 100);
        if (americanOdds > 400) return null;
        // Prob combinée minimum 35% - on veut gagner 1 fois sur 3
        if (combinedModelProb < 0.30) return null;
        return { legs, combinedDec: dec, win: stake * dec - stake, avgEdge: legs.reduce((s,l)=>s+l.edge,0)/legs.length, combinedModelProb, modelEV, crossLeague: new Set(legs.map(l=>l.sport)).size > 1 };
      })
      .filter(Boolean).sort((a,b)=>b.modelEV-a.modelEV).slice(0, maxParlays);
  }, [matches, stake, maxParlays]);

  // Value picks: bon odds sur favoris clairs (écart rang >= 6, cote -250 à -100)
  const valuePicks = matches.filter(m => {
    const hasRankGap = m.rankGap && m.rankGap >= 6;
    const hasPointsGap = m.pointsGap && m.pointsGap >= 10;
    const hasOddsGap = m.oddsGap && m.oddsGap >= 0.25;
    if (!hasRankGap && !hasPointsGap && !hasOddsGap) return false;
    for (const side of ["home","away"]) {
      const odds = m.odds[side], model = m.modelProb?.[side], edge = m.value?.[side];
      if (odds == null || odds < -250 || odds > -80) continue;
      if (model == null || model < 0.60) continue;
      if (edge == null || edge < -0.05) continue;
      return true;
    }
    return false;
  });

  const tabs = [
    { id:"matches",     label:`Matchs${matches.length ? ` (${matches.length})` : ""}` },
    { id:"suggestions", label:`Sûrs (${suggestions.length})` },
    { id:"value",       label:`Value 💰${valuePicks.length ? ` (${valuePicks.length})` : ""}` },
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
                <div style={{ display:"flex", gap:4, marginLeft:8 }}>
                  {[[1,"Auj."],[2,"2j"]].map(([d,l]) => (
                    <button key={d} onClick={() => setDays(d)} style={{ background:days===d?"#4a9eff22":"transparent", color:days===d?"#4a9eff":"#445", border:`1px solid ${days===d?"#4a9eff40":"#1e2535"}`, borderRadius:4, padding:"4px 10px", cursor:"pointer", fontSize:10 }}>{l}</button>
                  ))}
                </div>
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
            <div style={{ display:"flex", gap:16, marginBottom:12, flexWrap:"wrap", alignItems:"flex-end" }}>
              <div>
                <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>MISE ($)</div>
                <input type="number" value={stake} min="1" onChange={e => setStake(Math.max(1, Number(e.target.value)))} style={{ width:80, background:"#0f1320", border:"1px solid #1e2535", borderRadius:4, padding:"6px 10px", color:"#ccd", fontFamily:"monospace", fontSize:13 }} />
              </div>
              <div>
                <div style={{ fontSize:9, color:"#445", marginBottom:4 }}>NB PARLAYS</div>
                <div style={{ display:"flex", gap:4 }}>
                  {[3,5,8,12,20].map(n => (
                    <button key={n} onClick={() => setMaxParlays(n)} style={{ background:maxParlays===n?"#00ff8822":"#0f1320", border:`1px solid ${maxParlays===n?"#00aa55":"#1e2535"}`, color:maxParlays===n?"#00ff88":"#556", padding:"5px 9px", borderRadius:4, cursor:"pointer", fontSize:11 }}>{n}</button>
                  ))}
                </div>
              </div>
            </div>
            {suggestions.length === 0 ? (
              <div style={{ color:"#334", textAlign:"center", padding:40, fontSize:12 }}>{matches.length === 0 ? "Charge les matchs d'abord" : "Aucun parlay sécuritaire trouvé"}</div>
            ) : (
              suggestions.map((p, i) => <ParlayCard key={i} parlay={p} index={i} stake={stake} onLoad={parlay => { setPicks(parlay.legs.map(l=>({...l}))); setActiveTab("builder"); }} onSave={saveToHistory} />)
            )}
          </div>
        )}

        {activeTab === "builder" && <BuilderTab picks={picks} onRemove={removePick} stake={stake} setStake={setStake} />}
        {activeTab === "value" && (
          <div>
            <div style={{ background:"#0a1a0a", border:"1px solid #1a4a2a", borderRadius:10, padding:"12px 14px", marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#00ff88", fontWeight:700, marginBottom:4 }}>💰 FAVORIS AVEC VALEUR</div>
              <div style={{ fontSize:10, color:"#556", lineHeight:1.6 }}>
                Équipes clairement supérieures (écart rang ≥ 8) · Cotes entre -250 et -80 · Bon rendement pour le risque
              </div>
            </div>
            {valuePicks.length === 0 ? (
              <div style={{ color:"#334", textAlign:"center", padding:40, fontSize:12 }}>
                {matches.length === 0 ? "Charge les matchs d'abord" : "Aucun favori à valeur trouvé aujourd'hui"}
              </div>
            ) : (
              valuePicks.map(m => {
                const favSide = ["home","away"].find(s => m.odds[s] != null && m.odds[s] >= -250 && m.odds[s] <= -80 && (m.modelProb?.[s] || 0) >= 0.60);
                const favOdds = favSide ? m.odds[favSide] : null;
                const favModel = favSide ? m.modelProb?.[favSide] : null;
                const favEdge = favSide ? m.value?.[favSide] : null;
                const favStats = favSide === "home" ? m.homeStats : m.awayStats;
                const favTeam = favSide === "home" ? m.homeTeam : m.awayTeam;
                const underdogOdds = favSide === "home" ? m.odds.away : m.odds.home;
                const isPicked = picks.some(p => p.matchId === m.id);
                return (
                  <div key={m.id} style={{ background:"#080f0a", border:"2px solid #1a4a2a", borderRadius:12, padding:14, marginBottom:10 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10, flexWrap:"wrap", gap:6 }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:"#eee" }}>{m.homeTeam} vs {m.awayTeam}</div>
                        <div style={{ fontSize:10, color:"#445", marginTop:2 }}>{m.sportLabel} · {new Date(m.commenceTime).toLocaleDateString("fr-CA",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})} · Écart rang: <span style={{ color:"#ffcc44" }}>{m.rankGap}/{m.totalTeams}</span> · Écart pts: <span style={{ color:"#00ff88" }}>+{m.pointsGap}</span></div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:9, color:"#445" }}>COTE FAVORI</div>
                        <div style={{ fontFamily:"monospace", fontSize:22, fontWeight:700, color:"#00ff88" }}>{favOdds >= 0 ? "+" : ""}{favOdds}</div>
                      </div>
                    </div>
                    <div style={{ background:"#0f1a0f", borderRadius:8, padding:"10px 12px", marginBottom:8 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                        <div>
                          <div style={{ fontSize:12, fontWeight:700, color:"#00ff88" }}>{favTeam} {favSide === "home" ? "(DOM)" : "(VIS)"}</div>
                          {favStats && (
                            <div style={{ display:"flex", gap:10, marginTop:4 }}>
                              <span style={{ fontSize:10, color:"#445" }}>Rang <span style={{ color:"#88aacc" }}>#{favStats.rank}</span></span>
                              <span style={{ fontSize:10, color:"#445" }}>PPG <span style={{ color: favStats.ppg >= 2 ? "#00ff88" : "#ffcc44" }}>{favStats.ppg}</span></span>
                              <span style={{ fontSize:10, color:"#445" }}>
                                Forme {(favStats.form||"").split("").map((c,i) => (
                                  <span key={i} style={{ display:"inline-block", width:12, height:12, borderRadius:2, fontSize:8, fontWeight:700, textAlign:"center", lineHeight:"12px", background:c==="W"?"#00ff88":c==="D"?"#ffcc44":"#ff5555", color:"#000", marginLeft:1 }}>{c}</span>
                                ))}
                              </span>
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:10, color:"#445" }}>Prob modèle</div>
                          <div style={{ fontSize:16, fontWeight:700, color:"#00ff88" }}>{favModel ? (favModel*100).toFixed(1)+"%" : "—"}</div>
                          {favEdge != null && <div style={{ fontSize:10, color: favEdge > 0 ? "#00ff88" : "#ff5555" }}>edge {favEdge >= 0 ? "+" : ""}{(favEdge*100).toFixed(1)}%</div>}
                        </div>
                      </div>
                      <div style={{ fontSize:10, color:"#445", borderTop:"1px solid #1a2a1a", paddingTop:6, marginTop:4 }}>
                        Adversaire cote: <span style={{ fontFamily:"monospace", color:"#888" }}>{underdogOdds >= 0 ? "+" : ""}{underdogOdds}</span>
                        <span style={{ marginLeft:12 }}>Pour $20 → </span>
                        <span style={{ color:"#00ff88", fontFamily:"monospace", fontWeight:700 }}>
                          ${(20 * (favOdds < 0 ? (100/Math.abs(favOdds)+1) : (favOdds/100+1))).toFixed(0)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => addPick(m, favSide)}
                      disabled={isPicked}
                      style={{ width:"100%", background: isPicked ? "#0a1a0a" : "#003322", border:`1px solid ${isPicked ? "#1a4a2a" : "#00aa55"}`, color: isPicked ? "#445" : "#00ff88", padding:"8px", borderRadius:6, cursor: isPicked ? "default" : "pointer", fontSize:11, fontWeight:700 }}>
                      {isPicked ? "✓ Dans le Builder" : "→ Ajouter au Builder"}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
        {activeTab === "optimizer" && <ParlayOptimizer />}
        {activeTab === "history" && <HistoryTab history={history} onUpdate={(id,result) => setHistory(prev=>prev.map(h=>h.id===id?{...h,result}:h))} onClear={() => { if(confirm("Effacer?")) setHistory([]); }} />}
      </div>
    </div>
  );
}
