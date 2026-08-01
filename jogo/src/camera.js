/* camera.js — rig de câmera: cabine (padrão), perseguição (escape) e abertura.
 *
 * A descoberta que define este arquivo: com o olho no assento e a câmera
 * nivelada, as pontas dos garfos ficam a 32,6° abaixo do horizonte, contra uma
 * meia-abertura vertical de 27,5°. Os garfos ficam FORA DA TELA — o jogador
 * dirigiria sem ver a ferramenta com que precisa trabalhar. Todo o desenho aqui
 * existe para resolver isso sem virar câmera de videogame.
 *
 * Duas regras duras:
 *  - `rotation.order = 'YXZ'`. Na ordem padrão 'XYZ', yaw e pitch simultâneos
 *    injetam roll parasita.
 *  - NUNCA `cam.lookAt()` no modo cabine: ele reconstrói a orientação a partir
 *    do +Y do mundo e zera o roll em silêncio.
 */

import * as THREE from 'three';
import { EYE, TIP_Z, K } from './forklift.js';

const D2R = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;

/* FOV travado no HORIZONTAL. O three.js usa FOV vertical: travar nele e testar
 * só no notebook quebra a demo justamente no aparelho em que o comprador abre.
 * 92° horizontais → 60,4°v no desktop 16:9, 55°v (clamp) no celular deitado. */
const HALF_H = D2R(46);
const VFOV_MIN = D2R(55);
const VFOV_MAX = D2R(66);

const NDC_ALVO = 0.62;   // ponta do garfo a ~81% da altura da tela

function vfovFor(aspect) {
    return clamp(2 * Math.atan(Math.tan(HALF_H) / aspect), VFOV_MIN, VFOV_MAX);
}

const shortest = a => Math.atan2(Math.sin(a), Math.cos(a));
const expK = (rate, dt) => 1 - Math.exp(-rate * dt);

export function createCameraRig(aspect) {
    const cam = new THREE.PerspectiveCamera(60, aspect, 0.08, 120);
    cam.rotation.order = 'YXZ';

    let vfov = vfovFor(aspect);
    cam.fov = THREE.MathUtils.radToDeg(vfov);
    cam.updateProjectionMatrix();

    const S = {
        mode: 'cabine',        // 'cabine' | 'chase'
        mix: 0,                // 0 = cabine, 1 = chase
        mixTarget: 0,
        intro: 0,              // 1 → 0 durante a abertura
        pitchDown: 0,
        lookYaw: 0, lookPitch: 0,
        lookYawTarget: 0, lookPitchTarget: 0,
        autoBack: 0, backHold: 0, manualLookT: 0,
        bobPhase: 0, bobY: 0,
        kick: 0, shakeT: 0,
        vig: 0,
        lagYaw: 0,
        chasePos: new THREE.Vector3(),
        chaseYaw: 0,
    };

    const vig = document.getElementById('vig');
    const fade = document.getElementById('fade');
    let fadeT = 0, fadeDur = 0;

    const _p = new THREE.Vector3();
    const _p2 = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _q2 = new THREE.Quaternion();
    const _e = new THREE.Euler(0, 0, 0, 'YXZ');

    /* ---------- solver da cabine ---------- */
    function solveCabine(st, body, dt, out) {
        // Pitch DERIVADO da geometria: mantém a ponta do garfo sempre em ~81% da
        // altura da tela, seja qual for o FOV e a altura do garfo. Uma fórmula
        // substitui três regras (repouso, trabalho, "o pescoço segue a carga").
        const dep = Math.atan2(EYE.y - st.forkY, TIP_Z - EYE.z);
        const kk = Math.atan(NDC_ALVO * Math.tan(vfov / 2));
        let want = clamp(dep - kk, D2R(-8), D2R(20));

        // taxa de pitch é vetor de enjoo: suaviza E limita a 25°/s
        const rate = D2R(25) * dt;
        const step = (want - S.pitchDown) * expK(6, dt);
        S.pitchDown += clamp(step, -rate, rate);

        // olhar automático por cima do ombro na ré — substitui espelho e minimapa,
        // e é o gesto real do operador
        const querBack = st.v < -0.15;
        S.backHold = querBack ? S.backHold + dt : 0;
        const autoOn = (S.backHold > 0.25 || S.lookHeld) && S.manualLookT <= 0;
        S.autoBack += ((autoOn ? 1 : 0) - S.autoBack) * expK(4.5, dt);

        S.lookYaw += (S.lookYawTarget - S.lookYaw) * expK(9, dt);
        S.lookPitch += (S.lookPitchTarget - S.lookPitch) * expK(9, dt);
        if (S.manualLookT > 0) S.manualLookT -= dt;

        const backYaw = -2.62 * S.autoBack;   // -150°, ombro direito

        // bob só VERTICAL, por distância, ≤14 mm. Zero lateral, zero rotacional:
        // qualquer componente de rotação aqui é cinetose de graça.
        S.bobPhase += Math.abs(st.v) * dt * 3.1;
        const amp = Math.min(Math.abs(st.v) / K.VMAX, 1) * 0.014;
        S.bobY += (Math.sin(S.bobPhase) * amp - S.bobY) * expK(12, dt);
        const idle = Math.sin(performance.now() * 0.011) * 0.0016;   // tremor de motor

        const yaw = st.yaw + Math.PI + S.lookYaw + backYaw;   // +π: frente local é +Z
        const pitch = -S.pitchDown + S.lookPitch;
        const roll = body.rotation.z * 0.35;                  // fração, não cópia

        _e.set(pitch, yaw, roll);
        out.quat.setFromEuler(_e);

        const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
        out.pos.set(
            st.x + EYE.x * cy + EYE.z * sy,
            EYE.y + S.bobY + idle + S.kick,
            st.z - EYE.x * sy + EYE.z * cy
        );
        out.fov = vfov;
    }

    /* ---------- solver de perseguição (escape e abertura) ---------- */
    function solveChase(st, dt, out) {
        S.chaseYaw += shortest(st.yaw - S.chaseYaw) * expK(3.0, dt);
        const f = _p2.set(Math.sin(S.chaseYaw), 0, Math.cos(S.chaseYaw));
        _p.set(st.x, 2.7, st.z).addScaledVector(f, -5.6);
        S.chasePos.lerp(_p, expK(6, dt));
        out.pos.copy(S.chasePos);

        const look = _p.set(st.x, 1.05, st.z)
            .addScaledVector(_p2.set(Math.sin(st.yaw), 0, Math.cos(st.yaw)), 3.4);
        const m = new THREE.Matrix4().lookAt(out.pos, look, THREE.Object3D.DEFAULT_UP);
        out.quat.setFromRotationMatrix(m);
        out.fov = clamp(vfov * 0.92, VFOV_MIN, VFOV_MAX);
    }

    /* ---------- abertura: 3/4 dianteiro-esquerdo, em piso livre ----------
       Não reusar a pose do chase: a 5,6 m atrás do spawn (z=-1,5) a câmera cairia
       em z=-7,1, dentro da face do rack em z=-6,55 — o plano de abertura seria
       através de uma prateleira. */
    function solveIntro(st, out) {
        const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw);
        const lx = 3.6, ly = 2.3, lz = 1.4;
        out.pos.set(st.x + lx * cy + lz * sy, ly, st.z - lx * sy + lz * cy);
        const look = _p.set(st.x, 1.10, st.z)
            .addScaledVector(_p2.set(sy, 0, cy), 0.2);
        const m = new THREE.Matrix4().lookAt(out.pos, look, THREE.Object3D.DEFAULT_UP);
        out.quat.setFromRotationMatrix(m);
        out.fov = D2R(44);
    }

    const A = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: vfov };
    const B = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: vfov };

    function apply(st, body, dt) {
        solveCabine(st, body, dt, A);

        let pos = A.pos, quat = A.quat, fov = A.fov;

        if (S.intro > 0) {
            solveIntro(st, B);
            const t = S.intro > 0.62 ? 1 : (S.intro / 0.62);
            const k = 1 - Math.pow(1 - (1 - t), 3);
            _p.lerpVectors(A.pos, B.pos, t);
            _q.slerpQuaternions(A.quat, B.quat, t);
            pos = _p; quat = _q; fov = A.fov + (B.fov - A.fov) * t;
        } else if (S.mix > 0.001) {
            solveChase(st, dt, B);
            _p.lerpVectors(A.pos, B.pos, S.mix);
            _q.slerpQuaternions(A.quat, B.quat, S.mix);
            pos = _p; quat = _q; fov = A.fov + (B.fov - A.fov) * S.mix;
        }

        cam.position.copy(pos);
        if (S.shakeT > 0) {
            const a = S.shakeT * 0.06;
            cam.position.x += (Math.random() - 0.5) * a;
            cam.position.y += (Math.random() - 0.5) * a;
            S.shakeT = Math.max(0, S.shakeT - dt * 3);
        }
        cam.quaternion.copy(quat);

        const fovDeg = THREE.MathUtils.radToDeg(fov);
        if (Math.abs(cam.fov - fovDeg) > 0.02) {
            cam.fov = fovDeg;
            cam.updateProjectionMatrix();
        }
    }

    return {
        cam,
        get mode() { return S.mix > 0.5 ? 'chase' : 'cabine'; },

        setViewport(w, h) {
            const a = w / h;
            cam.aspect = a;
            vfov = vfovFor(a);
            cam.fov = THREE.MathUtils.radToDeg(vfov);
            cam.updateProjectionMatrix();
        },

        /** Arrasto/mouse para olhar em volta. dx/dy em fração de tela. */
        look(dx, dy) {
            S.lookYawTarget = clamp(S.lookYawTarget - dx * 2.4, -2.7, 2.7);
            S.lookPitchTarget = clamp(S.lookPitchTarget - dy * 1.6, D2R(-38), D2R(30));
            S.manualLookT = 1.5;
        },
        recenterLook() { S.lookYawTarget = 0; S.lookPitchTarget = 0; },
        setLookBack(v) { S.lookHeld = !!v; },

        toggle() { S.mixTarget = S.mixTarget > 0.5 ? 0 : 1; },
        kick(a) { S.shakeT = Math.min(1, S.shakeT + a); },

        blackout(ms = 140) { fadeT = 1; fadeDur = ms / 1000; },

        playIntro() { S.intro = 1; },
        skipIntro() { if (S.intro > 0) S.intro = Math.min(S.intro, 0.6); },

        /** Zera TUDO que vive fora de forklift.reset(): sem isto a máquina renasce
         *  com a cabeça torta e a câmera dá um giro fantasma — parece bug de física. */
        snapTo(st) {
            S.mix = S.mixTarget = 0;
            S.intro = 0;
            S.lookYaw = S.lookPitch = S.lookYawTarget = S.lookPitchTarget = 0;
            S.autoBack = S.backHold = S.manualLookT = 0;
            S.bobPhase = S.bobY = S.kick = S.shakeT = 0;
            S.lagYaw = st.yaw;
            S.chaseYaw = st.yaw;
            S.chasePos.set(
                st.x - Math.sin(st.yaw) * 5.6, 2.7, st.z - Math.cos(st.yaw) * 5.6);
            const dep = Math.atan2(EYE.y - st.forkY, TIP_Z - EYE.z);
            S.pitchDown = clamp(dep - Math.atan(NDC_ALVO * Math.tan(vfov / 2)), D2R(-8), D2R(20));
            S.vig = 0;
            if (vig) vig.style.opacity = '0';
            apply(st, { rotation: { z: 0 } }, 1 / 60);
        },

        update(dt, st, body) {
            if (S.intro > 0) S.intro = Math.max(0, S.intro - dt / 2.6);
            S.mix += (S.mixTarget - S.mix) * expK(4.2, dt);

            apply(st, body || { rotation: { z: 0 } }, dt);

            // vinheta ligada à guinada: assimétrica de propósito — fechar rápido,
            // abrir devagar. Simétrico pisca e irrita.
            if (vig) {
                const alvo = clamp(Math.abs(st.omega) / 1.25, 0, 1) * 0.55 * (1 - S.mix);
                const tau = alvo > S.vig ? 0.18 : 0.35;
                S.vig += (alvo - S.vig) * expK(1 / tau, dt);
                vig.style.opacity = S.vig.toFixed(3);
            }
            if (fade && fadeT > 0) {
                fadeT = Math.max(0, fadeT - dt / fadeDur);
                fade.style.opacity = fadeT.toFixed(3);
            }
        },
    };
}
