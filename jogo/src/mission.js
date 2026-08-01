/* mission.js — Nível 5 "Operação com carga": pegar UM palete e depositar na vaga.
 *
 * Level design deliberado: o palete e a vaga ficam ambos no campo de visão do
 * PRIMEIRO frame, dentro de uma caixa de ~10×8 m. É isso que dispensa minimapa,
 * coluna de luz e seta de borda — e é por isso que 1ª pessoa funciona aqui.
 */

import * as THREE from 'three';
import { COLOR } from './tokens.js';
import { P } from './pallet.js';

const D2R = THREE.MathUtils.degToRad;

const PALETE = { x: -1.9, z: 3.4, yaw: 0.16, label: 'SKU 4412', kg: 820 };

// Resolvido contra o gerador do warehouse.js, não estimado:
// filled = ((b*7 + li*3 + ri*5) % 10) < 7 → para ri=4, li=1 sobram b ∈ {2,5,8}.
// cx = -13.75 + 5,5·2,75 = 1,375.
const VAGA = { id: 'R05-B6-N2', label: 'RUA 03 · NÍVEL 2', x: 1.375, y: 1.78, z: 5.43, yaw: Math.PI };

const GUIA = {
    neutro: new THREE.Color(COLOR.slate),
    perto: new THREE.Color(COLOR.hazard),
    alinhado: new THREE.Color(COLOR.deep),
};

/** Vibração háptica. Só existe no Android; iOS ignora silenciosamente — por isso
 *  nunca é o ÚNICO sinal de que algo aconteceu, sempre acompanha som/HUD. */
function vibrar(padrao) {
    try { navigator.vibrate?.(padrao); } catch { /* sem suporte, sem problema */ }
}

export function createMission({ scene, forklift, palletSys, hud, telemetry }) {
    /* ---------- guias de garfo projetadas no chão ----------
       Não é muleta de videogame: no último meio metro a face do palete cai a
       42,2° de depressão, abaixo da borda da placa do carro (37,4°) — o encaixe
       final é geometricamente cego, e isso é verdade na máquina real. As guias
       são a única referência do último metro. */
    const guias = [];
    for (const sx of [-0.30, 0.30]) {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(0.06, 2.80),
            new THREE.MeshBasicMaterial({
                color: GUIA.neutro, transparent: true, opacity: 0.35, depthWrite: false,
            })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(sx, 0.024, 3.00);
        m.renderOrder = 3;
        forklift.root.add(m);   // no root, não no body: o roll descolaria do chão
        guias.push(m);
    }

    const mk = hud.addMarker({ label: 'PALETE', sub: 'SKU 4412', kind: 'alvo' });

    const S = {
        fase: 'buscar',      // buscar → transportar → concluido
        t: 0,
        semProgresso: 0,
        autoTilt: -1,
        engate: null,
        deposito: null,
        colisoes: 0,
        picoALat: 0,
        pallet: null,
    };

    function begin() {
        palletSys.reset();
        S.pallet = palletSys.spawn(PALETE.x, PALETE.z, PALETE.yaw,
            { label: PALETE.label, kg: PALETE.kg });
        palletSys.setTarget(null);
        S.fase = 'buscar';
        S.t = 0;
        S.semProgresso = 0;
        S.autoTilt = -1;
        S.engate = null;
        S.deposito = null;
        S.colisoes = 0;
        S.picoALat = 0;
        hud.setMarker(mk, {
            pos: new THREE.Vector3(PALETE.x, 0.9, PALETE.z),
            label: 'PALETE', sub: PALETE.label, kind: 'alvo', visible: true,
        });
        hud.say('NÍVEL 5 · OPERAÇÃO COM CARGA — PEGUE O PALETE', 'info', 3.2);
        const card = document.getElementById('card');
        if (card) card.hidden = true;
    }

    function onCollision(hit) {
        S.colisoes++;
        telemetry?.push('collision', { speed: +hit.speed.toFixed(2) });
    }

    function chip(texto, kind = 'info') {
        const e = document.getElementById('chip');
        if (!e) return;
        if (!texto) { e.className = 'chip'; return; }
        if (e.textContent !== texto) e.textContent = texto;
        e.className = `chip on is-${kind}`;
    }

    function atualizaGuias(cand, st) {
        let cor = GUIA.neutro, op = 0.35;

        if (S.fase === 'buscar' && S.pallet) {
            const d = Math.hypot(S.pallet.position.x - st.x, S.pallet.position.z - st.z);
            if (d < 4) { cor = GUIA.perto; op = 0.55; }
        }
        if (cand) { cor = GUIA.alinhado; op = 0.85; }
        // guia reta mente na curva: apaga em vez de enganar
        if (Math.abs(st.delta) > D2R(15)) op *= 0.27;
        if (S.fase === 'concluido') op = 0;

        for (const g of guias) {
            g.material.color.copy(cor);
            g.material.opacity = op;
        }
    }

    function update(dt, input) {
        const st = forklift.state;
        S.t += dt;
        S.semProgresso += dt;
        S.picoALat = Math.max(S.picoALat, Math.abs(st.aLat));

        const pr = palletSys.probe();
        const cand = pr.ok ? pr : null;
        atualizaGuias(cand, st);

        /* ---------- engate AUTOMÁTICO no instante do encaixe ----------
           Era: alinhar E segurar o ▲ dentro de uma janela estreita de
           profundidade. Não funciona — o palete não tem colisor, então na prática
           o jogador atravessa ele e nada acontece. Playtest derrubou o desenho
           anterior. Agora encaixou, pegou: vibra e vira parte do garfo. */
        if (S.fase === 'buscar' && cand) {
            S.engate = palletSys.engage(cand);
            S.engate.depth = cand.depth;
            vibrar([14, 45, 26]);
            S.fase = 'transportar';
            S.semProgresso = 0;
            S.autoTilt = 0;
            palletSys.setTarget(VAGA);
            hud.setMarker(mk, {
                pos: new THREE.Vector3(VAGA.x, VAGA.y + 0.4, VAGA.z),
                label: 'VAGA', sub: VAGA.label, kind: 'vaga', visible: true,
            });
            hud.say('CARGA ENGATADA — ERGA ▲ E LEVE ATÉ A ' + VAGA.label, 'ok', 3.4);
            telemetry?.push('pallet_pick', {
                lat: +S.engate.lat.toFixed(3),
                yawErr: +S.engate.yawErr.toFixed(3),
                forkErr: +S.engate.forkErr.toFixed(3),
                depth: +cand.depth.toFixed(2),
            });
        }

        // inclinar a torre para trás depois de engatar: prática correta, e
        // step() ACUMULA em S.tilt (não sobrescreve), então escrever aqui é seguro
        if (S.autoTilt >= 0 && S.autoTilt < 1) {
            S.autoTilt = Math.min(1, S.autoTilt + dt / 0.5);
            st.tilt += (D2R(5) - st.tilt) * Math.min(1, dt / 0.18);
        }

        /* ---------- depósito ---------- */
        const podeSoltar = palletSys.canPlace();
        if (S.fase === 'transportar' && podeSoltar && input.axes.fork < 0) {
            const r = palletSys.release();
            if (r && r.slot) {
                S.deposito = r;
                S.fase = 'concluido';
                vibrar([22, 60, 40]);
                hud.setMarker(mk, { visible: false });
                hud.say('DEPOSITADO — MISSÃO CONCLUÍDA', 'ok', 4);
                telemetry?.push('pallet_place', {
                    slotId: r.slot.id, posErr: +r.posErr.toFixed(3),
                });
                mostrarCartao();
            }
        }

        /* ---------- chip: diz O QUE CORRIGIR, não só que falhou ---------- */
        const n2 = v => v.toFixed(2).replace('.', ',');

        if (S.fase === 'concluido') {
            chip('');
        } else if (S.fase === 'transportar') {
            if (podeSoltar) {
                chip('NA VAGA — ABAIXE O GARFO ▼ PARA SOLTAR', 'ok');
            } else if (st.forkY > 0.6 && Math.abs(st.v) > 0.5) {
                chip('GARFO ALTO — ABAIXE PARA TRAFEGAR', 'warn');
            } else {
                const perto = Math.hypot(VAGA.x - st.x, VAGA.z - st.z) < 4.0;
                const dz = VAGA.y - st.forkY;
                chip(perto
                    ? `VAGA: ALVO ${n2(VAGA.y)} m · FALTAM ${n2(Math.abs(dz))} m ${dz > 0 ? '▲' : '▼'}`
                    : 'CARGA A BORDO · LIMITE 8 KM/H · NR-11', 'info');
            }
        } else {
            // fase de busca: a ordem das mensagens é a ordem de correção
            const lado = pr.latSign > 0 ? 'ESQUERDA' : 'DIREITA';
            const msg = {
                nenhum: ['PALETE JÁ RECOLHIDO', 'ok'],
                longe: ['APROXIME-SE DO PALETE PELA FRENTE', 'info'],
                perto: ['RECUE UM POUCO — VOCÊ PASSOU DO PALETE', 'warn'],
                lateral: [`DESVIE PARA A ${lado} PARA CENTRALIZAR`, 'warn'],
                angulo: ['ENDIREITE A MÁQUINA COM O PALETE', 'warn'],
                garfo_alto: ['ABAIXE O GARFO ▼ ATÉ A ALTURA DO BOLSO', 'warn'],
                garfo_baixo: ['ERGA O GARFO ▲ ATÉ A ALTURA DO BOLSO', 'warn'],
            }[pr.falha] || ['CENTRALIZE O PALETE ENTRE AS COLUNAS DO MASTRO', 'info'];
            chip(msg[0], msg[1]);
        }
    }

    function mostrarCartao() {
        const card = document.getElementById('card');
        if (!card) return;
        const e = S.engate, d = S.deposito;

        const precEngate = Math.max(0, 100 * (1 - Math.max(
            e.lat / P.TOL_LAT, e.yawErr / P.TOL_YAW, e.forkErr / P.TOL_FORK)));
        // fração da lâmina dentro do bolso: ponta em 1,585, face do palete em depth-0,5
        const prof = Math.max(0, Math.min(1, (2.085 - e.depth) / 1.05));
        const precDep = Math.max(0, 100 * (1 - d.posErr / P.PLACE_TOL));

        const n = (v, d2 = 0) => v.toFixed(d2).replace('.', ',');
        card.querySelector('.card-rows').innerHTML = [
            ['Tempo', `${n(S.t, 1)} s`],
            ['Precisão de encaixe', `${n(precEngate)} / 100`],
            ['Profundidade da lâmina', `${n(prof * 100)} %`],
            ['Precisão de depósito', `${n(precDep)} / 100 · erro ${n(d.posErr * 100)} cm`],
            ['Colisões', `${S.colisoes}`],
            ['Pico de aceleração lateral', `${n(S.picoALat, 1)} m/s²`],
        ].map(([k, v]) => `<div class="cr"><span>${k}</span><b>${v}</b></div>`).join('');
        card.hidden = false;
    }

    return { begin, update, onCollision, state: S, VAGA, PALETE };
}
