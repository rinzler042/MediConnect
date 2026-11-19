'use strict';

const crypto = require('crypto');
const { HttpError } = require('./errors');

/**
 * Autenticación en dos pasos (RNF-01):
 *  1. POST /api/auth/login  -> genera un código OTP de 6 dígitos (desafío).
 *  2. POST /api/auth/verificar -> valida el código y emite un token de sesión.
 * El código se envía por correo/SMS en producción; en desarrollo se devuelve en la
 * respuesta cuando DEV_EXPOSE_OTP !== 'false' para poder probar sin servicio de correo.
 */

const DESAFIO_MIN = 5;
const SESION_HORAS = 8;

function iniciarDesafio(db, correo) {
  const usuario = db.usuarios.find((u) => u.correo === String(correo || '').toLowerCase());
  if (!usuario) throw new HttpError(404, 'Correo no registrado');

  const desafio = {
    id: crypto.randomUUID(),
    usuarioId: usuario.id,
    codigo: String(crypto.randomInt(100000, 1000000)),
    expira: Date.now() + DESAFIO_MIN * 60_000,
  };
  db.desafios.push(desafio);
  return desafio;
}

function verificarDesafio(db, desafioId, codigo) {
  const idx = db.desafios.findIndex((d) => d.id === desafioId);
  if (idx === -1) throw new HttpError(401, 'Desafío inexistente');
  const desafio = db.desafios[idx];

  if (Date.now() > desafio.expira) {
    db.desafios.splice(idx, 1);
    throw new HttpError(401, 'El código expiró; inicie sesión de nuevo');
  }
  if (desafio.codigo !== String(codigo)) throw new HttpError(401, 'Código incorrecto');

  db.desafios.splice(idx, 1);
  const token = crypto.randomUUID();
  db.sesiones.set(token, {
    usuarioId: desafio.usuarioId,
    dosFactores: true,
    expira: Date.now() + SESION_HORAS * 3_600_000,
  });
  return token;
}

/** Middleware: exige token válido y adjunta req.usuario y req.sesion. */
function autenticar(db) {
  return (req, _res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const sesion = db.sesiones.get(token);
    if (!sesion || sesion.expira < Date.now()) {
      return next(new HttpError(401, 'Sesión inválida o expirada'));
    }
    req.usuario = db.usuarios.find((u) => u.id === sesion.usuarioId);
    req.sesion = sesion;
    req.token = token;
    next();
  };
}

function requerirRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.usuario.rol)) return next(new HttpError(403, 'Sin permiso para esta operación'));
    next();
  };
}

/** Middleware: rutas clínicas requieren sesión con segundo factor verificado (RNF-01). */
function requerirDosFactores(req, _res, next) {
  if (!req.sesion.dosFactores) return next(new HttpError(403, 'Se requiere autenticación de dos factores'));
  next();
}

module.exports = { iniciarDesafio, verificarDesafio, autenticar, requerirRol, requerirDosFactores };
