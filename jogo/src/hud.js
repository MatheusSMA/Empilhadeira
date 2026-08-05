/* hud.js — marcadores projetados em tela e avisos.
 *
 * Em primeira pessoa não existe visão geral: sem marcador, o jogador não faz
 * ideia de para onde ir e fecha a aba. O marcador precisa funcionar nos dois
 * casos — alvo visível à frente, e alvo fora do campo de visão (aí vira seta
 * grudada na borda apontando para ele).
 */

import * as THREE from 'three';

const _v = new THREE.Vector3();

export function createHud(root) {
    const layer = document.createElement('div');
    layer.className = 'markers';
    root.appendChild(layer);

    // A coluna de avisos vem do HTML e já contém o chip; os banners entram
    // ANTES dele, para o chip ficar sempre no pé da pilha.
    const avisos = root.querySelector('.avisos') || root;
    const banners = document.createElement('div');
    banners.className = 'banners';
    avisos.insertBefore(banners, avisos.firstChild);

    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    root.appendChild(prompt);

    const markers = [];

    function addMarker({ label, sub = '', kind = 'alvo' }) {
        const e = document.createElement('div');
        e.className = `marker is-${kind}`;
        e.innerHTML =
            `<div class="mk-arrow"></div>` +
            `<div class="mk-body"><div class="mk-lbl"></div><div class="mk-sub"></div></div>`;
        layer.appendChild(e);
        const m = {
            el: e,
            lblEl: e.querySelector('.mk-lbl'),
            subEl: e.querySelector('.mk-sub'),
            arrow: e.querySelector('.mk-arrow'),
            target: new THREE.Vector3(),
            visible: false,
            label, sub, kind,
        };
        m.lblEl.textContent = label;
        m.subEl.textContent = sub;
        markers.push(m);
        return m;
    }

    function setMarker(m, { pos, label, sub, kind, visible = true }) {
        if (pos) m.target.copy(pos);
        if (label !== undefined && label !== m.label) { m.label = label; m.lblEl.textContent = label; }
        if (sub !== undefined && sub !== m.sub) { m.sub = sub; m.subEl.textContent = sub; }
        if (kind !== undefined && kind !== m.kind) {
            m.el.classList.remove(`is-${m.kind}`);
            m.kind = kind;
            m.el.classList.add(`is-${kind}`);
        }
        m.visible = visible;
    }

    function project(cam) {
        const w = innerWidth, h = innerHeight;
        const cx = w / 2, cy = h / 2;
        const pad = 56;

        for (const m of markers) {
            if (!m.visible) { m.el.style.display = 'none'; continue; }
            m.el.style.display = '';

            _v.copy(m.target).project(cam);
            const behind = _v.z > 1;

            let x = (_v.x * 0.5 + 0.5) * w;
            let y = (-_v.y * 0.5 + 0.5) * h;
            if (behind) { x = w - x; y = h - y; }   // atrás: espelha para a borda certa

            const off = behind || x < pad || x > w - pad || y < pad || y > h - pad;

            if (off) {
                // gruda na borda, apontando para o alvo
                let dx = x - cx, dy = y - cy;
                const len = Math.hypot(dx, dy) || 1;
                dx /= len; dy /= len;
                const sx = (w / 2 - pad) / Math.abs(dx || 1e-6);
                const sy = (h / 2 - pad) / Math.abs(dy || 1e-6);
                const s = Math.min(sx, sy);
                x = cx + dx * s;
                y = cy + dy * s;
                m.el.classList.add('is-off');
                m.arrow.style.transform = `rotate(${Math.atan2(dy, dx) * 180 / Math.PI + 90}deg)`;
            } else {
                m.el.classList.remove('is-off');
            }

            const dist = cam.position.distanceTo(m.target);
            m.el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0) translate(-50%,-50%)`;
            m.el.style.setProperty('--d', dist.toFixed(0));
            if (!off) m.subEl.textContent = m.sub ? `${m.sub} · ${dist.toFixed(0)} m` : `${dist.toFixed(0)} m`;
            else m.subEl.textContent = `${dist.toFixed(0)} m`;
        }
    }

    /* ---------- pilha de avisos ----------
       Era UM elemento reescrito no lugar. Quando duas coisas aconteciam no
       mesmo segundo — bater e estourar a curva, que é o par mais comum — a
       segunda apagava a primeira e o jogador via um piscar sem conseguir ler
       nenhuma das duas. Agora cada aviso é um cartão com vida própria e eles
       se empilham um debaixo do outro.

       O teto de 3 é o que impede a pilha de virar parede em cima da cena: o
       quarto aviso empurra o mais velho para fora. */
    const MAX_AVISOS = 3;
    const SAIDA = 0.22;         // segundos da transição de saída
    const vivos = [];

    function say(text, kind = 'info', secs = 2.6) {
        // repetir o mesmo texto não empilha cópia — só renova o tempo dele
        const igual = vivos.find(a => a.texto === text && !a.saindo);
        if (igual) { igual.t = Math.max(igual.t, secs); return; }

        const el = document.createElement('div');
        el.className = `banner is-${kind}`;
        el.textContent = text;
        banners.appendChild(el);
        void el.offsetWidth;    // sem o reflow a transição de entrada não roda
        el.classList.add('on');

        vivos.push({ el, texto: text, t: secs, saindo: false });
        while (vivos.length > MAX_AVISOS) vivos.shift().el.remove();
    }

    /** Esvazia a pilha na hora. Reiniciar a missão não pode herdar aviso da
     *  tentativa anterior — "lado errado" pairando sobre uma corrida nova é
     *  informação falsa, e o jogador acredita nela. */
    function limpaAvisos() {
        for (const a of vivos) a.el.remove();
        vivos.length = 0;
    }

    function setPrompt(text, kind = 'ok') {
        if (!text) { prompt.className = 'prompt'; return; }
        prompt.textContent = text;
        prompt.className = `prompt on is-${kind}`;
    }

    function update(dt, cam) {
        project(cam);
        for (let i = vivos.length - 1; i >= 0; i--) {
            const a = vivos[i];
            a.t -= dt;
            if (a.t > 0) continue;
            if (!a.saindo) {
                a.saindo = true;
                a.t = SAIDA;            // deixa a saída rodar antes de tirar do DOM
                a.el.classList.remove('on');
                continue;
            }
            a.el.remove();
            vivos.splice(i, 1);
        }
    }

    return { addMarker, setMarker, say, limpaAvisos, setPrompt, update, markers };
}
