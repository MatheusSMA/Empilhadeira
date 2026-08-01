/* tokens.js — paleta compartilhada. Módulo FOLHA: não importa nada.
 *
 * Existe para quebrar um ciclo real: scene.js → camera.js → forklift.js →
 * scene.js. Em módulos ES o ciclo é permitido, mas o `const COLOR` fica em zona
 * morta temporal e o módulo estoura na avaliação — com o agravante de que o
 * erro não aparece no console como erro de página. Ninguém deve voltar a
 * importar cor de scene.js.
 *
 * Espelha :root de ../index.html (linhas 14–28) e de ui.css.
 */

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
