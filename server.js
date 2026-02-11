const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// REDIS (GLOBAL)
// ===============================
const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// ===============================
// BASE64 CORRETO PARA STREMTHRU
// ===============================
function toB64(obj) {
  // StremThru espera BASE64 PADRÃO
  // encodeURIComponent garante URL válida
  return encodeURIComponent(
    Buffer.from(JSON.stringify(obj)).toString("base64")
  );
}

// ===============================
// LOG HELPERS
// ===============================
function ms(start) {
  return `${Date.now() - start}ms`;
}

// ===============================
// GERAR CONFIG
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  console.log("[CFG] Gerado ID:", id);
  res.json({ id });
});

// ===============================
// MANIFEST (STREAM ONLY)
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kv.get(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.4.0",
    name: cfg.nome || "BR Debrid",
    description: "Brazuca + BeTor + Comet + Torz",
    logo: cfg.icone || "https://imgur.com/a/hndiKou",
    types: ["movie", "series"],
    resources: [
      {
        name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt"]
      }
    ],
    catalogs: []
  });
});

// ===============================
// COMET (MANIFEST POR USUÁRIO)
// ===============================
function getCometManifest(cfg) {
  const cometCfg = {
    maxResultsPerResolution: 0,
    maxSize: 0,
    cachedOnly: false,
    removeTrash: true,
    deduplicateStreams: true,
    enableTorrent: true,
    languages: {
      required: ["pt"],
      preferred: ["pt"]
    }
  };

  const encoded = encodeURIComponent(
    Buffer.from(JSON.stringify(cometCfg)).toString("base64")
  );

  return `https://comet.feels.legal/${encoded}/manifest.json`;
}

// ===============================
// CALL STREMTHRU
// ===============================
async function callWrap(upstreams, stores, type, imdb) {
  const encoded = toB64({ upstreams, stores });

  const url =
    `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  console.log("[WRAP URL]", url);

  return axios.get(url, {
    timeout: 50000,
    headers: { "User-Agent": "DebridBR/1.0" }
  });
}

// ===============================
// STREAM (ESPERA TOTAL + LOGS)
// ===============================
async function streamHandler(req, res) {
  const start = Date.now();
  const { id, type, imdb } = req.params;

  console.log("\n===============================");
  console.log("🎬 STREAM REQUEST:", imdb);

  const cfg = await kv.get(`addon:${id}`);
  if (!cfg) {
    console.log("[CFG] Não encontrada");
    return res.json({ streams: [] });
  }

  // REDIS GLOBAL
  const cacheKey = `cache:${type}:${imdb}`;
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log("[CACHE HIT]", imdb);
    console.log("[TOTAL]", ms(start));
    return res.json(cached);
  }

  console.log("[CACHE MISS]", imdb);

  // PRIORIDADE FIXA
  const upstreams = [
    {
      u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json"
    },
    {
      u: "https://betor-scrap.vercel.app/manifest.json"
    }
  ];

  if (cfg.cometa === true) {
    const cometUrl = getCometManifest(cfg);
    upstreams.push({ u: cometUrl });
    console.log("[UPSTREAM] Comet:", cometUrl);
  }

  if (cfg.torrentio === true) {
    const torUrl =
      "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json";
    upstreams.push({ u: torUrl });
    console.log("[UPSTREAM] Torrentio:", torUrl);
  }

  console.log("[UPSTREAMS]");
  upstreams.forEach((u, i) => console.log(` ${i + 1}.`, u.u));

  const stores = [];
  if (cfg.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox) stores.push({ c: "tb", t: cfg.torbox });

  console.log(
    "[DEBRIDS]",
    stores.length ? stores.map(s => s.c).join(", ") : "nenhum"
  );

  try {
    const tWrap = Date.now();
    const { data } = await callWrap(upstreams, stores, type, imdb);

    console.log("[WRAP OK]", ms(tWrap));
    console.log("[STREAMS]", data.streams?.length || 0);

    if (data.streams && data.streams.length > 0) {
      await kv.set(cacheKey, data, { ex: 10800 });
      console.log("[CACHE SALVO]");
    }

    console.log("[TOTAL]", ms(start));
    return res.json(data);
  } catch (err) {
    console.log("[WRAP ERROR]");
    console.log("STATUS:", err.response?.status);
    console.log("DATA:", err.response?.data);
    console.log("MSG:", err.message);
    console.log("[TOTAL]", ms(start));
    return res.json({ streams: [] });
  }
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

// ===============================
// INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;
