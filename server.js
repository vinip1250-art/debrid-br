const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// 1. CONFIGURAÇÕES PADRÃO
// ============================================================
const UPSTREAM_BASE = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";
const DEFAULT_NAME = "Brazuca"; 
const DEFAULT_LOGO = "https://i.imgur.com/Q61eP9V.png";

// ============================================================
// 2. ROTA DO MANIFESTO DINÂMICO (O Segredo da Customização)
// ============================================================
app.get('/addon/manifest.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    // Cache curto para permitir mudanças rápidas
    res.setHeader('Cache-Control', 'public, max-age=60'); 
    
    try {
        // 1. Captura personalizações da URL (Query Params)
        const customName = req.query.name || DEFAULT_NAME;
        const customLogo = req.query.logo || DEFAULT_LOGO;
        
        // 2. Baixa o original
        const response = await axios.get(`${UPSTREAM_BASE}/manifest.json`);
        const manifest = response.data;

        // 3. Aplica a customização
        // Geramos um ID baseado no nome para que o Stremio não confunda addons diferentes
        const idSuffix = Buffer.from(customName).toString('hex').substring(0, 10);
        
        manifest.id = `community.brazuca.wrapper.${idSuffix}`;
        manifest.name = customName;
        manifest.description = `Wrapper customizado: ${customName}`;
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
// 4. INTERFACE DO GERADOR
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Wrapper Custom</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #050505; color: #e2e8f0; font-family: sans-serif; }
        .card { background-color: #111; border: 1px solid #333; }
        .input-dark { background-color: #000; border: 1px solid #333; color: white; }
        .input-dark:focus { border-color: #3b82f6; outline: none; }
        .btn-action { background: linear-gradient(to right, #2563eb, #3b82f6); color: white; }
        .btn-action:hover { filter: brightness(1.1); }
        a.link-ref { color: #60a5fa; text-decoration: none; font-size: 0.7rem; display: block; text-align: right; margin-top: 5px; }
        a.link-ref:hover { text-decoration: underline; }
        .divider { border-top: 1px solid #222; margin: 20px 0; position: relative; }
        .divider span { position: absolute; top: -10px; left: 50%; transform: translateX(-50%); background: #111; padding: 0 10px; color: #555; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 bg-black">

    <div class="w-full max-w-lg card rounded-2xl shadow-2xl p-6 border border-gray-800 relative">
        
        <div class="text-center mb-6">
            <img src="${DEFAULT_LOGO}" id="previewLogo" class="w-14 h-14 mx-auto mb-2 rounded-full border border-gray-700 object-cover">
            <h1 class="text-xl font-bold text-white">Brazuca <span class="text-blue-500">+</span></h1>
            <p class="text-gray-500 text-xs">Wrapper Customizável v31.0</p>
        </div>

        <form class="space-y-5">
            
            <!-- Instância -->
            <div>
                <label class="text-xs font-bold text-gray-500 uppercase ml-1">1. Instância</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm mt-1">
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Recomendado)</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight Ignite</option>
                    <option value="https://api.stremthru.xyz">Oficial</option>
                    <option value="custom">Outra...</option>
                </select>
                <input type="text" id="custom_instance" placeholder="https://..." class="hidden w-full input-dark p-3 rounded-lg text-sm mt-2">
            </div>

            <!-- Personalização (NOVO) -->
            <div class="divider"><span>Personalização (Sidekick Free)</span></div>
            
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="text-xs font-bold text-gray-500 uppercase ml-1">Nome do Addon</label>
                    <input type="text" id="custom_name" placeholder="Ex: Meus Filmes" value="Brazuca" class="w-full input-dark p-2 rounded text-sm mt-1">
                </div>
                <div>
                    <label class="text-xs font-bold text-gray-500 uppercase ml-1">Ícone (URL)</label>
                    <input type="text" id="custom_logo" placeholder="https://..." class="w-full input-dark p-2 rounded text-sm mt-1" onchange="updatePreview()">
                </div>
            </div>

            <!-- Debrids -->
            <div class="divider"><span>Debrid</span></div>
            <div class="space-y-3">
                <div class="bg-[#161616] p-3 rounded border border-gray-800">
                    <div class="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="use_rd" class="accent-blue-600 w-4 h-4" onchange="validate()">
                        <span class="text-sm font-bold text-gray-300">Real-Debrid</span>
                    </div>
                    <input type="text" id="rd_key" placeholder="Token Store 'rd'" class="w-full input-dark p-2 rounded text-xs" disabled>
                    <a href="http://real-debrid.com/?id=6684575" target="_blank" class="link-ref">Assinar RD ↗</a>
                </div>

                <div class="bg-[#161616] p-3 rounded border border-gray-800">
                    <div class="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="use_tb" class="accent-purple-600 w-4 h-4" onchange="validate()">
                        <span class="text-sm font-bold text-gray-300">TorBox</span>
                    </div>
                    <input type="text" id="tb_key" placeholder="Token Store 'tb'" class="w-full input-dark p-2 rounded text-xs" disabled>
                    <a href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" class="link-ref text-purple-400">Assinar TB ↗</a>
                </div>
            </div>

            <!-- Fontes Extras -->
            <div class="divider"><span>Extras</span></div>
            <div>
                <div class="bg-[#161616] p-3 rounded border border-gray-800">
                    <label class="flex items-center gap-2 mb-2 cursor-pointer">
                        <input type="checkbox" id="use_jackett" class="accent-green-500 w-4 h-4" onchange="toggleJackett()">
                        <span class="text-sm font-bold text-gray-300">Jackett / Prowlarr</span>
                    </label>
                    <input type="text" id="jackett_url" placeholder="URL do Manifesto (JackettIO)" class="w-full input-dark p-2 rounded text-xs hidden">
                </div>
            </div>

            <!-- Resultado -->
            <div id="resultArea" class="hidden pt-4 border-t border-gray-800 space-y-3">
                <div class="relative">
                    <input type="text" id="finalUrl" readonly class="w-full bg-gray-900 border border-blue-900 text-blue-400 text-[10px] p-3 rounded pr-12 font-mono focus:outline-none">
                    <button type="button" onclick="copyLink()" class="absolute right-1 top-1 bottom-1 bg-blue-900 hover:bg-blue-800 text-white px-3 rounded text-xs font-bold transition">COPY</button>
                </div>
                <a id="installBtn" href="#" class="block w-full btn-action py-3 rounded-lg text-center font-bold text-sm uppercase tracking-wide shadow-lg">
                    INSTALAR
                </a>
            </div>

            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 py-3 rounded-lg text-sm font-bold cursor-not-allowed transition" disabled>
                GERAR CONFIGURAÇÃO
            </button>

        </form>
    </div>

    <script>
        const instanceSelect = document.getElementById('instance');
        const customInput = document.getElementById('custom_instance');

        instanceSelect.addEventListener('change', (e) => {
            customInput.classList.toggle('hidden', e.target.value !== 'custom');
        });

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
            let host = instanceSelect.value === 'custom' ? customInput.value.trim() : instanceSelect.value;
            host = host.replace(/\\/$/, '').replace('http:', 'https:');

            // 1. Personalização (URL Params)
            const cName = document.getElementById('custom_name').value.trim() || "Brazuca";
            const cLogo = document.getElementById('custom_logo').value.trim();
            
            let proxyParams = \`?name=\${encodeURIComponent(cName)}\`;
            if(cLogo) proxyParams += \`&logo=\${encodeURIComponent(cLogo)}\`;

            // Nosso Proxy com parâmetros de personalização
            const myMirrorUrl = window.location.origin + "/addon/manifest.json" + proxyParams;

            let config = { upstreams: [], stores: [] };
            
            // Adiciona Brazuca Customizado
            config.upstreams.push({ u: myMirrorUrl });

            // Adiciona Jackett
            if (document.getElementById('use_jackett').checked) {
                const jURL = document.getElementById('jackett_url').value.trim();
                if (jURL && jURL.startsWith('http')) {
                    config.upstreams.push({ u: jURL });
                }
            }

            // Configura Stores
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


