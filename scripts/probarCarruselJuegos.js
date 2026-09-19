// scripts/probarCarruselJuegos.js
//
// Pruebas del carrusel de juegos de la página principal.
//
// POR QUÉ EXISTE
// Es lo primero que ve un cliente que entra al sitio, y es lo que menos se
// mira desde adentro: nadie del local abre la página pública todos los días.
// Se prueban las dos cosas que se rompen en silencio:
//
//   1. El giro sin fin. La fila se dibuja tres veces y se reubica sola entre
//      copias; si la cuenta falla, o el carrusel se frena contra un borde
//      —que es lo que se quiso sacar— o da un tirón visible a mitad del
//      deslizamiento, justo cuando alguien lo está usando.
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
const CARPETA_ESTILOS = path.join(FRONT, 'styles');

let logica;
try {
  logica = await import(pathToFileURL(RUTA_LOGICA).href);
} catch (err) {
  console.error(`No pude leer la lógica del carrusel en:\n  ${RUTA_LOGICA}`);
  console.error('Si moviste la carpeta del frontend, actualizá FRONT en este script.');
  console.error(err.message);
  process.exit(1);
}
const { COPIAS, acomodarCiclo, pasoDeScroll, progresoCiclico, PASO } = logica;

const css = fs.readFileSync(RUTA_CSS, 'utf8');
const componente = fs.readFileSync(RUTA_COMPONENTE, 'utf8');

// Una fila de 50 tarjetas en una ventana de 1200 px.
const fila = (scrollLeft) => ({ scrollLeft, clientWidth: 1200, scrollWidth: 9500 });

// ─── EL GIRO SIN FIN ─────────────────────────────────────────────────────────

// Una vuelta de 50 tarjetas mide 3000 px; el carrete son tres, o sea 9000.
const COPIA = 3000;
const enPista = (scrollLeft) => ({ scrollLeft, anchoCopia: COPIA });

test('son tres copias: con dos no alcanza el margen', () => {
  assert.equal(COPIAS, 3);
});

test('en la copia del medio no se toca nada', () => {
  // Toda la zona buena va de media copia a copia y media.
  assert.equal(acomodarCiclo(enPista(COPIA)), null, 'el arranque está en la zona buena');
  assert.equal(acomodarCiclo(enPista(COPIA * 1.2)), null);
  assert.equal(acomodarCiclo(enPista(COPIA * 0.8)), null);
});

test('si se desliza hacia atrás de más, se reubica una vuelta adelante', () => {
  // Es lo que hace que NO haya freno a la izquierda: se sigue deslizando y
  // por detrás la fila vuelve al medio, sin que se note.
  assert.equal(acomodarCiclo(enPista(COPIA * 0.4)), COPIA * 1.4);
  assert.equal(acomodarCiclo(enPista(0)), COPIA, 'ni siquiera el tope de la izquierda frena');
});

test('si se desliza hacia adelante de más, se reubica una vuelta atrás', () => {
  assert.equal(acomodarCiclo(enPista(COPIA * 1.6)), COPIA * 0.6);
  // Desde muy lejos salta las copias que haga falta de una sola vez: dos
  // correcciones seguidas sí se notan como un tirón.
  assert.equal(acomodarCiclo(enPista(COPIA * 3)), COPIA);
});

test('la reubicación siempre cae en la zona buena', () => {
  // Si dejara la fila fuera del medio, la corrección se dispararía otra vez y
  // el carrusel temblaría.
  for (const donde of [0, 100, COPIA * 0.49, COPIA * 1.51, COPIA * 2, COPIA * 2.9]) {
    const destino = acomodarCiclo(enPista(donde));
    if (destino === null) continue;
    assert.equal(acomodarCiclo(enPista(destino)), null,
      `al reubicar desde ${donde} quedó en ${destino}, que vuelve a corregirse`);
  }
});

test('sin medidas todavía, no se reubica nada', () => {
  // Antes de que el navegador mida la fila, mover algo la rompería.
  assert.equal(acomodarCiclo({ scrollLeft: 0, anchoCopia: 0 }), null);
  assert.equal(acomodarCiclo(), null);
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

test('la barrita mide contra UNA vuelta, no contra las tres copias', () => {
  const { visible } = progresoCiclico({ scrollLeft: COPIA, clientWidth: 1200, anchoCopia: COPIA });
  assert.ok(visible > 0.39 && visible < 0.41,
    'en 1200 px se ve un 40% de una vuelta de 3000, no un 13% del carrete entero');
});

test('la barrita recorre y vuelve a empezar, como el carrusel', () => {
  const avance = (x) => progresoCiclico({ scrollLeft: x, clientWidth: 1200, anchoCopia: COPIA }).avance;
  assert.equal(avance(COPIA), 0, 'el principio de cualquier vuelta es el principio');
  assert.ok(Math.abs(avance(COPIA * 1.5) - 0.5) < 0.01, 'a media vuelta, la mitad');
  assert.equal(avance(COPIA * 2), 0, 'y en la vuelta siguiente vuelve a arrancar');
});

test('la barrita aguanta el rebote del iPhone', () => {
  // El rebote deja scrollLeft negativo un instante.
  const { avance } = progresoCiclico({ scrollLeft: -80, clientWidth: 1200, anchoCopia: COPIA });
  assert.ok(avance >= 0 && avance <= 1, `se salió de los límites: ${avance}`);
  assert.deepEqual(progresoCiclico(), { visible: 1, avance: 0 });
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

// ─── QUE NADIE LE GANE AL CARRUSEL ───────────────────────────────────────────

test('ninguna otra regla puede recortar las portadas del carrusel', () => {
  // Esto ya pasó una vez y costó encontrarlo: la grilla vieja de 4 juegos
  // dejó `#games img { width:200px; height:200px; object-fit:cover }` en
  // Home.css. Al llevar un ID, esa regla le GANA en especificidad a .cj-img
  // aunque el carrusel esté bien escrito, y recorta TODAS las portadas a un
  // cuadrado. Desde afuera parece que el carrusel está mal.
  const archivos = fs.readdirSync(CARPETA_ESTILOS).filter((f) => f.endsWith('.css'));
  const culpables = [];

  for (const archivo of archivos) {
    if (archivo === 'CarruselJuegos.css') continue;
    const crudo = fs.readFileSync(path.join(CARPETA_ESTILOS, archivo), 'utf8');
    // Los comentarios se quitan primero: el que explica este mismo bug nombra
    // la regla culpable, y sin esto la prueba se acusaba a sí misma.
    const texto = crudo.replace(/\/\*[\s\S]*?\*\//g, '');
    // Se buscan reglas que apunten a imágenes DENTRO de la sección de juegos.
    for (const regla of texto.match(/#games[^{}]*img[^{}]*{[^}]*}/g) || []) {
      culpables.push(`${archivo}: ${regla.split('{')[0].trim()}`);
    }
  }

  assert.deepEqual(
    culpables,
    [],
    `Estas reglas le ganan al carrusel y le recortan las portadas: ${culpables.join(' | ')}`
  );
});

// ─── EL COMPONENTE ───────────────────────────────────────────────────────────

test('el componente usa la lógica probada, no su propia cuenta', () => {
  assert.match(componente, /acomodarCiclo\(/, 'el giro sale de la función probada');
  assert.match(componente, /progresoCiclico\(/, 'y la barrita también');
  assert.ok(!/scrollLeft\s*[><]\s*\d/.test(componente), 'no puede haber una cuenta suelta dentro del componente');
});

test('cada portada dice de qué juego es', () => {
  assert.match(componente, /alt=\{juego\.nombre\}/, 'sin alt, un lector de pantalla no dice nada');
  // El \s cubre que la etiqueta esté partida en varias líneas por los atributos.
  const imgs = (componente.match(/<img\s/g) || []).length;
  assert.equal(imgs, 1, 'una sola imagen por tarjeta: la copia borrosa ya no hace falta');
});

test('cada foto lleva sus medidas: sin eso la fila mide mal y la barrita miente', () => {
  // Las fotos de más allá se bajan recién cuando hacen falta, y una que no
  // llegó mide CERO. Sin width/height, la fila entera mide mal desde el
  // arranque: el carrusel cree que todo cabe en pantalla y la barrita sale
  // llena, como si no hubiera nada más que ver.
  assert.match(componente, /width=\{juego\.ancho \|\| undefined\}/);
  assert.match(componente, /height=\{juego\.alto \|\| undefined\}/);
});

test('se vuelve a medir cuando cada foto termina de cargar', () => {
  assert.match(componente, /onLoad=\{remedir\}/, 'las medidas cambian a medida que llegan');
  assert.match(componente, /tocado\.current/,
    'pero si la persona ya tocó el carrusel, no se le mueve la fila por debajo');
});

test('el componente dibuja las tres copias y solo le lee una al lector', () => {
  assert.match(componente, /copias\.map\(/, 'la fila se repite para poder girar');
  assert.match(componente, /aria-hidden=\{copia !== 1/,
    'repetir 150 nombres a un lector de pantalla sería ruido');
  assert.match(componente, /key=\{`\$\{copia\}-\$\{juego\.id\}`\}/,
    'cada copia necesita su propia clave o React se confunde');
});

test('el salto entre copias va sin animación', () => {
  assert.match(componente, /scrollBehavior = "auto"/,
    'con el desplazamiento suave, el salto se veria como un viaje relámpago');
  assert.match(componente, /ubicarSinAnimar\(/);
});

test('el carrusel no usa scroll-snap: pelea con el giro', () => {
  assert.ok(!/scroll-snap-type:\s*x/.test(css),
    'el imán del snap tira de la fila justo cuando se está reubicando');
});

test('las flechas se explican solas y solo salen si hay adónde ir', () => {
  assert.match(componente, /aria-label="Ver juegos anteriores"/);
  assert.match(componente, /aria-label="Ver más juegos"/);
  assert.ok(!componente.includes('disabled={!puedeIzq}'),
    'ya no se apagan: el carrusel gira sin fin, siempre hay adónde ir');
  const conFlechas = (componente.match(/\{hayMas && \(/g) || []).length;
  assert.ok(conFlechas >= 2, 'con todo a la vista, una flecha que da la vuelta a nada confunde');
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
  assert.match(componente, /<article[\s\S]{0,80}className="cj-item"/);
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
