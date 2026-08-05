/* mission.js — Nível 5 "Operação com carga": pegar UM palete e depositar na vaga.
 *
 * Level design deliberado: o palete e a vaga ficam ambos no campo de visão do
 * PRIMEIRO frame, dentro de uma caixa de ~10×8 m. É isso que dispensa minimapa,
 * coluna de luz e seta de borda — e é por isso que 1ª pessoa funciona aqui.
 */

import * as THREE from 'three';
import { COLOR } from './tokens.js';
import { P } from './pallet.js';
import { K } from './forklift.js';
import { haptics } from './haptics.js';
import { caminhoDubins, arcoAtePonto } from './dubins.js';

const D2R = THREE.MathUtils.degToRad;

/** O segmento entre dois pontos atravessa algum colisor? Método dos slabs.
 *  Barato o bastante para rodar por frame com ~12 caixas. */
function segmentoLivre(x0, z0, x1, z1, colisores) {
    const dx = x1 - x0, dz = z1 - z0;
    for (const c of colisores) {
        let t0 = 0, t1 = 1, bate = true;
        const eixos = [[x0, c.x - c.hw, c.x + c.hw, dx], [z0, c.z - c.hd, c.z + c.hd, dz]];
        for (const [p, lo, hi, d] of eixos) {
            if (Math.abs(d) < 1e-9) {
                if (p < lo || p > hi) { bate = false; break; }
                continue;
            }
            let a = (lo - p) / d, b = (hi - p) / d;
            if (a > b) { const t = a; a = b; b = t; }
            if (a > t0) t0 = a;
            if (b < t1) t1 = b;
            if (t0 > t1) { bate = false; break; }
        }
        if (bate) return false;
    }
    return true;
}

const PALETE = { x: -1.9, z: 3.4, yaw: 0.16, label: 'SKU 4412', kg: 820 };

// Resolvido contra o gerador do warehouse.js, não estimado:
// filled = ((b*7 + li*3 + ri*5) % 10) < 7 → para ri=4, li=1 sobram b ∈ {2,5,8}.
// cx = -13.75 + 5,5·2,75 = 1,375.
const VAGA = { id: 'R05-B6-N2', label: 'RUA 03 · NÍVEL 2', x: 1.375, y: 1.78, z: 5.43, yaw: Math.PI };

const GUIA = {
    neutro: new THREE.Color(COLOR.slate),
    perto: new THREE.Color(COLOR.hazard),
    alinhado: new THREE.Color(COLOR.deep),
};


export function createMission({ scene, forklift, palletSys, hud, telemetry, colisores }) {
    const reduzirMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let chipTxt = '', chipTom = '', chipT = 0;

    /* ---------- guias de garfo projetadas no chão ----------
       Não é muleta de videogame: no último meio metro a face do palete cai a
       42,2° de depressão, abaixo da borda da placa do carro (37,4°) — o encaixe
       final é geometricamente cego, e isso é verdade na máquina real. As guias
       são a única referência do último metro. */
    const guias = [];
    for (const sx of [-0.30, 0.30]) {
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(0.06, 2.80),
            new THREE.MeshBasicMaterial({
                color: GUIA.neutro, transparent: true, opacity: 0.35, depthWrite: false,
            })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(sx, 0.024, 3.00);
        m.renderOrder = 3;
        forklift.root.add(m);   // no root, não no body: o roll descolaria do chão
        guias.push(m);
    }

    /* ---------- pista de aproximação ----------
       As guias acima dizem PARA ONDE eu aponto. Esta diz ONDE eu deveria
       estar: é o eixo de entrada do alvo, desenhado no chão, saindo da face
       dele na direção de quem chega. Alinhar as duas coisas é o ajuste fino.
       Só acende quando se está À FRENTE da face, dentro do corredor.

       Base escura obrigatória: a lima tem 1,12:1 de contraste contra o
       concreto do piso — sozinha ela some. Escuro dá a silhueta, a lima dá o
       estado. Mesma regra da HUD. */
    const PISTA = {
        N: 26, LARG: 0.86, BITOLA: 0.30,
        // Raio de giro do guia. A máquina faz 0,57 m parada e 3,2 m a toda;
        // 1,6 m é o que ela consegue na velocidade de aproximação. Um guia com
        // raio menor que o real desenha manobra que não sai.
        RAIO: 1.6,

        /* Zona de aparição. Era um raio circular, e por isso a pista acendia
           estando do OUTRO lado da prateleira — perto em linha reta, mas sem
           nenhum caminho até a vaga. Agora é a região à FRENTE da face: um
           corredor, medido ao longo do eixo de entrada e limitado de lado.
           Entrar no corredor por qualquer ponta já acende; passar por trás do
           rack, não. */
        FRENTE_MIN: 0.4,    // logo à frente da face
        FRENTE_MAX: 9.0,    // pega o corredor inteiro, não só o entorno
        LADO_MAX: 3.2,      // largura do corredor
        CHEIO: 5.0,         // daqui para frente a pista está com opacidade cheia

        /* Espaço de arranque ATRÁS da boca. Estar à frente da face e enxergar a
           boca ainda não quer dizer que dá para entrar: entre o palete e a
           prateleira de trás sobra um bolsão de 1,5 m sem saída, e a pista
           acendia lá mandando entrar por um lado onde a máquina não cabe.
           Se o eixo de entrada não tem 2,6 m livres (1,9 m de chassi + folga),
           não existe rua — existe parede. */
        ARRANQUE: 2.6,

        /* Abaixo desta distância da boca o traçado é RETO, e isso não é
           simplificação: Dubins entre poses separadas por menos de ~3 raios de
           giro devolve laço, porque a única forma de corrigir 20 cm mantendo o
           rumo de chegada é dar a volta inteira. Medido nesta pista — de 0 a 1 m
           a mediana do caminho é 15× a reta, e chega a 56×. Era isso que
           desenhava "rota sem sentido" no último metro. A reta é honesta: a
           visada até a boca já foi testada, então ela sempre está livre. */
        RETO: 5.0,
        // Acima de RETO o Dubins vale, mas ainda pode degenerar numa pose ruim.
        // Passou disto de volta, não há caminho para a frente que preste: some,
        // e o jogador contorna. Mentir com um laço é pior que não desenhar.
        RAZAO_MAX: 2.2,
        MORRE: 0.30,        // colado na boca as guias do garfo assumem

        /* Raio do guia de PERTO. Não é o de aproximação: chegando no alvo a
           máquina está rastejando, e rastejando ela faz 0,57 m. 0,7 m é honesto
           para essa velocidade — e, medido, é o que devolve curva de verdade em
           70% das poses de perto, contra 52% de laços que dava com 1,6 m.
           O raio do guia tem que acompanhar o regime de velocidade; um raio de
           corrida usado na manobra fina vira laço, que foi o defeito relatado. */
        RAIO_PERTO: 0.7,
        /* Mesmo com raio pequeno sobra ~11% de poses onde o alvo cai DENTRO do
           círculo de giro — aí não existe curva para a frente, só a volta
           inteira. Nessas, reta: aponta o alvo sem desenhar manobra impossível,
           e a visada já provou que o segmento está livre. */
        RAZAO_PERTO: 2.6,

        REVELA: 0.60,       // segundos do traçado saindo da empilhadeira
        // A intro da câmera dura 2,6 s. Sem esperar, o traçado acontecia
        // inteiro enquanto o jogador ainda via o plano de abertura — a
        // animação existia e nunca era vista.
        ESPERA_INTRO: 2.7,

        /* Pulso que corre da empilhadeira até o alvo, em laço. O traçado que
           brota uma vez dura meio segundo e passa despercebido — quem olha a
           pista depois de ela já estar desenhada nunca via animação nenhuma.
           O pulso repete, então a direção do percurso fica legível a qualquer
           momento, não só no instante em que a pista acende. */
        PULSO_T: 1.50,      // período, em segundos
        PULSO_W: 0.20,      // meia-largura na cabeça do cometa
        PULSO_CAUDA: 7,     // comprimento da cauda, em índices do traçado

        /* Setas de percurso. A fita diz ONDE é a pista; as setas dizem para que
           LADO se anda nela, e é o que aponta o objetivo de longe. Rolam no
           mesmo período do pulso para os dois lerem como um movimento só. */
        SETAS_N: 5,
        SETAS_LEN: 0.46,
        SETAS_W: 0.34,
        SETAS_ALT: 0.026,   // acima da fita (0,02) para não brigar por z
    };

    /** Fita de largura fixa gerada por frame ao longo de uma curva. Não dá para
     *  usar PlaneGeometry: o caminho muda a cada quadro. */
    function criarFita(meiaLargura, cor, opacidade, ordem) {
        const n = PISTA.N;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 6), 3));
        const idx = [];
        for (let i = 0; i < n; i++) {
            const a = i * 2;
            idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        geo.setIndex(idx);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: cor, transparent: true, opacity: opacidade,
            depthWrite: false, side: THREE.DoubleSide,
        }));
        m.renderOrder = ordem;
        m.frustumCulled = false;
        return { mesh: m, meiaLargura, pos: geo.attributes.position };
    }

    const pista = (() => {
        const g = new THREE.Group();
        // opBase / opEixo: opacidade fora e dentro do eixo. corEstado marca quem
        // acompanha a cor de alinhamento — a base escura é silhueta, não estado.
        const base = criarFita(PISTA.LARG / 2, COLOR.ink, 0.16, 2);
        const pulso = criarFita(PISTA.PULSO_W, COLOR.hazard, 0.80, 3);
        const trilhoE = criarFita(0.022, COLOR.hazard, 0.55, 4);
        const trilhoD = criarFita(0.022, COLOR.hazard, 0.55, 4);
        Object.assign(base, { desvio: 0, opBase: 0.16, opEixo: 0.16, corEstado: false });
        Object.assign(pulso, { desvio: 0, opBase: 0.80, opEixo: 0.92, corEstado: true, ehPulso: true });
        Object.assign(trilhoE, { desvio: -PISTA.BITOLA, opBase: 0.5, opEixo: 0.72, corEstado: true });
        Object.assign(trilhoD, { desvio: PISTA.BITOLA, opBase: 0.5, opEixo: 0.72, corEstado: true });
        g.add(base.mesh, pulso.mesh, trilhoE.mesh, trilhoD.mesh);

        // setas: N triângulos soltos, um buffer só, reposicionados por frame
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position',
            new THREE.BufferAttribute(new Float32Array(PISTA.SETAS_N * 9), 3));
        const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
            color: COLOR.hazard, transparent: true, opacity: 0.9,
            depthWrite: false, side: THREE.DoubleSide,
        }));
        sm.renderOrder = 5;
        sm.frustumCulled = false;
        g.add(sm);

        g.visible = false;
        scene.add(g);
        return { grupo: g, fitas: [base, pulso, trilhoE, trilhoD],
                 setas: { mesh: sm, pos: sg.attributes.position } };
    })();

    /** Caminho curvo do jogador até o alvo.
     *
     *  Uma reta saindo do alvo dizia onde ficar, mas não COMO chegar lá: quem
     *  está fora do eixo tinha que descobrir sozinho a manobra. A curva sai da
     *  posição atual da máquina, na direção em que ela aponta, e chega no alvo
     *  já alinhada com o eixo de entrada — é o caminho a percorrer, desenhado.
     *
     *  O traçado é de Dubins, então nunca desenha manobra que a máquina não
     *  consiga fazer, e brota da empilhadeira em direção ao alvo. */
    function atualizaPista(alvo, st, simetrico, dt) {
        const esconde = () => {
            pista.grupo.visible = false;
            S.pistaRevela = 0;      // reaparecer volta a traçar do zero
            return null;
        };
        if (!alvo) return esconde();
        if (S.pistaEspera > 0) { S.pistaEspera -= (dt || 0.016); return esconde(); }

        const dx = st.x - alvo.x, dz = st.z - alvo.z;
        const dist = Math.hypot(dx, dz);

        // Palete tem simetria de 180°: a entrada é pelo lado de quem chega.
        let yaw = alvo.yaw || 0;
        if (simetrico && (Math.sin(yaw) * dx + Math.cos(yaw) * dz) < 0) yaw += Math.PI;

        // eixo que sai do alvo em direção a quem chega
        const ax = Math.sin(yaw), az = Math.cos(yaw);

        // Decomposição na moldura do alvo: quanto estou À FRENTE dele, e quanto
        // estou desviado de lado. É o que substitui o raio circular.
        const frente = ax * dx + az * dz;
        const lateral = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
        if (frente < PISTA.FRENTE_MIN || frente > PISTA.FRENTE_MAX
            || Math.abs(lateral) > PISTA.LADO_MAX) return esconde();

        /* Estar "à frente" não basta: o palete tem simetria de 180°, então de
           qualquer lado você está tecnicamente na frente dele — inclusive da rua
           de cima, com um rack inteiro no meio. Se há prateleira entre a máquina
           e o alvo, não existe caminho, e desenhar um seria mentira.

           A visada vai até a BOCA de entrada, não até o alvo: a vaga fica na
           face do rack, ou seja, dentro do próprio colisor dele — mirar o alvo
           faz o teste falhar sempre, inclusive na rua certa. */
        const bocaX = alvo.x + ax * 1.15, bocaZ = alvo.z + az * 1.15;
        if (colisores && !segmentoLivre(st.x, st.z, bocaX, bocaZ, colisores)) return esconde();

        /* E tem espaço para se alinhar? A visada prova que dá para VER a boca, não
           que dá para ENTRAR nela. Sem este teste a pista acendia no bolsão entre
           o palete e a prateleira de trás — 1,5 m sem saída, do lado errado. */
        if (colisores && !segmentoLivre(bocaX, bocaZ,
            bocaX + ax * PISTA.ARRANQUE, bocaZ + az * PISTA.ARRANQUE, colisores)) return esconde();

        let rumoErr = st.yaw - (yaw + Math.PI);
        rumoErr = Math.abs(Math.atan2(Math.sin(rumoErr), Math.cos(rumoErr)));
        const noEixo = Math.abs(lateral) < 0.34 && rumoErr < D2R(16);

        const n = PISTA.N;
        const distBoca = Math.hypot(bocaX - st.x, bocaZ - st.z);
        if (distBoca < PISTA.MORRE) return esconde();

        const px = new Float32Array(n + 1), pz = new Float32Array(n + 1);

        if (distBoca < PISTA.RETO) {
            /* Perto demais para o Dubins completo — ver PISTA.RETO. Aqui o rumo
               de chegada é SOLTO: arco até apontar a boca, depois reta. Continua
               sendo curva de verdade, e continua respeitando o raio de giro, mas
               não tem como virar laço, porque o laço vinha justamente de exigir
               o rumo final a 20 cm do alvo. Se a boca ficar atrás, o arco vira
               meia-volta — e aí a volta é a manobra certa, não um traçado torto. */
            const cam = arcoAtePonto({ x: st.x, z: st.z, yaw: st.yaw },
                { x: bocaX, z: bocaZ }, PISTA.RAIO_PERTO, n);
            if (cam && cam.comprimento <= distBoca * PISTA.RAZAO_PERTO) {
                for (let i = 0; i <= n; i++) { px[i] = cam.pts[i][0]; pz[i] = cam.pts[i][1]; }
            } else {
                // sem curva possível para a frente: reta, que ao menos aponta certo
                for (let i = 0; i <= n; i++) {
                    const t = i / n;
                    px[i] = st.x + (bocaX - st.x) * t;
                    pz[i] = st.z + (bocaZ - st.z) * t;
                }
            }
        } else {
            /* Caminho de Dubins: o menor trajeto que ESTA máquina consegue
               percorrer. A interpolação suave anterior ignorava o raio de giro —
               chegando a 90° do alvo ela desenhava uma curva impossível, e um guia
               impossível é pior que guia nenhum. Dubins nunca devolve nada mais
               fechado que R; quando devolve um laço longo, é porque não há saída
               para a frente, e aí some. */
            const chegada = { x: bocaX, z: bocaZ, yaw: yaw + Math.PI };
            const cam = caminhoDubins({ x: st.x, z: st.z, yaw: st.yaw }, chegada, PISTA.RAIO, n);
            if (!cam || cam.comprimento > distBoca * PISTA.RAZAO_MAX) return esconde();
            for (let i = 0; i <= n; i++) { px[i] = cam.pts[i][0]; pz[i] = cam.pts[i][1]; }
        }

        // Some suave nas bordas do corredor em vez de piscar ao cruzar o limite.
        const fFrente = THREE.MathUtils.clamp(
            (PISTA.FRENTE_MAX - frente) / (PISTA.FRENTE_MAX - PISTA.CHEIO), 0, 1);
        const fLado = THREE.MathUtils.clamp(
            (PISTA.LADO_MAX - Math.abs(lateral)) / 1.1, 0, 1);
        // e some ao encostar na boca, em vez de cortar seco em PISTA.MORRE
        const fPerto = THREE.MathUtils.clamp((distBoca - PISTA.MORRE) / 0.55, 0, 1);
        const fade = fFrente * fLado * fPerto;
        const cor = noEixo ? COLOR.deep : COLOR.hazard;

        // Traçado saindo da empilhadeira: a curva começa na máquina (i=0), então
        // revelar por índice crescente é o guia brotando dela em direção ao alvo.
        S.pistaRevela = Math.min(1, S.pistaRevela + (dt || 0.016) / PISTA.REVELA);
        const frenteRevela = S.pistaRevela * (n + 3);

        // Cabeça do pulso, em índice: entra pela máquina (−cauda) e sai no alvo.
        S.pistaPulso = (S.pistaPulso + (dt || 0.016)) % PISTA.PULSO_T;
        const cabeca = -PISTA.PULSO_CAUDA
            + (S.pistaPulso / PISTA.PULSO_T) * (n + 1 + PISTA.PULSO_CAUDA);

        for (const f of pista.fitas) {
            const arr = f.pos.array;
            for (let i = 0; i <= n; i++) {
                // normal lateral pela diferença finita do próprio caminho
                const a = Math.max(0, i - 1), b = Math.min(n, i + 1);
                let tx = px[b] - px[a], tz = pz[b] - pz[a];
                const L = Math.hypot(tx, tz) || 1;
                tx /= L; tz /= L;
                const grau = THREE.MathUtils.clamp(frenteRevela - i, 0, 1);
                let mw = f.meiaLargura * grau;
                if (f.ehPulso) {
                    // cometa: cheio na cabeça, afinando até sumir no fim da cauda
                    const d = cabeca - i;
                    mw *= (d < 0 || d > PISTA.PULSO_CAUDA)
                        ? 0
                        : Math.pow(1 - d / PISTA.PULSO_CAUDA, 0.7);
                }
                const nx = tz * mw, nz = -tx * mw;
                const cx = px[i] + tz * f.desvio, cz = pz[i] - tx * f.desvio;
                const o = i * 6;
                arr[o] = cx - nx; arr[o + 1] = 0.02; arr[o + 2] = cz - nz;
                arr[o + 3] = cx + nx; arr[o + 4] = 0.02; arr[o + 5] = cz + nz;
            }
            f.pos.needsUpdate = true;
            if (f.corEstado) f.mesh.material.color.setHex(cor);
            // Mais sutil: a pista orienta, não compete com a cena.
            f.mesh.material.opacity = (noEixo ? f.opEixo : f.opBase) * fade;
        }

        /* Setas rolando em direção ao alvo. Espaçadas por 1/N do caminho e
           deslocadas pelo mesmo relógio do pulso, então nascem na empilhadeira e
           somem no alvo, em fila. */
        const sArr = pista.setas.pos.array;
        for (let k = 0; k < PISTA.SETAS_N; k++) {
            const u = (k / PISTA.SETAS_N + S.pistaPulso / PISTA.PULSO_T) % 1;
            const fi = u * n;
            const i = Math.min(n - 1, Math.floor(fi));
            const fr = fi - i;
            const cx = px[i] + (px[i + 1] - px[i]) * fr;
            const cz = pz[i] + (pz[i + 1] - pz[i]) * fr;
            let tx = px[i + 1] - px[i], tz = pz[i + 1] - pz[i];
            const L = Math.hypot(tx, tz) || 1;
            tx /= L; tz /= L;
            // encolhe junto com o traçado que ainda está brotando
            const grau = THREE.MathUtils.clamp(frenteRevela - fi, 0, 1);
            const e = PISTA.SETAS_LEN * 0.5 * grau, w = PISTA.SETAS_W * 0.5 * grau;
            const nx = tz * w, nz = -tx * w;
            const o = k * 9;
            sArr[o] = cx + tx * e; sArr[o + 1] = PISTA.SETAS_ALT; sArr[o + 2] = cz + tz * e;
            sArr[o + 3] = cx - tx * e + nx; sArr[o + 4] = PISTA.SETAS_ALT; sArr[o + 5] = cz - tz * e + nz;
            sArr[o + 6] = cx - tx * e - nx; sArr[o + 7] = PISTA.SETAS_ALT; sArr[o + 8] = cz - tz * e - nz;
        }
        pista.setas.pos.needsUpdate = true;
        pista.setas.mesh.material.color.setHex(cor);
        pista.setas.mesh.material.opacity = 0.9 * fade;

        pista.grupo.visible = true;
        return { lateral, rumoErr, dist, frente, noEixo };
    }

    const mk = hud.addMarker({ label: 'PALETE', sub: 'SKU 4412', kind: 'alvo' });

    const S = {
        fase: 'buscar',      // buscar → transportar → concluido
        t: 0,
        semProgresso: 0,
        autoTilt: -1,
        engate: null,
        deposito: null,
        colisoes: 0,
        quaseAcidentes: 0,
        emRisco: false,
        riscoFrio: 0,
        avisouGarfo: false,
        picoALat: 0,
        pallet: null,
        pista: null,
        pistaRevela: 0,
        pistaPulso: 0,
        pistaEspera: 0,
    };

    function begin() {
        palletSys.reset();
        S.pallet = palletSys.spawn(PALETE.x, PALETE.z, PALETE.yaw,
            { label: PALETE.label, kg: PALETE.kg });
        palletSys.setTarget(null);
        S.fase = 'buscar';
        S.t = 0;
        S.semProgresso = 0;
        S.autoTilt = -1;
        S.engate = null;
        S.deposito = null;
        S.colisoes = 0;
        S.quaseAcidentes = 0;
        S.emRisco = false;
        S.riscoFrio = 0;
        S.avisouGarfo = false;
        S.picoALat = 0;
        S.pista = null;
        S.pistaRevela = 0;
        S.pistaPulso = 0;
        S.pistaEspera = PISTA.ESPERA_INTRO;
        pista.grupo.visible = false;
        hud.setMarker(mk, {
            pos: new THREE.Vector3(PALETE.x, 0.9, PALETE.z),
            label: 'PALETE', sub: PALETE.label, kind: 'alvo', visible: true,
        });
        hud.say('NÍVEL 5 · OPERAÇÃO COM CARGA — PEGUE O PALETE', 'info', 3.2);
        const card = document.getElementById('card');
        if (card) card.hidden = true;
    }

    function onCollision(hit) {
        S.colisoes++;
        haptics.toca('colisao', hit.speed);
        telemetry?.push('collision', { speed: +hit.speed.toFixed(2) });
    }

    /* O chip é reescrito a 60 Hz. Sem a guarda de saída, o className era
       recriado todo frame; e um fade-out-fade-in a cada troca vira piscada
       dupla justo quando a mensagem mais importa. Um assentamento só lê como
       "a linha se atualizou". A trava de 380 ms é o que separa aviso de ruído:
       na aproximação do palete o texto muda várias vezes por segundo. */
    function chip(texto, kind = 'info') {
        const e = document.getElementById('chip');
        if (!e) return;
        if (!texto) { if (chipTxt) { e.className = 'chip'; chipTxt = ''; } return; }
        if (texto === chipTxt && kind === chipTom) return;

        const trocaDeTom = kind !== chipTom;
        e.textContent = texto;
        e.className = 'chip on is-' + kind;

        const agora = performance.now();
        if (!reduzirMovimento && agora - chipT > 380) {
            /* O deslocamento em X TEM que estar nos dois quadros: é o que
               centraliza o chip, e sem ele o elemento salta para o lado durante
               a animação. Mas o valor MUDA com o regime de posicionamento —
               -50% solto no desktop, 0 quando o chip entra em fluxo na coluna de
               avisos em toque. Por isso vem da variável CSS, não fixo aqui. */
            const tx = getComputedStyle(e).getPropertyValue('--chip-tx').trim() || '-50%';
            e.animate([
                { transform: `translateX(${tx}) translateY(${trocaDeTom ? -7 : -4}px)`, opacity: .35 },
                { transform: `translateX(${tx}) translateY(0)`, opacity: 1 },
            ], { duration: trocaDeTom ? 240 : 190, easing: 'cubic-bezier(.14,.8,.26,1)' });
            chipT = agora;
        }
        chipTxt = texto;
        chipTom = kind;
    }

    function atualizaGuias(cand, st) {
        let cor = GUIA.neutro, op = 0.35;

        if (S.fase === 'buscar' && S.pallet) {
            const d = Math.hypot(S.pallet.position.x - st.x, S.pallet.position.z - st.z);
            if (d < 4) { cor = GUIA.perto; op = 0.55; }
        }
        if (cand) { cor = GUIA.alinhado; op = 0.85; }
        // guia reta mente na curva: apaga em vez de enganar
        if (Math.abs(st.delta) > D2R(15)) op *= 0.27;
        if (S.fase === 'concluido') op = 0;

        for (const g of guias) {
            g.material.color.copy(cor);
            g.material.opacity = op;
        }
    }

    function update(dt, input) {
        const st = forklift.state;
        S.t += dt;
        S.semProgresso += dt;
        S.picoALat = Math.max(S.picoALat, Math.abs(st.aLat));

        /* ---------- quase-acidente ----------
           A aceleração lateral já era calculada e já alimentava o roll da
           cabine, mas ninguém a registrava: o contador do relatório e o do
           painel da turma nasceriam sempre zerados. Histerese de 30% para não
           disparar em rajada enquanto o jogador segura a curva. */
        const limiar = st.loaded ? K.ALAT_WARN_LOAD : K.ALAT_WARN;
        S.riscoFrio = Math.max(0, S.riscoFrio - dt);
        if (Math.abs(st.aLat) > limiar && !S.emRisco && S.riscoFrio <= 0) {
            S.emRisco = true;
            S.riscoFrio = 3;   // um trecho agressivo é UM evento, não doze
            S.quaseAcidentes++;
            haptics.toca('quaseAcidente');
            hud.say('CURVA RÁPIDA DEMAIS — RISCO DE TOMBAMENTO', 'warn', 2.2);
            telemetry?.push('near_miss', { aLat: +st.aLat.toFixed(2), carregado: st.loaded });
        } else if (Math.abs(st.aLat) < limiar * 0.7) {
            S.emRisco = false;
        }

        // Garfo alto limita a máquina a rastejar. O aviso dispara uma vez, no
        // instante em que o jogador TENTA andar — avisar antes disso seria
        // ruído, porque erguer parado é legítimo.
        if (st.garfoAlto && Math.abs(input.axes.drive) > 0.2 && !S.avisouGarfo) {
            S.avisouGarfo = true;
            haptics.toca('quaseAcidente');
            hud.say('GARFO ALTO — ABAIXE PARA TRAFEGAR', 'warn', 2.6);
        } else if (!st.garfoAlto) {
            S.avisouGarfo = false;
        }

        const pr = palletSys.probe();
        const cand = pr.ok ? pr : null;
        atualizaGuias(cand, st);

        // A pista nasce no alvo da vez: o palete enquanto se busca, a vaga
        // depois de engatar. O palete tem simetria de 180°, a vaga não.
        const alvoPista = S.fase === 'buscar'
            ? (S.pallet && !S.pallet.userData.engaged
                ? { x: S.pallet.position.x, z: S.pallet.position.z, yaw: S.pallet.rotation.y }
                : null)
            : S.fase === 'transportar' ? VAGA : null;
        S.pista = atualizaPista(alvoPista, st, S.fase === 'buscar', dt);

        /* ---------- engate AUTOMÁTICO no instante do encaixe ----------
           Era: alinhar E segurar o ▲ dentro de uma janela estreita de
           profundidade. Não funciona — o palete não tem colisor, então na prática
           o jogador atravessa ele e nada acontece. Playtest derrubou o desenho
           anterior. Agora encaixou, pegou: vibra e vira parte do garfo. */
        if (S.fase === 'buscar' && cand) {
            S.engate = palletSys.engage(cand);
            S.engate.depth = cand.depth;
            haptics.toca("engate");
            S.fase = 'transportar';
            S.pistaRevela = 0;   // alvo novo, traçado novo
            S.pistaPulso = 0;    // e o pulso recomeça saindo da máquina
            S.semProgresso = 0;
            S.autoTilt = 0;
            palletSys.setTarget(VAGA);
            hud.setMarker(mk, {
                pos: new THREE.Vector3(VAGA.x, VAGA.y + 0.4, VAGA.z),
                label: 'VAGA', sub: VAGA.label, kind: 'vaga', visible: true,
            });
            hud.say('CARGA ENGATADA — ERGA ▲ E LEVE ATÉ A ' + VAGA.label, 'ok', 3.4);
            telemetry?.push('pallet_pick', {
                lat: +S.engate.lat.toFixed(3),
                yawErr: +S.engate.yawErr.toFixed(3),
                forkErr: +S.engate.forkErr.toFixed(3),
                depth: +cand.depth.toFixed(2),
            });
        }

        // inclinar a torre para trás depois de engatar: prática correta, e
        // step() ACUMULA em S.tilt (não sobrescreve), então escrever aqui é seguro
        if (S.autoTilt >= 0 && S.autoTilt < 1) {
            S.autoTilt = Math.min(1, S.autoTilt + dt / 0.5);
            st.tilt += (D2R(5) - st.tilt) * Math.min(1, dt / 0.18);
        }

        /* ---------- depósito ---------- */
        const podeSoltar = palletSys.canPlace();
        if (S.fase === 'transportar' && podeSoltar && input.axes.fork < 0) {
            const r = palletSys.release();
            if (r && r.slot) {
                S.deposito = r;
                S.fase = 'concluido';
                pista.grupo.visible = false;
                haptics.toca("deposito");
                hud.setMarker(mk, { visible: false });
                hud.say('DEPOSITADO — MISSÃO CONCLUÍDA', 'ok', 4);
                telemetry?.push('pallet_place', {
                    slotId: r.slot.id, posErr: +r.posErr.toFixed(3),
                });
                mostrarCartao();
            }
        }

        /* ---------- chip: diz O QUE CORRIGIR, não só que falhou ---------- */
        const n2 = v => v.toFixed(2).replace('.', ',');

        if (S.fase === 'concluido') {
            chip('');
        } else if (st.garfoAlto && !podeSoltar) {
            chip('GARFO ALTO — MÁQUINA LIMITADA · ABAIXE PARA TRAFEGAR', 'warn');
        } else if (S.fase === 'transportar') {
            if (podeSoltar) {
                chip('NA VAGA — ABAIXE O GARFO ▼ PARA SOLTAR', 'ok');
            } else if (S.pista && !S.pista.noEixo) {
                // Entregar não tinha dica de alinhamento — só de altura. A pista
                // dá o desvio, então dá para dizer o que corrigir.
                chip(Math.abs(S.pista.lateral) > 0.34
                    ? `ENTRE NA PISTA — DESVIE PARA A ${S.pista.lateral > 0 ? 'DIREITA' : 'ESQUERDA'}`
                    : 'ENDIREITE A MÁQUINA COM A PISTA', 'warn');
            } else if (S.pista) {
                const dz = VAGA.y - st.forkY;
                chip(Math.abs(dz) > 0.16
                    ? `NA PISTA · GARFO ${dz > 0 ? '▲' : '▼'} FALTAM ${n2(Math.abs(dz))} m`
                    : 'NA PISTA · ALTURA OK — AVANCE', 'ok');
            } else {
                chip('CARGA A BORDO · LIMITE 6 KM/H · NR-11', 'info');
            }
        } else {
            // fase de busca: a ordem das mensagens é a ordem de correção
            const lado = pr.latSign > 0 ? 'ESQUERDA' : 'DIREITA';
            // Já no eixo da pista, só falta chegar: reconhecer isso é o que
            // transforma "aproxime-se" em confirmação de que o ajuste deu certo.
            if (pr.falha === 'longe' && S.pista?.noEixo) {
                chip('NA PISTA · SIGA EM FRENTE', 'ok');
                return;
            }
            const msg = {
                nenhum: ['PALETE JÁ RECOLHIDO', 'ok'],
                longe: ['APROXIME-SE DO PALETE PELA FRENTE', 'info'],
                perto: ['RECUE UM POUCO — VOCÊ PASSOU DO PALETE', 'warn'],
                lateral: [`DESVIE PARA A ${lado} PARA CENTRALIZAR`, 'warn'],
                angulo: ['ENDIREITE A MÁQUINA COM O PALETE', 'warn'],
                garfo_alto: ['ABAIXE O GARFO ▼ ATÉ A ALTURA DO BOLSO', 'warn'],
                garfo_baixo: ['ERGA O GARFO ▲ ATÉ A ALTURA DO BOLSO', 'warn'],
            }[pr.falha] || ['CENTRALIZE O PALETE ENTRE AS COLUNAS DO MASTRO', 'info'];
            chip(msg[0], msg[1]);
        }
    }

    function mostrarCartao() {
        const card = document.getElementById('card');
        if (!card) return;
        const e = S.engate, d = S.deposito;

        const precEngate = Math.max(0, 100 * (1 - Math.max(
            e.lat / P.TOL_LAT, e.yawErr / P.TOL_YAW, e.forkErr / P.TOL_FORK)));
        // fração da lâmina dentro do bolso: ponta em 1,585, face do palete em depth-0,5
        const prof = Math.max(0, Math.min(1, (2.085 - e.depth) / 1.05));
        const precDep = Math.max(0, 100 * (1 - d.posErr / P.PLACE_TOL));

        const n = (v, d2 = 0) => v.toFixed(d2).replace('.', ',');
        card.querySelector('.card-rows').innerHTML = [
            ['Tempo', `${n(S.t, 1)} s`],
            ['Precisão de encaixe', `${n(precEngate)} / 100`],
            ['Profundidade da lâmina', `${n(prof * 100)} %`],
            ['Precisão de depósito', `${n(precDep)} / 100 · erro ${n(d.posErr * 100)} cm`],
            ['Colisões', `${S.colisoes}`],
            ['Quase-acidentes', `${S.quaseAcidentes}`],
            ['Pico de aceleração lateral', `${n(S.picoALat, 1)} m/s²`],
        ].map(([k, v], i) => `<div class="cr" style="--i:${i}"><span>${k}</span><b>${v}</b></div>`).join('');
        card.hidden = false;
    }

    return { begin, update, onCollision, state: S, VAGA, PALETE,
             get temColisores() { return !!(colisores && colisores.length); } };
}
