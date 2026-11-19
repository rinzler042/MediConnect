'use strict';

const { HttpError } = require('../errors');
const audit = require('../audit');

/**
 * Reglas de citas.
 *  - RF-01: agendar, reprogramar y cancelar citas según disponibilidad.
 *  - RF-05: recordatorio 24 h antes; sin confirmación, se libera el cupo.
 *  - RN-02: ventana de confirmación de 6 h tras el recordatorio, es decir, el cupo
 *           se libera 18 h antes de la cita y pasa a la lista de espera.
 *  - RF-04: enlace seguro tokenizado para teleconsulta.
 *  - RF-06: registro de urgencias sin cita previa.
 */

const DURACION_MS = 30 * 60_000;
const RECORDATORIO_ANTES_MS = 24 * 3_600_000;
const VENTANA_CONFIRMACION_MS = 6 * 3_600_000;
const ANTICIPACION_MINIMA_MS = RECORDATORIO_ANTES_MS - VENTANA_CONFIRMACION_MS; // 18 h
const ESTADOS_OCUPAN = ['Pendiente', 'Confirmada', 'EnAtencion'];
const MODALIDADES = ['presencial', 'virtual'];
const ENLACE_ANTES_MS = 15 * 60_000;
const ENLACE_VIGENCIA_MS = 60 * 60_000;
const HORA_INICIO = 8;
const HORA_FIN = 16;
const OFFSET_MS = 6 * 3_600_000; // America/Mexico_City sin horario de verano desde 2022

/* ---------- utilidades de horario ---------- */

/** Un instante es válido si cae en bloques de 30 min entre 08:00 y 16:00 hora local. */
function esHorarioValido(ms) {
  const local = new Date(ms - OFFSET_MS);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  return local.getUTCSeconds() === 0 && (m === 0 || m === 30) && h >= HORA_INICIO && h < HORA_FIN;
}

/** Bloques de 30 min del día 'YYYY-MM-DD' en ISO (UTC). */
function bloquesDelDia(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`))) {
    throw new HttpError(400, 'Fecha inválida; use el formato AAAA-MM-DD');
  }
  const bloques = [];
  for (let h = HORA_INICIO; h < HORA_FIN; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      bloques.push(new Date(`${fecha}T${hh}:${mm}:00-06:00`).toISOString());
    }
  }
  return bloques;
}

function solapa(citaFechaHora, ms) {
  return Math.abs(Date.parse(citaFechaHora) - ms) < DURACION_MS;
}

function estaOcupado(db, medicoId, ms, excluirCitaId = null) {
  return db.citas.some(
    (c) =>
      c.id !== excluirCitaId &&
      c.medicoId === medicoId &&
      ESTADOS_OCUPAN.includes(c.estado) &&
      solapa(c.fechaHora, ms),
  );
}

function puedeGestionarCita(usuario, cita) {
  if (usuario.rol === 'recepcion') return true;
  if (usuario.rol === 'paciente') return usuario.pacienteId === cita.pacienteId;
  if (usuario.rol === 'medico') return usuario.medicoId === cita.medicoId;
  return false;
}

function notificar(db, { tipo, pacienteId, citaId, mensaje }, ahora = Date.now()) {
  db.notificaciones.push(Object.freeze({ tipo, pacienteId, citaId, mensaje, ts: new Date(ahora).toISOString() }));
}

function buscarCita(db, id) {
  const cita = db.citas.find((c) => c.id === id);
  if (!cita) throw new HttpError(404, 'Cita no encontrada');
  return cita;
}

/* ---------- consultas ---------- */

function disponibilidad(db, { medicoId, fecha }, ahora = Date.now()) {
  if (!db.medicos.some((m) => m.id === medicoId)) throw new HttpError(404, 'Médico no encontrado');
  return bloquesDelDia(fecha).filter((iso) => {
    const ms = Date.parse(iso);
    return ms > ahora + ANTICIPACION_MINIMA_MS && !estaOcupado(db, medicoId, ms);
  });
}

function listarCitas(db, usuario) {
  return db.citas.filter((c) => puedeGestionarCita(usuario, c) || (usuario.rol === 'direccion'));
}

/* ---------- escritura ---------- */

function crearCita(db, datos) {
  const cita = {
    id: `cita-${++db.contadores.cita}`,
    pacienteId: datos.pacienteId,
    medicoId: datos.medicoId,
    sede: datos.sede,
    modalidad: datos.modalidad,
    fechaHora: datos.fechaHora,
    estado: datos.estado || 'Pendiente',
    urgencia: Boolean(datos.urgencia),
    motivo: datos.motivo || null,
    recordatorioEnviado: false,
    consultaId: null,
  };
  db.citas.push(cita);
  return cita;
}

function agendar(db, datos, usuario, ahora = Date.now()) {
  const pacienteId = usuario.rol === 'paciente' ? usuario.pacienteId : datos.pacienteId;
  if (!db.pacientes.some((p) => p.id === pacienteId)) throw new HttpError(400, 'Paciente no encontrado');

  const medico = db.medicos.find((m) => m.id === datos.medicoId);
  if (!medico) throw new HttpError(400, 'Médico no encontrado');
  if (!MODALIDADES.includes(datos.modalidad)) throw new HttpError(400, 'Modalidad inválida');

  const ms = Date.parse(datos.fechaHora);
  if (Number.isNaN(ms)) throw new HttpError(400, 'fechaHora inválida');
  if (ms - ahora < ANTICIPACION_MINIMA_MS) {
    throw new HttpError(422, 'La cita debe agendarse con al menos 18 horas de anticipación (RN-02)');
  }
  if (!esHorarioValido(ms)) throw new HttpError(422, 'Horario fuera de la agenda (bloques de 30 min, 08:00–16:00)');
  if (estaOcupado(db, medico.id, ms)) throw new HttpError(409, 'El horario ya está ocupado');

  const cita = crearCita(db, {
    pacienteId,
    medicoId: medico.id,
    sede: medico.sede,
    modalidad: datos.modalidad,
    fechaHora: new Date(ms).toISOString(),
  });
  audit.registrar(db, { usuarioId: usuario.id, accion: 'agendar_cita', recurso: cita.id, detalle: { medicoId: medico.id } });
  return cita;
}

function reprogramar(db, citaId, nuevaFechaHora, usuario, ahora = Date.now()) {
  const cita = buscarCita(db, citaId);
  if (!puedeGestionarCita(usuario, cita)) throw new HttpError(403, 'Sin permiso sobre esta cita');
  if (!['Pendiente', 'Confirmada'].includes(cita.estado)) throw new HttpError(409, 'La cita no puede reprogramarse');

  const ms = Date.parse(nuevaFechaHora);
  if (Number.isNaN(ms)) throw new HttpError(400, 'fechaHora inválida');
  if (ms - ahora < ANTICIPACION_MINIMA_MS) throw new HttpError(422, 'Anticipación mínima de 18 horas (RN-02)');
  if (!esHorarioValido(ms)) throw new HttpError(422, 'Horario fuera de la agenda');
  if (estaOcupado(db, cita.medicoId, ms, cita.id)) throw new HttpError(409, 'El horario ya está ocupado');

  const anterior = cita.fechaHora;
  cita.fechaHora = new Date(ms).toISOString();
  cita.estado = 'Pendiente';
  cita.recordatorioEnviado = false;
  audit.registrar(db, { usuarioId: usuario.id, accion: 'reprogramar_cita', recurso: cita.id, detalle: { anterior } });
  return cita;
}

function cancelar(db, citaId, usuario, motivo = 'cancelada_por_usuario') {
  const cita = buscarCita(db, citaId);
  if (!puedeGestionarCita(usuario, cita)) throw new HttpError(403, 'Sin permiso sobre esta cita');
  if (['Completada', 'Cancelada'].includes(cita.estado)) throw new HttpError(409, 'La cita ya no puede cancelarse');

  cita.estado = 'Cancelada';
  cita.motivo = motivo;
  audit.registrar(db, { usuarioId: usuario.id, accion: 'cancelar_cita', recurso: cita.id, detalle: { motivo } });
  liberarCupo(db, cita);
  return cita;
}

function confirmar(db, citaId, usuario, ahora = Date.now()) {
  const cita = buscarCita(db, citaId);
  if (!puedeGestionarCita(usuario, cita)) throw new HttpError(403, 'Sin permiso sobre esta cita');
  if (cita.estado !== 'Pendiente') throw new HttpError(409, 'Solo se confirman citas pendientes');

  const limite = Date.parse(cita.fechaHora) - ANTICIPACION_MINIMA_MS;
  if (ahora > limite) throw new HttpError(409, 'La ventana de confirmación ya venció');

  cita.estado = 'Confirmada';
  audit.registrar(db, { usuarioId: usuario.id, accion: 'confirmar_cita', recurso: cita.id });
  return cita;
}

/* ---------- lista de espera y liberación de cupos (RF-05, RN-02) ---------- */

function agregarListaEspera(db, { pacienteId, medicoId, fecha }, usuario) {
  const paciente = usuario.rol === 'paciente' ? usuario.pacienteId : pacienteId;
  if (!db.pacientes.some((p) => p.id === paciente)) throw new HttpError(400, 'Paciente no encontrado');
  if (!db.medicos.some((m) => m.id === medicoId)) throw new HttpError(400, 'Médico no encontrado');
  bloquesDelDia(fecha); // valida formato

  const entrada = { id: `espera-${db.listaEspera.length + 1}`, pacienteId: paciente, medicoId, fecha, estado: 'en_espera' };
  db.listaEspera.push(entrada);
  audit.registrar(db, { usuarioId: usuario.id, accion: 'alta_lista_espera', recurso: entrada.id });
  return entrada;
}

/** Libera el cupo de una cita cancelada y lo asigna al primer paciente en lista de espera del médico. */
function liberarCupo(db, cita, ahora = Date.now()) {
  const siguiente = db.listaEspera.find((e) => e.estado === 'en_espera' && e.medicoId === cita.medicoId);
  if (!siguiente) return null;

  siguiente.estado = 'asignada';
  const nueva = crearCita(db, {
    pacienteId: siguiente.pacienteId,
    medicoId: cita.medicoId,
    sede: cita.sede,
    modalidad: cita.modalidad,
    fechaHora: cita.fechaHora,
  });
  notificar(db, {
    tipo: 'cupo_ofrecido',
    pacienteId: siguiente.pacienteId,
    citaId: nueva.id,
    mensaje: 'Se liberó un cupo en su fecha de interés; confirme su cita.',
  }, ahora);
  return nueva;
}

/**
 * Ejecuta las reglas temporales de RF-05 y RN-02. Pensado para correr periódicamente:
 *  - a las 24 h de la cita envía el recordatorio;
 *  - a las 18 h de la cita (6 h después del recordatorio) sin confirmación, cancela y libera el cupo.
 */
function procesarVentanas(db, ahora = Date.now()) {
  const resultado = { recordatorios: 0, liberadas: 0 };

  for (const cita of [...db.citas]) {
    if (cita.estado !== 'Pendiente') continue;
    const inicio = Date.parse(cita.fechaHora);
    const recordatorioEn = inicio - RECORDATORIO_ANTES_MS;
    const limite = recordatorioEn + VENTANA_CONFIRMACION_MS;

    if (!cita.recordatorioEnviado && ahora >= recordatorioEn) {
      cita.recordatorioEnviado = true;
      notificar(db, {
        tipo: 'recordatorio',
        pacienteId: cita.pacienteId,
        citaId: cita.id,
        mensaje: 'Tiene una cita en 24 horas. Confírmela dentro de las siguientes 6 horas.',
      }, ahora);
      resultado.recordatorios++;
    }

    if (ahora > limite) {
      cita.estado = 'Cancelada';
      cita.motivo = 'sin_confirmacion';
      audit.registrar(db, { usuarioId: 'sistema', accion: 'liberar_cupo', recurso: cita.id, detalle: { motivo: 'sin_confirmacion' } });
      liberarCupo(db, cita, ahora);
      resultado.liberadas++;
    }
  }
  return resultado;
}

/* ---------- urgencias y teleconsulta ---------- */

/** RF-06: registro administrativo de urgencia sin cita previa (no exime la autenticación clínica). */
function registrarUrgencia(db, { pacienteId, medicoId, motivo }, usuario, ahora = Date.now()) {
  if (!db.pacientes.some((p) => p.id === pacienteId)) throw new HttpError(400, 'Paciente no encontrado');
  const medico = db.medicos.find((m) => m.id === medicoId);
  const cita = crearCita(db, {
    pacienteId,
    medicoId: medico ? medico.id : null,
    sede: medico ? medico.sede : 'Urgencias',
    modalidad: 'presencial',
    fechaHora: new Date(ahora).toISOString(),
    estado: 'EnAtencion',
    urgencia: true,
    motivo: motivo || 'Ingreso de urgencia',
  });
  audit.registrar(db, { usuarioId: usuario.id, accion: 'registrar_urgencia', recurso: cita.id });
  return cita;
}

/** RF-04: enlace seguro tokenizado, válido solo en la ventana de la cita. */
function generarEnlace(db, citaId, usuario, ahora = Date.now()) {
  const cita = buscarCita(db, citaId);
  if (!puedeGestionarCita(usuario, cita)) throw new HttpError(403, 'Sin permiso sobre esta cita');
  if (cita.modalidad !== 'virtual') throw new HttpError(422, 'La cita no es virtual');
  if (['Cancelada', 'Completada'].includes(cita.estado)) throw new HttpError(409, 'La cita no está activa');

  const inicio = Date.parse(cita.fechaHora);
  if (ahora < inicio - ENLACE_ANTES_MS || ahora > inicio + ENLACE_VIGENCIA_MS) {
    throw new HttpError(422, 'El enlace solo está disponible en la fecha y hora de la cita');
  }
  const token = require('crypto').randomUUID();
  const enlace = { token, citaId, expira: inicio + ENLACE_VIGENCIA_MS, url: `/teleconsulta/${token}` };
  db.enlaces.push(enlace);
  audit.registrar(db, { usuarioId: usuario.id, accion: 'generar_enlace_teleconsulta', recurso: cita.id });
  return enlace;
}

module.exports = {
  esHorarioValido,
  bloquesDelDia,
  disponibilidad,
  listarCitas,
  agendar,
  reprogramar,
  cancelar,
  confirmar,
  agregarListaEspera,
  liberarCupo,
  procesarVentanas,
  registrarUrgencia,
  generarEnlace,
  puedeGestionarCita,
  ANTICIPACION_MINIMA_MS,
};
