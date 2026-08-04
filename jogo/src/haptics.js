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

export const haptics = {
    get suportado() { return suportado; },
    setLigado(v) { ligado = !!v; },

    /** @param {keyof PADROES} nome */
    toca(nome, arg) {
        if (!suportado || !ligado) return false;
        const p = PADROES[nome];
        if (!p) return false;
        try {
            navigator.vibrate(typeof p === 'function' ? p(arg) : p);
            return true;
        } catch {
            return false;   // alguns navegadores lançam quando a aba está oculta
        }
    },
};
