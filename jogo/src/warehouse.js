/* warehouse.js — galpão procedural a partir de uma SPEC de dados.
 *
 * Regra: o gerador emite geometria E colisores juntos. Nunca derivar colisão do
 * grafo de cena — uma fonte, dois consumidores.
 */

import * as THREE from 'three';
import { COLOR } from './scene.js';

export const SPEC = {
    floor: { w: 46, d: 34 },
    // Corredores generosos de propósito: o comprador nunca pode ficar entalado.
    // A folga real de um CD é mais apertada, mas frustração aqui custa a venda.
    rows: [-14, -6, 6, 14],       // centro de cada par de racks (eixo Z)
    pairGap: 1.10,                // afastamento costas-com-costas
    bays: 10,
    bayW: 2.75,
    rackDepth: 1.10,
    levels: [0.12, 1.68, 3.18],   // altura das longarinas
    uprightH: 4.30,
    spawn: { x: 0, z: -1.5, yaw: 0 },
};

const MAT = {
    rack: new THREE.MeshStandardMaterial({ color: 0x9A5F1E, roughness: 0.62, metalness: 0.18 }),
    beam: new THREE.MeshStandardMaterial({ color: COLOR.hazard, roughness: 0.58, metalness: 0.12 }),
    crate: new THREE.MeshStandardMaterial({ color: 0xB99760, roughness: 0.88, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xD3CFC6, roughness: 0.96, side: THREE.BackSide }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xFFFDF2 }),
    paint: new THREE.MeshStandardMaterial({ color: COLOR.hazard, roughness: 0.8 }),
};

/* ---------- placas de rua: o texto que faz o galpão parar de ser genérico ---------- */
function signTexture(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#14181C';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#F0B208';
    g.fillRect(0, 0, 256, 4);
    g.font = '600 30px "IBM Plex Mono", monospace';
    g.fillStyle = '#F0B208';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.letterSpacing = '4px';
    g.fillText(text, 128, 36);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function buildWarehouse(scene) {
    const group = new THREE.Group();
    scene.add(group);

    const colliders = [];   // {x, z, hw, hd} em XZ
    const slots = [];       // alvos de depósito {id, x, y, z, yaw, label}

    const halfW = SPEC.floor.w / 2;
    const halfD = SPEC.floor.d / 2;
    const spanX = SPEC.bays * SPEC.bayW;
    const x0 = -spanX / 2;

    /* ---------- paredes e teto ---------- */
    // 9,4 de altura com centro em 4,5: a face inferior fica em y=-0,2, abaixo do
    // piso. Coincidir com y=0 daria z-fighting no chão inteiro.
    const shell = new THREE.Mesh(
        new THREE.BoxGeometry(SPEC.floor.w, 9.4, SPEC.floor.d),
        MAT.wall
    );
    shell.position.y = 4.5;
    shell.receiveShadow = true;
    group.add(shell);

    for (const [x, z] of [[-halfW, 0], [halfW, 0]]) {
        colliders.push({ x: x + Math.sign(x) * 0.6, z, hw: 0.6, hd: halfD });
    }
    for (const [x, z] of [[0, -halfD], [0, halfD]]) {
        colliders.push({ x, z: z + Math.sign(z) * 0.6, hw: halfW, hd: 0.6 });
    }

    // luminárias: emissivo fake, custo zero de luz
    for (let i = 0; i < 10; i++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.12, 0.5), MAT.lamp);
        l.position.set(((i % 5) - 2) * 8.5, 6.6, i < 5 ? -8 : 8);
        group.add(l);
    }

    /* ---------- racks instanciados ---------- */
    const rackZs = [];
    for (const rz of SPEC.rows) {
        rackZs.push(rz - SPEC.pairGap / 2, rz + SPEC.pairGap / 2);
    }

    const upG = new THREE.BoxGeometry(0.12, SPEC.uprightH, SPEC.rackDepth);
    const beamG = new THREE.BoxGeometry(SPEC.bayW - 0.12, 0.14, 0.09);
    const crateG = new THREE.BoxGeometry(1.05, 0.85, 1.00);

    const nUp = rackZs.length * (SPEC.bays + 1);
    const nBeam = rackZs.length * SPEC.bays * SPEC.levels.length * 2;

    const uprights = new THREE.InstancedMesh(upG, MAT.rack, nUp);
    const beams = new THREE.InstancedMesh(beamG, MAT.beam, nBeam);
    uprights.castShadow = beams.castShadow = true;
    uprights.receiveShadow = beams.receiveShadow = true;

    const m = new THREE.Matrix4();
    let iu = 0, ib = 0;
    const crates = [];

    rackZs.forEach((rz, ri) => {
        // face útil do rack = o lado voltado para o corredor
        const faceSign = ri % 2 === 0 ? -1 : 1;

        for (let b = 0; b <= SPEC.bays; b++) {
            m.makeTranslation(x0 + b * SPEC.bayW, SPEC.uprightH / 2, rz);
            uprights.setMatrixAt(iu++, m);
        }
        for (let b = 0; b < SPEC.bays; b++) {
            const cx = x0 + (b + 0.5) * SPEC.bayW;
            for (let li = 0; li < SPEC.levels.length; li++) {
                const y = SPEC.levels[li];
                for (const dz of [-SPEC.rackDepth / 2 + 0.05, SPEC.rackDepth / 2 - 0.05]) {
                    m.makeTranslation(cx, y, rz + dz);
                    beams.setMatrixAt(ib++, m);
                }
                // paletes de cenário: preenche a maioria, deixa vagas visíveis
                const filled = ((b * 7 + li * 3 + ri * 5) % 10) < 7;
                if (filled) {
                    crates.push([cx, y + 0.50, rz]);
                } else if (li <= 1) {
                    slots.push({
                        id: `R${String(ri + 1).padStart(2, '0')}-B${b + 1}-N${li + 1}`,
                        label: `RUA ${String(Math.floor(ri / 2) + 1).padStart(2, '0')} · NÍVEL ${li + 1}`,
                        x: cx, y: y + 0.10, z: rz + faceSign * 0.02,
                        yaw: faceSign < 0 ? Math.PI : 0,
                    });
                }
            }
        }

        colliders.push({ x: 0, z: rz, hw: spanX / 2 + 0.1, hd: SPEC.rackDepth / 2 });
    });

    uprights.count = iu;
    beams.count = ib;
    uprights.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
    group.add(uprights, beams);

    const cratesMesh = new THREE.InstancedMesh(crateG, MAT.crate, crates.length);
    cratesMesh.castShadow = cratesMesh.receiveShadow = true;
    crates.forEach(([x, y, z], i) => {
        m.makeTranslation(x, y, z);
        cratesMesh.setMatrixAt(i, m);
    });
    cratesMesh.instanceMatrix.needsUpdate = true;
    group.add(cratesMesh);

    /* ---------- pintura de piso: demarcação e placas de rua ----------
       Faixas como malha própria (não textura repetida) para alinhar de verdade
       com os racks — textura com repeat nunca casa com a geometria. */
    for (const rz of SPEC.rows) {
        for (const side of [-1, 1]) {
            const stripe = new THREE.Mesh(new THREE.PlaneGeometry(spanX, 0.12), MAT.paint);
            stripe.rotation.x = -Math.PI / 2;
            stripe.position.set(0, 0.015, rz + side * (SPEC.pairGap / 2 + SPEC.rackDepth / 2 + 0.75));
            group.add(stripe);
        }
    }

    SPEC.rows.forEach((rz, i) => {
        const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(2.4, 0.6),
            new THREE.MeshBasicMaterial({ map: signTexture(`RUA ${String(i + 1).padStart(2, '0')}`) })
        );
        sign.position.set(x0 - 1.6, 2.4, rz);
        sign.rotation.y = Math.PI / 2;
        group.add(sign);

        const sign2 = sign.clone();
        sign2.position.x = x0 + spanX + 1.6;
        sign2.rotation.y = -Math.PI / 2;
        group.add(sign2);
    });

    // faixa de pedestre hazard atravessando a área central
    for (let i = 0; i < 9; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 3.2), MAT.paint);
        s.rotation.x = -Math.PI / 2;
        s.position.set(x0 - 3.4, 0.015, -3.6 + i * 0.9);
        group.add(s);
    }

    return { group, colliders, slots, spawn: SPEC.spawn };
}

/* ---------- colisão: cápsulas do corpo × AABB em XZ ----------
   Três pontos ao longo do chassi, não um só: a origem fica no eixo dianteiro e o
   corpo se estende 1,9 m para trás — com um círculo só, dar ré numa prateleira
   atravessa a máquina. O raio dianteiro é folgado de propósito para os garfos
   entrarem no vão do rack.
   Empurra para fora pela menor sobreposição. Nunca é parede rígida: o jogador
   não pode ficar preso em hipótese nenhuma. */
const BODY = [
    { z: 0.00, r: 0.62 },   // eixo dianteiro
    { z: -0.75, r: 0.66 },   // meio do chassi
    { z: -1.60, r: 0.66 },   // contrapeso
];

/** Contato mais profundo entre o corpo e os colisores, ou null. */
function deepestContact(x, z, yaw, colliders, points) {
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    let best = null;

    for (const p of points) {
        const wx = x + p.z * sy;
        const wz = z + p.z * cy;
        for (const c of colliders) {
            const dx = wx - c.x;
            const dz = wz - c.z;
            const px = c.hw + p.r - Math.abs(dx);
            if (px <= 0) continue;
            const pz = c.hd + p.r - Math.abs(dz);
            if (pz <= 0) continue;

            const depth = Math.min(px, pz);
            if (best && depth <= best.depth) continue;
            best = px < pz
                ? { depth, ax: Math.sign(dx || 1) * px, az: 0 }
                : { depth, ax: 0, az: Math.sign(dz || 1) * pz };
        }
    }
    return best;
}

export function isOverlapping(state, colliders, points = BODY) {
    return !!deepestContact(state.x, state.z, state.yaw, colliders, points);
}

/** Resolve o contato MAIS PROFUNDO por iteração. Empurrar todos os pontos de uma
 *  vez faz o dianteiro e o traseiro brigarem quando o corpo escanteia um rack. */
export function resolveCollision(state, colliders, points = BODY) {
    let hit = null;
    for (let i = 0; i < 8; i++) {
        const c = deepestContact(state.x, state.z, state.yaw, colliders, points);
        if (!c) break;
        state.x += c.ax;
        state.z += c.az;
        if (!hit) { hit = { speed: Math.abs(state.v), depth: c.depth }; state.v *= 0.4; }
    }
    return hit;
}

/** Rede de segurança: se o corpo ficou sobreposto mesmo depois de resolver (só
 *  acontece se ele escanteia geometria fina), procura em espiral o ponto livre
 *  mais próximo e vai para lá. Termina sempre. Nunca ficar preso é regra dura —
 *  quem joga é o comprador, e um travamento na frente dele custa a venda. */
export function unstick(state, colliders, points = BODY) {
    if (!deepestContact(state.x, state.z, state.yaw, colliders, points)) return false;

    for (let r = 0.6; r <= 14; r += 0.6) {
        for (let a = 0; a < 24; a++) {
            const th = (a / 24) * Math.PI * 2;
            const x = state.x + Math.cos(th) * r;
            const z = state.z + Math.sin(th) * r;
            if (!deepestContact(x, z, state.yaw, colliders, points)) {
                state.x = x;
                state.z = z;
                state.v = 0;
                return true;
            }
        }
    }
    return false;
}
