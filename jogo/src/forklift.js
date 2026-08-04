/* forklift.js — modelo, cinemática de esterço traseiro, mastro e garfos.
 *
 * Convenção: origem NO CHÃO, NO CENTRO DO EIXO DIANTEIRO. Local +Z = frente.
 * Essa escolha é o plano inteiro: o centro instantâneo de rotação de uma
 * empilhadeira fica sobre a linha do eixo dianteiro, então integrando esse ponto
 * e pendurando o corpo atrás dele, a varredura da traseira sai correta de graça.
 */

import * as THREE from 'three';
import { COLOR } from './tokens.js';

/* ---------- constantes de dirigibilidade (é aqui que se itera o feel) ---------- */
export const K = {
    L: 1.30,                    // entre-eixos (m)
    DMAX: THREE.MathUtils.degToRad(78),  // esterço máximo — tan(78°)=4.7, raio minúsculo como na real
    SERVO: THREE.MathUtils.degToRad(140), // velocidade do servo de esterço (rad/s)
    // Teto anti-enjoo. O pico real da curva de esterço é ω = (v/L)·tan(δ(v)),
    // máximo em v≈1,5 m/s → 1,372 rad/s (78,6°/s). Clampar em 1,25 corta 9% do
    // pico e não toca no pivô parado (0,73 rad/s a 0,3 m/s) — o "bico fino" que
    // vende continua, some só o pedaço que embrulha o estômago em 1ª pessoa.
    OMEGA_MAX: 1.25,
    STEER_FALLOFF: 0.72,        // quanto o esterço fecha com a velocidade — ver nota em step()
    // 2,2 m/s = 7,9 km/h vazio. Antes eram 3,0 (10,8 km/h) e em primeira pessoa
    // isso fica rápido demais: o jogador chega no palete antes de ler a cena.
    // Operação real de CD anda nessa faixa mesmo. Baixar a velocidade também
    // derruba ω e aLat, então some junto o resto do enjoo de curva.
    VMAX: 2.2,                  // m/s vazio
    VMAX_LOAD: 1.6,             // m/s com carga
    VREV: -1.0,
    ACCEL: 2.0,
    BRAKE: 4.2,
    DRAG: 0.8,
    FORK_MIN: 0.05,             // = altura da barra do garfo no mundo (ver mastPivot)
    // Altura máxima de trânsito. Acima disso a máquina só rasteja: trafegar com
    // o garfo alto é item real de NR-11 e some do relatório se o jogo permitir.
    // Rastejo em vez de trava dura porque travar impediria o ajuste fino na
    // prateleira — e travar o jogador é a única coisa que não se pode fazer.
    FORK_TRANSITO: 0.55,
    V_GARFO_ALTO: 0.35,
    FORK_MAX: 3.20,
    FORK_SPEED: 0.9,
    TILT_MIN: THREE.MathUtils.degToRad(-3),
    TILT_MAX: THREE.MathUtils.degToRad(8),
    TILT_SPEED: THREE.MathUtils.degToRad(9),
    // Limiares de quase-acidente (m/s²). RECALIBRAR SEMPRE que VMAX mudar: são
    // uma fração do pico alcançável pela curva de esterço, e um limiar acima do
    // pico nunca dispara — o contador morre em silêncio e ninguém percebe.
    // Com VMAX 2,2 / 1,6 o pico medido é 1,57 vazio e 0,83 com carga.
    ALAT_WARN: 1.35,
    ALAT_WARN_LOAD: 0.70,
};

/* Fonte única da calibração da cabine. A câmera em 1ª pessoa deriva o pitch
 * destes dois números — se o modelo mudar, mude aqui e o resto acompanha.
 * Olho: 0,67 m acima do topo do assento (y=1,03), com 0,57 m de folga até o
 * teto (face inferior em 2,27), logo à frente da almofada.
 * TIP_Z: garfo horizontal é box(…, 1.05) em carriage-local z=0,70 → 1,225, mais
 * mastPivot.z = 0,36 → 1,585. Conferido contra a geometria real. */
export const EYE = { x: 0, y: 1.70, z: -1.00 };
export const TIP_Z = 1.585;

const MAT = {
    hazard: new THREE.MeshStandardMaterial({ color: COLOR.hazard, roughness: 0.55, metalness: 0.10 }),
    steel: new THREE.MeshStandardMaterial({ color: COLOR.steel, roughness: 0.35, metalness: 0.65 }),
    tyre: new THREE.MeshStandardMaterial({ color: COLOR.ink, roughness: 0.95, metalness: 0 }),
    fork: new THREE.MeshStandardMaterial({ color: 0x8A939B, roughness: 0.25, metalness: 0.80 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x23282E, roughness: 0.85, metalness: 0 }),
};
const OUTLINE = new THREE.LineBasicMaterial({ color: COLOR.ink, transparent: true, opacity: 0.55 });

/** Caixa com contorno técnico — o look de ilustração de manual que amarra o jogo à proposta. */
function box(w, h, d, mat, { outline = true, cast = true } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    if (outline) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), OUTLINE));
    return m;
}

function at(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

/** O CylinderGeometry tem eixo em Y. Girar e deitar no MESMO objeto embaralha a
 *  ordem de Euler e a roda "gambia" — por isso o pivô é sempre um grupo à parte. */
function wheel(radius, width) {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18), MAT.tyre);
    m.rotation.z = Math.PI / 2;
    m.castShadow = true;
    pivot.add(m);
    // marca para o giro ser visível
    const mark = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.01, radius * 0.16, radius * 1.1),
        MAT.steel
    );
    mark.rotation.z = Math.PI / 2;
    pivot.add(mark);
    return pivot;
}

export function createForklift() {
    const root = new THREE.Group();

    // body existe só para roll/pitch cosméticos, sem afetar a cinemática
    const body = new THREE.Group();
    root.add(body);

    body.add(at(box(1.10, 0.50, 1.90, MAT.hazard), 0, 0.54, -0.62));
    body.add(at(box(1.06, 0.62, 0.55, MAT.steel), 0, 0.62, -1.62));
    body.add(at(box(0.94, 0.34, 0.62, MAT.hazard), 0, 0.96, -1.18));   // capô
    body.add(at(box(0.52, 0.46, 0.10, MAT.seat), 0, 1.20, -1.34));     // encosto
    body.add(at(box(0.54, 0.10, 0.48, MAT.seat), 0, 0.98, -1.05));     // assento

    const wheelCol = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8), MAT.steel);
    wheelCol.position.set(0, 1.12, -0.72);
    wheelCol.rotation.x = -0.35;
    body.add(wheelCol);
    const volante = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 20), MAT.seat);
    volante.position.set(0, 1.28, -0.66);
    volante.rotation.x = Math.PI / 2 - 0.35;
    body.add(volante);

    // protetor de cabine
    for (const [x, z] of [[0.46, -0.42], [-0.46, -0.42], [0.46, -1.62], [-0.46, -1.62]]) {
        body.add(at(box(0.06, 1.30, 0.06, MAT.steel, { outline: false }), x, 1.62, z));
    }
    body.add(at(box(1.04, 0.06, 1.30, MAT.steel), 0, 2.30, -1.02));

    /* ---------- mastro ---------- */
    // y = 0,04 não é arbitrário: com o garfo em carriage-local y=0,02 e
    // carriage.position.y = forkY - FORK_MIN, isso faz a barra do garfo ficar
    // exatamente na altura `forkY` em coordenada de mundo. Sem essa calibração a
    // detecção de encaixe erra por 8 cm — invisível na tela, fatal no teste.
    const mastPivot = new THREE.Group();
    mastPivot.position.set(0, 0.03, 0.36);
    body.add(mastPivot);

    mastPivot.add(at(box(0.09, 3.20, 0.14, MAT.steel), 0.42, 1.60, 0));
    mastPivot.add(at(box(0.09, 3.20, 0.14, MAT.steel), -0.42, 1.60, 0));
    mastPivot.add(at(box(0.98, 0.10, 0.14, MAT.steel), 0, 3.16, 0));

    const carriage = new THREE.Group();
    mastPivot.add(carriage);
    carriage.add(at(box(1.00, 0.55, 0.06, MAT.steel), 0, 0.28, 0.10));
    for (const sx of [0.30, -0.30]) {
        carriage.add(at(box(0.12, 0.42, 0.05, MAT.fork), sx, 0.21, 0.16));   // vertical do L
        carriage.add(at(box(0.12, 0.05, 1.05, MAT.fork), sx, 0.02, 0.70));   // horizontal do L
    }
    const attachPoint = new THREE.Object3D();
    attachPoint.position.set(0, 0.05, 0.78);
    carriage.add(attachPoint);

    /* ---------- rodas ---------- */
    const wFL = wheel(0.28, 0.20); wFL.position.set(0.48, 0.28, 0);
    const wFR = wheel(0.28, 0.20); wFR.position.set(-0.48, 0.28, 0);
    body.add(wFL, wFR);

    const steerPivot = new THREE.Group();
    steerPivot.position.set(0, 0.24, -K.L);
    body.add(steerPivot);
    const wR = wheel(0.24, 0.18);
    steerPivot.add(wR);

    /* ---------- sombra de contato: ancora ao chão melhor que sombra dinâmica ---------- */
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const sg = sc.getContext('2d');
    const grad = sg.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(20,24,28,.5)');
    grad.addColorStop(1, 'rgba(20,24,28,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 128, 128);
    const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(2.0, 3.0),
        new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false,
        })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, 0.012, -0.7);
    root.add(contact);

    /* ---------- estado ---------- */
    const S = {
        x: 0, z: 0, yaw: 0,
        v: 0, delta: 0, omega: 0, aLat: 0,
        forkY: K.FORK_MIN, tilt: 0,
        loaded: false,
        garfoAlto: false,
        get speed() { return S.v; },
    };

    function step(dt, axes) {
        S.garfoAlto = S.forkY > K.FORK_TRANSITO;
        const vmax = S.garfoAlto ? K.V_GARFO_ALTO : (S.loaded ? K.VMAX_LOAD : K.VMAX);

        // --- tração ---
        const th = axes.drive;
        if (th > 0.01) S.v += K.ACCEL * (S.loaded ? 0.8 : 1) * th * dt;
        else if (th < -0.01) S.v += K.ACCEL * 0.85 * th * dt;
        else S.v -= Math.sign(S.v) * Math.min(Math.abs(S.v), K.DRAG * dt);
        // freio ativo ao inverter o comando
        if (th * S.v < -0.01) S.v -= Math.sign(S.v) * Math.min(Math.abs(S.v), K.BRAKE * dt);
        S.v = THREE.MathUtils.clamp(S.v, S.garfoAlto ? -K.V_GARFO_ALTO : K.VREV, vmax);

        // --- esterço traseiro ---
        // s = +1 significa "quero ir para a esquerda". `delta` é interno e já
        // absorveu a inversão do mecanismo; a roda visual recebe -delta.
        // Esterço sensível à velocidade. Parado, δ chega aos 78° e o raio fica em
        // ~1,85 m — bico fino, é o momento "uau". A toda, fecha para ~22°: sem isso
        // a máquina vira pião a 10 km/h e embrulha o estômago de quem só quer ver a demo.
        const sf = 1 - K.STEER_FALLOFF * Math.min(Math.abs(S.v) / vmax, 1);

        // Na ré a fórmula inverte sozinha: analógico à direita fazia o nariz —
        // e portanto a vista inteira — girar para a esquerda. É o comportamento
        // mecânico correto do esterço traseiro, mas como se dirige olhando para
        // frente, lê como controle quebrado. Playtest derrubou a fidelidade:
        // o comando do jogador é negado na ré para que a vista sempre gire para
        // o lado do polegar.
        const sJogador = axes.steer * (S.v < -0.05 ? -1 : 1);
        const dTarget = sJogador * K.DMAX * sf;
        const dMax = K.SERVO * dt;
        S.delta += THREE.MathUtils.clamp(dTarget - S.delta, -dMax, dMax);

        S.omega = THREE.MathUtils.clamp((S.v / K.L) * Math.tan(S.delta), -K.OMEGA_MAX, K.OMEGA_MAX);
        S.yaw += S.omega * dt;
        S.x += Math.sin(S.yaw) * S.v * dt;
        S.z += Math.cos(S.yaw) * S.v * dt;

        // Um número só liga o feel, a telemetria e o discurso de estabilidade.
        S.aLat = S.omega * S.v;

        // --- garfo e torre ---
        S.forkY = THREE.MathUtils.clamp(S.forkY + axes.fork * K.FORK_SPEED * dt, K.FORK_MIN, K.FORK_MAX);
        S.tilt = THREE.MathUtils.clamp(S.tilt + axes.tilt * K.TILT_SPEED * dt, K.TILT_MIN, K.TILT_MAX);

        // --- aplicar no grafo ---
        root.position.set(S.x, 0, S.z);
        root.rotation.y = S.yaw;

        carriage.position.y = S.forkY - K.FORK_MIN;
        mastPivot.rotation.x = -S.tilt;

        const roll = THREE.MathUtils.clamp(-S.aLat * 0.014, -0.05, 0.05);
        body.rotation.z += (roll - body.rotation.z) * (1 - Math.exp(-8 * dt));
        const pitch = THREE.MathUtils.clamp(-(th * 0.012), -0.02, 0.02);
        body.rotation.x += (pitch - body.rotation.x) * (1 - Math.exp(-6 * dt));

        const spin = (S.v * dt) / 0.28;
        wFL.rotation.x += spin;
        wFR.rotation.x += spin;
        wR.rotation.x += (S.v * dt) / 0.24;
        steerPivot.rotation.y = -S.delta;
    }

    function reset(x = 0, z = 0, yaw = 0) {
        S.x = x; S.z = z; S.yaw = yaw;
        S.v = S.delta = S.omega = S.aLat = 0;
        S.forkY = K.FORK_MIN;
        S.tilt = 0;
        S.loaded = false;
        S.garfoAlto = false;
        body.rotation.set(0, 0, 0);
        root.position.set(x, 0, z);
        root.rotation.y = yaw;
        carriage.position.y = 0;
        mastPivot.rotation.x = 0;
    }

    return { root, body, carriage, attachPoint, mastPivot, state: S, step, reset };
}
