// scripts/probarCarruselJuegos.js
//
// Pruebas del carrusel de juegos de la página principal.
//
// POR QUÉ EXISTE
// Es lo primero que ve un cliente que entra al sitio, y es lo que menos se
// mira desde adentro: nadie del local abre la página pública todos los días.
// Se prueban las dos cosas que se rompen en silencio:
//
//   1. Las flechas. Si la cuenta de "¿queda algo hacia ese lado?" falla, queda
//      un botón que no hace nada o —peor— una flecha apagada con juegos
//      escondidos detrás que el cliente nunca ve.
//   2. Las reglas de tamaño. Las 50 portadas vienen de todas las formas: 14
//      verticales tipo carátula, 17 casi cuadradas y 19 apaisadas. Van como
//      una tira de cine —mismo alto, ancho natural— porque obligarlas a un
//      marco común dejaba a unas con franjas de relleno y a otras diminutas.
//      Si alguien vuelve a fijarles un ancho o les pone `cover`, se rompe.
//
//   npm run probar-carrusel

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const aquí = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(aquí, '../../sala-juegos-frontend-vite/src');
const RUTA_LOGICA = path.join(FRONT, 'constants/carrusel.js');
const RUTA_CSS = path.join(FRONT, 'styles/CarruselJuegos.css');
const RUTA_COMPONENTE = path.join(FRONT, 'components/CarruselJuegos.jsx');

let logica;
try {
  logica = await import(pathToFileURL(RUTA_LOGICA).href);
} catch (err) {
  console.error(`No pude leer la lógica del carrusel en:\n  ${RUTA_LOGICA}`);
  console.error('Si moviste la carpeta del frontend, actualizá FRONT en este script.');
  console.error(err.message);
  process.exit(1);
}
const { puntasVisibles, pasoDeScroll, progresoDeScroll, MARGEN, PASO } = logica;

const css = fs.readFileSync(RUTA_CSS, 'utf8');
const componente = fs.readFileSync(RUTA_COMPONENTE, 'utf8');

// Una fila de 50 tarjetas en una ventana de 1200 px.
const fila = (scrollLeft) => ({ scrollLeft, clientWidth: 1200, scrollWidth: 9500 });

// ─── LAS FLECHAS ─────────────────────────────────────────────────────────────

test('al principio solo se puede ir a la derecha', () => {
  const { izquierda, derecha } = puntasVisibles(fila(0));
  assert.equal(izquierda, false, 'no hay nada hacia atrás');
  assert.equal(derecha, true, 'sí hay juegos hacia adelante');
});

test('en el medio se puede ir para los dos lados', () => {
  const { izquierda, derecha } = puntasVisibles(fila(4000));
  assert.equal(izquierda, true);
  assert.equal(derecha, true);
});

test('al final solo se puede volver', () => {
  const { izquierda, derecha } = puntasVisibles(fila(9500 - 1200));
  assert.equal(izquierda, true);
  assert.equal(derecha, false, 'no puede quedar una flecha que no hace nada');
});

test('el redondeo del navegador no deja una flecha fantasma', () => {
  // Chrome deja 8299.6 de 8300: sin holgura, la flecha derecha quedaría
  // encendida para siempre en el final.
  const casi = { scrollLeft: 9500 - 1200 - 3, clientWidth: 1200, scrollWidth: 9500 };
  assert.equal(puntasVisibles(casi).derecha, false, 'a 3 px del final ya es el final');
  assert.equal(puntasVisibles({ ...casi, scrollLeft: 2 }).izquierda, false, 'y 2 px es el principio');
  assert.ok(MARGEN >= 2 && MARGEN <= 20, 'la holgura tiene que ser chica, no tapar juegos');
});

test('si todos los juegos entran en pantalla, no hay flechas', () => {
  const cortito = { scrollLeft: 0, clientWidth: 1200, scrollWidth: 1200 };
  const { izquierda, derecha } = puntasVisibles(cortito);
  assert.equal(izquierda, false);
  assert.equal(derecha, false, 'con 3 juegos no se muestra una flecha inútil');
});

test('sin datos no revienta', () => {
  assert.deepEqual(puntasVisibles(), { izquierda: false, derecha: false });
  assert.deepEqual(puntasVisibles({}), { izquierda: false, derecha: false });
});

// ─── CUÁNTO AVANZA CADA TOQUE ────────────────────────────────────────────────

test('cada flecha avanza casi una pantalla, no una tarjeta', () => {
  assert.equal(pasoDeScroll(1200, 1), 1020);
  assert.equal(pasoDeScroll(1200, -1), -1020, 'hacia atrás, lo mismo');
  assert.ok(PASO > 0.5 && PASO < 1, 'menos de una pantalla: queda algo a la vista de referencia');
});

test('el paso se adapta a la pantalla: en un teléfono avanza menos', () => {
  const telefono = pasoDeScroll(360);
  const monitor = pasoDeScroll(1600);
  assert.ok(telefono < monitor, 'un teléfono no puede saltar lo mismo que un monitor');
  assert.ok(telefono > 0);
});

test('un ancho raro no rompe el cálculo', () => {
  assert.equal(pasoDeScroll(0), 0);
  assert.equal(pasoDeScroll(undefined), 0);
});

// ─── LA BARRITA DE POSICIÓN ──────────────────────────────────────────────────

test('la barrita dice qué parte se ve y dónde está', () => {
  const alPrincipio = progresoDeScroll(fila(0));
  assert.equal(alPrincipio.avance, 0);
  assert.ok(alPrincipio.visible > 0.12 && alPrincipio.visible < 0.14,
    'de 9500 px de fila, en 1200 se ve algo más de un octavo');

  const alFinal = progresoDeScroll(fila(9500 - 1200));
  assert.equal(alFinal.avance, 1, 'al final la barrita llega al tope');

  const medio = progresoDeScroll(fila((9500 - 1200) / 2));
  assert.ok(Math.abs(medio.avance - 0.5) < 0.01, 'a mitad de camino, la mitad');
});

test('si todo entra en pantalla, no hay barrita que mostrar', () => {
  const { visible, avance } = progresoDeScroll({ scrollLeft: 0, clientWidth: 1200, scrollWidth: 1200 });
  assert.equal(visible, 1, 'visible = 1 es la señal de que no hay nada escondido');
  assert.equal(avance, 0);
});

test('la barrita nunca se sale de sus límites', () => {
  // El rebote del iPhone deja scrollLeft negativo o pasado del final.
  assert.equal(progresoDeScroll({ scrollLeft: -80, clientWidth: 1200, scrollWidth: 9500 }).avance, 0);
  assert.equal(progresoDeScroll({ scrollLeft: 99999, clientWidth: 1200, scrollWidth: 9500 }).avance, 1);
  assert.deepEqual(progresoDeScroll(), { visible: 1, avance: 0 });
});

// ─── QUE SE VEA BIEN EN CUALQUIER PANTALLA ───────────────────────────────────

test('el alto se adapta a la pantalla, y en el teléfono no es diminuto', () => {
  assert.match(css, /--cj-alto:\s*clamp\(/,
    'con un alto fijo, en un monitor grande quedan chiquitas y en un teléfono no se ven');
  const [, min, max] = css.match(/--cj-alto:\s*clamp\(\s*(\d+)px[^,]*,[^,]+,\s*(\d+)px/) || [];
  assert.ok(Number(min) >= 170, `en el teléfono (${min}px) tiene que verse grande`);
  // La portada más ancha de la sala es 1.85. A este alto mide min*1.85 de
  // ancho, y eso tiene que entrar en un teléfono de 360px con sus márgenes.
  assert.ok(Number(min) * 1.85 < 345,
    `a ${min}px de alto, la foto más ancha (333px+) se sale de la pantalla del teléfono`);
  assert.ok(Number(max) >= 200 && Number(max) <= 280, `el máximo (${max}px) no puede ser gigante`);
});

test('la portada se ve entera y a su forma: ni recortada ni rellenada', () => {
  assert.match(css, /\.cj-img\s*{[^}]*height:\s*100%/s, 'el alto lo pone la fila');
  assert.match(css, /\.cj-img\s*{[^}]*width:\s*auto/s, 'y el ancho lo pone la foto');
  assert.ok(!/\.cj-img\s*{[^}]*object-fit:\s*cover/s.test(css), 'cover recorta');
  assert.ok(!/\.cj-foto\s*{[^}]*aspect-ratio/s.test(css),
    'forzar una proporción común es lo que dejaba franjas de relleno');
  assert.ok(!componente.includes('cj-fondo'),
    'con el ancho natural ya no hace falta el fondo borroso que rellenaba');
});

test('un nombre largo no ensancha la tarjeta más que su foto', () => {
  assert.match(css, /\.cj-nombre\s*{[^}]*width:\s*0/s,
    'el texto no puede contar para medir la tarjeta');
  assert.match(css, /\.cj-nombre\s*{[^}]*min-width:\s*100%/s,
    'pero después tiene que ocupar el ancho que definió la foto');
});

test('en el teléfono no se muestran las flechas: ahí se arrastra', () => {
  assert.match(css, /\.cj-flecha\s*{[^}]*display:\s*none/s, 'apagadas por defecto');
  assert.match(css, /@media\s*\(hover:\s*hover\)\s*and\s*\(min-width:\s*768px\)/,
    'solo aparecen con mouse y con espacio');
});

test('las flechas no pueden empujar la página a lo ancho', () => {
  const izq = css.match(/\.cj-flecha--izq\s*{\s*left:\s*(-?\d+)px/);
  const der = css.match(/\.cj-flecha--der\s*{\s*right:\s*(-?\d+)px/);
  assert.ok(izq && der, 'las flechas tienen que estar posicionadas');
  assert.ok(Number(izq[1]) >= 0, 'una flecha fuera del borde crea barra horizontal en pantallas angostas');
  assert.ok(Number(der[1]) >= 0);
});

test('un nombre largo no desalinea la fila', () => {
  assert.match(css, /\.cj-nombre\s*{[^}]*-webkit-line-clamp:\s*2/s, 'máximo dos líneas');
  assert.match(css, /\.cj-nombre\s*{[^}]*min-height/s, 'y una altura pareja para todas');
});

test('la barra de desplazamiento no se ve, pero se puede arrastrar', () => {
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /overflow-x:\s*auto/, 'auto y no hidden: el dedo tiene que poder arrastrar');
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/, 'inercia en iPhone');
});

test('quien pidió menos movimiento no recibe animaciones', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

// ─── EL COMPONENTE ───────────────────────────────────────────────────────────

test('el componente usa la lógica probada, no su propia cuenta', () => {
  assert.match(componente, /puntasVisibles\(/, 'las flechas salen de la función probada');
  assert.match(componente, /pasoDeScroll\(/, 'el avance también');
  assert.ok(!/scrollLeft\s*>\s*\d/.test(componente), 'no puede haber una cuenta suelta dentro del componente');
});

test('cada portada dice de qué juego es', () => {
  assert.match(componente, /alt=\{juego\.nombre\}/, 'sin alt, un lector de pantalla no dice nada');
  const imgs = (componente.match(/<img /g) || []).length;
  assert.equal(imgs, 1, 'una sola imagen por tarjeta: la copia borrosa ya no hace falta');
});

test('las flechas se apagan y se explican solas', () => {
  assert.match(componente, /disabled=\{!puedeIzq\}/);
  assert.match(componente, /disabled=\{!puedeDer\}/);
  assert.match(componente, /aria-label="Ver juegos anteriores"/);
  assert.match(componente, /aria-label="Ver más juegos"/);
});

test('sin juegos no se dibuja un carrusel vacío', () => {
  assert.match(componente, /if \(!juegos\?\.length\) return null/);
});

// ─── PENSADO PARA DEDOS ──────────────────────────────────────────────────────

test('la tarjeta responde al toque: con el dedo no hay hover', () => {
  assert.match(css, /\.cj-item:active\s*{[^}]*transform/s,
    'sin respuesta al toque, la pantalla se siente trabada');
});

test('las tarjetas no son enlaces: no puede haber un toque que lleve a la nada', () => {
  // Ojo: "<a" también coincide con "<article", por eso se busca el href.
  assert.ok(
    !/href=/.test(componente),
    'los 50 juegos apuntaban al mismo catálogo genérico de PS Plus, que ya está en el botón de abajo'
  );
  assert.match(componente, /<article className="cj-item"/);
});

test('la barrita es informativa, no un control diminuto', () => {
  assert.match(componente, /className="cj-barra" aria-hidden="true"/,
    'no se le lee al lector de pantalla: las flechas ya dicen el estado');
  assert.ok(!/onClick[\s\S]{0,40}cj-barra/.test(componente),
    'un riel de 4 px es un blanco imposible para un dedo: no puede ser tocable');
  const alto = css.match(/\.cj-barra\s*{[^}]*height:\s*(\d+)px/s);
  assert.ok(alto && Number(alto[1]) <= 6, 'tiene que ser una línea fina, no una barra de scroll');
});

test('la barrita se esconde cuando no hay nada más que ver', () => {
  assert.match(componente, /hayMas && \(/, 'con pocos juegos no se muestra una barra llena');
  assert.match(componente, /barra\.visible < 1/);
});

test('el teclado mueve una pantalla, no tres píxeles', () => {
  assert.match(componente, /ArrowRight/);
  assert.match(componente, /ArrowLeft/);
  assert.match(componente, /preventDefault/, 'para que no lo pise el desplazamiento del navegador');
});
