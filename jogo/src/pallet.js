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
    // Garfos dentro dos bolsos, em coordenada local da empilhadeira. Z_MIN 0,92
    // é o limite geométrico: abaixo disso a face traseira do palete atravessa a
    // placa do carro. Z_MAX 1,90 é folgado de propósito — o engate é automático,
    // então a janela precisa abrir CEDO, antes de o jogador atravessar o palete.
    Z_MIN: 0.92,
    Z_MAX: 1.90,
    /* Meia-caixa do colisor do palete no chão. Menor que a AABB real (que a
       0,16 rad daria 0,67 × 0,59) de propósito: o ponto dianteiro do chassi tem
       raio 0,62, então com HD 0,52 o corpo trava a 1,14 m do centro do palete e
       a janela de encaixe [0,92 · 1,90] continua aberta de 1,14 a 1,90.
       Encostar TEM que ser possível sem impedir o engate — e o engate dispara
       antes do contato, então na prática o colisor só age em quem chega torto. */
    COL_HW: 0.62,
    COL_HD: 0.52,
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
const D2R60 = THREE.MathUtils.degToRad(60);

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
    /** Estado do encaixe com o palete mais próximo, incluindo POR QUE falhou.
     *  O motivo importa tanto quanto o resultado: sem ele a HUD só sabe dizer
     *  "não deu", e o jogador não descobre sozinho o que corrigir. */
    function probe() {
        if (carried) return { ok: false, falha: 'carregando' };

        // Correção de tilt: mastPivot.rotation.x = -tilt levanta a lâmina em
        // sin(tilt)·BLADE_MID — a 8° são 9,7 cm, 60% da tolerância vertical. Sem
        // isto o instrumento e a geometria discordam e o encaixe falha "sem motivo".
        const fy = forklift.state.forkY + Math.sin(forklift.state.tilt) * P.BLADE_MID;

        let melhor = null;
        for (const p of pallets) {
            if (p.userData.engaged || p.userData.placed) continue;
            p.getWorldPosition(_v);
            forklift.root.worldToLocal(_v);

            const alvoY = p.position.y + P.POCKET_Y;
            const c = {
                pallet: p,
                depth: _v.z,
                lat: Math.abs(_v.x),
                latSign: Math.sign(_v.x),
                forkErr: fy - alvoY,
                dist: Math.hypot(_v.x, _v.z),
            };
            let dyaw = p.rotation.y - forklift.state.yaw;
            dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
            // o palete tem simetria de 180°: entrar por qualquer face serve
            c.yawErr = Math.min(Math.abs(dyaw), Math.abs(Math.abs(dyaw) - Math.PI));

            if (!melhor || c.dist < melhor.dist) melhor = c;
        }
        if (!melhor) return { ok: false, falha: 'nenhum' };

        // A ordem dos testes É a ordem em que o jogador deve corrigir. Ângulo e
        // desvio vêm ANTES da profundidade quando já se está por perto: chegar
        // torto encurta a distância projetada, e sem isto a dica manda "recuar"
        // quando o problema real é estar atravessado.
        /* Lado errado ≠ torto. O palete só tem bolso nas duas faces LONGAS; as
           curtas são madeira maciça. Acima de 60° de erro o jogador não está
           torto, está atacando a lateral — e mandar "endireite" ali não diz o
           que fazer, porque não há como endireitar sem contornar o palete. */
        const porPerto = melhor.dist < 2.6;
        if (porPerto && melhor.yawErr > D2R60) return { ...melhor, ok: false, falha: 'lado' };
        if (porPerto && melhor.yawErr > P.TOL_YAW) return { ...melhor, ok: false, falha: 'angulo' };
        if (porPerto && melhor.lat > P.TOL_LAT) return { ...melhor, ok: false, falha: 'lateral' };
        if (melhor.depth < P.Z_MIN || melhor.depth > P.Z_MAX)
            return { ...melhor, ok: false, falha: melhor.depth > P.Z_MAX ? 'longe' : 'perto' };
        if (melhor.lat > P.TOL_LAT) return { ...melhor, ok: false, falha: 'lateral' };
        if (melhor.yawErr > P.TOL_YAW) return { ...melhor, ok: false, falha: 'angulo' };
        if (Math.abs(melhor.forkErr) > P.TOL_FORK)
            return { ...melhor, ok: false, falha: melhor.forkErr > 0 ? 'garfo_alto' : 'garfo_baixo' };

        return { ...melhor, ok: true, forkErr: Math.abs(melhor.forkErr) };
    }

    function candidate() {
        const r = probe();
        return r.ok ? r : null;
    }

    /* Colisores dos paletes que estão NO CHÃO. Sai da lista quem está no garfo
       (anda junto com a máquina, colidiria consigo mesma) e quem já foi
       depositado (está na prateleira, que já tem colisor próprio).
       Reaproveita o objeto por palete para não alocar por frame. */
    const _cols = [];
    function colisores() {
        _cols.length = 0;
        for (const p of pallets) {
            if (p.userData.engaged || p.userData.placed) continue;
            const c = p.userData.colisor
                || (p.userData.colisor = { x: 0, z: 0, hw: P.COL_HW, hd: P.COL_HD });
            c.x = p.position.x;
            c.z = p.position.z;
            _cols.push(c);
        }
        return _cols;
    }

    /** Por que a vaga não aceita a carga agora? Mesmos testes de canPlace(), mas
     *  dizendo QUAL falhou — sem isso a HUD só sabe repetir "ainda não". */
    function placeProbe() {
        if (!carried || !targetSlot) return { ok: false, falha: 'sem_carga' };
        carried.getWorldPosition(_v);
        const a = alvoDeMedida(targetSlot);
        const dxz = Math.hypot(_v.x - a.x, _v.z - a.z);
        const dy = _v.y - targetSlot.y;
        // NaN aqui virava ok:true silencioso — se a pose não for finita, não aceita
        if (!Number.isFinite(dxz) || !Number.isFinite(dy))
            return { ok: false, falha: 'indefinido', dxz, dy };
        if (Math.abs(dy) >= 0.65) return { ok: false, falha: dy > 0 ? 'alto' : 'baixo', dxz, dy };
        if (dxz >= P.PLACE_TOL) return { ok: false, falha: 'longe', dxz, dy };
        return { ok: true, dxz, dy };
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

        // Pose assentada, em coordenada local do carriage. y = -POCKET_Y porque a
        // barra do garfo fica DENTRO do bolso, que está a POCKET_Y acima da base
        // do palete — com y=0 o estrado flutuaria 7 cm e erguer não o tiraria do
        // chão de forma convincente.
        snap = {
            t: 0,
            from: { pos: p.position.clone(), quat: p.quaternion.clone() },
            to: { pos: new THREE.Vector3(0, -P.POCKET_Y, 0.74), quat: new THREE.Quaternion() },
        };
        return { lat: c.lat, yawErr: c.yawErr, forkErr: c.forkErr };
    }

    /* Ponto contra o qual a entrega é MEDIDA. Não é o centro da vaga: o chassi
       tem 0,62 m de raio dianteiro e o rack 0,55 m de meia-profundidade, então
       a carga no garfo nunca chega a menos de 41 cm do centro da vaga — é
       geometria, não perícia. Medir contra o centro dava nota 32/100 numa
       manobra perfeita, e 2/100 na minha corrida de teste; um comprador lendo
       isso conclui que reprovou. O assentamento visual continua indo até o
       centro da vaga, então nada disto aparece na tela — só na conta. */
    const alvoDeMedida = (slot) => slot.aim || slot;

    /** A vaga aceita o palete agora? Mesmo teste que `release()` usa para decidir
     *  — extraído para que a HUD e o gatilho não possam divergir dele. */
    function canPlace() {
        if (!carried || !targetSlot) return false;
        carried.getWorldPosition(_v);
        const a = alvoDeMedida(targetSlot);
        const d = Math.hypot(_v.x - a.x, _v.z - a.z);
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
            const a = alvoDeMedida(targetSlot);
            const d = Math.hypot(p.position.x - a.x, p.position.z - a.z);
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
        pallets, spawn, setTarget, probe, candidate, canPlace, placeProbe, colisores,
        engage, release, update,
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
