/* main.js — boot, loop e ligação com a HUD.
 *
 * Dev local: módulos ES exigem origem HTTP, `file://` não funciona.
 *   python -m http.server 8000     (na raiz do repo)  →  http://localhost:8000/jogo/
 */

import * as THREE from 'three';
import { createScene, COLOR } from './scene.js';
import { createForklift } from './forklift.js';
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

const forklift = createForklift();
scene.add(forklift.root);
forklift.reset(0, -6, 0);
camera.snapTo(forklift.state);

input.init();

/* ---------- TEMPORÁRIO: referências de escala e velocidade.
   Substituído pelo galpão procedural em warehouse.js (fatia 4). ---------- */
(function tempProps() {
    const crate = new THREE.MeshStandardMaterial({ color: 0xB99760, roughness: 0.85 });
    const geo = new THREE.BoxGeometry(1.1, 0.9, 1.1);
    const edges = new THREE.EdgesGeometry(geo, 30);
    const om = new THREE.LineBasicMaterial({ color: COLOR.ink, transparent: true, opacity: 0.45 });

    for (let i = 0; i < 22; i++) {
        const m = new THREE.Mesh(geo, crate);
        const a = (i / 22) * Math.PI * 2;
        const r = 9 + (i % 4) * 5.5;
        m.position.set(Math.cos(a) * r, 0.45, Math.sin(a) * r);
        m.rotation.y = a;
        m.castShadow = true;
        m.receiveShadow = true;
        m.add(new THREE.LineSegments(edges, om));
        scene.add(m);
    }
})();

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
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let fps = 60;

function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }

    // clamp anti-tunneling: voltar de outra aba não pode teleportar a máquina
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;

    input.beginFrame();

    if (input.pressed('retry')) {
        forklift.reset(0, -6, 0);
        camera.snapTo(forklift.state);
        acc = 0;
    }

    // passo fixo: o feel tem que ser idêntico em 60 e 120 Hz
    acc = Math.min(acc + dt, 0.2);
    while (acc >= STEP) {
        forklift.step(STEP, input.axes);
        acc -= STEP;
    }

    // limite suave do piso temporário — nunca prender, só desacelerar
    const s = forklift.state;
    const lim = 62;
    if (Math.abs(s.x) > lim || Math.abs(s.z) > lim) {
        s.x = THREE.MathUtils.clamp(s.x, -lim, lim);
        s.z = THREE.MathUtils.clamp(s.z, -lim, lim);
        s.v *= 0.4;
    }

    followSun(s);
    camera.update(dt, s);
    quality.step(dt);
    updateHud(dt);

    renderer.render(scene, camera.cam);
}
requestAnimationFrame(frame);
