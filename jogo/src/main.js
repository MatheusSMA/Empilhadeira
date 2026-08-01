/* main.js — boot, loop e ligação com a HUD.
 *
 * Dev local: módulos ES exigem origem HTTP, `file://` não funciona.
 *   python -m http.server 8000     (na raiz do repo)  →  http://localhost:8000/jogo/
 */

import * as THREE from 'three';
import { createScene } from './scene.js';
import { createForklift } from './forklift.js';
import { buildWarehouse, resolveCollision, unstick } from './warehouse.js';
import { input } from './input.js';

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

/* ---------- estado do loop ---------- */
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let fps = 60;

function respawn() {
    forklift.reset(world.spawn.x, world.spawn.z, world.spawn.yaw);
    camera.snapTo(forklift.state);
    acc = 0;
}

input.init();
respawn();

/* ---------- HUD ---------- */
const el = {
    speed: document.getElementById('rSpeed'),
    fork: document.getElementById('rFork'),
};
let dbg;
if (DEBUG) {
    dbg = document.createElement('div');
    dbg.className = 'debug';
    document.querySelector('.hud').appendChild(dbg);
}

const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');
let hudAcc = 0;
function updateHud(dt) {
    hudAcc += dt;
    if (hudAcc < 0.1) return;   // 10 Hz basta e evita layout thrash
    hudAcc = 0;
    const s = forklift.state;
    el.speed.textContent = fmt(Math.abs(s.v) * 3.6);
    el.fork.textContent = fmt(s.forkY, 2);
    if (dbg) {
        dbg.textContent =
            `${fps.toFixed(0)} fps · ${renderer.info.render.calls} draws · tier ${quality.tier}\n` +
            `v ${fmt(s.v, 2)} · δ ${fmt(THREE.MathUtils.radToDeg(s.delta), 0)}° · ` +
            `ω ${fmt(s.omega, 2)} · aLat ${fmt(s.aLat, 1)} · ${input.source}`;
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

    if (input.pressed('retry')) respawn();

    // passo fixo: o feel tem que ser idêntico em 60 e 120 Hz
    const s = forklift.state;
    acc = Math.min(acc + dt, 0.2);
    while (acc >= STEP) {
        acc -= STEP;
        forklift.step(STEP, input.axes);
        const hit = resolveCollision(s, world.colliders);
        if (hit) {
            if (unstick(s, world.colliders)) camera.snapTo(s);   // rede de segurança
            // step() já escreveu no grafo; a colisão mexeu no estado depois dele
            forklift.root.position.set(s.x, 0, s.z);
            if (hit.speed > 0.9) camera.kick(hit.speed * 0.05);
        }
    }

    followSun(s);
    camera.update(dt, s);
    quality.step(dt);
    updateHud(dt);

    renderer.render(scene, camera.cam);
}
requestAnimationFrame(frame);
