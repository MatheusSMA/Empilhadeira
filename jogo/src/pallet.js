/* pallet.js — palete PBR, detecção de encaixe, engate e depósito.
 *
 * A geometria não é enfeite: os bolsos ficam onde os garfos da empilhadeira
 * realmente passam (x = ±0,30), porque a detecção de encaixe é medida contra
 * essas mesmas coordenadas. Mudar o vão dos blocos sem mudar o garfo quebra o
 * engate de um jeito que não aparece na tela.
 */

import * as THREE from 'three';
import { COLOR } from './tokens.js';

export const P = {
    W: 1.20,          // largura (X)
    D: 1.00,          // profundidade (Z)
    H: 0.145,         // altura do estrado
    POCKET_Y: 0.072,  // centro do bolso — é a altura que o garfo tem que casar
    // Tolerâncias de encaixe. Generosas de propósito: quem joga é o comprador.
    TOL_LAT: 0.30,    // desalinhamento lateral máximo (m)
    TOL_YAW: THREE.MathUtils.degToRad(28),
    TOL_FORK: 0.16,   // erro de altura do garfo (m)
    // Garfos dentro dos bolsos, em coordenada local da empilhadeira. Z_MIN 1,00
    // e não 0,80: com 0,80 a face traseira do palete cai em z=0,30, atravessando
    // a placa do carro (z≈0,46) — engate com o palete dentro do mastro.
    Z_MIN: 1.00,
    Z_MAX: 1.55,
    BLADE_MID: 0.70,  // meio da lâmina em local do mastro — usado na correção de tilt
    SNAP_TIME: 0.22,
    PLACE_TOL: 0.60,  // raio de aceitação da vaga de depósito
};

const MAT = {
    wood: new THREE.MeshStandardMaterial({ color: 0xC49A63, roughness: 0.9, metalness: 0 }),
    block: new THREE.MeshStandardMaterial({ color: 0x9E7647, roughness: 0.92, metalness: 0 }),
    carton: new THREE.MeshStandardMaterial({ color: 0xC9A277, roughness: 0.88, metalness: 0 }),
    strap: new THREE.MeshStandardMaterial({ color: COLOR.signal, roughness: 0.6 }),
};
const OUTLINE = new THREE.LineBasicMaterial({ color: COLOR.ink, transparent: true, opacity: 0.5 });

function slab(w, h, d, mat, outline = false) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (outline) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), OUTLINE));
    return m;
}

/** Palete PBR com carga. Origem no CHÃO, no centro do estrado. */
export function createPallet({ label = 'SKU', kg = 0 } = {}) {
    const g = new THREE.Group();

    // tábuas do tabuleiro superior
    for (let i = 0; i < 5; i++) {
        const b = slab(P.W, 0.022, 0.155, MAT.wood);
        b.position.set(0, P.H - 0.011, -P.D / 2 + 0.078 + i * ((P.D - 0.155) / 4));
        g.add(b);
    }
    // tábuas inferiores
    for (const z of [-0.43, 0, 0.43]) {
        const b = slab(P.W, 0.022, 0.14, MAT.wood);
        b.position.set(0, 0.011, z);
        g.add(b);
    }
    // blocos — o vão entre eles É o bolso do garfo
    for (const x of [-0.52, 0, 0.52]) {
        for (const z of [-0.43, 0, 0.43]) {
            const b = slab(0.12, 0.10, 0.14, MAT.block);
            b.position.set(x, 0.072, z);
            g.add(b);
        }
    }

    // carga
    const load = slab(0.94, 0.78, 0.84, MAT.carton, true);
    load.position.set(0, P.H + 0.39, 0);
    g.add(load);
    for (const x of [-0.28, 0.28]) {
        const s = slab(0.035, 0.79, 0.86, MAT.strap);
        s.position.set(x, P.H + 0.39, 0);
        g.add(s);
    }

    g.userData = { isPallet: true, label, kg, engaged: false, placed: false };
    return g;
}

/* ---------- alvo de depósito ---------- */
export function createTarget() {
    const g = new THREE.Group();

    const box = new THREE.Box3(
        new THREE.Vector3(-P.W / 2, 0, -P.D / 2),
        new THREE.Vector3(P.W / 2, P.H + 0.85, P.D / 2)
    );
    const wire = new THREE.Box3Helper(box, new THREE.Color(COLOR.hazard));
    wire.material.transparent = true;
    wire.material.depthTest = false;
    g.add(wire);

    const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(P.W + 0.25, P.D + 0.25),
        new THREE.MeshBasicMaterial({
            color: COLOR.hazard, transparent: true, opacity: 0.22, depthWrite: false,
        })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.02;
    g.add(pad);

    g.userData.pulse = (t) => {
        const a = 0.55 + 0.45 * Math.sin(t * 3.4);
        wire.material.opacity = a;
        pad.material.opacity = 0.12 + 0.16 * a;
    };
    return g;
}

/* ---------- sistema ---------- */

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function createPalletSystem({ scene, forklift }) {
    const pallets = [];
    let carried = null;
    let snap = null;      // tween de assentamento em curso
    let clock = 0;

    const target = createTarget();
    target.visible = false;
    scene.add(target);
    let targetSlot = null;

    function spawn(x, z, yaw = 0, opts) {
        const p = createPallet(opts);
        p.position.set(x, 0, z);
        p.rotation.y = yaw;
        scene.add(p);
        pallets.push(p);
        return p;
    }

    function setTarget(slot) {
        targetSlot = slot;
        if (!slot) { target.visible = false; return; }
        target.position.set(slot.x, slot.y, slot.z);
        target.rotation.y = slot.yaw || 0;
        target.visible = true;
    }

    /** Palete alinhado para engate, ou null. Também devolve o quanto está torto —
     *  esse erro vira nota de precisão, então é medido ANTES de qualquer assistência. */
    function candidate() {
        if (carried) return null;
        // Correção de tilt: mastPivot.rotation.x = -tilt levanta a lâmina em
        // sin(tilt)·BLADE_MID — a 8° são 9,7 cm, 60% da tolerância vertical. Sem
        // isto o instrumento e a geometria discordam e o encaixe falha "sem motivo".
        const fy = forklift.state.forkY
            + Math.sin(forklift.state.tilt) * P.BLADE_MID;

        for (const p of pallets) {
            if (p.userData.engaged) continue;
            p.getWorldPosition(_v);
            forklift.root.worldToLocal(_v);

            if (_v.z < P.Z_MIN || _v.z > P.Z_MAX) continue;
            const lat = Math.abs(_v.x);
            if (lat > P.TOL_LAT) continue;

            let dyaw = p.rotation.y - forklift.state.yaw;
            dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
            // o palete tem simetria de 180°: entrar por qualquer face serve
            const yawErr = Math.min(Math.abs(dyaw), Math.abs(Math.abs(dyaw) - Math.PI));
            if (yawErr > P.TOL_YAW) continue;

            const forkErr = Math.abs(fy - (p.position.y + P.POCKET_Y));
            if (forkErr > P.TOL_FORK) continue;

            return { pallet: p, lat, yawErr, forkErr, depth: _v.z };
        }
        return null;
    }

    function engage(c) {
        const p = c.pallet;
        // Sem isto o Three usa a matriz do frame ANTERIOR e o palete pula ao engatar.
        forklift.root.updateWorldMatrix(true, true);
        p.updateWorldMatrix(true, false);

        forklift.carriage.attach(p);
        p.userData.engaged = true;
        carried = p;
        forklift.state.loaded = true;

        // pose assentada, em coordenada local do carriage
        snap = {
            t: 0,
            from: { pos: p.position.clone(), quat: p.quaternion.clone() },
            to: { pos: new THREE.Vector3(0, -0.02, 0.74), quat: new THREE.Quaternion() },
        };
        return { lat: c.lat, yawErr: c.yawErr, forkErr: c.forkErr };
    }

    /** A vaga aceita o palete agora? Mesmo teste que `release()` usa para decidir
     *  — extraído para que a HUD e o gatilho não possam divergir dele. */
    function canPlace() {
        if (!carried || !targetSlot) return false;
        carried.getWorldPosition(_v);
        const d = Math.hypot(_v.x - targetSlot.x, _v.z - targetSlot.z);
        return d < P.PLACE_TOL && Math.abs(_v.y - targetSlot.y) < 0.65;
    }

    function release() {
        if (!carried) return null;
        const p = carried;

        forklift.carriage.updateWorldMatrix(true, true);
        scene.attach(p);
        p.userData.engaged = false;
        carried = null;
        snap = null;
        forklift.state.loaded = false;

        // aceita a vaga se estiver perto o bastante — o erro real ainda é medido
        let res = { slot: null, posErr: null };
        if (targetSlot) {
            const d = Math.hypot(p.position.x - targetSlot.x, p.position.z - targetSlot.z);
            if (d < P.PLACE_TOL && Math.abs(p.position.y - targetSlot.y) < 0.65) {
                res = { slot: targetSlot, posErr: d };
                snap = {
                    t: 0, obj: p,
                    from: { pos: p.position.clone(), quat: p.quaternion.clone() },
                    to: {
                        pos: new THREE.Vector3(targetSlot.x, targetSlot.y, targetSlot.z),
                        quat: new THREE.Quaternion().setFromEuler(
                            new THREE.Euler(0, targetSlot.yaw || 0, 0)),
                    },
                };
                p.userData.placed = true;
                setTarget(null);
                return res;
            }
        }
        // fora do alvo: pousa no chão, sem drama. Nunca punir.
        snap = {
            t: 0, obj: p,
            from: { pos: p.position.clone(), quat: p.quaternion.clone() },
            to: {
                pos: new THREE.Vector3(p.position.x, 0, p.position.z),
                quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotation.y, 0)),
            },
        };
        return res;
    }

    function update(dt) {
        clock += dt;
        if (target.visible) target.userData.pulse(clock);

        if (snap) {
            snap.t = Math.min(1, snap.t + dt / P.SNAP_TIME);
            const k = 1 - Math.pow(1 - snap.t, 3);         // easeOutCubic
            const obj = snap.obj || carried;
            if (obj) {
                obj.position.lerpVectors(snap.from.pos, snap.to.pos, k);
                obj.quaternion.slerpQuaternions(snap.from.quat, snap.to.quat, k);
            }
            if (snap.t >= 1) snap = null;
        }
    }

    return {
        pallets, spawn, setTarget, candidate, canPlace, engage, release, update,
        get carried() { return carried; },
        get targetSlot() { return targetSlot; },
        reset() {
            if (carried) release();
            for (const p of pallets) scene.remove(p);
            pallets.length = 0;
            setTarget(null);
            snap = null;
        },
    };
}
