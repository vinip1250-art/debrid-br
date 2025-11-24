const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const BRAZUCA_ORIGINAL = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json";
const NEW_NAME = "Brazuca";
const NEW_LOGO = "https://i.imgur.com/KVpfrAk.png";
const NEW_ID = "community.brazuca.proxy.v7"; // força atualização

// ============================================================
// ROTA 1: MANIFESTO EDITADO
// ============================================================
app.get('/addon/manifest.json', async (req, res) => {
  try {
    const response = await axios.get(BRAZUCA_ORIGINAL);
    const manifest = response.data;

    manifest.id = NEW_ID;
    manifest.name = NEW_NAME;
    manifest.logo = NEW_LOGO;
    manifest.description = "Addon Brazuca via StremThru + Debrid";
    manifest.version = "3.2.0";

    res.json(manifest);
  } catch (err) {
    console.error("Erro ao carregar manifesto:", err.message);
    res.json({
      id: NEW_ID,
      name: NEW_NAME,
      logo: NEW_LOGO,
      description: "Manifesto fallback Brazuca",
      version: "3.2.0",
      catalogs: [],
      resources: ["stream"],
      types: ["movie", "series"],
      idPrefixes: ["tt"]
    });
  }
});

// ============================================================
// ROTA 2: PÁGINA GERADORA
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Brazuca Addon Generator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #050505; color: #e2e8f0; font-family: sans-serif; }
    .card { background-color: #111; border: 1px solid #333; }
    .btn-subscribe {
      display: block;
      width: 100%;
      text-align: center;
      padding: 10px;
      border-radius: 8px;
      font-weight: bold;
      margin-top: 8px;
      transition: transform 0.2s;
    }
    .btn-subscribe:hover { transform: scale(1.02); }
    .btn-rd { background: linear-gradient(to right, #2563eb, #3b82f6); color: white; }
    .btn-tb { background: linear-gradient(to right, #9333ea, #a855f7); color: white; }
    .btn-action { background: linear-gradient(to right, #2563eb, #3b82f6); color: white; }
    .btn-action:hover { filter: brightness(1.1); }
  </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">

  <div class="w-full max-w-lg card rounded-2xl shadow-2xl p-6 border border-gray-800 relative">
    <div class="text-center mb-6">
      <img src="${NEW_LOGO}" class="w-16 h-16 mx-auto mb-2 rounded-full border border-gray-700">
      <h1 class="text-2xl font-bold text-white">Brazuca</h1>
      <p class="text-gray-500 text-xs">Gerador StremThru + Debrid</p>
    </div>

    <form class="space-y-5">
      <!-- Serviços -->
      <div class="space-y-4">
        <label class="text-xs font-bold text-gray-500 uppercase ml-1">Serviços (Tokens StremThru)</label>
        
        <!-- Real Debrid -->
        <div class="bg-[#1a1a1a] p-3 rounded border border-gray-800">
          <div class="flex items-center gap-2 mb-1">
            <input type="checkbox" id="use_rd" class="accent-blue-600 w-4 h-4" onchange="validate()">
            <span class="text-sm font-bold text-gray-300">Real-Debrid</span>
          </div>
          <input type="text" id="rd_key" placeholder="Cole o Token da Store 'rd'" class="w-full input-dark p-2 rounded text-xs bg-transparent border border-gray-700 focus:border-blue-500 focus:bg-black transition-colors" disabled>
          <a href="http://real-debrid.com/?id=6684575" target="_blank" class="btn-subscribe btn-rd">💎 Assinar Real-Debrid</a>
        </div>

        <!-- TorBox -->
        <div class="bg-[#1a1a1a] p-3 rounded border border-gray-800">
          <div class="flex items-center gap-2 mb-1">
            <input type="checkbox" id="use_tb" class="accent-purple-600 w-4 h-4" onchange="validate()">
            <span class="text-sm font-bold text-gray-300">TorBox</span>
          </div>
          <input type="text" id="tb_key" placeholder="Cole o Token da Store 'tb'" class="w-full input-dark p-2 rounded text-xs bg-transparent border border-gray-700 focus:border-purple-500 focus:bg-black transition-colors" disabled>
          <a href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" class="btn-subscribe btn-tb">⚡ Assinar TorBox</a>
        </div>
      </div>

      <!-- Resultado -->
      <div id="resultArea" class="hidden pt-4 border-t border-gray-800 space-y-3">
        <div class="relative">
          <input type="text" id="finalUrl" readonly class="w-full bg-gray-900 border border-blue-900 text-blue-400 text-[10px] p-3 rounded pr-12 font-mono">
          <button type="button" onclick="copyLink()" class="absolute right-1 top-1 bottom-1 bg-blue-900 hover:bg-blue-800 text-white px-3 rounded text-xs font-bold transition">
            COPY
          </button>
        </div>
        <a id="installBtn" href="#" class="block w-full btn-action py-3 rounded-lg text-center font-bold text-sm uppercase tracking-wide shadow-lg shadow-blue-900/20">
          INSTALAR NO STREMIO
        </a>
      </div>

      <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 py-3 rounded-lg text-sm font-bold cursor-not-allowed transition" disabled>
        GERAR LINK
      </button>
    </form>
  </div>

  <script>
    function validate() {
      const rd = document.getElementById('use_rd').checked;
      const tb = document.getElementById('use_tb').checked;
      const rdInput = document.getElementById('rd_key');
      const tbInput = document.getElementById('tb_key');
      const btn = document.getElementById('btnGenerate');

      rdInput.disabled = !rd;
      tbInput.disabled = !tb;
      if(!rd) rdInput.value = '';
      if(!tb) tbInput.value = '';

      const isValid = (rd && rdInput.value.trim()) || (tb && tbInput.value.trim());
      btn.disabled = !isValid;
      if(isValid) {
        btn.classList.replace('bg-gray-800', 'btn-action');
        btn.classList.replace('text-gray-500', 'text-white');
        btn.classList.remove('cursor-not-allowed');
      } else {
        btn.classList.replace('btn-action', 'bg-gray-800');
        btn.classList.replace('text-white', 'text-gray-500');
        btn.classList.add('cursor-not-allowed');
      }
    }

    document.getElementById('rd_key').addEventListener('input', validate);
    document.getElementById('tb_key').addEventListener('input', validate);

    function generate() {
      const BRAZUCA_URL = "${BRAZUCA_ORIGINAL}";
      let host = document.getElementById('instance').value;
      if(host === 'custom') host = document.getElementById('custom_instance').value.trim();
      host = host.replace(/\\/$/, '').replace('http:', 'https:');

      let config = { upstreams: [], stores: [] };
      if (document.getElementById('use_rd').checked) {
        config.upstreams.push({ u: BRAZUCA_URL });
        config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
      }
      if (document.getElement
