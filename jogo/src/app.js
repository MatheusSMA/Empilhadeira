/* app.js — o portal: quem é você, onde você parou. Duas telas, e o simulador.
 *
 * Encena a PLATAFORMA que está sendo vendida (Prumo), nunca o sistema de um
 * cliente real: sem marca, logotipo ou domínio de terceiro, e a pílula
 * "Demo" fica visível nas duas telas.
 *
 * Nada sai do navegador. Não existe login: numa demo aberta por link de
 * WhatsApp, formulário é a primeira desculpa para fechar a aba.
 */

const NIVEIS = [
    { n: 1, curto: 'A máquina', titulo: 'Entender a máquina', min: 25, estado: 'concluido', nota: 92 },
    { n: 2, curto: 'Estabilidade', titulo: 'Estabilidade e capacidade de carga', min: 30, estado: 'concluido', nota: 84 },
    { n: 3, curto: 'Inspeção', titulo: 'Inspeção diária e comandos', min: 35, estado: 'concluido', nota: 88 },
    { n: 4, curto: 'Manobra', titulo: 'Máquina parada → movimento', min: 40, estado: 'concluido', nota: 79 },
    { n: 5, curto: 'Carga', titulo: 'Operação com carga', min: 40, alvo: 3, estado: 'disponivel' },
    { n: 6, curto: 'Avaliação', titulo: 'Segurança + avaliação final', min: 30, estado: 'bloqueado' },
];

const el = id => document.getElementById(id);
const dois = n => String(n).padStart(2, '0');

export function createApp({ onStart, onExit }) {
    const telas = {
        boas: el('scr-boas'),
        painel: el('scr-painel'),
    };

    const operador = { nome: 'Marcos' };
    try {
        const s = JSON.parse(localStorage.getItem('xr.operador') || 'null');
        if (s?.nome) operador.nome = s.nome;
    } catch { }

    let estado = 'boas';

    function mostrar(nome) {
        estado = nome;
        for (const k in telas) telas[k]?.classList.toggle('is-active', k === nome);
        document.body.classList.toggle('em-jogo', nome === 'sim');
        if (nome === 'sim') location.hash = '#/simulador';
        else if (nome === 'painel') location.hash = '#/trilha';
    }

    /* ---------- identidade ---------- */

    function pintar() {
        el('chNome').textContent = operador.nome;
        el('btSair')?.setAttribute('aria-label', `Sair da conta de ${operador.nome}`);
    }

    function salvar() {
        try { localStorage.setItem('xr.operador', JSON.stringify(operador)); } catch { }
    }

    /* "Trocar conta" não abre formulário: torna o próprio nome editável no
       lugar onde ele está. Zero UI nova, zero palavra nova. */
    const campoNome = el('chNome');

    function commitNome() {
        campoNome.removeAttribute('contenteditable');
        const v = (campoNome.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22);
        operador.nome = v || operador.nome;
        salvar();
        pintar();
    }

    el('btTrocar')?.addEventListener('click', () => {
        // 'plaintext-only' cai para "inherit" (= não editável) em Firefox
        // antigo; por isso o teste, e o handler de colar logo abaixo.
        const suporta = 'plaintextOnly' in document.body.style ||
            (() => {
                const d = document.createElement('div');
                d.setAttribute('contenteditable', 'plaintext-only');
                return d.contentEditable === 'plaintext-only';
            })();
        campoNome.setAttribute('contenteditable', suporta ? 'plaintext-only' : 'true');
        campoNome.focus();
        const r = document.createRange();
        r.selectNodeContents(campoNome);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
    });

    campoNome.addEventListener('blur', () => {
        if (campoNome.hasAttribute('contenteditable')) commitNome();
    });
    campoNome.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); campoNome.blur(); }
        if (e.key === 'Escape') { campoNome.textContent = operador.nome; campoNome.blur(); }
    });
    // Colar sempre entra como texto puro: sem isso, colar de um site injeta
    // HTML formatado dentro da pílula.
    campoNome.addEventListener('paste', e => {
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text') || '';
        document.execCommand('insertText', false, t.replace(/\s+/g, ' ').slice(0, 22));
    });

    el('btEntrar').addEventListener('click', () => {
        if (campoNome.hasAttribute('contenteditable')) commitNome();
        montarTrilha();
        mostrar('painel');
    });

    /* ---------- trilha ----------
       O play é gerado junto com a linha, então o listener é ligado aqui e não
       uma vez no boot: montarTrilha() roda de novo a cada entrada. */

    function montarTrilha() {
        const wrap = el('lista');
        wrap.innerHTML = '';

        for (const lv of NIVEIS) {
            const li = document.createElement('li');

            if (lv.estado === 'concluido') {
                li.className = 'nv feito';
                li.innerHTML =
                    `<em>${dois(lv.n)}</em><span>${lv.curto}</span><b>${lv.nota}</b>`;

            } else if (lv.estado === 'disponivel') {
                li.className = 'nv agora';
                li.innerHTML =
                    `<em>${dois(lv.n)}</em><span>${lv.curto}</span><i>${lv.min} min · ${lv.alvo} paletes</i>` +
                    `<button class="play" type="button" aria-label="Iniciar nível ${lv.n}: ${lv.titulo}">` +
                    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>` +
                    `</button>`;
                li.querySelector('.play').addEventListener('click', () => {
                    mostrar('sim');
                    onStart(operador);
                });

            } else {
                li.className = 'nv travado';
                li.innerHTML =
                    `<em>${dois(lv.n)}</em><span>${lv.curto}</span>` +
                    `<svg class="cadeado" viewBox="0 0 24 24" role="img" aria-label="Bloqueado">` +
                    `<rect x="4" y="10" width="16" height="11" rx="3.5" fill="currentColor"/>` +
                    `<path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>` +
                    `</svg>`;
            }

            wrap.appendChild(li);
        }
    }

    el('btSair')?.addEventListener('click', () => mostrar('boas'));

    /* ---------- volta do jogo para o painel ---------- */
    function voltarAoPortal() {
        mostrar('painel');
        onExit?.();
    }

    return {
        get estado() { return estado; },
        get operador() { return operador; },
        voltarAoPortal,
        iniciar() {
            pintar();
            montarTrilha();
            // Link direto para o simulador: o sócio manda o link já dentro da
            // missão numa reunião curta, sem passar pelo portal.
            if (location.hash.startsWith('#/simulador')) {
                mostrar('sim');
                onStart(operador);
            } else if (location.hash.startsWith('#/trilha')) {
                mostrar('painel');
            } else {
                mostrar('boas');
            }
        },
    };
}
