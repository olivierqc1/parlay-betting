const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const FOOTBALL_API_KEY = process.env.FOOTBALL_API_KEY;

app.use(cors());
app.use(express.json());

// Cache simple
const cache = {};
function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) return null;
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache[key] = { data, timestamp: Date.now(), ttl: ttlMs };
}

// Map ligues
const LEAGUE_MAP = {
  soccer_epl:                { id: 39,  season: 2024 },
  soccer_uefa_champs_league: { id: 2,   season: 2024 },
  soccer_spain_la_liga:      { id: 140, season: 2024 },
  soccer_germany_bundesliga: { id: 78,  season: 2024 },
  soccer_italy_serie_a:      { id: 135, season: 2024 },
  soccer_france_ligue_one:   { id: 61,  season: 2024 },
  soccer_usa_mls:            { id: 253, season: 2024 },
};

// Normalisation stricte des noms d'équipes
function normalizeName(name) {
  return name
    .toLowerCase()
    // Enlever suffixes communs
    .replace(/\b(fc|cf|sc|ac|as|rc|ss|afc|utd|united|city|town|sporting|athletic|real|club|calcio|inter|atletico)\b/g, "")
    // Enlever prefixes communs
    .replace(/^(1\.|vfb|vfl|rb|bvb|sv|fsv|tsg|tsv|sc|fc|ac|as|ss|rc)\s+/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatchScore(nameA, nameB) {
  const a = normalizeName(nameA);
  const b = normalizeName(nameB);
  
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;
  
  const wordsA = a.split(" ").filter(w => w.length > 2);
  const wordsB = b.split(" ").filter(w => w.length > 2);
  
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  
  const common = wordsA.filter(w => wordsB.includes(w));
  const score = common.length / Math.max(wordsA.length, wordsB.length);
  
  return score;
}

function findTeamInStandings(teamName, standings) {
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [name, stats] of Object.entries(standings)) {
    const score = teamMatchScore(teamName, name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { stats, matchedName: name, score };
    }
  }
  
  // Seuil strict - minimum 0.5 pour accepter le match
  if (bestScore < 0.5) return null;
  return bestMatch;
}

async function fetchFootballAPI(endpoint) {
  const res = await fetch(`https://v3.football.api-sports.io/${endpoint}`, {
    headers: { "x-apisports-key": FOOTBALL_API_KEY },
  });
  if (!res.ok) throw new Error(`API-Football error: ${res.status}`);
  const json = await res.json();
  return json.response;
}

async function getStandings(leagueId, season) {
  const cacheKey = `standings_${leagueId}_${season}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await fetchFootballAPI(`standings?league=${leagueId}&season=${season}`);
  const standings = {};
  const groups = data?.[0]?.league?.standings || [];
  
  groups.forEach((group) => {
    group.forEach((team) => {
      standings[team.team.name] = {
        rank: team.rank,
        points: team.points,
        played: team.all.played,
        win: team.all.win,
        draw: team.all.draw,
        lose: team.all.lose,
        goalsFor: team.all.goals.for,
        goalsAgainst: team.all.goals.against,
        form: team.form || "",
        // Stats domicile/extérieur séparées
        homeWin: team.home?.win || 0,
        homePlayed: team.home?.played || 0,
        awayWin: team.away?.win || 0,
        awayPlayed: team.away?.played || 0,
        homeGoalsFor: team.home?.goals?.for || 0,
        awayGoalsFor: team.away?.goals?.for || 0,
        homeGoalsAgainst: team.home?.goals?.against || 0,
        awayGoalsAgainst: team.away?.goals?.against || 0,
      };
    });
  });

  setCache(cacheKey, standings, 6 * 60 * 60 * 1000);
  return standings;
}

// Modèle calibré - retourne des probs réalistes pour le soccer
function calculateModelProbs(homeTeam, awayTeam, standings) {
  const totalTeams = Object.keys(standings).length;
  
  const homeMatch = findTeamInStandings(homeTeam, standings);
  const awayMatch = findTeamInStandings(awayTeam, standings);
  
  if (!homeMatch || !awayMatch) return null;
  
  const h = homeMatch.stats;
  const a = awayMatch.stats;
  
  // 1. Force basée sur les points (normalisée)
  const maxPossiblePts = h.played * 3 || 1;
  const homePtsPct = h.points / maxPossiblePts;
  const awayPtsPct = a.points / maxPossiblePts;
  
  // 2. Forme récente pondérée (W=1, D=0.5, L=0) sur 5 derniers
  function formScore(formStr) {
    if (!formStr || formStr.length === 0) return 0.45;
    const last5 = formStr.slice(-5);
    let score = 0;
    let count = 0;
    for (const c of last5) {
      if (c === "W") score += 1;
      else if (c === "D") score += 0.5;
      count++;
    }
    return count > 0 ? score / count : 0.45;
  }
  
  const homeFormScore = formScore(h.form);
  const awayFormScore = formScore(a.form);
  
  // 3. xG basé sur stats domicile/extérieur spécifiques
  const homeAttackRate = h.homePlayed > 0 ? h.homeGoalsFor / h.homePlayed : 1.4;
  const homeDefRate = h.homePlayed > 0 ? h.homeGoalsAgainst / h.homePlayed : 1.2;
  const awayAttackRate = a.awayPlayed > 0 ? a.awayGoalsFor / a.awayPlayed : 1.0;
  const awayDefRate = a.awayPlayed > 0 ? a.awayGoalsAgainst / a.awayPlayed : 1.6;
  
  // xG attendus pour chaque équipe dans CE match
  const homeXG = homeAttackRate * (awayDefRate / 1.4);
  const awayXG = awayAttackRate * (homeDefRate / 1.2);
  
  // 4. Score composite avec poids calibrés
  const homeStrength = (homePtsPct * 0.40) + (homeFormScore * 0.35) + (Math.min(homeXG, 3) / 3 * 0.25);
  const awayStrength = (awayPtsPct * 0.40) + (awayFormScore * 0.35) + (Math.min(awayXG, 3) / 3 * 0.25);
  
  // 5. Conversion en probabilités avec avantage domicile
  // Base historique soccer: ~45% dom, ~27% nul, ~28% vis
  const homeAdvantage = 0.06;
  const total = homeStrength + awayStrength;
  
  const rawHomeProb = (homeStrength / total) * (1 - 0.27) + homeAdvantage;
  const rawAwayProb = (awayStrength / total) * (1 - 0.27);
  const rawDrawProb = 0.27; // Le nul varie peu en soccer (~25-30%)
  
  // Normaliser pour que la somme = 1
  const rawTotal = rawHomeProb + rawAwayProb + rawDrawProb;
  
  return {
    home: Math.max(0.10, Math.min(0.75, rawHomeProb / rawTotal)),
    away: Math.max(0.10, Math.min(0.65, rawAwayProb / rawTotal)),
    draw: Math.max(0.15, Math.min(0.35, rawDrawProb / rawTotal)),
    homeTeam: homeMatch.matchedName,
    awayTeam: awayMatch.matchedName,
    homeMatchScore: homeMatch.score,
    awayMatchScore: awayMatch.score,
  };
}

app.get("/", (req, res) => {
  res.json({ status: "ParlayEdge API running" });
});

app.get("/api/odds", async (req, res) => {
  const { sport, markets = "h2h", regions = "us", bookmakers = "betonlineag" } = req.query;
  if (!sport) return res.status(400).json({ error: "sport param required" });
  if (!ODDS_API_KEY) return res.status(500).json({ error: "ODDS_API_KEY not configured" });

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${ODDS_API_KEY}&regions=${regions}&markets=${markets}&bookmakers=${bookmakers}&oddsFormat=american`;
    const response = await fetch(url);
    const remaining = response.headers.get("x-requests-remaining");
    const used = response.headers.get("x-requests-used");
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message || "Odds API error" });
    }
    const data = await response.json();
    res.json({
      data,
      meta: {
        remainingRequests: remaining ? parseInt(remaining) : null,
        usedRequests: used ? parseInt(used) : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/model/:sport", async (req, res) => {
  const { sport } = req.params;
  const league = LEAGUE_MAP[sport];
  if (!league) return res.status(400).json({ error: "Ligue non supportee" });
  if (!FOOTBALL_API_KEY) return res.status(500).json({ error: "FOOTBALL_API_KEY not configured" });

  try {
    const standings = await getStandings(league.id, league.season);
    const totalTeams = Object.keys(standings).length;
    res.json({ standings, totalTeams });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint pour tester le matching d'une équipe
app.get("/api/debug/match", async (req, res) => {
  const { team, sport } = req.query;
  const league = LEAGUE_MAP[sport];
  if (!league) return res.status(400).json({ error: "sport invalide" });
  const standings = await getStandings(league.id, league.season);
  const result = findTeamInStandings(team, standings);
  res.json({ searched: team, result, allTeams: Object.keys(standings) });
});

app.listen(PORT, () => {
  console.log(`ParlayEdge backend running on port ${PORT}`);
});
