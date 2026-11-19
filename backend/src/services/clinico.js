'use strict';

const { HttpError } = require('../errors');
const audit = require('../audit');

/**
 * Módulo clínico.
 *  - RF-02: expediente clínico único por paciente con consultas (signos vitales, CIE-11, notas).
 *  - RES-02: diagnósticos codificados conforme a CIE-11.
 *  - RNF-01: acceso al expediente solo para personal clínico con 2FA (la ruta lo exige).
 *  - RNF-03: toda lectura o modificación queda en auditoría.
 *  - RF-03: recetas vinculadas al inventario.
 *  - RN-01: impedir la receta si hay alergia severa incompatible y alertar al médico.
 */

const CLINICOS = ['medico', 'enfermero'];
// Formato CIE-11 simplificado: categoría alfanumérica con extensión opcional (p. ej. BA00, CA40.0).
const PATRON_CIE11 = /^[A-Z0-9]{2,4}(\.[A-Z0-9]{1,4})?$/;
const SIGNOS_NUMERICOS = ['presionSistolica', 'presionDiastolica', 'frecuenciaCardiaca', 'temperatura', 'peso'];

function buscarExpediente(db, pacienteId) {
  const expediente = db.expedientes.find((e) => e.pacienteId === pacienteId);
  if (!expediente) throw new HttpError(404, 'Expediente no encontrado');
  return expediente;
}

function obtenerExpediente(db, pacienteId, usuario) {
  if (usuario.rol === 'paciente' && usuario.pacienteId !== pacienteId) {
    throw new HttpError(403, 'Solo puede consultar su propio expediente');
  }
  if (!CLINICOS.includes(usuario.rol) && usuario.rol !== 'paciente') {
    throw new HttpError(403, 'Sin permiso para consultar expedientes');
  }
  const expediente = buscarExpediente(db, pacienteId);
  const paciente = db.pacientes.find((p) => p.id === pacienteId);
  audit.registrar(db, { usuarioId: usuario.id, accion: 'leer_expediente', recurso: expediente.id });
  return {
    ...expediente,
    paciente: { id: paciente.id, nombre: paciente.nombre, alergias: paciente.alergias },
  };
}

function validarConsulta(datos) {
  const errores = [];
  if (!datos.citaId) errores.push('citaId es obligatorio');
  if (!PATRON_CIE11.test(String(datos.diagnosticoCIE11 || '').toUpperCase())) {
    errores.push('diagnosticoCIE11 no tiene un formato CIE-11 válido');
  }
  if (!String(datos.notasEvolucion || '').trim()) errores.push('notasEvolucion es obligatorio');

  const signos = datos.signosVitales || {};
  for (const campo of SIGNOS_NUMERICOS) {
    if (signos[campo] !== undefined && typeof signos[campo] !== 'number') {
      errores.push(`signosVitales.${campo} debe ser numérico`);
    }
  }
  if (errores.length) throw new HttpError(400, 'Consulta inválida', { errores });
}

function registrarConsulta(db, pacienteId, datos, usuario) {
  if (!CLINICOS.includes(usuario.rol)) throw new HttpError(403, 'Solo personal clínico registra consultas');
  validarConsulta(datos);

  const expediente = buscarExpediente(db, pacienteId);
  const cita = db.citas.find((c) => c.id === datos.citaId);
  if (!cita || cita.pacienteId !== pacienteId) throw new HttpError(400, 'La cita no corresponde a este paciente');
  if (usuario.rol === 'medico' && cita.medicoId !== usuario.medicoId) {
    throw new HttpError(403, 'La cita pertenece a otro médico');
  }
  if (['Cancelada', 'Completada'].includes(cita.estado)) throw new HttpError(409, 'La cita no admite consulta');

  const consulta = {
    id: `consulta-${++db.contadores.consulta}`,
    citaId: cita.id,
    pacienteId,
    medicoId: cita.medicoId,
    fecha: new Date().toISOString(),
    signosVitales: { ...datos.signosVitales },
    diagnosticoCIE11: datos.diagnosticoCIE11.toUpperCase(),
    notasEvolucion: datos.notasEvolucion.trim(),
    recetaId: null,
  };
  expediente.consultas.push(consulta);
  cita.estado = 'Completada';
  cita.consultaId = consulta.id;
  audit.registrar(db, { usuarioId: usuario.id, accion: 'registrar_consulta', recurso: expediente.id, detalle: { consulta: consulta.id } });
  return consulta;
}

/** Alergias severas que coinciden con los componentes contraindicados del medicamento (RN-01). */
function alertasAlergia(paciente, medicamento) {
  return paciente.alergias
    .filter((a) => a.severidad === 'severa')
    .filter((a) => medicamento.contraindicaciones.includes(a.sustancia.toLowerCase()))
    .map((a) => ({ medicamento: medicamento.nombre, alergia: a.sustancia, severidad: a.severidad }));
}

function buscarConsulta(db, consultaId) {
  for (const exp of db.expedientes) {
    const consulta = exp.consultas.find((c) => c.id === consultaId);
    if (consulta) return consulta;
  }
  throw new HttpError(404, 'Consulta no encontrada');
}

/**
 * RF-03 + RN-01: valida alergias y existencias antes de tocar el inventario.
 * Si algo falla, nada se modifica (operación atómica en memoria).
 */
function emitirReceta(db, { consultaId, items }, usuario) {
  if (usuario.rol !== 'medico') throw new HttpError(403, 'Solo médicos emiten recetas');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'La receta requiere al menos un medicamento');

  const consulta = buscarConsulta(db, consultaId);
  if (consulta.medicoId !== usuario.medicoId) throw new HttpError(403, 'La consulta pertenece a otro médico');
  if (consulta.recetaId) throw new HttpError(409, 'La consulta ya tiene receta');

  const paciente = db.pacientes.find((p) => p.id === consulta.pacienteId);
  const lineas = items.map((item) => {
    const medicamento = db.medicamentos.find((m) => m.id === item.medicamentoId);
    if (!medicamento) throw new HttpError(400, `Medicamento ${item.medicamentoId} no existe`);
    const cantidad = Number(item.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new HttpError(400, 'Cantidad inválida');
    return { medicamento, cantidad };
  });

  const alertas = lineas.flatMap(({ medicamento }) => alertasAlergia(paciente, medicamento));
  if (alertas.length) {
    audit.registrar(db, { usuarioId: usuario.id, accion: 'receta_bloqueada_alergia', recurso: consultaId, detalle: { alertas } });
    throw new HttpError(409, 'Receta bloqueada: alergia severa incompatible', { alertas });
  }

  const sinStock = lineas.filter(({ medicamento, cantidad }) => medicamento.existencia < cantidad);
  if (sinStock.length) {
    throw new HttpError(409, 'Existencia insuficiente', {
      faltantes: sinStock.map(({ medicamento }) => medicamento.nombre),
    });
  }

  lineas.forEach(({ medicamento, cantidad }) => { medicamento.existencia -= cantidad; });

  const receta = {
    id: `receta-${++db.contadores.receta}`,
    folio: `REC-${String(db.contadores.receta).padStart(6, '0')}`,
    consultaId,
    pacienteId: paciente.id,
    medicoId: usuario.medicoId,
    items: lineas.map(({ medicamento, cantidad }) => ({ medicamentoId: medicamento.id, nombre: medicamento.nombre, cantidad })),
    fechaEmision: new Date().toISOString(),
  };
  db.recetas.push(receta);
  consulta.recetaId = receta.id;
  audit.registrar(db, { usuarioId: usuario.id, accion: 'emitir_receta', recurso: receta.folio });
  return receta;
}

function listarMedicamentos(db) {
  return db.medicamentos.map(({ id, nombre, existencia, contraindicaciones }) => ({ id, nombre, existencia, contraindicaciones }));
}

module.exports = { obtenerExpediente, registrarConsulta, emitirReceta, listarMedicamentos, alertasAlergia, PATRON_CIE11 };
