/* app.js — o portal: quem é você, onde você parou. Quatro telas, e o simulador.
 *
 * Encena a PLATAFORMA que está sendo vendida (Prumo), nunca o sistema de um
 * cliente real: sem marca, logotipo ou domínio de terceiro.
 *
 * Nada sai do navegador. Não existe login de verdade: numa demo aberta por link
 * de WhatsApp, formulário é a primeira desculpa para fechar a aba.
 */

import { haptics } from './haptics.js';

/* Direção da transição. Z = mudou de profundidade (Continuar, Sair, entrar no
   simulador). X = telas irmãs (as três abas). A regra É o desenho: sem um
   modelo, cada transição vira decisão avulsa e o conjunto perde coerência. */
const PROF = { boas: 0, inicio: 1, trilha: 1, turma: 1, sim: 2 };
const LADO = { inicio: 0, trilha: 1, turma: 2 };
const VS = ['v-esq', 'v-dir', 'v-frente', 'v-tras', 'v-mundo'];

function rumo(de, para) {
    if (para === 'sim') return 'v-mundo';
    if (!de || de === para) return 'v-frente';
    const d = (PROF[para] ?? 1) - (PROF[de] ?? 1);
    if (d > 0) return 'v-frente';
    if (d < 0) return 'v-tras';
    return LADO[para] > LADO[de] ? 'v-dir' : 'v-esq';
}

const NIVEIS = [
    { n: 1, curto: 'A máquina', titulo: 'Entender a máquina', estado: 'concluido', nota: 92 },
    { n: 2, curto: 'Estabilidade', titulo: 'Estabilidade e capacidade de carga', estado: 'concluido', nota: 84 },
    { n: 3, curto: 'Inspeção', titulo: 'Inspeção diária e comandos', estado: 'concluido', nota: 96 },
    { n: 4, curto: 'Manobra', titulo: 'Máquina parada → movimento', estado: 'concluido', nota: 88 },
    { n: 5, curto: 'Carga', titulo: 'Operação com carga', estado: 'disponivel' },
    { n: 6, curto: 'Avaliação', titulo: 'Segurança + avaliação final', estado: 'bloqueado' },
];

/* Turma do instrutor. Dados de demonstração — nenhum aluno real, nenhuma
   informação vinda de fora do navegador. */
const TURMA = [
    { nome: 'Rafael', nivel: 5 },
    { nome: 'Marcos', nivel: 6, alerta: 'ok' },
    { nome: 'Aline', nivel: 3, alerta: 'atencao' },
    { nome: 'Diego', nivel: 6, alerta: 'ok' },
    { nome: 'Bruna', nivel: 2, alerta: 'atencao' },
];

const SVG = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13l5.5 5.5L20 6" stroke="#12121A" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 26" aria-hidden="true"><path d="M4 3l17 10L4 23z" fill="#12121A"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10.5" width="16" height="11" rx="3" fill="#D8FF4E"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="#D8FF4E" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
    avatar: '<svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="48" fill="#7A7BF5"/><path d="M14 96c0-19 15-31 34-31s34 12 34 31z" fill="#12121A"/><circle cx="48" cy="47" r="17" fill="#12121A"/><path d="M27 41a21 21 0 0 1 42 0z" fill="#FFFFFF"/><rect x="22" y="39" width="52" height="6.5" rx="3.25" fill="#FFFFFF"/></svg>',
    okPeq: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13l5.5 5.5L20 6" stroke="#D8FF4E" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alertaPeq: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v7" stroke="#D8FF4E" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.5" fill="#D8FF4E"/></svg>',
};

const el = id => document.getElementById(id);
const dois = n => String(n).padStart(2, '0');

export function createApp({ onStart, onExit }) {
    const telas = {
        boas: el('scr-boas'),
        inicio: el('scr-inicio'),
        trilha: el('scr-trilha'),
        turma: el('scr-turma'),
    };
    const abas = el('abas');

    const operador = { nome: 'Rafael' };
    try {
        const s = JSON.parse(localStorage.getItem('xr.operador') || 'null');
        if (s?.nome) operador.nome = s.nome;
    } catch { }

    let estado = null;
    let saindo = null, tSaida = 0;

    /** Uma tela por vez. As abas só existem depois de entrar, e nunca durante
     *  o simulador — senão flutuam por cima da cabine. */
    function mostrar(nome) {
        const antes = estado;
        if (antes === nome) return;
        estado = nome;
        const v = rumo(antes, nome);

        // toque rápido em duas abas não pode deixar tela órfã visível
        clearTimeout(tSaida);
        if (saindo) { saindo.classList.remove('is-leaving', ...VS); saindo = null; }

        const velha = telas[antes];
        for (const k in telas) {
            const t = telas[k];
            if (!t) continue;
            t.classList.remove(...VS);
            t.classList.toggle('is-active', k === nome);
        }
        telas[nome]?.classList.add(v);

        if (velha && velha !== telas[nome]) {
            velha.classList.add('is-leaving', v);
            saindo = velha;
            tSaida = setTimeout(() => {
                velha.classList.remove('is-leaving', ...VS);
                saindo = null;
            }, v === 'v-mundo' ? 300 : 160);
        }

        const noJogo = nome === 'sim';
        const comAbas = !noJogo && nome !== 'boas';
        document.body.classList.toggle('em-jogo', noJogo);
        document.body.classList.toggle('pr-abas', comAbas);

        // a barra de abas cai ANTES de a placa dissolver: é o primeiro tempo
        // da entrada no simulador
        if (noJogo && !abas.hidden) {
            abas.classList.add('mv-sai');
            setTimeout(() => { abas.hidden = true; abas.classList.remove('mv-sai'); }, 200);
        } else {
            abas.hidden = !comAbas;
        }

        abas.querySelectorAll('.pr-aba').forEach(b =>
            b.classList.toggle('on', b.dataset.aba === nome));

        if (noJogo) location.hash = '#/simulador';
        else if (nome !== 'boas') location.hash = '#/' + nome;
    }

    function jogar() {
        haptics.toca('entrar');
        mostrar('sim');
        onStart(operador);
    }

    /* ---------- identidade ---------- */

    const campoNome = el('chNome');

    function pintar() {
        campoNome.textContent = operador.nome;
        el('btSair')?.setAttribute('aria-label', `Sair da conta de ${operador.nome}`);
    }

    function commitNome() {
        campoNome.removeAttribute('contenteditable');
        const v = (campoNome.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 18);
        operador.nome = v || operador.nome;
        try { localStorage.setItem('xr.operador', JSON.stringify(operador)); } catch { }
        pintar();
    }

    /* Trocar de operador não abre formulário: o próprio nome vira editável no
       lugar onde ele está. Zero UI nova, zero palavra nova. */
    campoNome.addEventListener('dblclick', () => {
        campoNome.setAttribute('contenteditable', 'plaintext-only');
        campoNome.focus();
        const r = document.createRange();
        r.selectNodeContents(campoNome);
        const sel = getSelection();
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
    // Colar entra como texto puro: sem isso, colar de um site injeta HTML.
    campoNome.addEventListener('paste', e => {
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text') || '';
        document.execCommand('insertText', false, t.replace(/\s+/g, ' ').slice(0, 18));
    });

    /* ---------- listas ---------- */

    function montarSegs() {
        const wrap = el('segs');
        wrap.innerHTML = '';
        for (const lv of NIVEIS) {
            const i = document.createElement('i');
            if (lv.estado === 'disponivel') i.className = 'atual';
            wrap.appendChild(i);
        }
        el('fracN').textContent = NIVEIS.filter(l => l.estado === 'concluido').length;
    }

    function montarTrilha() {
        const wrap = el('lista');
        wrap.innerHTML = '';

        for (const [i, lv] of NIVEIS.entries()) {
            const li = document.createElement('li');
            li.style.setProperty('--i', 1 + Math.min(i, 4));

            if (lv.estado === 'concluido') {
                li.className = 'pr-nv';
                li.innerHTML = `<em>${dois(lv.n)}</em><span>${lv.curto}</span>` +
                    `<b>${lv.nota}</b>${SVG.check}`;

            } else if (lv.estado === 'disponivel') {
                li.className = 'pr-nv agora';
                li.setAttribute('role', 'button');
                li.setAttribute('tabindex', '0');
                li.setAttribute('aria-label', `Iniciar nível ${lv.n}: ${lv.titulo}`);
                li.innerHTML = `<em>${dois(lv.n)}</em><span>${lv.curto}</span>` +
                    `<span class="pr-play">${SVG.play}</span>`;
                li.addEventListener('click', jogar);
                li.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jogar(); }
                });

            } else {
                li.className = 'pr-nv travado';
                li.setAttribute('aria-label', `Nível ${lv.n} bloqueado`);
                li.innerHTML = `<em>${dois(lv.n)}</em><span>${lv.curto}</span>${SVG.cadeado}`;
            }

            wrap.appendChild(li);
        }
    }

    function montarTurma() {
        const wrap = el('alunos');
        wrap.innerHTML = '';
        for (const a of TURMA) {
            const li = document.createElement('li');
            li.className = 'pr-al';
            const disco = a.alerta
                ? `<i>${a.alerta === 'ok' ? SVG.okPeq : SVG.alertaPeq}</i>`
                : '<i class="vazio"></i>';
            li.innerHTML = SVG.avatar + `<span>${a.nome}</span><b>${dois(a.nivel)}</b>` + disco;
            wrap.appendChild(li);
        }
    }

    /* ---------- ligações ---------- */

    el('btEntrar').addEventListener('click', () => {
        if (campoNome.hasAttribute('contenteditable')) commitNome();
        haptics.toca('toque');
        mostrar('inicio');
    });
    el('btAtual').addEventListener('click', jogar);
    el('btSair').addEventListener('click', () => mostrar('boas'));

    abas.querySelectorAll('.pr-aba').forEach(b =>
        b.addEventListener('click', () => {
            if (b.dataset.aba === estado) return;   // tocar na aba atual não faz nada
            haptics.toca('aba');
            mostrar(b.dataset.aba);
        }));

    function voltarAoPortal() {
        mostrar('inicio');
        onExit?.();
    }

    return {
        get estado() { return estado; },
        get operador() { return operador; },
        voltarAoPortal,
        iniciar() {
            // Só a PRIMEIRA aparição escalona por elemento: ali não há
            // deslizamento de tela competindo. Nas trocas seguintes, quem se
            // move é a tela inteira e mais nada.
            document.documentElement.classList.add('primeira');
            setTimeout(() => document.documentElement.classList.remove('primeira'), 1200);
            pintar();
            montarSegs();
            montarTrilha();
            montarTurma();
            // Link direto: o sócio manda a missão pronta numa reunião curta,
            // sem passar pelo portal.
            const h = location.hash;
            if (h.startsWith('#/simulador')) {
                document.documentElement.classList.add('direto');
                jogar();
            }
            else if (h.startsWith('#/trilha')) mostrar('trilha');
            else if (h.startsWith('#/turma')) mostrar('turma');
            else if (h.startsWith('#/inicio')) mostrar('inicio');
            else mostrar('boas');
        },
    };
}
