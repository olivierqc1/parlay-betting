const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.ODDS_API_KEY;

app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ParlayEdge API running" });
});

// Get odds for a sport
app.get("/api/odds", async (req, res) => {
  const { sport, markets = "h2h", regions = "us", bookmakers = "betonlineag" } = req.query;

  if (!sport) return res.status(400).json({ error: "sport param required" });
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${API_KEY}&regions=${regions}&markets=${markets}&bookmakers=${bookmakers}&oddsFormat=american`;
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

// Get available sports
app.get("/api/sports", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "API key not configured" });
  try {
    const url = `https://api.the-odds-api.com/v4/sports?apiKey=${API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const soccer = data.filter((s) => s.group === "Soccer");
    res.json(soccer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ParlayEdge backend running on port ${PORT}`);
});
