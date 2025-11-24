const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// 1. CONFIGURAÇÕES E FONTES
// ============================================================
const UPSTREAM_BASE = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";
const COMET_BASE = "https://cometfortheweebs.midnightignite.me/manifest.json";

// Identidade Visual
const NEW_NAME = "Brazuca"; 
const NEW_LOGO = "https://i.imgur.com/KVpfrAk.png";

// ============================================================
// 2. ROTA DO MANIFESTO DINÂMICO (Customização)
// ============================================================
app.get('/addon/manifest.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60'); 
    
    try {
        // Captura nome/logo da URL ou usa padrão
        const customName = req.query.name || NEW_NAME;
        const customLogo = req.query.logo || NEW_LOGO;
        
        const response = await axios.get(`${UPSTREAM_BASE}/manifest.json`);
        const manifest = response.data;

        // ID único baseado no nome
        const idSuffix = Buffer.from(customName).toString('hex').substring(0, 8);
        
        manifest.id = `community.brazuca.wrapper.${idSuffix}`;
        manifest.name = customName;
        manifest.description = "Filmes e Séries (Multi-Source)";
        manifest.logo = customLogo;
        
        delete manifest.background; 
        
        res.json(manifest);
    } catch (error) {
        res.status(500).json({ error: "Upstream Error" });
    }
});

// ============================================================
// 3. REDIRECIONADOR
// ============================================================
app.use('/addon', (req, res) => {
    res.redirect(307, `${UPSTREAM_BASE}${req.path}`);
});

// ============================================================
// 4. INTERFACE (GERADOR)
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Wrapper</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { background-color: #0a0a0a; color: #e5e5e5; font-family: sans-serif; }
        .card { background-color: #141414; border: 1px solid #262626; }
        .input-dark { background-color: #0a0a0a; border: 1px solid #333; color: white; transition: 0.2s; }
        .input-dark:focus { border-color: #3b82f6; outline: none; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); }
        
        .btn-action { 
            background: linear-gradient(90deg, #2563eb 0%, #3b82f6 100%); 
            color: white; font-weight: bold; 
            transition: all 0.3s ease;
        }
        .btn-action:hover { transform: translateY(-2px); shadow: 0 10px 20px rgba(37, 99, 235, 0.3); }
        
        .divider { border-top: 1px solid #262626; margin: 25px 0; position: relative; }
        .divider span { 
            position: absolute; top: -10px; left: 50%; transform: translateX(-50%); 
            background: #141414; padding: 0 10px; color: #525252; font-size: 0.7rem; 
            text-transform: uppercase; letter-spacing: 1px; font-weight: bold;
        }

        /* Botões de Assinatura */
        .btn-sub-rd {
            background: #2563eb; color: white; font-weight: 600;
            display: flex; align-items: center; justify-content: center;
            height: 100%; border-radius: 0.5rem; transition: 0.2s;
            font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .btn-sub-rd:hover { background: #1d4ed8; }

        .btn-sub-tb {
            background: #7c3aed; color: white; font-weight: 600;
            display: flex; align-items: center; justify-content: center;
            height: 100%; border-radius: 0.5rem; transition: 0.2s;
            font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .btn-sub-tb:hover { background: #6d28d9; }

    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 bg-black">

    <div class="w-full max-w-xl card rounded-2xl shadow-2xl p-8 border border-gray-800 relative">
        
        <!-- Header -->
        <div class="text-center mb-8">
            <img src="${NEW_LOGO}" id="previewLogo" class="w-20 h-20 mx-auto mb-3 rounded-full border-2 border-gray-800 shadow-lg object-cover">
            <h1 class="text-3xl font-extrabold text-white tracking-tight">Brazuca <span class="text-blue-500">Wrapper</span></h1>
            <p class="text-gray-500 text-xs mt-1 uppercase tracking-widest">Gerador StremThru v33</p>
        </div>

        <form class="space-y-6">
            
            <!-- 1. Instância -->
            <div>
                <label class="text-xs font-bold text-gray-500 uppercase ml-1">1. Servidor (Bridge)</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm mt-1 cursor-pointer">
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Recomendado)</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight Ignite</option>
                </select>
            </div>

            <!-- 2. Debrids (Novo Layout) -->
            <div class="divider"><span>Serviços Debrid</span></div>
            
            <div class="space-y-4">
                
                <!-- Real Debrid -->
                <div class="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800">
                    <div class="flex justify-between items-center mb-3">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" id="use_rd" class="w-5 h-5 accent-blue-600 cursor-pointer" onchange="validate()">
                            <span class="text-sm font-bold text-white">Real-Debrid</span>
                        </div>
                        <span class="text-[10px] text-gray-500">Link Premium</span>
                    </div>
                    
                    <div class="flex gap-3 h-10">
                        <input type="text" id="rd_key" placeholder="Cole sua API KEY" class="flex-1 input-dark px-3 rounded-lg text-xs" disabled>
                        <a href="http://real-debrid.com/?id=6684575" target="_blank" class="btn-sub-rd w-32 shadow-lg shadow-blue-900/20">
                            Assinar <i class="fas fa-external-link-alt ml-2"></i>
                        </a>
                    </div>
                </div>

                <!-- TorBox -->
                <div class="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800">
                    <div class="flex justify-between items-center mb-3">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" id="use_tb" class="w-5 h-5 accent-purple-600 cursor-pointer" onchange="validate()">
                            <span class="text-sm font-bold text-white">TorBox</span>
                        </div>
                        <span class="text-[10px] text-gray-500">Link Premium</span>
                    </div>
                    
                    <div class="flex gap-3 h-10">
                        <input type="text" id="tb_key" placeholder="Cole sua API KEY" class="flex-1 input-dark px-3 rounded-lg text-xs" disabled>
                        <a href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" class="btn-sub-tb w-32 shadow-lg shadow-purple-900/20">
                            Assinar <i class="fas fa-external-link-alt ml-2"></i>
                        </a>
                    </div>
                </div>
            </div>

            <!-- 3. Fontes Extras -->
            <div class="divider"><span>Fontes & Personalização</span></div>
            
            <div class="grid grid-cols-1 gap-4">
                
                <!-- Personalização -->
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase">Nome do Addon</label>
                        <input type="text" id="custom_name" value="Brazuca" class="w-full input-dark p-2 rounded text-sm mt-1">
                    </div>
                    <div>
                        <label class="text-[10px] font-bold text-gray-500 uppercase">Ícone (URL)</label>
                        <input type="text" id="custom_logo" value="${NEW_LOGO}" class="w-full input-dark p-2 rounded text-sm mt-1" onchange="updatePreview()">
                    </div>
                </div>

                <!-- Comet & Jackett -->
                <div class="bg-[#1a1a1a] p-3 rounded border border-gray-800 space-y-3">
                    
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="use_comet" class="w-4 h-4 accent-green-500 rounded">
                        <div>
                            <span class="text-xs font-bold text-white block">Incluir Comet (ElfHosted)</span>
                            <span class="text-[10px] text-gray-500">Mais resultados em alta qualidade</span>
                        </div>
                    </label>

                    <div class="pt-2 border-t border-gray-700">
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" id="use_jackett" class="w-4 h-4 accent-yellow-500 rounded" onchange="toggleJackett()">
                            <span class="text-xs font-bold text-white">Incluir Jackett / Prowlarr</span>
                        </label>
                        <input type="text" id="jackett_url" placeholder="URL do Manifesto (https://.../manifest.json)" class="w-full input-dark p-2 rounded text-xs mt-2 hidden">
                    </div>
                </div>
            </div>

            <!-- Resultado -->
            <div id="resultArea" class="hidden pt-4 border-t border-gray-800 space-y-3">
                <div class="relative">
                    <input type="text" id="finalUrl" readonly class="w-full bg-black border border-blue-900 text-blue-400 text-[10px] p-3 rounded pr-14 font-mono focus:outline-none">
                    <button type="button" onclick="copyLink()" class="absolute right-1 top-1 bottom-1 bg-blue-900 hover:bg-blue-800 text-white px-3 rounded text-xs font-bold transition">
                        COPY
                    </button>
                </div>
                
                <a id="installBtn" href="#" class="block w-full btn-action py-3.5 rounded-xl text-center font-bold text-sm uppercase tracking-widest shadow-lg">
                    INSTALAR AGORA
                </a>
            </div>

            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 py-3.5 rounded-xl text-sm font-bold cursor-not-allowed transition" disabled>
                GERAR CONFIGURAÇÃO
            </button>

        </form>
    </div>

    <script>
        const instanceSelect = document.getElementById('instance');
        
        // URLs Padrão
        const COMET_URL = "${COMET_BASE}";

        function toggleJackett() {
            const chk = document.getElementById('use_jackett').checked;
            document.getElementById('jackett_url').classList.toggle('hidden', !chk);
        }

        function updatePreview() {
            const url = document.getElementById('custom_logo').value.trim();
            if(url) document.getElementById('previewLogo').src = url;
        }

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
            
            // Opacity visual
            rdInput.parentElement.style.opacity = rd ? '1' : '0.5';
            tbInput.parentElement.style.opacity = tb ? '1' : '0.5';

            const isValid = (rd && rdInput.value.trim()) || (tb && tbInput.value.trim());

            if(isValid) {
                btn.classList.replace('bg-gray-800', 'btn-action');
                btn.classList.replace('text-gray-500', 'text-white');
                btn.classList.remove('cursor-not-allowed');
                btn.disabled = false;
            } else {
                btn.classList.replace('btn-action', 'bg-gray-800');
                btn.classList.replace('text-white', 'text-gray-500');
                btn.classList.add('cursor-not-allowed');
                btn.disabled = true;
            }
        }

        document.getElementById('rd_key').addEventListener('input', validate);
        document.getElementById('tb_key').addEventListener('input', validate);

        function generate() {
            let host = instanceSelect.value;
            // Garante https e remove barra
            host = host.replace(/\\/$/, '').replace('http:', 'https:');
            if (!host.startsWith('http')) host = 'https://' + host;

            // 1. Personalização
            const cName = document.getElementById('custom_name').value.trim();
            const cLogo = document.getElementById('custom_logo').value.trim();
            
            let proxyParams = \`?name=\${encodeURIComponent(cName)}\`;
            if(cLogo) proxyParams += \`&logo=\${encodeURIComponent(cLogo)}\`;

            const myMirrorUrl = window.location.origin + "/addon/manifest.json" + proxyParams;

            // 2. Montar Upstreams
            let config = { upstreams: [], stores: [] };
            
            // A) Brazuca (Principal)
            config.upstreams.push({ u: myMirrorUrl });

            // B) Comet (Se marcado)
            if (document.getElementById('use_comet').checked) {
                config.upstreams.push({ u: COMET_URL });
            }

            // C) Jackett (Se marcado)
            if (document.getElementById('use_jackett').checked) {
                const jURL = document.getElementById('jackett_url').value.trim();
                if (jURL && jURL.startsWith('http')) {
                    config.upstreams.push({ u: jURL });
                }
            }

            // 3. Montar Stores
            if (document.getElementById('use_rd').checked) {
                config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
            }
            if (document.getElementById('use_tb').checked) {
                config.stores.push({ c: "tb", t: document.getElementById('tb_key').value.trim() });
            }

            const b64 = btoa(JSON.stringify(config));
            const hostClean = host.replace(/^https?:\\/\\//, '');
            const httpsUrl = \`\${host}/stremio/wrap/\${b64}/manifest.json\`;
            const stremioUrl = \`stremio://\${hostClean}/stremio/wrap/\${b64}/manifest.json\`;

            document.getElementById('finalUrl').value = httpsUrl;
            document.getElementById('installBtn').href = stremioUrl;
            
            document.getElementById('btnGenerate').classList.add('hidden');
            document.getElementById('resultArea').classList.remove('hidden');
        }

        function copyLink() {
            const el = document.getElementById('finalUrl');
            el.select();
            document.execCommand('copy');
            const btn = document.querySelector('button[onclick="copyLink()"]');
            btn.innerText = "OK!";
            setTimeout(() => btn.innerText = "COPY", 1500);
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(generatorHtml));

app.get('*', (req, res) => {
    if (req.path.startsWith('/addon')) return res.status(404).send('Not Found');
    res.redirect('/');
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});
