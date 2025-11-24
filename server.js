const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');

const app = express();
app.use(cors());

// ============================================================
// 1. MANIFESTO
// ============================================================
const manifest = {
    id: 'community.brazuca.pro.direct.v7',
    version: '7.0.0',
    name: 'Brazuca',
    description: 'Filmes e Séries Brasileiros (Real-Debrid & TorBox)',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    logo: "https://i.imgur.com/Q61eP9V.png"
};

const builder = new addonBuilder(manifest);
const BRAZUCA_UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";

// Trackers (Essencial para TorBox encontrar peers rápido)
const TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.openbittorrent.com:80/announce",
    "udp://tracker.coppersurfer.tk:6969/announce"
];

// ============================================================
// 2. FUNÇÕES DE DEBRID
// ============================================================

// --- REAL-DEBRID ---
async function resolveRealDebrid(infoHash, apiKey) {
    try {
        const magnet = `magnet:?xt=urn:btih:${infoHash}`;
        
        // 1. Adicionar
        const addUrl = 'https://api.real-debrid.com/rest/1.0/torrents/addMagnet';
        const addResp = await axios.post(addUrl, `magnet=${encodeURIComponent(magnet)}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const torrentId = addResp.data.id;

        // 2. Selecionar (Polling inteligente)
        const infoUrl = `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`;
        let attempts = 0;
        while (attempts < 5) {
            const infoResp = await axios.get(infoUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            const status = infoResp.data.status;
            
            if (status === 'waiting_files_selection') {
                await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, `files=all`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                break;
            }
            if (status === 'downloaded' || status === 'downloading') break;
            
            await new Promise(r => setTimeout(r, 800));
            attempts++;
        }

        // 3. Pegar Link
        const finalInfo = await axios.get(infoUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (finalInfo.data.links && finalInfo.data.links.length > 0) {
            const unrestrictResp = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${finalInfo.data.links[0]}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            return unrestrictResp.data.download;
        }
        return null;
    } catch (e) { return null; }
}

async function checkRealDebridCache(hashes, apiKey) {
    if (!hashes.length) return {};
    const validHashes = hashes.slice(0, 50);
    
    try {
        const url = `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${validHashes.join('/')}`;
        const resp = await axios.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const results = {};
        
        // Normalização segura
        const lowerResponse = {};
        for (const k in resp.data) {
            lowerResponse[k.toLowerCase()] = resp.data[k];
        }

        for (const h of validHashes) {
            const data = lowerResponse[h.toLowerCase()];
            // Verifica se existe 'rd' e se tem arquivos dentro
            if (data && data.rd && Array.isArray(data.rd) && data.rd.length > 0) {
                results[h] = true;
            } else {
                results[h] = false;
            }
        }
        return results;
    } catch (e) { return {}; }
}

// --- TORBOX (REFEITO PARA CORRIGIR UPLOAD) ---
async function resolveTorBox(infoHash, apiKey) {
    try {
        // TorBox precisa de trackers para iniciar rápido se não tiver em cache
        let magnet = `magnet:?xt=urn:btih:${infoHash}`;
        TRACKERS.forEach(t => magnet += `&tr=${encodeURIComponent(t)}`);

        console.log(`[TorBox] Adicionando: ${infoHash}`);

        // 1. Create (Usando x-www-form-urlencoded estrito)
        const params = new URLSearchParams();
        params.append('magnet', magnet);
        params.append('seed', '1');
        params.append('allow_zip', 'false');

        const createResp = await axios.post('https://api.torbox.app/v1/api/torrents/create', params, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (!createResp.data.success) {
            console.error("[TorBox] Create Failed:", createResp.data);
            return null;
        }

        const torrentId = createResp.data.data.torrent_id;

        // 2. Polling para Listagem (Aumentado para 8s)
        // TorBox demora para indexar metadados
        let files = null;
        for(let i=0; i<4; i++) {
            await new Promise(r => setTimeout(r, 2000)); // 2s, 4s, 6s, 8s
            
            try {
                const listResp = await axios.get(`https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true&id=${torrentId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                
                const data = listResp.data.data;
                if (data && data.files && data.files.length > 0) {
                    files = data.files;
                    break;
                }
            } catch(e) {}
        }
        
        if (files) {
            // Pega o maior arquivo
            const file = files.reduce((prev, curr) => (prev.size > curr.size) ? prev : curr);
            const reqUrl = `https://api.torbox.app/v1/api/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${file.id}&zip_link=false`;
            const reqResp = await axios.get(reqUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            
            if (reqResp.data.success) return reqResp.data.data;
        }
        
        return null; // Download started but not ready
    } catch (e) { 
        console.error("TorBox Resolve Error:", e.message);
        return null; 
    }
}

async function checkTorBoxCache(hashes, apiKey) {
    if (!hashes.length) return {};
    // Limite seguro e string limpa
    const validHashes = hashes.slice(0, 40);
    const hStr = validHashes.join(',');

    try {
        const url = `https://api.torbox.app/v1/api/torrents/checkcached?hash=${hStr}&format=list&list_files=false`;
        const resp = await axios.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        
        const results = {};
        hashes.forEach(h => results[h] = false);
        
        const data = resp.data.data;
        // TorBox retorna lista de hashes encontrados (strings)
        // Ex: ['hash1', 'hash2']
        if (Array.isArray(data)) {
            data.forEach(foundHash => {
                if(foundHash) results[foundHash.toLowerCase()] = true;
            });
        } else if (typeof data === 'object') {
            // Fallback para formato antigo { hash: true }
            Object.keys(data).forEach(k => { if(data[k]) results[k.toLowerCase()] = true; });
        }
        return results;
    } catch (e) { return {}; }
}

// ============================================================
// 3. HTML CONFIG
// ============================================================
const configureHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Config</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { background-color: #0b0c10; color: #c5c6c7; font-family: 'Segoe UI', sans-serif; }
        .card { background-color: #1f2833; border: 1px solid #45a29e; box-shadow: 0 0 20px rgba(102, 252, 241, 0.15); }
        .input-dark { background-color: #0b0c10; border: 1px solid #45a29e; color: #fff; transition: all 0.3s; }
        .input-dark:focus { box-shadow: 0 0 8px #66fcf1; outline: none; }
        .btn-action { background: linear-gradient(90deg, #45a29e 0%, #66fcf1 100%); color: #0b0c10; font-weight: bold; }
        .btn-action:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(102, 252, 241, 0.4); }
        
        .btn-ref-rd { background-color: #2563eb; color: white; font-size: 0.8rem; padding: 10px; border-radius: 8px; display: block; text-align: center; font-weight: bold; }
        .btn-ref-tb { background-color: #9333ea; color: white; font-size: 0.8rem; padding: 10px; border-radius: 8px; display: block; text-align: center; font-weight: bold; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-black to-gray-900">
    <div class="w-full max-w-md card rounded-2xl p-8 relative">
        <div class="text-center mb-8">
            <h1 class="text-4xl font-extrabold text-[#66fcf1] mb-2 tracking-tight">Brazuca <span class="text-white">Direct</span></h1>
            <p class="text-gray-400 text-xs tracking-widest">V7.0 FINAL FIX</p>
        </div>
        <form id="configForm" class="space-y-6">
            <!-- Real Debrid -->
            <div class="bg-[#0b0c10] p-4 rounded-xl border border-gray-800 hover:border-blue-500 transition-colors relative">
                <label class="flex items-center gap-3 cursor-pointer mb-3">
                    <input type="checkbox" id="use_rd" class="w-5 h-5 accent-[#66fcf1]" onchange="validate()">
                    <span class="text-lg font-bold text-white">Real-Debrid</span>
                </label>
                <input type="text" id="rd_key" placeholder="API Key (F...)" class="w-full input-dark p-3 rounded-lg text-sm text-gray-300 placeholder-gray-600 mb-3" disabled>
                <a href="http://real-debrid.com/?id=6684575" target="_blank" class="btn-ref-rd shadow-lg shadow-blue-900/30">💎 Assinar Real-Debrid</a>
            </div>
            <!-- TorBox -->
            <div class="bg-[#0b0c10] p-4 rounded-xl border border-gray-800 hover:border-purple-500 transition-colors relative">
                <label class="flex items-center gap-3 cursor-pointer mb-3">
                    <input type="checkbox" id="use_tb" class="w-5 h-5 accent-[#66fcf1]" onchange="validate()">
                    <span class="text-lg font-bold text-white">TorBox</span>
                </label>
                <input type="text" id="tb_key" placeholder="API Key TorBox" class="w-full input-dark p-3 rounded-lg text-sm text-gray-300 placeholder-gray-600 mb-3" disabled>
                <a href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" class="btn-ref-tb shadow-lg shadow-purple-900/30">⚡ Assinar TorBox</a>
            </div>
            <!-- Ações -->
            <div class="grid grid-cols-4 gap-2 pt-2">
                <button type="button" onclick="copyLink()" id="btnCopy" class="col-span-1 bg-gray-800 hover:bg-gray-700 text-white font-bold rounded-xl transition opacity-50 pointer-events-none flex items-center justify-center" title="Copiar Link">
                    <i class="fas fa-copy"></i>
                </button>
                <a id="installBtn" href="#" class="col-span-3 block btn-action py-4 rounded-xl text-lg uppercase tracking-widest text-center transition-all opacity-50 pointer-events-none shadow-lg flex items-center justify-center gap-2">
                    <i class="fas fa-play"></i> INSTALAR
                </a>
            </div>
            <input type="text" id="finalLink" class="hidden">
        </form>
    </div>
    <div id="toast" class="fixed bottom-5 right-5 bg-green-600 text-white px-4 py-2 rounded shadow-lg hidden">Link Copiado!</div>
    <script>
        function validate() {
            const rd = document.getElementById('use_rd').checked;
            const tb = document.getElementById('use_tb').checked;
            const rdKey = document.getElementById('rd_key');
            const tbKey = document.getElementById('tb_key');
            const btnInstall = document.getElementById('installBtn');
            const btnCopy = document.getElementById('btnCopy');

            rdKey.disabled = !rd; tbKey.disabled = !tb;
            if(!rd) rdKey.value = ''; if(!tb) tbKey.value = '';
            rdKey.parentElement.style.opacity = rd ? '1' : '0.6';
            tbKey.parentElement.style.opacity = tb ? '1' : '0.6';

            if ((rd && rdKey.value.length > 5) || (tb && tbKey.value.length > 5)) {
                btnInstall.classList.remove('opacity-50', 'pointer-events-none');
                btnCopy.classList.remove('opacity-50', 'pointer-events-none');
                generateLink();
            } else {
                btnInstall.classList.add('opacity-50', 'pointer-events-none');
                btnCopy.classList.add('opacity-50', 'pointer-events-none');
            }
        }
        document.getElementById('rd_key').addEventListener('input', validate);
        document.getElementById('tb_key').addEventListener('input', validate);

        function generateLink() {
            const rd = document.getElementById('use_rd').checked;
            const tb = document.getElementById('use_tb').checked;
            const config = {
                s: 'multi',
                rd: rd ? document.getElementById('rd_key').value.trim() : null,
                tb: tb ? document.getElementById('tb_key').value.trim() : null
            };
            const b64 = btoa(JSON.stringify(config));
            const encoded = encodeURIComponent(b64);
            const host = window.location.host;
            document.getElementById('installBtn').href = 'stremio://' + host + '/' + encoded + '/manifest.json';
            document.getElementById('finalLink').value = 'https://' + host + '/' + encoded + '/manifest.json';
        }
        function copyLink() {
            const link = document.getElementById('finalLink').value;
            navigator.clipboard.writeText(link).then(() => {
                document.getElementById('toast').classList.remove('hidden');
                setTimeout(() => document.getElementById('toast').classList.add('hidden'), 2000);
            });
        }
    </script>
</body>
</html>
`;

// ============================================================
// 4. ROTAS
// ============================================================

app.get('/', (req, res) => res.send(configureHtml));
app.get('/configure', (req, res) => res.send(configureHtml));

app.get('/:config/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const m = { ...manifest };
    try { if(req.params.config.length > 5) m.behaviorHints = { configurable: true, configurationRequired: false }; } catch(e){}
    res.json(m);
});

app.get('/:config/stream/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    let cfg;
    try { cfg = JSON.parse(Buffer.from(decodeURIComponent(req.params.config), 'base64').toString()); } catch(e) { return res.json({ streams: [] }); }

    const rdKey = cfg.rd;
    const tbKey = cfg.tb;

    if (!rdKey && !tbKey) return res.json({ streams: [{ title: '⚠ Configure o Addon' }] });

    let streams = [];
    try {
        const resp = await axios.get(`${BRAZUCA_UPSTREAM}/stream/${req.params.type}/${req.params.id}.json`, { timeout: 6000 });
        streams = resp.data.streams || [];
    } catch(e) { return res.json({ streams: [] }); }

    if (!streams.length) return res.json({ streams: [] });

    // Hashes
    const hashList = [];
    streams.forEach(s => {
        let h = s.infoHash;
        if (!h && s.url && s.url.startsWith('magnet:')) {
            const m = s.url.match(/xt=urn:btih:([a-zA-Z0-9]{40})/);
            if (m) h = m[1];
        }
        if (h) { s.infoHash = h.toLowerCase(); if(!hashList.includes(s.infoHash)) hashList.push(s.infoHash); }
    });

    let rdCache = {}, tbCache = {};
    if (hashList.length > 0) {
        if (rdKey) rdCache = await checkRealDebridCache(hashList, rdKey);
        if (tbKey) tbCache = await checkTorBoxCache(hashList, tbKey);
    }

    const finalStreams = [];
    streams.forEach(s => {
        const h = s.infoHash;
        if (!h) return;
        const cleanTitle = (s.title || 'video').replace(/\n/g, ' ').replace(/\[.*?\]/g, '').trim();

        if (rdKey) {
            const isCached = rdCache[h] === true;
            const icon = isCached ? '⚡' : '📥';
            finalStreams.push({
                name: 'Brazuca [RD]',
                title: `${icon} ${cleanTitle}`,
                url: `${req.protocol}://${req.get('host')}/resolve/realdebrid/${encodeURIComponent(rdKey)}/${h}`,
                behaviorHints: { notWebReady: !isCached }
            });
        }
        if (tbKey) {
            const isCached = tbCache[h] === true;
            const icon = isCached ? '⚡' : '📥';
            finalStreams.push({
                name: 'Brazuca [TB]',
                title: `${icon} ${cleanTitle}`,
                url: `${req.protocol}://${req.get('host')}/resolve/torbox/${encodeURIComponent(tbKey)}/${h}`,
                behaviorHints: { notWebReady: !isCached }
            });
        }
    });

    finalStreams.sort((a, b) => b.title.includes('⚡') - a.title.includes('⚡'));
    res.json({ streams: finalStreams });
});

// RESOLVE HANDLER (Página de status para download)
app.get('/resolve/:service/:key/:hash', async (req, res) => {
    const { service, key, hash } = req.params;
    let directLink = null;
    
    if (service === 'realdebrid') directLink = await resolveRealDebrid(hash, key);
    else if (service === 'torbox') directLink = await resolveTorBox(hash, key);

    if (directLink) {
        res.redirect(directLink);
    } else {
        // Resposta HTML amigável para o usuário entender que o download começou
        res.send(`
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { background-color: #111; color: #eee; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; padding: 20px; }
                        h1 { color: #45a29e; }
                        p { font-size: 1.1rem; margin: 10px 0; }
                        .btn { background: #45a29e; color: #000; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin-top: 20px; }
                    </style>
                </head>
                <body>
                    <div>
                        <h1>📥 Download Iniciado</h1>
                        <p>O arquivo não estava em cache.</p>
                        <p>Ele foi adicionado à sua nuvem <b>${service.toUpperCase()}</b>.</p>
                        <p>Aguarde a conclusão no site ou tente novamente em alguns instantes.</p>
                        <a href="javascript:history.back()" class="btn">Voltar</a>
                    </div>
                </body>
            </html>
        `);
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Brazuca v7.0 rodando na porta ${PORT}`);
});
