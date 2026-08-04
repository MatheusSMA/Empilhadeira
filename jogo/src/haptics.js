/* haptics.js — retorno tátil.
 *
 * `navigator.vibrate` existe no Android e NÃO existe no Safari do iPhone —
 * a Apple nunca expôs a API para a web. Não há contorno honesto: no iOS isso
 * é silencioso. Por isso vibração nunca é o único sinal de que algo
 * aconteceu; sempre acompanha mudança visual.
 *
 * Padrões curtos de propósito. Vibração longa em jogo lê como erro do
 * aparelho, não como resposta.
 */

const suportado = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let ligado = true;

const PADROES = {
    toque: 8,                  // qualquer botão
    aba: [5],                  // troca de aba: mais leve que um botão de ação
    entrar: [10, 30, 18],      // entrar no simulador
    engate: [14, 45, 26],      // o palete prendeu no garfo
    deposito: [22, 60, 40],    // missão concluída
    quaseAcidente: [10, 26, 10],
    // colisão é o único variável: a intensidade conta o tranco
    colisao: v => [Math.round(18 + Math.min(v, 2.2) * 20)],
};

/* Contadores de diagnóstico. "O celular não vibra" tem três causas possíveis e
 * de fora não dá para distinguir: o código não chamou, chamou e o navegador
 * recusou, ou o aparelho não tem a API. Sem contar, a investigação é chute. */
const diag = { tentou: 0, aceitou: 0, recusou: 0, ultimo: '—' };

export const haptics = {
    get suportado() { return suportado; },
    get diag() { return diag; },
    setLigado(v) { ligado = !!v; },

    /** @param {keyof PADROES} nome */
    toca(nome, arg) {
        diag.ultimo = nome;
        if (!ligado) return false;
        if (!suportado) { diag.recusou++; return false; }
        const p = PADROES[nome];
        if (!p) return false;
        diag.tentou++;
        try {
            // O retorno é o sinal: false = o navegador recusou (aba oculta, sem
            // gesto do usuário, vibração desligada no sistema).
            const ok = navigator.vibrate(typeof p === 'function' ? p(arg) : p);
            if (ok) diag.aceitou++; else diag.recusou++;
            return ok;
        } catch {
            diag.recusou++;
            return false;
        }
    },

    /** Resumo curto para a HUD de debug. */
    resumo() {
        if (!suportado) return 'SEM API (iOS não expõe vibração para a web)';
        return `${diag.aceitou}/${diag.tentou} aceitos · ${diag.ultimo}`;
    },
};
