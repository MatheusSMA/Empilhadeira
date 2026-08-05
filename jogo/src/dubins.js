/* dubins.js — menor caminho VIÁVEL para um veículo que não gira no lugar.
 *
 * A curva Hermite anterior era suave e bonita e mentia: interpolar duas poses
 * ignora que a máquina tem raio de giro mínimo. Chegando a 90° do alvo, ela
 * desenhava um caminho que a empilhadeira não consegue percorrer.
 *
 * Dubins resolve exatamente isso: dado um raio mínimo R, o caminho mais curto
 * entre duas poses é sempre uma das seis combinações de arco-reta-arco —
 * LSL, RSR, LSR, RSL, RLR, LRL. Nada mais curto existe, e tudo que ele devolve
 * é percorrível.
 *
 * Convenção interna: (x, y, θ) com frente = (cos θ, sin θ), o padrão da
 * literatura. Quem chama converte — ver `caminhoDubins`.
 */

const TAU = Math.PI * 2;
const mod2pi = a => ((a % TAU) + TAU) % TAU;

/* Cada solver devolve [t, p, q] em radianos/comprimento normalizado (unidades
   de R), ou null quando aquela combinação não existe para esta geometria. */
const SOLVERS = {
    LSL: (a, b, d) => {
        const tmp = Math.atan2(Math.cos(b) - Math.cos(a), d + Math.sin(a) - Math.sin(b));
        const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b));
        if (p2 < 0) return null;
        return [mod2pi(-a + tmp), Math.sqrt(p2), mod2pi(b - tmp)];
    },
    RSR: (a, b, d) => {
        const tmp = Math.atan2(Math.cos(a) - Math.cos(b), d - Math.sin(a) + Math.sin(b));
        const p2 = 2 + d * d - 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a));
        if (p2 < 0) return null;
        return [mod2pi(a - tmp), Math.sqrt(p2), mod2pi(-b + tmp)];
    },
    LSR: (a, b, d) => {
        const p2 = -2 + d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) + Math.sin(b));
        if (p2 < 0) return null;
        const p = Math.sqrt(p2);
        const tmp = Math.atan2(-Math.cos(a) - Math.cos(b), d + Math.sin(a) + Math.sin(b))
            - Math.atan2(-2, p);
        return [mod2pi(-a + tmp), p, mod2pi(-mod2pi(b) + tmp)];
    },
    RSL: (a, b, d) => {
        const p2 = d * d - 2 + 2 * Math.cos(a - b) - 2 * d * (Math.sin(a) + Math.sin(b));
        if (p2 < 0) return null;
        const p = Math.sqrt(p2);
        const tmp = Math.atan2(Math.cos(a) + Math.cos(b), d - Math.sin(a) - Math.sin(b))
            - Math.atan2(2, p);
        return [mod2pi(a - tmp), p, mod2pi(b - tmp)];
    },
    RLR: (a, b, d) => {
        const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(a) - Math.sin(b))) / 8;
        if (Math.abs(tmp) > 1) return null;
        const p = mod2pi(TAU - Math.acos(tmp));
        const t = mod2pi(a - Math.atan2(Math.cos(a) - Math.cos(b), d - Math.sin(a) + Math.sin(b)) + p / 2);
        return [t, p, mod2pi(a - b - t + p)];
    },
    LRL: (a, b, d) => {
        const tmp = (6 - d * d + 2 * Math.cos(a - b) + 2 * d * (Math.sin(b) - Math.sin(a))) / 8;
        if (Math.abs(tmp) > 1) return null;
        const p = mod2pi(TAU - Math.acos(tmp));
        const t = mod2pi(-a + Math.atan2(-Math.cos(a) + Math.cos(b), d + Math.sin(a) - Math.sin(b)) + p / 2);
        return [t, p, mod2pi(mod2pi(b) - a + 2 * p)];
    },
};

const PALAVRAS = {
    LSL: ['L', 'S', 'L'], RSR: ['R', 'S', 'R'], LSR: ['L', 'S', 'R'],
    RSL: ['R', 'S', 'L'], RLR: ['R', 'L', 'R'], LRL: ['L', 'R', 'L'],
};

/** Avança uma pose ao longo de um segmento. `len` é ângulo em L/R e distância
 *  em S, ambos em unidades normalizadas (multiplicar por R depois não serve —
 *  a integração já é feita em unidades de R). */
function avanca(x, y, th, modo, len) {
    if (modo === 'S') return [x + len * Math.cos(th), y + len * Math.sin(th), th];
    if (modo === 'L') return [
        x + Math.sin(th + len) - Math.sin(th),
        y - Math.cos(th + len) + Math.cos(th),
        th + len,
    ];
    return [                                    // 'R'
        x - Math.sin(th - len) + Math.sin(th),
        y + Math.cos(th - len) - Math.cos(th),
        th - len,
    ];
}

/**
 * Arco + reta até um PONTO, sem exigir rumo de chegada.
 *
 * Existe porque o Dubins completo degenera de perto: obrigar o rumo final faz
 * com que corrigir 20 cm custe a volta inteira — de 0 a 1 m o caminho dá 15× a
 * reta na mediana. Soltando o rumo de chegada some a degeneração e sobra o que
 * a máquina de fato faz: gira o quanto precisar para apontar o alvo, e vai.
 *
 * Nunca devolve laço (o arco é sempre < 2π e só existe um), e nunca fecha mais
 * que R. Se o alvo cair DENTRO de um dos círculos de giro, aquele lado é
 * impossível e o outro assume — o alvo não pode estar dentro dos dois, porque
 * os círculos se tocam num ponto só.
 *
 * @returns {{pts: Array<[number,number]>, comprimento: number}|null}
 */
export function arcoAtePonto(de, para, R, amostras = 28) {
    const x0 = de.z, y0 = de.x, th0 = de.yaw;      // mesma troca de eixos de caminhoDubins
    const xT = para.z, yT = para.x;

    let melhor = null;
    for (const lado of [1, -1]) {                  // +1 = esquerda (anti-horário), -1 = direita
        const cx = x0 - lado * R * Math.sin(th0);
        const cy = y0 + lado * R * Math.cos(th0);
        const D = Math.hypot(xT - cx, yT - cy);
        if (D <= R + 1e-6) continue;               // alvo dentro do círculo: por este lado não há
        const aT = Math.atan2(yT - cy, xT - cx);
        const phi0 = Math.atan2(y0 - cy, x0 - cx);
        const phiQ = aT - lado * Math.acos(R / D);
        const arco = lado > 0 ? mod2pi(phiQ - phi0) : mod2pi(phi0 - phiQ);
        const reta = Math.sqrt(D * D - R * R);
        const custo = R * arco + reta;
        if (!melhor || custo < melhor.custo) melhor = { lado, cx, cy, phi0, arco, custo };
    }
    if (!melhor) return null;

    const { lado, cx, cy, phi0, arco, custo } = melhor;
    const qx = cx + R * Math.cos(phi0 + lado * arco);
    const qy = cy + R * Math.sin(phi0 + lado * arco);
    const restante = custo - R * arco;
    const ux = (xT - qx) / (restante || 1), uy = (yT - qy) / (restante || 1);

    const pts = [];
    for (let i = 0; i <= amostras; i++) {
        const s = (i / amostras) * custo;
        let X, Y;
        if (s <= R * arco) {
            const phi = phi0 + lado * (s / R);
            X = cx + R * Math.cos(phi);
            Y = cy + R * Math.sin(phi);
        } else {
            const t = s - R * arco;
            X = qx + ux * t;
            Y = qy + uy * t;
        }
        pts.push([Y, X]);                          // de volta para (x, z) do jogo
    }
    return { pts, comprimento: custo };
}

/**
 * Caminho viável entre duas poses no plano XZ do jogo.
 *
 * O jogo usa frente = (sin yaw, cos yaw) no plano (x, z); a literatura usa
 * frente = (cos θ, sin θ) em (x, y). A troca X=z, Y=x resolve isso sem
 * nenhuma correção de sinal: com ela, frente = (cos yaw, sin yaw).
 *
 * @returns {{pts: Array<[number,number]>, palavra: string, comprimento: number}|null}
 *          pontos já de volta em (x, z) do jogo.
 */
export function caminhoDubins(de, para, R, amostras = 28) {
    // (x, z, yaw) do jogo  →  (X, Y, θ) da literatura
    const x0 = de.z, y0 = de.x, th0 = de.yaw;
    const x1 = para.z, y1 = para.x, th1 = para.yaw;

    const dx = x1 - x0, dy = y1 - y0;
    const D = Math.hypot(dx, dy);
    const d = D / R;
    if (!isFinite(d)) return null;

    const theta = mod2pi(Math.atan2(dy, dx));
    const alpha = mod2pi(th0 - theta);
    const beta = mod2pi(th1 - theta);

    let melhor = null;
    for (const nome in SOLVERS) {
        const r = SOLVERS[nome](alpha, beta, d);
        if (!r) continue;
        const custo = r[0] + r[1] + r[2];
        if (!isFinite(custo)) continue;
        if (!melhor || custo < melhor.custo) melhor = { nome, seg: r, custo };
    }
    if (!melhor) return null;

    const modos = PALAVRAS[melhor.nome];
    const total = melhor.custo;
    const pts = [];
    for (let i = 0; i <= amostras; i++) {
        let s = (i / amostras) * total;      // distância percorrida, em unidades de R
        let x = 0, y = 0, th = alpha;        // frame normalizado: início na origem
        for (let k = 0; k < 3; k++) {
            const len = Math.min(s, melhor.seg[k]);
            [x, y, th] = avanca(x, y, th, modos[k], len);
            s -= len;
            if (s <= 1e-9) break;
        }
        // desfaz normalização: escala por R e gira de volta para o mundo
        const c = Math.cos(theta), sn = Math.sin(theta);
        const X = x0 + R * (x * c - y * sn);
        const Y = y0 + R * (x * sn + y * c);
        pts.push([Y, X]);                    // de volta para (x, z) do jogo
    }

    return { pts, palavra: melhor.nome, comprimento: total * R };
}
