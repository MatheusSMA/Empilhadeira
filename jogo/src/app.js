/* app.js — o portal: acesso, trilha e briefing, até chegar no simulador.
 *
 * Encena um LMS corporativo porque é assim que o produto vai existir na vida
 * real — o comprador precisa ver a moldura, não só o jogo. Mas encena a
 * PLATAFORMA QUE ESTÁ SENDO VENDIDA, nunca o sistema de um cliente real: nada
 * aqui usa marca, logotipo ou domínio de terceiro, e a faixa de demonstração
 * fica visível em todas as telas.
 *
 * Nada sai do navegador. O "acesso" não valida nem envia coisa alguma.
 */

const NIVEIS = [
    { n: 1, titulo: 'Entender a máquina', min: 25, estado: 'concluido', nota: 92 },
    { n: 2, titulo: 'Estabilidade e capacidade de carga', min: 30, estado: 'concluido', nota: 84 },
    { n: 3, titulo: 'Inspeção diária e comandos', min: 35, estado: 'concluido', nota: 88 },
    { n: 4, titulo: 'Máquina parada → movimento', min: 40, estado: 'concluido', nota: 79 },
    {
        n: 5, titulo: 'Operação com carga', min: 40, estado: 'disponivel',
        desc: 'Pegar o palete, transportar e depositar na prateleira certa. Precisão pontua mais que velocidade.',
    },
    { n: 6, titulo: 'Segurança + avaliação final', min: 30, estado: 'bloqueado' },
];

const el = id => document.getElementById(id);

export function createApp({ onStart, onExit }) {
    const telas = {
        acesso: el('scr-acesso'),
        trilha: el('scr-trilha'),
        brief: el('scr-brief'),
    };

    const operador = {
        nome: 'Visitante',
        matricula: 'NAT-' + String(40000 + Math.floor(performance.now() % 9000)).padStart(5, '0'),
        unidade: 'CD Cajamar',
        turno: 'T2',
    };

    let estado = 'acesso';

    function mostrar(nome) {
        estado = nome;
        for (const k in telas) telas[k]?.classList.toggle('is-active', k === nome);
        document.body.classList.toggle('em-jogo', nome === 'sim');
        if (nome === 'sim') location.hash = '#/simulador';
        else if (nome === 'trilha') location.hash = '#/trilha';
    }

    /* ---------- tela de acesso ---------- */
    const inNome = el('inNome');
    const inUnidade = el('inUnidade');
    const inTurno = el('inTurno');
    el('mtxt').textContent = operador.matricula;

    function entrar() {
        const v = (inNome.value || '').trim();
        operador.nome = v || 'Visitante';
        operador.unidade = inUnidade.value;
        operador.turno = inTurno.value;
        try { localStorage.setItem('xr.operador', JSON.stringify(operador)); } catch { }
        pintarCracha();
        montarTrilha();
        mostrar('trilha');
    }

    el('btEntrar').addEventListener('click', entrar);
    inNome.addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });

    try {
        const s = JSON.parse(localStorage.getItem('xr.operador') || 'null');
        if (s?.nome && s.nome !== 'Visitante') inNome.value = s.nome;
    } catch { }

    function iniciais(nome) {
        return nome.trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || 'OP';
    }

    function pintarCracha() {
        el('chNome').textContent = operador.nome;
        el('chIni').textContent = iniciais(operador.nome);
        el('chMeta').textContent = `${operador.matricula} · ${operador.unidade} · Turno ${operador.turno}`;
    }

    /* ---------- trilha ---------- */
    function montarTrilha() {
        const wrap = el('lista');
        wrap.innerHTML = '';
        for (const lv of NIVEIS) {
            const c = document.createElement('div');
            c.className = `lv is-${lv.estado}`;
            const marca = lv.estado === 'concluido' ? `✓ ${lv.nota}` :
                lv.estado === 'disponivel' ? 'Disponível' : 'Bloqueado';
            c.innerHTML = `
                <div class="lv-n">Nível ${lv.n}</div>
                <div class="lv-b">
                  <div class="lv-t">${lv.titulo}</div>
                  <div class="lv-m">${lv.min} min · ${marca}</div>
                </div>
                <div class="lv-a">${lv.estado === 'disponivel' ? 'Iniciar ▶' : ''}</div>`;
            if (lv.estado === 'disponivel') {
                c.addEventListener('click', () => abrirBrief(lv));
            } else if (lv.estado === 'bloqueado') {
                c.addEventListener('click', () => {
                    el('travaMsg').textContent =
                        `O Nível ${lv.n} — ${lv.titulo} faz parte do projeto completo.`;
                    el('trava').classList.add('on');
                    setTimeout(() => el('trava').classList.remove('on'), 3200);
                });
            } else {
                c.addEventListener('click', () => {
                    el('travaMsg').textContent =
                        `O Nível ${lv.n} está encenado nesta demonstração. Jogável: Nível 5.`;
                    el('trava').classList.add('on');
                    setTimeout(() => el('trava').classList.remove('on'), 3200);
                });
            }
            wrap.appendChild(c);
        }
    }

    /* ---------- briefing ---------- */
    function abrirBrief(lv) {
        el('bfN').textContent = `Nível ${lv.n}`;
        el('bfT').textContent = lv.titulo;
        el('bfD').textContent = lv.desc || '';
        mostrar('brief');
    }

    el('btIniciar').addEventListener('click', () => {
        mostrar('sim');
        onStart(operador);
    });
    el('btVoltarTrilha').addEventListener('click', () => mostrar('trilha'));
    el('btSair')?.addEventListener('click', () => mostrar('acesso'));

    /* ---------- volta do jogo para a trilha ---------- */
    function voltarAoPortal() {
        mostrar('trilha');
        onExit?.();
    }

    return {
        get estado() { return estado; },
        get operador() { return operador; },
        voltarAoPortal,
        iniciar() {
            pintarCracha();
            // Link direto para o simulador: o sócio manda o link já dentro da
            // missão numa reunião curta, sem passar pelo portal.
            if (location.hash.startsWith('#/simulador')) {
                montarTrilha();
                mostrar('sim');
                onStart(operador);
            } else {
                mostrar('acesso');
            }
        },
    };
}
