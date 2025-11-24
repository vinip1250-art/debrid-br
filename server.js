const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";
const NEW_NAME = "Brazuca";
const NEW_ID = "community.brazuca.wrapper.vFinal"; // ID Novo
const NEW_LOGO = "https://i.imgur.com/Q61eP9V.png";

// ============================================================
// ROTA PROXY (Tenta enganar o StremThru para mudar o nome)
// ============================================================
app.get('/addon/manifest.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache moderado

    try {
        const response = await axios.get(`${UPSTREAM}/manifest.json`);
        const manifest = response.data;

        // Reescreve visual
        manifest.id = NEW_ID;
        manifest.name = NEW_NAME;
        manifest.description = "Filmes e Séries (Wrapper)";
        manifest.logo = NEW_LOGO;
        
        // Limpa recursos para forçar o Stremio a pedir tudo via proxy
        // Isso ajuda a manter o ícone consistente
        res.json(manifest);
    } catch (error) {
        res.status(500).json({ error: "Erro no proxy" });
    }
});

// Redireciona catálogos e streams para o original
// Usamos 302 Found para evitar cache agressivo de redirecionamento errado
app.get('/addon/:resource/:type/:id.json', (req, res) => {
    const { resource, type, id } = req.params;
    res.redirect(302, `${UPSTREAM}/${resource}/${type}/${id}.json`);
});

app.get('/addon/:resource/:type/:id/:extra.json', (req, res) => {
    const { resource, type, id, extra } = req.params;
    res.redirect(302, `${UPSTREAM}/${resource}/${type}/${id}/${extra}.json`);
});

// ============================================================
// FRONTEND
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Wrapper</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0a0a0a; color: #e5e5e5; font-family: sans-serif; }
        .card { background-color: #121212; border: 1px solid #2a2a2a; }
        .input-dark { background-color: #080808; border: 1px solid #333; color: white; }
        .input-dark:focus { border-color: #3b82f6; outline: none; }
        .btn-primary { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; }
        .btn-primary:hover { opacity: 0.9; }
        a.link-ref { color: #60a5fa; text-decoration: none; font-size: 0.7rem; margin-top: 4px; display: block; text-align: right; }
        a.link-ref:hover { text-decoration: underline; }
        
        /* Toggle Switch */
        .toggle-checkbox:checked { right: 0; border-color: #68D391; }
        .toggle-checkbox:checked + .toggle-label { background-color: #68D391; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">

    <div class="w-full max-w-lg card rounded-xl shadow-2xl p-6 relative">
        
        <div class="text-center mb-6">
            <img src="${NEW_LOGO}" class="w-16 h-16 mx-auto mb-3 rounded-full shadow-lg">
            <h1 class="text-xl font-bold text-white">Brazuca Wrapper</h1>
            <p class="text-gray-500 text-xs uppercase tracking-widest mt-1">Gerador StremThru</p>
        </div>

        <form class="space-y-5">
            
            <!-- Instância -->
            <div>
                <label class="text-xs font-bold text-gray-500 uppercase ml-1">Instância StremThru</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm mt-1 cursor-pointer">
                    <option value="https://stremthru.elfhosted.com">ElfHosted</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight Ignite</option>
                    <option value="https://api.stremthru.xyz">Oficial</option>
                    <option value="custom">Outra...</option>
                </select>
                <input type="text" id="custom_instance" placeholder="https://..." class="hidden w-full input-dark p-3 rounded-lg text-sm mt-2">
            </div>

            <!-- Modo Compatibilidade (NOVO) -->
            <div class="bg-gray-900 p-3 rounded border border-gray-800 flex items-center justify-between">
                <div>
                    <span class="text-sm font-bold text-gray-300 block">Usar Nome Original</span>
                    <span class="text-[10px] text-gray-500">Ative se der erro ao instalar (Corrige ElfHosted)</span>
                </div>
                <div class="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                    <input type="checkbox" name="toggle" id="compatibility_mode" class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer"/>
                    <label for="compatibility_mode" class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-700 cursor-pointer"></label>
                </div>
            </div>

            <!-- Debrids -->
            <div class="space-y-3">
                <label class="text-xs font-bold text-gray-500 uppercase ml-1">Store Tokens</label>
                
                <!-- RD -->
                <div class="bg-[#161616] p-3 rounded border border-gray-800">
                    <div class="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="use_rd" class="accent-blue-600 w-4 h-4" onchange="validate()">
                        <span class="text-sm font-bold text-gray-300">Real-Debrid</span>
                    </div>
                    <input type="text" id="rd_key" placeholder="Token Store 'rd'" class="w-full input-dark p-2 rounded text-xs" disabled>
                    <a href="http://real-debrid.com/?id=6684575" target="_blank" class="link-ref">Assinar Real-Debrid ↗</a>
                </div>

                <!-- TB -->
                <div class="bg-[#161616] p-3 rounded border border-gray-800">
                    <div class="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="use_tb" class="accent-purple-600 w-4 h-4" onchange="validate()">
                        <span class="text-sm font-bold text-gray-300">TorBox</span>
                    </div>
                    <input type="text" id="tb_key" placeholder="Token Store 'tb'" class="w-full input-dark p-2 rounded text-xs" disabled>
                    <a href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" class="link-ref text-purple-400">Assinar TorBox ↗</a>
                </div>
            </div>

            <!-- Result -->
            <div id="resultArea" class="hidden pt-4 border-t border-gray-800 space-y-3">
                <div class="relative">
                    <input type="text" id="finalUrl" readonly class="w-full bg-black border border-blue-900 text-gray-400 text-[10px] p-3 rounded pr-14 font-mono">
                    <button type="button" onclick="copyLink()" class="absolute right-1 top-1 bottom-1 bg-blue-900 hover:bg-blue-800 text-white px-3 rounded text-xs font-bold transition">COPY</button>
                </div>
                <a id="installBtn" href="#" class="block w-full btn-primary py-3 rounded-lg text-center font-bold text-sm uppercase tracking-wide shadow-lg">
                    INSTALAR
                </a>
            </div>

            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 py-3 rounded-lg text-sm font-bold cursor-not-allowed transition" disabled>
                GERAR LINK
            </button>

        </form>
    </div>

    <script>
        // URLs
        const BRAZUCA_ORIGINAL = "${UPSTREAM}/manifest.json";
        
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
            
            rdInput.parentElement.style.opacity = rd ? '1' : '0.5';
            tbInput.parentElement.style.opacity = tb ? '1' : '0.5';

            if ((rd && rdInput.value.trim()) || (tb && tbInput.value.trim())) {
                btn.classList.replace('bg-gray-800', 'btn-primary');
                btn.classList.replace('text-gray-500', 'text-white');
                btn.classList.remove('cursor-not-allowed');
                btn.disabled = false;
            } else {
                btn.classList.replace('btn-primary', 'bg-gray-800');
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

            const useCompat = document.getElementById('compatibility_mode').checked;
            
            // LÓGICA DO TOGGLE
            // Se Compatibilidade Ativada: Usa link original (Funciona sempre, nome feio)
            // Se Desativada: Usa nosso Proxy (Nome bonito, pode falhar na ElfHosted)
            const myProxyUrl = window.location.origin + "/addon/manifest.json";
            const targetManifest = useCompat ? BRAZUCA_ORIGINAL : myProxyUrl;

            let config = { upstreams: [], stores: [] };

            if (document.getElementById('use_rd').checked) {
                config.upstreams.push({ u: targetManifest });
                config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
            }
            if (document.getElementById('use_tb').checked) {
                config.upstreams.push({ u: targetManifest });
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

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});
