const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// CONFIGURAÇÕES DO ESPELHO
// ============================================================
const UPSTREAM_URL = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";
const NEW_NAME = "Brazuca"; // Nome curto que aparecerá
const NEW_LOGO = "https://i.imgur.com/Q61eP9V.png"; // Ícone novo

// ============================================================
// ROTA 1: MANIFESTO CUSTOMIZADO (O segredo do nome curto)
// ============================================================
app.get('/addon/manifest.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    try {
        // 1. Baixa o original
        const response = await axios.get(`${UPSTREAM_URL}/manifest.json`);
        const manifest = response.data;

        // 2. Reescreve os dados cosméticos
        manifest.id = 'community.brazuca.proxy.renamed';
        manifest.name = NEW_NAME;
        manifest.description = "Brazuca (Wrapper StremThru)";
        manifest.logo = NEW_LOGO;
        
        // 3. Entrega o JSON modificado
        res.json(manifest);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erro ao buscar manifesto original" });
    }
});

// ============================================================
// ROTA 2: REDIRECIONADOR DE RECURSOS (Streams/Catálogos)
// ============================================================
// Redireciona qualquer outra requisição do addon (/stream, /catalog, /meta)
// diretamente para o servidor original. Isso evita sobrecarga e erros 400/500.
app.use('/addon', (req, res) => {
    const redirectUrl = `${UPSTREAM_URL}${req.path}`;
    res.redirect(307, redirectUrl);
});

// ============================================================
// ROTA 3: PÁGINA GERADORA
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Pro Generator</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { background-color: #050505; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; }
        .card { background-color: #111; border: 1px solid #333; }
        .input-dark { background-color: #000; border: 1px solid #333; color: white; }
        .input-dark:focus { border-color: #3b82f6; outline: none; }
        .btn-action { background: linear-gradient(to right, #2563eb, #3b82f6); color: white; }
        .btn-action:hover { filter: brightness(1.1); }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">

    <div class="w-full max-w-lg card rounded-2xl shadow-2xl p-6 border border-gray-800 relative">
        
        <div class="text-center mb-6">
            <img src="${NEW_LOGO}" class="w-12 h-12 mx-auto mb-2 rounded-full border border-gray-700">
            <h1 class="text-xl font-bold text-white">Brazuca Wrapper</h1>
            <p class="text-gray-500 text-xs">Gera um addon com nome curto e suporte duplo</p>
        </div>

        <form class="space-y-5">
            
            <!-- Instância -->
            <div>
                <label class="text-xs font-bold text-gray-500 uppercase ml-1">Instância StremThru</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm mt-1">
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Estável)</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight (Weebs)</option>
                    <option value="https://stremthru.midnightignite.me">Midnight (Padrão)</option>
                    <option value="custom">Outra...</option>
                </select>
                <input type="text" id="custom_instance" placeholder="https://..." class="hidden w-full input-dark p-3 rounded-lg text-sm mt-2">
            </div>

            <!-- Debrids -->
            <div class="space-y-3">
                <label class="text-xs font-bold text-gray-500 uppercase ml-1">Tokens (Store StremThru)</label>
                
                <div class="flex items-center gap-2">
                    <input type="checkbox" id="use_rd" class="accent-blue-600" onchange="validate()">
                    <input type="text" id="rd_key" placeholder="Token Real-Debrid" class="w-full input-dark p-2 rounded text-xs" disabled>
                </div>

                <div class="flex items-center gap-2">
                    <input type="checkbox" id="use_tb" class="accent-purple-600" onchange="validate()">
                    <input type="text" id="tb_key" placeholder="Token TorBox" class="w-full input-dark p-2 rounded text-xs" disabled>
                </div>
            </div>

            <!-- Resultado -->
            <div id="resultArea" class="hidden pt-4 border-t border-gray-800 space-y-3">
                <div class="relative">
                    <input type="text" id="finalUrl" readonly class="w-full bg-gray-900 border border-blue-900 text-blue-400 text-[10px] p-3 rounded pr-12">
                    <button type="button" onclick="copyLink()" class="absolute right-1 top-1 bottom-1 bg-blue-900 hover:bg-blue-800 text-white px-3 rounded text-xs font-bold">
                        COPY
                    </button>
                </div>
                <a id="installBtn" href="#" class="block w-full btn-action py-3 rounded-lg text-center font-bold text-sm">
                    INSTALAR AGORA
                </a>
            </div>

            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 py-3 rounded-lg text-sm font-bold cursor-not-allowed" disabled>
                GERAR LINK
            </button>

        </form>
    </div>

    <script>
        const instanceSelect = document.getElementById('instance');
        const customInput = document.getElementById('custom_instance');

        instanceSelect.addEventListener('change', (e) => {
            customInput.classList.toggle('hidden', e.target.value !== 'custom');
        });

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

            // AQUI ESTÁ O TRUQUE:
            // Em vez de apontar para o Brazuca original, apontamos para o NOSSO espelho (/addon/manifest.json)
            // Assim o StremThru lê o nome curto "Brazuca"
            const myMirrorUrl = window.location.origin + "/addon/manifest.json";

            let config = { upstreams: [], stores: [] };

            if (document.getElementById('use_rd').checked) {
                config.upstreams.push({ u: myMirrorUrl });
                config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
            }
            if (document.getElementById('use_tb').checked) {
                config.upstreams.push({ u: myMirrorUrl });
                config.stores.push({ c: "tb", t: document.getElementById('tb_key').value.trim() });
            }

            const b64 = btoa(JSON.stringify(config));
            const httpsUrl = \`\${host}/stremio/wrap/\${b64}/manifest.json\`;
            const stremioUrl = httpsUrl.replace(/^https?/, 'stremio');

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
            const originalText = btn.innerText;
            btn.innerText = "OK!";
            setTimeout(() => btn.innerText = originalText, 1500);
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(generatorHtml));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});
