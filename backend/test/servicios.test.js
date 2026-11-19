'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { crearDb } = require('../src/db');
const { createApp } = require('../src/app');
const citas = require('../src/services/citas');
const clinico = require('../src/services/clinico');
const audit = require('../src/audit');

const HORA = 3_600_000;
const AHORA = Date.parse('2027-03-01T12:00:00Z');
const CITA_FUTURA = '2027-03-10T15:00:00-06:00'; // miércoles, 15:00 hora local

const usuario = (db, id) => db.usuarios.find((u) => u.id === id);

describe('horario de agenda (RF-01)', () => {
  test('acepta bloques de 30 min entre 08:00 y 16:00 hora local', () => {
    assert.equal(citas.esHorarioValido(Date.parse('2027-03-10T08:00:00-06:00')), true);
    assert.equal(citas.esHorarioValido(Date.parse('2027-03-10T15:30:00-06:00')), true);
  });

  test('rechaza horarios fuera de la agenda o no alineados', () => {
    assert.equal(citas.esHorarioValido(Date.parse('2027-03-10T07:30:00-06:00')), false);
    assert.equal(citas.esHorarioValido(Date.parse('2027-03-10T16:00:00-06:00')), false);
    assert.equal(citas.esHorarioValido(Date.parse('2027-03-10T08:15:00-06:00')), false);
  });
});

describe('agendar y disponibilidad (RF-01, RN-02)', () => {
  test('agenda una cita y luego bloquea el mismo horario', () => {
    const db = crearDb();
    const recep = usuario(db, 'u-rec-1');
    const cita = citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, recep, AHORA);
    assert.equal(cita.estado, 'Pendiente');
    assert.equal(cita.sede, 'Hospital Central');

    assert.throws(
      () => citas.agendar(db, { pacienteId: 'p2', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, recep, AHORA),
      (e) => e.status === 409,
    );
    const slots = citas.disponibilidad(db, { medicoId: 'm1', fecha: '2027-03-10' }, AHORA);
    assert.ok(!slots.includes(new Date(CITA_FUTURA).toISOString()));
  });

  test('exige al menos 18 horas de anticipación (RN-02)', () => {
    const db = crearDb();
    assert.throws(
      () => citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: '2027-03-01T20:00:00-06:00' }, usuario(db, 'u-rec-1'), AHORA),
      (e) => e.status === 422,
    );
  });
});

describe('recordatorio y ventana de confirmación (RF-05, RN-02)', () => {
  test('envía recordatorio a las 24 h y libera el cupo a las 18 h si no confirma', () => {
    const db = crearDb();
    const cita = citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, usuario(db, 'u-rec-1'), AHORA);
    const inicio = Date.parse(CITA_FUTURA);

    // 25 h antes: aún no hay recordatorio
    citas.procesarVentanas(db, inicio - 25 * HORA);
    assert.equal(cita.estado, 'Pendiente');
    assert.equal(cita.recordatorioEnviado, false);

    // 23 h antes: recordatorio enviado, la cita sigue viva
    const r1 = citas.procesarVentanas(db, inicio - 23 * HORA);
    assert.equal(r1.recordatorios, 1);
    assert.equal(cita.estado, 'Pendiente');
    assert.equal(db.notificaciones.at(-1).tipo, 'recordatorio');

    // 17 h antes: ventana vencida, cita cancelada
    citas.procesarVentanas(db, inicio - 17 * HORA);
    assert.equal(cita.estado, 'Cancelada');
    assert.equal(cita.motivo, 'sin_confirmacion');
  });

  test('confirmar dentro de la ventana cambia el estado a Confirmada', () => {
    const db = crearDb();
    const recep = usuario(db, 'u-rec-1');
    const cita = citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, recep, AHORA);
    citas.confirmar(db, cita.id, recep, Date.parse(CITA_FUTURA) - 20 * HORA);
    assert.equal(cita.estado, 'Confirmada');
  });
});

describe('lista de espera (RF-05)', () => {
  test('al cancelar una cita, el cupo pasa al primer paciente en lista de espera', () => {
    const db = crearDb();
    const recep = usuario(db, 'u-rec-1');
    const cita = citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, recep, AHORA);
    citas.agregarListaEspera(db, { pacienteId: 'p2', medicoId: 'm1', fecha: '2027-03-10' }, recep);

    citas.cancelar(db, cita.id, recep);

    const nueva = db.citas.find((c) => c.pacienteId === 'p2');
    assert.ok(nueva, 'debe crearse una cita para el paciente en espera');
    assert.equal(nueva.fechaHora, new Date(CITA_FUTURA).toISOString());
    assert.equal(db.listaEspera[0].estado, 'asignada');
  });
});

describe('urgencias (RF-06)', () => {
  test('registra ingreso sin cita previa en estado EnAtencion', () => {
    const db = crearDb();
    const cita = citas.registrarUrgencia(db, { pacienteId: 'p2', medicoId: 'm2', motivo: 'Dolor torácico' }, usuario(db, 'u-rec-1'), AHORA);
    assert.equal(cita.estado, 'EnAtencion');
    assert.equal(cita.urgencia, true);
    assert.equal(cita.sede, 'Clínica Norte');
  });
});

describe('recetas y alergias (RF-03, RN-01)', () => {
  function consultaDe(db, pacienteId, citaId) {
    return clinico.registrarConsulta(db, pacienteId, {
      citaId,
      signosVitales: { presionSistolica: 120, presionDiastolica: 80, frecuenciaCardiaca: 72 },
      diagnosticoCIE11: 'CA40.0',
      notasEvolucion: 'Cuadro infeccioso leve.',
    }, usuario(db, 'u-med-1'));
  }

  test('bloquea la receta si hay alergia severa incompatible y no descuenta inventario', () => {
    const db = crearDb();
    const cita = citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, usuario(db, 'u-rec-1'), AHORA);
    const consulta = consultaDe(db, 'p1', cita.id);
    const stockAntes = db.medicamentos.find((m) => m.id === 'med-1').existencia;

    assert.throws(
      () => clinico.emitirReceta(db, { consultaId: consulta.id, items: [{ medicamentoId: 'med-1', cantidad: 1 }] }, usuario(db, 'u-med-1')),
      (e) => e.status === 409 && e.extra.alertas.length === 1,
    );
    assert.equal(db.medicamentos.find((m) => m.id === 'med-1').existencia, stockAntes);
  });

  test('emite la receta, descuenta existencias y genera folio', () => {
    const db = crearDb();
    const cita = citas.agendar(db, { pacienteId: 'p2', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, usuario(db, 'u-rec-1'), AHORA);
    const consulta = consultaDe(db, 'p2', cita.id);
    const receta = clinico.emitirReceta(db, { consultaId: consulta.id, items: [{ medicamentoId: 'med-2', cantidad: 2 }] }, usuario(db, 'u-med-1'));

    assert.match(receta.folio, /^REC-\d{6}$/);
    assert.equal(db.medicamentos.find((m) => m.id === 'med-2').existencia, 118);
  });

  test('rechaza medicamentos sin existencia suficiente', () => {
    const db = crearDb();
    const cita = citas.agendar(db, { pacienteId: 'p2', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, usuario(db, 'u-rec-1'), AHORA);
    const consulta = consultaDe(db, 'p2', cita.id);
    assert.throws(
      () => clinico.emitirReceta(db, { consultaId: consulta.id, items: [{ medicamentoId: 'med-3', cantidad: 1 }] }, usuario(db, 'u-med-1')),
      (e) => e.status === 409,
    );
  });

  test('valida el formato CIE-11 (RES-02)', () => {
    const db = crearDb();
    const cita = citas.agendar(db, { pacienteId: 'p2', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, usuario(db, 'u-rec-1'), AHORA);
    assert.throws(
      () => clinico.registrarConsulta(db, 'p2', { citaId: cita.id, diagnosticoCIE11: 'gripe!!', notasEvolucion: 'x' }, usuario(db, 'u-med-1')),
      (e) => e.status === 400,
    );
  });
});

describe('auditoría WORM (RNF-03)', () => {
  test('la cadena de hashes es válida y detecta alteraciones', () => {
    const db = crearDb();
    citas.agendar(db, { pacienteId: 'p1', medicoId: 'm1', modalidad: 'presencial', fechaHora: CITA_FUTURA }, usuario(db, 'u-rec-1'), AHORA);
    audit.registrar(db, { usuarioId: 'u-dir-1', accion: 'revision', recurso: 'x' });
    assert.equal(audit.verificarIntegridad(db).valida, true);

    db.auditoria[0] = Object.freeze({ ...db.auditoria[0], usuarioId: 'intruso' });
    const r = audit.verificarIntegridad(db);
    assert.equal(r.valida, false);
    assert.equal(r.indiceAlterado, 0);
  });
});

describe('API HTTP y autenticación en dos pasos (RNF-01)', () => {
  test('login con OTP, control de rol y 401 sin token', async () => {
    const db = crearDb();
    const app = createApp(db, { exponerOtp: true });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (ruta, body, token) => fetch(base + ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

    try {
      const sinToken = await fetch(`${base}/api/citas`);
      assert.equal(sinToken.status, 401);

      const login = await post('/api/auth/login', { correo: 'ana.gomez@correo.mx' });
      const { desafioId, codigoDesarrollo } = await login.json();
      const verif = await post('/api/auth/verificar', { desafioId, codigo: codigoDesarrollo });
      assert.equal(verif.status, 200);
      const { token } = await verif.json();

      const auditoria = await fetch(`${base}/api/auditoria`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(auditoria.status, 403, 'un paciente no debe ver la auditoría');
    } finally {
      server.close();
    }
  });
});
