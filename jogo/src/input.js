/* input.js — camada de input unificada.
 *
 * Contrato único: o código de jogo lê `input.axes` / `input.held` / `input.pressed()`
 * e NUNCA pergunta se é celular. Teclado e toque mesclam no mesmo frame — num
 * notebook com tela sensível o usuário pode misturar os dois.
 */

import { haptics } from './haptics.js';

const KEYMAP = {
    drive: { pos: ['KeyW', 'ArrowUp'], neg: ['KeyS', 'ArrowDown'] },
    steer: { pos: ['KeyA', 'ArrowLeft'], neg: ['KeyD', 'ArrowRight'] }, // + = esquerda
    fork: { pos: ['KeyQ'], neg: ['KeyE'] },
    tilt: { pos: ['KeyX'], neg: ['KeyZ'] },
};
const BTNKEYS = {
    honk: ['Space'], retry: ['KeyR'], pause: ['Escape'],
    cam: ['KeyV'], back: ['KeyC'],
};

const held = new Set();          // teclas fisicamente pressionadas
const touchBtn = Object.create(null); // botões de toque pressionados

const state = {
    axes: { drive: 0, steer: 0, fork: 0, tilt: 0 },
    held: { honk: false, retry: false, pause: false, cam: false, back: false },
    source: 'keyboard',
    enabled: true,
};
let prevHeld = { ...state.held };

/* ---------- teclado ---------- */

function axisFromKeys(map) {
    const p = map.pos.some(k => held.has(k)) ? 1 : 0;
    const n = map.neg.some(k => held.has(k)) ? 1 : 0;
    return p - n;
}

addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    held.add(e.code);
    // Espaço rola a página; setas idem. Não queremos nenhum dos dois.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => held.delete(e.code));
// Sem isto a empilhadeira sai andando sozinha quando o usuário troca de aba.
addEventListener('blur', () => held.clear());
addEventListener('visibilitychange', () => { if (document.hidden) held.clear(); });

/* ---------- joystick analógico de origem dinâmica ---------- */

const RADIUS = 60;   // px até a deflexão máxima
const DEAD = 0.12; // deadzone normalizada

const stick = { x: 0, y: 0 };
let pointerId = null;
let origin = null;
let elStick = null, elKnob = null;

function stickReset() {
    pointerId = null;
    origin = null;
    stick.x = 0;
    stick.y = 0;
    if (elStick) elStick.classList.remove('on');
    // O CSS já centraliza a bolinha (margin:-26px). Somar outro -26 aqui
    // a deixava permanentemente 26px acima e à esquerda do centro.
    if (elKnob) elKnob.style.transform = 'translate3d(0,0,0)';
}

function stickMove(cx, cy) {
    const dx = cx - origin.x;
    const dy = cy - origin.y;
    const len = Math.hypot(dx, dy) || 1;

    let m = Math.min(len / RADIUS, 1);
    m = m <= DEAD ? 0 : (m - DEAD) / (1 - DEAD);
    m = m * m; // curva quadrática: sem ela só existe "parado" e "voando"

    const ux = dx / len, uy = dy / len;
    stick.x = ux * m;
    stick.y = -uy * m; // Y da tela cresce para baixo

    if (elKnob) {
        const kx = ux * Math.min(len, RADIUS);
        const ky = uy * Math.min(len, RADIUS);
        elKnob.style.transform = `translate3d(${kx}px,${ky}px,0)`;
    }
}

function bindStick(zone, stickEl, knobEl) {
    elStick = stickEl;
    elKnob = knobEl;

    zone.addEventListener('pointerdown', e => {
        if (pointerId !== null) return;          // um segundo dedo não rouba o stick
        pointerId = e.pointerId;
        zone.setPointerCapture(e.pointerId);     // impede o stick de "grudar" ao sair da zona
        origin = { x: e.clientX, y: e.clientY };
        stickEl.style.left = e.clientX - zone.getBoundingClientRect().left + 'px';
        stickEl.style.top = e.clientY - zone.getBoundingClientRect().top + 'px';
        stickEl.classList.add('on');
        markTouch();
        e.preventDefault();
    }, { passive: false });

    zone.addEventListener('pointermove', e => {
        if (e.pointerId !== pointerId) return;
        stickMove(e.clientX, e.clientY);
        e.preventDefault();
    }, { passive: false });

    const release = e => {
        if (e.pointerId !== pointerId) return;
        stickReset();
    };
    zone.addEventListener('pointerup', release);
    // iOS dispara pointercancel em gestos de sistema. Sem tratar, a empilhadeira acelera para sempre.
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', release);
}

/* ---------- botões de toque ---------- */

function bindButton(el) {
    const name = el.dataset.btn;
    const down = e => {
        touchBtn[name] = true;
        el.classList.add('on');
        markTouch();
        haptics.toca('toque');
        e.preventDefault();
    };
    const up = e => {
        touchBtn[name] = false;
        el.classList.remove('on');
        e.preventDefault();
    };
    el.addEventListener('pointerdown', down, { passive: false });
    el.addEventListener('pointerup', up, { passive: false });
    el.addEventListener('pointercancel', up, { passive: false });
    el.addEventListener('pointerleave', up, { passive: false });
}

/* ---------- olhar em volta ----------
   O listener vai no CANVAS, nunca em window com capture nem numa div por cima
   da HUD: qualquer uma das duas rouba o ponteiro do joystick e a empilhadeira
   fica com o acelerador travado. */
let onLook = null;
let lookId = null, lookPrev = null, lookMoved = 0;

function bindLook(canvas) {
    canvas.addEventListener('pointerdown', e => {
        if (lookId !== null) return;
        lookId = e.pointerId;
        lookPrev = { x: e.clientX, y: e.clientY };
        lookMoved = 0;
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
        if (e.pointerId !== lookId || !onLook) return;
        const dx = (e.clientX - lookPrev.x) / innerWidth;
        const dy = (e.clientY - lookPrev.y) / innerHeight;
        lookPrev = { x: e.clientX, y: e.clientY };
        lookMoved += Math.abs(dx) + Math.abs(dy);
        onLook(dx, dy);
    });

    const end = e => {
        if (e.pointerId !== lookId) return;
        lookId = null;
        // toque curto sem arrastar = recentralizar o olhar
        if (lookMoved < 0.012 && onLook) onLook(0, 0, true);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
}

/* ---------- detecção de fonte (nunca por user-agent) ---------- */

function markTouch() {
    if (state.source === 'touch') return;
    state.source = 'touch';
    document.body.classList.add('touch');
}

addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') markTouch();
}, { capture: true });

/* ---------- API ---------- */

export const input = {
    axes: state.axes,
    held: state.held,
    get source() { return state.source; },

    init({ look } = {}) {
        const zone = document.getElementById('stickZone');
        if (zone) bindStick(zone, document.getElementById('stick'), document.getElementById('stickKnob'));
        document.querySelectorAll('[data-btn]').forEach(bindButton);
        onLook = look || null;
        const canvas = document.getElementById('stage');
        if (canvas && onLook) bindLook(canvas);
        // Se o aparelho é primariamente de toque, já mostra os controles sem esperar o primeiro toque.
        if (matchMedia('(hover: none) and (pointer: coarse)').matches) markTouch();
        stickReset();
    },

    setEnabled(v) {
        state.enabled = v;
        if (!v) { held.clear(); stickReset(); for (const k in touchBtn) touchBtn[k] = false; }
    },

    /** Chamado no topo do RAF. Mescla as fontes e calcula as bordas de subida. */
    beginFrame() {
        prevHeld = { ...state.held };
        const a = state.axes;

        if (!state.enabled) {
            a.drive = a.steer = a.fork = a.tilt = 0;
            for (const k in state.held) state.held[k] = false;
            return;
        }

        const cl = v => Math.max(-1, Math.min(1, v));
        a.drive = cl(axisFromKeys(KEYMAP.drive) + stick.y);
        a.steer = cl(axisFromKeys(KEYMAP.steer) - stick.x); // stick para a direita = virar à direita
        a.fork = cl(axisFromKeys(KEYMAP.fork) + (touchBtn.forkUp ? 1 : 0) - (touchBtn.forkDown ? 1 : 0));
        a.tilt = cl(axisFromKeys(KEYMAP.tilt) + (touchBtn.tiltBack ? 1 : 0) - (touchBtn.tiltFwd ? 1 : 0));

        state.held.honk = BTNKEYS.honk.some(k => held.has(k)) || !!touchBtn.honk;
        state.held.retry = BTNKEYS.retry.some(k => held.has(k)) || !!touchBtn.retry;
        state.held.pause = BTNKEYS.pause.some(k => held.has(k));
        state.held.cam = BTNKEYS.cam.some(k => held.has(k)) || !!touchBtn.cam;
        state.held.back = BTNKEYS.back.some(k => held.has(k)) || !!touchBtn.back;
    },

    /** true apenas no frame em que o botão desceu. */
    pressed(name) {
        return !!state.held[name] && !prevHeld[name];
    },

    /** Diagnóstico: de ONDE está vindo o comando. Existe porque "a empilhadeira
     *  anda sozinha" é indistinguível de bug de física sem isto. */
    debugSources() {
        const teclas = [...held].join(',') || '—';
        const btns = Object.keys(touchBtn).filter(k => touchBtn[k]).join(',') || '—';
        return `teclas[${teclas}] btn[${btns}] stick(${stick.x.toFixed(2)},${stick.y.toFixed(2)}) ptr:${pointerId}`;
    },
};
