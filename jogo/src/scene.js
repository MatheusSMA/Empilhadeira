/* scene.js — renderer, luz, chão, câmera-mola e degrade adaptativo de qualidade. */

import * as THREE from 'three';

export const COLOR = {
    ink: 0x14181C,
    steel: 0x2E353D,
    slate: 0x5C666F,
    line: 0xC9C6BE,
    concrete: 0xE6E3DC,
    paper: 0xF5F3EE,
    white: 0xFCFBF8,
    hazard: 0xF0B208,
    signal: 0xB8352B,
    deep: 0x1F5C51,
};

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
    t.repeat.set(40, 40);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

/* ---------- câmera-mola ----------
   O yaw da câmera persegue MAIS DEVAGAR que o do chassi: é isso que faz a
   traseira aparecer varrendo na curva — a leitura visual do esterço traseiro. */
class ChaseCamera {
    constructor(aspect) {
        this.cam = new THREE.PerspectiveCamera(55, aspect, 0.1, 220);
        this.pos = new THREE.Vector3(0, 3, -6);
        this.look = new THREE.Vector3();
        this.yaw = 0;
        this.fov = 55;
        this.shake = 0;
        this._t = new THREE.Vector3();
    }

    snapTo(target) {
        this.yaw = target.yaw;
        this.update(1, target);
        this.pos.copy(this._desired(target));
        this.cam.position.copy(this.pos);
    }

    _desired(t) {
        const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        return this._t.set(t.x, 0, t.z)
            .addScaledVector(f, -5.6)
            .add(new THREE.Vector3(0, 2.7, 0));
    }

    update(dt, t) {
        // aproximação exponencial: independente de framerate
        const kYaw = 1 - Math.exp(-3.0 * dt);
        let d = t.yaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));   // menor arco
        this.yaw += d * kYaw;

        const kPos = 1 - Math.exp(-6.0 * dt);
        this.pos.lerp(this._desired(t), kPos);

        // FOV cresce com a velocidade: sensação de andamento sem mudar nada na física
        const want = 55 + 6 * Math.min(Math.abs(t.speed) / 3.0, 1);
        this.fov += (want - this.fov) * (1 - Math.exp(-4 * dt));
        if (Math.abs(this.cam.fov - this.fov) > 0.01) {
            this.cam.fov = this.fov;
            this.cam.updateProjectionMatrix();
        }

        this.cam.position.copy(this.pos);
        if (this.shake > 0) {
            this.cam.position.x += (Math.random() - 0.5) * this.shake;
            this.cam.position.y += (Math.random() - 0.5) * this.shake;
            this.shake = Math.max(0, this.shake - dt * 0.9);
        }

        const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
        this.look.lerp(this._t.set(t.x, 1.05, t.z).addScaledVector(fwd, 3.4), 1 - Math.exp(-7 * dt));
        this.cam.lookAt(this.look);
    }

    kick(a) { this.shake = Math.min(0.4, this.shake + a); }
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
    // Câmera de sombra APERTADA e seguindo o veículo: nitidez sem mapa gigante.
    const sc = sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9;
    sc.near = 1; sc.far = 40;
    scene.add(sun);
    scene.add(sun.target);

    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(160, 160),
        new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.96, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const camera = new ChaseCamera(innerWidth / innerHeight);

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

    function resize() {
        const w = innerWidth, h = innerHeight;
        camera.cam.aspect = w / h;
        camera.cam.updateProjectionMatrix();
        applyDpr();
        renderer.setSize(w, h, false);
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
