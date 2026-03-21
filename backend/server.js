const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const ODDS_KEY = process.env.ODDS_API_KEY;
const FB_KEY   = process.env.FOOTBALL_API_KEY;

app.use(cors());
app.use(express.json());

// ─── Cache ────────────────────────────────────────────────────────────────────
const cache = new Map();
function getCache(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data, ttlMs) {
  cache.set(key, { data, ts: Date.now(), ttl: ttlMs });
}

// ─── Odds API sport key → API-Football league id ──────────────────────────────
const LEAGUE_MAP = {
  soccer_france_ligue_one:             { id: 61,  season: 2025 },
  soccer_france_ligue_2:               { id: 62,  season: 2025 },
  soccer_france_ligue_nationale:       { id: 63,  season: 2025 },
  soccer_epl:                          { id: 39,  season: 2025 },
  soccer_england_championship:         { id: 40,  season: 2025 },
  soccer_england_league1:              { id: 41,  season: 2025 },
  soccer_england_league2:              { id: 42,  season: 2025 },
  soccer_spain_la_liga:                { id: 140, season: 2025 },
  soccer_spain_segunda_division:       { id: 141, season: 2025 },
  soccer_germany_bundesliga:           { id: 78,  season: 2025 },
  soccer_germany_bundesliga2:          { id: 79,  season: 2025 },
  soccer_italy_serie_a:                { id: 135, season: 2025 },
  soccer_italy_serie_b:                { id: 136, season: 2025 },
  soccer_uefa_champs_league:           { id: 2,   season: 2025 },
  soccer_uefa_europa_league:           { id: 3,   season: 2025 },
  soccer_netherlands_eredivisie:       { id: 88,  season: 2025 },
  soccer_belgium_first_div:            { id: 144, season: 2025 },
  soccer_portugal_primeira_liga:       { id: 94,  season: 2025 },
  soccer_turkey_super_league:          { id: 203, season: 2025 },
  soccer_scotland_premiership:         { id: 179, season: 2025 },
  soccer_greece_super_league:          { id: 197, season: 2025 },
  soccer_usa_mls:                      { id: 253, season: 2024 },
  soccer_brazil_campeonato:            { id: 71,  season: 2025 },
  soccer_argentina_primera_division:   { id: 128, season: 2024 },
  soccer_mexico_ligamx:                { id: 262, season: 2024 },
  soccer_denmark_superliga:            { id: 119, season: 2025 },
  soccer_sweden_allsvenskan:           { id: 113, season: 2025 },
  soccer_norway_eliteserien:           { id: 103, season: 2025 },
  soccer_switzerland_superleague:      { id: 207, season: 2025 },
  soccer_switzerland_challenge_league: { id: 208, season: 2025 },
  soccer_austria_bundesliga:           { id: 218, season: 2025 },
  soccer_ireland_premier_division:     { id: 357, season: 2025 },
  soccer_russia_fpl:                   { id: 235, season: 2024 },
  soccer_australia_aleague:            { id: 188, season: 2025 },
  soccer_japan_j_league:               { id: 98,  season: 2024 },
};

const SPORT_LABELS = {
  soccer_france_ligue_one: "Ligue 1 🇫🇷",
  soccer_france_ligue_2: "Ligue 2 🇫🇷",
  soccer_france_ligue_nationale: "National 🇫🇷",
  soccer_epl: "Premier League 🏴󠁧󠁢󠁥󠁳󠁣󠁴󠁿",
  soccer_england_championship: "Championship 🏴󠁧󠁢󠁥󠁳󠁣󠁴󠁿",
  soccer_england_league1: "League One 🏴󠁧󠁢󠁥󠁳󠁣󠁴󠁿",
  soccer_england_league2: "League Two 🏴󠁧󠁢󠁥󠁳󠁣󠁴󠁿",
  soccer_spain_la_liga: "La Liga 🇪🇸",
  soccer_spain_segunda_division: "Segunda 🇪🇸",
  soccer_germany_bundesliga: "Bundesliga 🇩🇪",
  soccer_germany_bundesliga2: "2. Bundesliga 🇩🇪",
  soccer_italy_serie_a: "Serie A 🇮🇹",
  soccer_italy_serie_b: "Serie B 🇮🇹",
  soccer_uefa_champs_league: "Champions League ⭐",
  soccer_uefa_europa_league: "Europa League",
  soccer_netherlands_eredivisie: "Eredivisie 🇳🇱",
  soccer_belgium_first_div: "Pro League 🇧🇪",
  soccer_portugal_primeira_liga: "Primeira Liga 🇵🇹",
  soccer_turkey_super_league: "Süper Lig 🇹🇷",
  soccer_scotland_premiership: "Premiership 🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  soccer_greece_super_league: "Super League 🇬🇷",
  soccer_usa_mls: "MLS 🇺🇸",
  soccer_brazil_campeonato: "Brasileirão 🇧🇷",
  soccer_argentina_primera_division: "Liga Profesional 🇦🇷",
  soccer_mexico_ligamx: "Liga MX 🇲🇽",
  soccer_denmark_superliga: "Superliga 🇩🇰",
  soccer_sweden_allsvenskan: "Allsvenskan 🇸🇪",
  soccer_norway_eliteserien: "Eliteserien 🇳🇴",
  soccer_switzerland_superleague: "Super League 🇨🇭",
  soccer_switzerland_challenge_league: "Challenge League 🇨🇭",
  soccer_austria_bundesliga: "Bundesliga 🇦🇹",
  soccer_ireland_premier_division: "Premier Division 🇮🇪",
  soccer_russia_fpl: "FNL 🇷🇺",
  soccer_australia_aleague: "A-League 🇦🇺",
  soccer_japan_j_league: "J1 League 🇯🇵",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function americanToDecimal(o) {
  const n = parseFloat(o);
  return n >= 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function americanToImplied(o) {
  const n = parseFloat(o);
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}
function decimalToAmerican(d) {
  return d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`;
}

// ─── API-Football ─────────────────────────────────────────────────────────────
async function fbFetch(endpoint) {
  if (!FB_KEY) return null;
  try {
    const r = await fetch(`https://v3.football.api-sports.io/${endpoint}`, {
      headers: { "x-apisports-key": FB_KEY },
      timeout: 10000,
    });
    if (!r.ok) return null;
    return (await r.json()).response;
  } catch { return null; }
}

async function getStandings(leagueId, season) {
  const key = `standings_${leagueId}_${season}`;
  const cached = getCache(key);
  if (cached) return cached;
  const data = await fbFetch(`standings?league=${leagueId}&season=${season}`);
  if (!data) return null;
  const groups = data?.[0]?.league?.standings || [];
  if (!groups.length) return null;

  // BUGFIX: Prendre seulement le plus grand groupe (vrai classement)
  // Évite de merger groupes playoffs/relégation qui faussent les rangs
  const mainGroup = groups.reduce((best, g) => g.length > best.length ? g : best, groups[0]);

  // Valider que c'est un vrai classement (min 8 équipes, min 5 matchs joués)
  const validTeams = mainGroup.filter(t => (t.all?.played || 0) >= 5);
  if (validTeams.length < 8) return null;

  const table = {};
  validTeams.forEach(t => {
    const played = Math.max(t.all?.played || 1, 1);
    table[t.team.name] = {
      rank: t.rank, points: t.points, played,
      ppg: parseFloat((t.points / played).toFixed(2)),
      form: (t.form || "").slice(-5),
      gpgFor: parseFloat(((t.all?.goals?.for || 0) / played).toFixed(2)),
      gpgAgainst: parseFloat(((t.all?.goals?.against || 0) / played).toFixed(2)),
      homePlayed: t.home?.played || 0,
      homeWin: t.home?.win || 0,
      homeGoalsFor: t.home?.goals?.for || 0,
      homeGoalsAgainst: t.home?.goals?.against || 0,
      awayPlayed: t.away?.played || 0,
      awayWin: t.away?.win || 0,
      awayGoalsFor: t.away?.goals?.for || 0,
      awayGoalsAgainst: t.away?.goals?.against || 0,
    };
  });
  setCache(key, table, 6 * 60 * 60 * 1000);
  return table;
}

// ─── Team matching ────────────────────────────────────────────────────────────
function normName(name) {
  return name.toLowerCase()
    // Remove common club suffixes/prefixes
    .replace(/\b(fc|cf|sc|ac|as|rc|ss|afc|utd|united|city|town|sporting|athletic|real|club|calcio|inter|atletico|stade|olympique|racing|hotspur|wanderers|rovers|county|villa)\b/g, "")
    // Remove German/Dutch prefixes
    .replace(/\b(sv|vfb|vfl|rb|bvb|fsv|tsg|tsv|1\.\s*)\b/g, "")
    // Remove years like "98", "04", "05" at end
    .replace(/\s+\d{2}$/, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function matchScore(a, b) {
  const na = normName(a), nb = normName(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = na.split(" ").filter(w => w.length > 2);
  const wb = nb.split(" ").filter(w => w.length > 2);
  if (!wa.length || !wb.length) return 0;
  return wa.filter(w => wb.includes(w)).length / Math.max(wa.length, wb.length);
}
function findTeam(name, table) {
  if (!table) return null;
  let best = null, bestScore = 0;
  for (const [key, val] of Object.entries(table)) {
    const s = matchScore(name, key);
    if (s > bestScore) { bestScore = s; best = val; }
  }
  return bestScore >= 0.65 ? best : null;
}

// ─── Model ────────────────────────────────────────────────────────────────────
function formScore(f) {
  if (!f) return 0.45;
  const chars = f.slice(-5).split("");
  const weights = [1, 1.2, 1.4, 1.6, 2.0].slice(-chars.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pts = { W: 3, D: 1, L: 0 };
  return chars.reduce((s, c, i) => s + (pts[c] || 0) * weights[i], 0) / (3 * totalW);
}

function computeProbs(homeTeam, awayTeam, table) {
  const h = findTeam(homeTeam, table);
  const a = findTeam(awayTeam, table);
  if (!h || !a) return null;
  const homeXG = (h.homePlayed > 0 ? h.homeGoalsFor / h.homePlayed : 1.4) * ((a.awayPlayed > 0 ? a.awayGoalsAgainst / a.awayPlayed : 1.6) / 1.4);
  const awayXG = (a.awayPlayed > 0 ? a.awayGoalsFor / a.awayPlayed : 1.0) * ((h.homePlayed > 0 ? h.homeGoalsAgainst / h.homePlayed : 1.2) / 1.2);
  const maxPts = Math.max(h.played, a.played, 1) * 3;
  const hS = (h.points / maxPts * 0.35) + (formScore(h.form) * 0.30) + (Math.min(homeXG, 3) / 3 * 0.20) + 0.06;
  const aS = (a.points / maxPts * 0.35) + (formScore(a.form) * 0.30) + (Math.min(awayXG, 3) / 3 * 0.20);
  const tot = hS + aS;
  const rawH = (hS / tot) * 0.73 + 0.06, rawA = (aS / tot) * 0.73, rawD = 0.27;
  const rawTot = rawH + rawA + rawD;
  return {
    home: Math.max(0.08, Math.min(0.78, rawH / rawTot)),
    away: Math.max(0.08, Math.min(0.68, rawA / rawTot)),
    draw: Math.max(0.14, Math.min(0.36, rawD / rawTot)),
    homeStats: {
      rank: h.rank, ppg: h.ppg, form: h.form,
      gpgFor: h.gpgFor, gpgAgainst: h.gpgAgainst,
      homeWinRate: h.homePlayed > 0 ? parseFloat((h.homeWin / h.homePlayed).toFixed(2)) : null,
    },
    awayStats: {
      rank: a.rank, ppg: a.ppg, form: a.form,
      gpgFor: a.gpgFor, gpgAgainst: a.gpgAgainst,
      awayWinRate: a.awayPlayed > 0 ? parseFloat((a.awayWin / a.awayPlayed).toFixed(2)) : null,
    },
    rankGap: Math.abs(h.rank - a.rank),
    pointsGap: Math.abs(h.points - a.points),
    homeWins: h.win,
    awayWins: a.win,
    homePlayed: h.played,
    awayPlayed: a.played,
    totalTeams: Object.keys(table).length,
  };
}

// ─── Enrich raw matches ───────────────────────────────────────────────────────
function enrichMatches(rawMatches, sportKey, standings, days = 1) {
  const results = [];
  const now = Date.now();
  const maxMs = (days || 1) * 24 * 60 * 60 * 1000;
  for (const m of rawMatches) {
    // Skip matches beyond the days window
    const matchTime = new Date(m.commence_time).getTime();
    if (matchTime - now > maxMs) continue;
    // Skip matches already started
    if (matchTime < now - 2 * 60 * 60 * 1000) continue;
    const home = m.home_team, away = m.away_team;
    const best = { home: null, away: null, draw: null };
    for (const bm of m.bookmakers || []) {
      for (const mkt of bm.markets || []) {
        if (mkt.key !== "h2h") continue;
        for (const oc of mkt.outcomes || []) {
          const p = oc.price;
          if (oc.name === home  && (best.home === null || p > best.home))  best.home  = p;
          else if (oc.name === away && (best.away === null || p > best.away))  best.away  = p;
          else if (oc.name === "Draw" && (best.draw === null || p > best.draw)) best.draw  = p;
        }
      }
    }
    if (best.home === null || best.away === null) continue;
    const ip = {
      home: parseFloat(americanToImplied(best.home).toFixed(4)),
      away: parseFloat(americanToImplied(best.away).toFixed(4)),
      ...(best.draw != null ? { draw: parseFloat(americanToImplied(best.draw).toFixed(4)) } : {}),
    };
    const md = standings ? computeProbs(home, away, standings) : null;
    results.push({
      id: m.id, sport: sportKey,
      sportLabel: SPORT_LABELS[sportKey] || sportKey,
      homeTeam: home, awayTeam: away,
      commenceTime: m.commence_time,
      odds: best, impliedProb: ip,
      modelProb: md ? { home: md.home, away: md.away, draw: md.draw } : null,
      value: md ? (() => {
        const vh = parseFloat((md.home - ip.home).toFixed(4));
        const va = parseFloat((md.away - ip.away).toFixed(4));
        // Cap edges at 15% — anything higher is likely a model matching error
        return {
          home: Math.abs(vh) <= 0.15 ? vh : null,
          away: Math.abs(va) <= 0.15 ? va : null,
        };
      })() : null,
      homeStats: md?.homeStats || null,
      awayStats: md?.awayStats || null,
      rankGap:    md?.rankGap ?? null,
      pointsGap:  md?.pointsGap ?? null,
      totalTeams: md?.totalTeams ?? null,
      hasModel: !!md,
    });
  }
  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => res.json({ status: "ParlayEdge API running ✅" }));

// Toutes les ligues soccer disponibles sur le compte
app.get("/api/sports", async (req, res) => {
  if (!ODDS_KEY) return res.status(500).json({ error: "ODDS_API_KEY missing" });
  const key = "sports_list";
  const cached = getCache(key);
  if (cached) return res.json(cached);
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_KEY}`, { timeout: 10000 });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json();
    const sports = data
      .filter(s => s.group === "Soccer" && s.active)
      .map(s => ({
        key: s.key,
        label: SPORT_LABELS[s.key] || s.title,
        hasModel: !!LEAGUE_MAP[s.key],
      }));
    const result = { sports, count: sports.length };
    setCache(key, result, 24 * 60 * 60 * 1000);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cotes + stats pour une ligue
app.get("/api/odds", async (req, res) => {
  const { sport, days = 2 } = req.query;
  if (!sport || !ODDS_KEY) return res.status(400).json({ error: "sport + ODDS_API_KEY requis" });
  const cacheKey = `odds_${sport}_${days}`;
  let raw = getCache(cacheKey);
  if (!raw) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=american&daysFrom=${days}`;
      const r = await fetch(url, { timeout: 10000 });
      if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e.message || "Odds API error" }); }
      raw = await r.json();
      if (raw.length) setCache(cacheKey, raw, 15 * 60 * 1000);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  const leagueConf = LEAGUE_MAP[sport];
  const standings = leagueConf && FB_KEY ? await getStandings(leagueConf.id, leagueConf.season) : null;
  const matches = enrichMatches(raw, sport, standings, days);
  matches.sort((a, b) => {
    const va = a.value ? Math.max(a.value.home ?? -99, a.value.away ?? -99) : -99;
    const vb = b.value ? Math.max(b.value.home ?? -99, b.value.away ?? -99) : -99;
    return vb - va;
  });
  res.json({ matches, count: matches.length, hasModel: !!standings });
});

// Batch: plusieurs ligues en un appel
app.post("/api/odds/batch", async (req, res) => {
  const { sports = [], days = 1 } = req.body;
  if (!ODDS_KEY || !sports.length) return res.json({ matches: [] });
  const allMatches = [];
  const chunks = [];
  for (let i = 0; i < sports.length; i += 4) chunks.push(sports.slice(i, i + 4));
  for (const chunk of chunks) {
    await Promise.all(chunk.map(async sportKey => {
      const cacheKey = `odds_${sportKey}_${days}`;
      let raw = getCache(cacheKey);
      if (!raw) {
        try {
          const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=american&daysFrom=${days}`;
          const r = await fetch(url, { timeout: 10000 });
          if (!r.ok) return;
          raw = await r.json();
          if (raw.length) setCache(cacheKey, raw, 15 * 60 * 1000);
        } catch { return; }
      }
      const leagueConf = LEAGUE_MAP[sportKey];
      const standings = leagueConf && FB_KEY ? await getStandings(leagueConf.id, leagueConf.season) : null;
      allMatches.push(...enrichMatches(raw, sportKey, standings, days));
    }));
  }
  allMatches.sort((a, b) => {
    const va = a.value ? Math.max(a.value.home ?? -99, a.value.away ?? -99) : -99;
    const vb = b.value ? Math.max(b.value.home ?? -99, b.value.away ?? -99) : -99;
    return vb - va;
  });
  res.json({ matches: allMatches, count: allMatches.length });
});

// Build parlays
app.post("/api/parlay/build", (req, res) => {
  const { picks = [], legSize = 3, stake = 20 } = req.body;
  if (picks.length < legSize) return res.status(400).json({ error: `Besoin de ${legSize} picks minimum` });
  function combos(arr, k) {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [h, ...t] = arr;
    return [...combos(t, k - 1).map(c => [h, ...c]), ...combos(t, k)];
  }
  const parlays = combos(picks, legSize).map(legs => {
    const dec = legs.reduce((a, p) => a * americanToDecimal(p.odds), 1);
    const win = stake * dec - stake;
    const edges = legs.map(l => l.valueEdge).filter(v => v != null);
    const mps   = legs.map(l => l.modelProb).filter(v => v != null);
    return {
      legs,
      decimalOdds: parseFloat(dec.toFixed(4)),
      americanOdds: decimalToAmerican(dec),
      potentialWin: parseFloat(win.toFixed(2)),
      totalPayout: parseFloat((stake + win).toFixed(2)),
      avgEdge: edges.length ? parseFloat((edges.reduce((a,b)=>a+b,0)/edges.length).toFixed(4)) : null,
      combinedModelProb: mps.length === legs.length ? parseFloat(mps.reduce((a,b)=>a*b,1).toFixed(4)) : null,
    };
  });
  parlays.sort((a, b) => {
    const aPos = (a.avgEdge ?? -99) > 0 ? 1 : 0;
    const bPos = (b.avgEdge ?? -99) > 0 ? 1 : 0;
    return bPos !== aPos ? bPos - aPos : b.decimalOdds - a.decimalOdds;
  });
  res.json({ parlays, count: parlays.length, stake });
});

// Debug: voir les standings bruts d'une ligue
app.get("/api/debug/standings/:sport", async (req, res) => {
  const league = LEAGUE_MAP[req.params.sport];
  if (!league) return res.status(400).json({ error: "sport inconnu" });
  if (!FB_KEY) return res.status(500).json({ error: "FOOTBALL_API_KEY missing" });
  try {
    // Clear cache for fresh data
    const key = `standings_${league.id}_${league.season}`;
    cache.delete(key);
    const standings = await getStandings(league.id, league.season);
    if (!standings) return res.json({ error: "no standings", league });
    const teams = Object.entries(standings)
      .sort((a, b) => a[1].rank - b[1].rank)
      .map(([name, s]) => ({ name, rank: s.rank, points: s.points, played: s.played, ppg: s.ppg }));
    res.json({ league, count: teams.length, teams });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`ParlayEdge API on port ${PORT}`));
