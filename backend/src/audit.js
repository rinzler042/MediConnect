'use strict';

const crypto = require('crypto');

/**
 * Bitácora de auditoría tipo WORM (RNF-03): las entradas se congelan al escribirse
 * y cada una encadena el hash de la anterior, así cualquier alteración es detectable.
 */

const GENESIS = 'GENESIS';

function calcularHash(previo, cuerpo) {
  return crypto.createHash('sha256').update(previo + JSON.stringify(cuerpo)).digest('hex');
}

function registrar(db, { usuarioId, accion, recurso, detalle = {} }) {
  const previo = db.auditoria.length ? db.auditoria[db.auditoria.length - 1].hash : GENESIS;
  const cuerpo = { usuarioId, accion, recurso, detalle, ts: new Date().toISOString() };
  const entrada = Object.freeze({ ...cuerpo, hash: calcularHash(previo, cuerpo) });
  db.auditoria.push(entrada);
  return entrada;
}

function verificarIntegridad(db) {
  let previo = GENESIS;
  for (let i = 0; i < db.auditoria.length; i++) {
    const { hash, ...cuerpo } = db.auditoria[i];
    if (calcularHash(previo, cuerpo) !== hash) {
      return { valida: false, indiceAlterado: i, total: db.auditoria.length };
    }
    previo = hash;
  }
  return { valida: true, total: db.auditoria.length };
}

module.exports = { registrar, verificarIntegridad };
