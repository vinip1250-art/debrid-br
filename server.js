const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// 1. CONFIGURAÇÕES
// ============================================================
const BRAZUCA_UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";
const DEFAULT_NAME = "Brazuca"; 
const DEFAULT_LOGO = "https://i.imgur.com/KVpfrAk.png";
const PROJECT_VERSION = "1.0.0"; // Versão do seu Addon

// ============================================================
// 2. ROTA DO MANIFESTO (Proxy para Renomear/Trocar Ícone)
// ============================================================
app.get('/addon/manifest.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=60'); // Cache curto
    
    try {
        // Captura personalização da URL (query params)
        const customName = req.query.name || DEFAULT_NAME;
        const customLogo = req.query.logo || DEFAULT_LOGO;
        
        // 1. Baixa o manifesto original
        const response = await axios.get(`${BRAZUCA_UPSTREAM}/manifest.json`);
        const manifest = response.data;

        // 2. Gera ID único baseado no nome (para o Stremio não confundir)
        const idSuffix = Buffer.from(customName).toString('hex').substring(0, 10);
        
        // 3. Aplica as mudanças visuais
        manifest.id = `community.brazuca.wrapper.${idSuffix}`;
        manifest.name = customName;
        manifest.description = "Filmes e Séries Brasileiros via StremThru";
        manifest.logo = customLogo;
        manifest.version = PROJECT_VERSION; // Define a versão explicitamente
        
        delete manifest.background; // Remove background para limpar
        
        res.json(manifest);
    } catch (error) {
        console.error("Erro no upstream:", error.message);
        res.status(500).json({ error: "Falha ao obter manifesto original" });
    }
});

// ============================================================
// 3. ROTA REDIRECIONADORA (Streams/Catalogos)
// ============================================================
// Redireciona tudo que não for manifesto para o Brazuca original
app.use('/addon', (req, res) => {
    res.redirect(307, `${BRAZUCA_UPSTREAM}${req.path}`);
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
            background: #1e40af; color: #93c5fd; font-weight: 600;
            display: flex; align-items: center; justify-content: center;
            height: 100%; border-radius: 0.5rem; transition: 0.2s;
            font-size: 0.75rem; text-transform: uppercase; border: 1px solid #1d4ed8;
        }
        .btn-sub-rd:hover { background: #1d4ed8; color: white; }

        .btn-sub-tb {
            background: #5b21b6; color: #d8b4fe; font-weight: 600;
            display: flex; align-items: center; justify-content: center;
            height: 100%; border-radius: 0.5rem; transition: 0.2s;
            font-size: 0.75rem; text-transform: uppercase; border: 1px solid #7c3aed;
        }
        .btn-sub-tb:hover { background: #7c3aed; color: white; }

    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 bg-black">

    <div class="w-full max-w-lg card rounded-2xl shadow-2xl p-8 border border-gray-800 relative">
        
        <!-- Header -->
        <div class="text-center mb-8">
            <img src="${DEFAULT_LOGO}" id="previewLogo" class="w-20 h-20 mx-auto mb-3 rounded-full border-2 border-gray-800 shadow-lg object-cover">
            <h1 class="text-3xl font-extrabold text-white tracking-tight">Brazuca <span class="text-blue-500">Wrapper</span></h1>
            <p class="text-gray-500 text-xs mt-1 uppercase tracking-widest">Gerador StremThru v${PROJECT_VERSION}</p>
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

            <!-- Personalização -->
            <div class="divider"><span>Personalização (Opcional)</span></div>
            
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase">Nome do Addon</label>
                    <input type="text" id="custom_name" value="${DEFAULT_NAME}" class="w-full input-dark p-2 rounded text-sm mt-1">
                </div>
                <div>
                    <label class="text-[10px] font-bold text-gray-500 uppercase">Ícone (URL)</label>
                    <input type="text" id="custom_logo" value="${DEFAULT_LOGO}" class="w-full input-dark p-2 rounded text-sm mt-1" onchange="updatePreview()">
                </div>
            </div>

            <!-- 2. Debrids (Tokens) -->
            <div class="divider"><span>Serviços Debrid</span></div>
            
            <div class="space-y-4">
                
                <!-- Real Debrid -->
                <div class="bg-[#1a1a1a] p-4 rounded-xl border border-gray-800">
                    <div class="flex justify-between items-center mb-3">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" id="use_rd" class="w-5 h-5 accent-blue-600 cursor-pointer" onchange="validate()">
                            <span class="text-sm font-bold text-white">Real-Debrid</span>
                        </div>
                        <span class="text-[10px] text-gray-500">Store Token</span>
                    </div>
                    
                    <div class="flex gap-3 h-10">
                        <input type="text" id="rd_key" placeholder="Cole o Token da Store 'rd'" class="flex-1 input-dark px-3 rounded-lg text-xs" disabled>
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
                        <span class="text-[10px] text-gray-500">Store Token</span>
                    </div>
                    
                    <div class="flex gap-3 h-10">
                        <input type="text" id="tb_key" placeholder="Cole o Token da Store 'tb'" class="flex-1 input-dark px-3 rounded-lg text-xs" disabled>
                        <a href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" class="btn-sub-tb w-32 shadow-lg shadow-purple-900/20">
                            Assinar <i class="fas fa-external-link-alt ml-2"></i>
                        </a>
                    </div>
                </div>
            </div>

            <!-- Resultado -->
            <div id="resultArea" class="hidden pt-4 border-t border-gray-800 space-y-3">
                <div class="relative">
                    <input type="text" id="finalUrl" readonly class="w-full bg-black border border-blue-900 text-blue-400 text-[10px] p-3 rounded pr-12 font-mono focus:outline-none">
                    <button type="button" onclick="copyLink()" class="absolute right-1 top-1 bottom-1 bg-blue-900 hover:bg-blue-800 text-white px-3 rounded text-xs font-bold transition">COPY</button>
                </div>
                
                <a id="installBtn" href="#" class="block w-full btn-action py-3.5 rounded-xl text-center font-bold text-sm uppercase tracking-widest shadow-lg">
                    INSTALAR
                </a>
            </div>

            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 py-3.5 rounded-xl text-sm font-bold cursor-not-allowed transition" disabled>
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
            let host = instanceSelect.value === 'custom' ? customInput.value.trim() : instanceSelect.value;
            host = host.replace(/\\/$/, '').replace('http:', 'https:');

            // 1. Personalização
            const cName = document.getElementById('custom_name').value.trim();
            const cLogo = document.getElementById('custom_logo').value.trim();
            
            let proxyParams = \`?name=\${encodeURIComponent(cName)}\`;
            if(cLogo) proxyParams += \`&logo=\${encodeURIComponent(cLogo)}\`;

            // Nossa URL de Proxy (que serve o manifesto editado)
            const myMirrorUrl = window.location.origin + "/addon/manifest.json" + proxyParams;

            // 2. Montar Upstreams
            let config = { upstreams: [], stores: [] };
            
            // Adiciona Brazuca (via nosso Proxy)
            config.upstreams.push({ u: myMirrorUrl });

            // 3. Montar Stores (Debrids)
            if (document.getElementById('use_rd').checked) {
                config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
            }
            if (document.getElementById('use_tb').checked) {
                config.stores.push({ c: "tb", t: document.getElementById('tb_key').value.trim() });
            }

            const b64 = btoa(JSON.stringify(config));
            const hostClean = host.replace(/^https?:\\/\\//, '');
            
            // Links finais
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
            const oldTxt = btn.innerText;
            btn.innerText = "OK!";
            setTimeout(() => btn.innerText = oldTxt, 1500);
        }
    </script>
</body>
</html>
