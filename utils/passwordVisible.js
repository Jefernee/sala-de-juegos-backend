// utils/passwordVisible.js
// Cifrado RECUPERABLE de contraseñas para que SOLO el
// administrador pueda verlas en el módulo de Usuarios.
//
// OJO: esto es distinto del hash bcrypt del login (que es de un solo sentido y
// NO se puede revertir). Acá guardamos aparte una copia cifrada de forma
// reversible (AES-256-GCM) para poder mostrarla. La llave se deriva del
// JWT_SECRET, así que no hay que configurar nada nuevo. Si el JWT_SECRET cambia,
// las copias viejas dejan de poder leerse (habría que reasignar contraseñas).
import crypto from 'crypto';

// Llave de 32 bytes derivada del JWT_SECRET.
const getKey = () => crypto.createHash('sha256').update(String(process.env.JWT_SECRET || '')).digest();

// Cifra un texto → "iv:authTag:ciphertext" (hex). Retorna null si no hay texto.
export const cifrarPassword = (texto) => {
  if (!texto) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

// Descifra "iv:authTag:ciphertext" → texto original. Retorna null si falla
// (formato viejo, llave distinta, dato corrupto). Nunca lanza.
export const descifrarPassword = (guardado) => {
  if (!guardado) return null;
  try {
    const [ivHex, tagHex, dataHex] = String(guardado).split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
};
