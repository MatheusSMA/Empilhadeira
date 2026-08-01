/* scene.js — renderer, luz, chão, câmera-mola e degrade adaptativo de qualidade. */

import * as THREE from 'three';
import { createCameraRig } from './camera.js';
import { COLOR } from './tokens.js';

const isCoarse = matchMedia('(hover: none) and (pointer: coarse)').matches;

/* ---------- textura de chão gerada em runtime ----------
   Não é só decoração: sem referência visual o jogador não sente velocidade,
   e "dirigir é gostoso" morre. O piso caprichado do galpão vem na fatia 4. */
function makeFloorTexture() {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');

    g.fillStyle = '#D9D5CC';
    g.fillRect(0, 0, S, S);

    // granulado do concreto
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    g.putImageData(img, 0, 0);

    // junta de dilatação (1 célula = 2 m no mundo)
    g.strokeStyle = 'rgba(20,24,28,.16)';
    g.lineWidth = 3;
    g.strokeRect(0, 0, S, S);

    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(80, 80);   // piso de 160 m → junta a cada 2 m
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

export function createScene(canvas) {
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: !isCoarse,
        powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLOR.concrete);
    scene.fog = new THREE.Fog(COLOR.concrete, 26, 86);

    // Preenchimento do galpão + um único caster. Sem point lights.
    scene.add(new THREE.HemisphereLight(0xF5F3EE, 0x6E6A62, 1.55));

    const sun = new THREE.DirectionalLight(0xFFF6E2, 2.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isCoarse ? 512 : 1024, isCoarse ? 512 : 1024);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    // Câmera de sombra apertada e seguindo o veículo: nitidez sem mapa gigante.
    // ±14 e não ±9: em 1ª pessoa enxerga-se 20 m corredor abaixo, e com ±9 as
    // sombras terminavam num círculo visível em volta da máquina.
    const sc = sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14;
    sc.near = 1; sc.far = 46;
    scene.add(sun);
    scene.add(sun.target);

    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(160, 160),
        new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.96, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const camera = createCameraRig(innerWidth / innerHeight);

    /* ---------- qualidade adaptativa ---------- */
    const quality = {
        tier: 0,                                  // 0 = cheio, sobe = mais barato
        maxDpr: isCoarse ? 1.5 : 2,
        _hist: [], _cooldown: 2,
        step(dt) {
            this._cooldown -= dt;
            this._hist.push(dt);
            if (this._hist.length > 60) this._hist.shift();
            if (this._cooldown > 0 || this._hist.length < 60 || this.tier >= 2) return;
            const avg = this._hist.reduce((a, b) => a + b, 0) / this._hist.length;
            if (avg > 0.022) {                      // < ~45fps sustentado
                this.tier++;
                this._cooldown = 4;
                this._hist.length = 0;
                if (this.tier === 1) { this.maxDpr = 1; applyDpr(); }
                if (this.tier === 2) { renderer.shadowMap.enabled = false; scene.fog.far = 60; }
            }
        },
    };

    function applyDpr() {
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.maxDpr));
    }

    /* Letterbox em retrato. É o cenário mais provável — o decisor abre o link no
       WhatsApp, de pé, sem girar o aparelho. Em 390×844 a tela cheia entrega
       27° de FOV horizontal (buraco de fechadura) com os polegares justamente
       por cima da área onde o garfo aparece. Recortando para aspect ~0,91 são
       61° horizontais e sobra faixa opaca para os controles. */
    function resize() {
        const w = innerWidth, h = innerHeight;
        const retrato = h > w * 1.15;
        const vh = retrato ? Math.round(Math.min(h * 0.62, w * 1.10)) : h;

        camera.setViewport(w, vh);
        applyDpr();
        renderer.setSize(w, vh, true);   // updateStyle: o style inline ancora no topo
        document.body.classList.toggle('portrait', retrato);
    }
    applyDpr();
    resize();

    let rt;
    const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 120); };
    addEventListener('resize', onResize);
    addEventListener('orientationchange', onResize);
    // A barra de endereço do Safari muda a altura e faz o canvas dançar.
    if (window.visualViewport) visualViewport.addEventListener('resize', onResize);

    function followSun(t) {
        sun.position.set(t.x + 7, 12, t.z + 5);
        sun.target.position.set(t.x, 0, t.z);
        sun.target.updateMatrixWorld();
    }

    return { renderer, scene, camera, quality, sun, followSun, isCoarse };
}
