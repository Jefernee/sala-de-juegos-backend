// scripts/medirPortadas.js
//
// Completa las medidas de las portadas que se subieron antes de que el sistema
// las guardara. Le pregunta el tamaño a Cloudinary con `fl_getinfo`, que
// responde sobre la misma URL pública y no necesita credenciales.
//
//   npm run medir-portadas -- --dry    → dice qué mediría, sin escribir
//   npm run medir-portadas             → lo aplica
//
// POR QUÉ HACEN FALTA
// El carrusel de la página le da a cada foto el ancho que le toca por su
// forma, y las de más allá se bajan recién cuando hacen falta. Una foto que
// todavía no llegó mide CERO, así que sin las medidas la fila entera mide mal:
// el carrusel cree que todo cabe en pantalla y la barrita sale llena. Con las
// medidas, el navegador reserva el espacio exacto desde el primer dibujo.
//
// Solo toca las fichas a las que les falta el dato. Correrlo dos veces no
// cambia nada.
import https from 'https';
import { connectDB, mongoose } from '../db.js';
import Juego from '../models/Juego.js';

const dry = process.argv.includes('--dry');

// Le pregunta a Cloudinary cuánto mide la imagen de esa URL.
const medir = (url) =>
  new Promise((resolve) => {
    const consulta = url.replace('/upload/', '/upload/fl_getinfo/');
    const pedido = https.get(consulta, (res) => {
      let cuerpo = '';
      res.on('data', (d) => (cuerpo += d));
      res.on('end', () => {
        try {
          const datos = JSON.parse(cuerpo);
          const info = datos.output || datos;
          resolve(info?.width && info?.height ? { ancho: info.width, alto: info.height } : null);
        } catch {
          resolve(null);
        }
      });
    });
    pedido.on('error', () => resolve(null));
    pedido.setTimeout(15000, () => { pedido.destroy(); resolve(null); });
  });

await connectDB();

const pendientes = await Juego.find({
  imagenUrl: { $ne: null },
  $or: [{ imagenAncho: null }, { imagenAlto: null }],
})
  .select('nombre imagenUrl')
  .lean();

console.log(`\nPortadas sin medir: ${pendientes.length}\n`);

let medidas = 0;
const fallaron = [];

for (const juego of pendientes) {
  const tamano = await medir(juego.imagenUrl);
  if (!tamano) {
    fallaron.push(juego.nombre);
    continue;
  }
  const forma =
    tamano.ancho / tamano.alto > 1.2 ? 'acostada' :
    tamano.ancho / tamano.alto < 0.85 ? 'vertical' : 'cuadrada';
  console.log(`  ${String(tamano.ancho).padStart(4)}x${String(tamano.alto).padEnd(4)} ${forma.padEnd(9)} ${juego.nombre}`);

  if (!dry) {
    await Juego.updateOne(
      { _id: juego._id },
      { $set: { imagenAncho: tamano.ancho, imagenAlto: tamano.alto } }
    );
  }
  medidas++;
}

console.log(`\n${dry ? 'SE MEDIRÍAN' : 'MEDIDAS'}: ${medidas}`);
if (fallaron.length) {
  console.log(`\n⚠️  No se pudieron medir (${fallaron.length}): ${fallaron.join(', ')}`);
  console.log('   Esas van a seguir sin reservar su espacio; se arregla volviéndoles a subir la portada.');
}
if (dry) console.log('\nPara aplicarlo:  npm run medir-portadas\n');

await mongoose.disconnect();
