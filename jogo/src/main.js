/* main.js — boot, loop e ligação.
 *
 * Dev local: módulos ES exigem origem HTTP, `file://` não funciona.
 *   python -m http.server 8000     (na raiz do repo)  →  http://localhost:8000/jogo/
 */

import * as THREE from 'three';
import { createScene } from './scene.js';
import { createForklift } from './forklift.js';
import { buildWarehouse, resolveCollision, unstick } from './warehouse.js';
import { createPalletSystem } from './pallet.js';
import { createMission } from './mission.js';
import { createHud } from './hud.js';
import { createApp } from './app.js';
import { input } from './input.js';
import { haptics } from './haptics.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

/* ---------- boot: falhar bonito é melhor que canvas preto ---------- */
let ctx;
try {
    ctx = createScene(document.getElementById('stage'));
} catch (err) {
    console.error(err);
    document.getElementById('nowebgl').hidden = false;
    document.getElementById('overlay').style.display = 'none';
    throw err;
}

const { renderer, scene, camera, quality, followSun } = ctx;

const world = buildWarehouse(scene);
const forklift = createForklift();
scene.add(forklift.root);

const palletSys = createPalletSystem({ scene, forklift });
const hud = createHud(document.querySelector('.hud'));
const mission = createMission({ scene, forklift, palletSys, hud, colisores: world.colliders });

/* ---------- estado do loop ---------- */
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let fps = 60;
const colisores = [];   // remontado por frame: galpão + paletes no chão

/** Ordem obrigatória: palletSys.reset() reparenteia o palete carregado de volta
 *  para a cena ANTES de removê-lo. Invertendo, ele fica pendurado no carriage e
 *  some do mundo. E camera.snapTo por último, porque zera estado que não vive
 *  dentro de forklift.reset(). */
function respawn() {
    palletSys.reset();
    forklift.reset(world.spawn.x, world.spawn.z, world.spawn.yaw);
    mission.begin();
    camera.snapTo(forklift.state);
    acc = 0;
}

input.init({
    look: (dx, dy, recenter) => {
        if (!emJogo) return;                 // o portal não dirige a câmera
        if (recenter) camera.recenterLook();
        else camera.look(dx, dy);
    },
});

/* ---------- portal ---------- */
let emJogo = false;

const app = createApp({
    onStart: () => {
        emJogo = true;
        respawn();
        camera.setShowcase(false);
        camera.playIntro();
        input.setEnabled(true);
    },
    onExit: () => {
        emJogo = false;
        camera.setShowcase(true);
        input.setEnabled(false);
    },
});

// A cena já está construída e quente: usá-la de fundo vivo do portal custa zero.
respawn();
camera.setShowcase(true);
input.setEnabled(false);
app.iniciar();

document.getElementById('btRepetir')?.addEventListener('click', () => {
    document.getElementById('card').hidden = true;
    respawn();
    camera.playIntro();
});
document.getElementById('btTrilha')?.addEventListener('click', () => {
    // ordem importa: a placa violeta (z 13) sobe por cima do cartão (z 12) e
    // da HUD, e é ela a animação de saída dos dois. Esconder o cartão antes
    // deixaria um buraco no meio da transição.
    app.voltarAoPortal();
    setTimeout(() => { document.getElementById('card').hidden = true; }, 220);
});

/* ---------- HUD ---------- */
const el = {
    speed: document.getElementById('rSpeed'),
    fork: document.getElementById('rFork'),
    box: document.querySelector('.readout'),
};
let dbg;
if (DEBUG) {
    dbg = document.createElement('div');
    dbg.className = 'debug';
    document.querySelector('.hud').appendChild(dbg);
    // Introspecção só com ?debug=1: sem isto não há como ver por que a missão
    // não avança, porque todo o estado vive em closure de módulo.
    window.__dbg = { forklift, palletSys, mission, world, camera, hud, get emJogo() { return emJogo; } };
}

const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');
let hudAcc = 0;
function updateReadout(dt) {
    hudAcc += dt;
    if (hudAcc < 0.1) return;   // 10 Hz basta e evita layout thrash
    hudAcc = 0;
    const s = forklift.state;
    const kmh = Math.abs(s.v) * 3.6;
    el.speed.textContent = fmt(kmh);
    el.fork.textContent = fmt(s.forkY, 2);
    // O amarelo hazard deixa de ser cor de base e vira ESTADO. Contra o piso de
    // concreto do galpão ele tem 1,48:1 de contraste — gasto no permanente, não
    // significava nada quando o estado ficava perigoso. Agora diz uma coisa só:
    // a máquina saiu do envelope de velocidade que o próprio chip cita.
    el.box.classList.toggle('is-limite', kmh > 6);
    if (dbg) {
        dbg.textContent =
            `${fps.toFixed(0)} fps · ${renderer.info.render.calls} draws · tier ${quality.tier}\n` +
            `v ${fmt(s.v, 2)} · δ ${fmt(THREE.MathUtils.radToDeg(s.delta), 0)}° · ` +
            `ω ${fmt(s.omega, 2)} · aLat ${fmt(s.aLat, 1)}\n` +
            `garfo ${fmt(s.forkY, 2)} · tilt ${fmt(THREE.MathUtils.radToDeg(s.tilt), 1)}° · ` +
            `cam ${camera.mode} · ${input.source} · ` +
            `vibra ${haptics.resumo()}\n` +
            `eixos drive ${fmt(input.axes.drive, 2)} steer ${fmt(input.axes.steer, 2)} ` +
            `fork ${fmt(input.axes.fork, 2)} · ${input.debugSources()}`;
    }
}

/* ---------- loop ---------- */
function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }

    // clamp anti-tunneling: voltar de outra aba não pode teleportar a máquina
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;

    input.beginFrame();

    if (emJogo) {
        if (input.pressed('retry')) { document.getElementById('card').hidden = true; respawn(); }
        if (input.pressed('cam')) camera.toggle();
        camera.setLookBack(input.held.back);
    }

    const s = forklift.state;

    // Colisores do frame = galpão + paletes no chão. O palete precisa parar a
    // máquina: sem colisor o jogador atravessava a carga, que é justamente o que
    // torna "chegar torto" indistinguível de "chegar certo".
    colisores.length = 0;
    for (const c of world.colliders) colisores.push(c);
    for (const c of palletSys.colisores()) colisores.push(c);

    // passo fixo: o feel tem que ser idêntico em 60 e 120 Hz
    acc = Math.min(acc + dt, 0.2);
    while (acc >= STEP) {
        acc -= STEP;
        forklift.step(STEP, input.axes);
        const hit = resolveCollision(s, colisores);
        if (hit) {
            // Em 1ª pessoa um salto em espiral é teleporte do ponto de vista —
            // gatilho clássico de desorientação. Corte em preto enjoa muito menos.
            if (unstick(s, colisores)) camera.blackout(140);
            forklift.root.position.set(s.x, 0, s.z);
            if (hit.speed > 0.9) { camera.kick(hit.speed * 0.05); mission.onCollision(hit); }
        }
    }

    // candidate() usa worldToLocal; step() escreve root.position sem atualizar a
    // matriz de mundo. Sem isto lê a pose do frame ANTERIOR — 5 cm a 3 m/s.
    forklift.root.updateMatrixWorld(true);

    if (emJogo) mission.update(dt, input);
    palletSys.update(dt);

    followSun(s);
    camera.update(dt, s, forklift.body);
    hud.update(dt, camera.cam);
    quality.step(dt);
    updateReadout(dt);

    renderer.render(scene, camera.cam);
}
requestAnimationFrame(frame);
