const API = 'http://localhost:3000/api';
let fallos = 0;

async function login(correo) {
  const r1 = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo }),
  }).then((r) => r.json());
  const r2 = await fetch(`${API}/auth/verificar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ desafioId: r1.desafioId, codigo: r1.codigoDesarrollo }),
  });
  const body = await r2.json();
  return body.token;
}

async function req(token, metodo, ruta, cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  return { status: r.status, body: texto ? JSON.parse(texto) : null };
}

function check(nombre, cumple, detalle = '') {
  console.log(`${cumple ? 'PASS' : 'FAIL'}  ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  if (!cumple) fallos++;
}

// 0. 2FA: código incorrecto debe fallar
{
  const r1 = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: 'carlos.mendoza@mediconnect.mx' }),
  }).then((r) => r.json());
  const r2 = await fetch(`${API}/auth/verificar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ desafioId: r1.desafioId, codigo: '000000' }),
  });
  check('2FA rechaza código incorrecto', r2.status === 401, `HTTP ${r2.status}`);
}

// 1. Recepción agenda y confirma cita para Ana con la Dra. Lucía
const recep = await login('carlos.mendoza@mediconnect.mx');
const medicos = (await req(recep, 'GET', '/medicos')).body;
const medico = medicos.find((m) => m.id === 'm1');
const fecha = '2026-11-20';
const disp = await req(recep, 'GET', `/citas/disponibilidad?medicoId=m1&fecha=${fecha}`);
check('disponibilidad devuelve bloques de 30 min', disp.status === 200 && disp.body.slots.length > 0, `${disp.body.slots?.length} bloques`);

const agenda = await req(recep, 'POST', '/citas', {
  pacienteId: 'p1', medicoId: medico.id, modalidad: 'presencial', fechaHora: disp.body.slots[0],
});
check('recepción agenda cita', agenda.status === 201, `HTTP ${agenda.status}`);
const cita = agenda.body;

const dup = await req(recep, 'POST', '/citas', {
  pacienteId: 'p2', medicoId: medico.id, modalidad: 'presencial', fechaHora: disp.body.slots[0],
});
check('no permite doble reserva del mismo horario', dup.status === 409, `HTTP ${dup.status}`);

const conf = await req(recep, 'POST', `/citas/${cita.id}/confirmar`);
check('recepción confirma la cita', conf.status === 200 && conf.body.estado === 'Confirmada', conf.body?.estado);

// 2. Médica registra consulta y emite recetas
const medica = await login('lucia.herrera@mediconnect.mx');
const consulta = await req(medica, 'POST', '/expedientes/p1/consultas', {
  citaId: cita.id,
  signosVitales: { presionSistolica: 120, presionDiastolica: 80, frecuenciaCardiaca: 72, temperatura: 36.8 },
  diagnosticoCIE11: 'BA00',
  notasEvolucion: 'Control de rutina. Sin novedades.',
});
check('médica registra consulta con CIE-11 válido', consulta.status === 201, `HTTP ${consulta.status}`);

const badCie = await req(medica, 'POST', '/expedientes/p1/consultas', {
  citaId: cita.id, diagnosticoCIE11: 'gripe!!', notasEvolucion: 'x',
});
check('rechaza diagnóstico que no es CIE-11', badCie.status === 400, `HTTP ${badCie.status}`);

const consultaId = consulta.body.id;
const alergia = await req(medica, 'POST', '/recetas', {
  consultaId, items: [{ medicamentoId: 'med-1', cantidad: 1 }],
});
check('RN-01: bloquea amoxicilina por alergia a penicilina', alergia.status === 409 && alergia.body.alertas?.length === 1, `HTTP ${alergia.status}`);

const stockAntes = (await req(medica, 'GET', '/medicamentos')).body.find((m) => m.id === 'med-2').existencia;
const receta = await req(medica, 'POST', '/recetas', {
  consultaId, items: [{ medicamentoId: 'med-2', cantidad: 2 }],
});
check('emite receta de paracetamol', receta.status === 201 && /^REC-\d{6}$/.test(receta.body.folio), receta.body?.folio);
const stockDespues = (await req(medica, 'GET', '/medicamentos')).body.find((m) => m.id === 'med-2').existencia;
check('descuenta inventario al emitir', stockDespues === stockAntes - 2, `${stockAntes} → ${stockDespues}`);

// 3. Recepción registra urgencia sin cita
const urg = await req(recep, 'POST', '/urgencias', { pacienteId: 'p2', medicoId: 'm2', motivo: 'Dolor torácico' });
check('recepción registra urgencia', urg.status === 201 && urg.body.estado === 'EnAtencion', urg.body?.estado);

const urgClinico = await req(recep, 'GET', '/expedientes/p1');
check('recepción no accede al expediente clínico', urgClinico.status === 403, `HTTP ${urgClinico.status}`);

// 4. Paciente ve solo sus citas y no la auditoría
const paciente = await login('ana.gomez@correo.mx');
const misCitas = await req(paciente, 'GET', '/citas');
check('paciente ve sus citas', misCitas.status === 200 && misCitas.body.every((c) => c.pacienteId === 'p1'), `${misCitas.body.length} cita(s)`);
const audPac = await req(paciente, 'GET', '/auditoria');
check('paciente no ve auditoría', audPac.status === 403, `HTTP ${audPac.status}`);

// 5. Dirección verifica la cadena de auditoría
const dir = await login('direccion@mediconnect.mx');
const integ = await req(dir, 'GET', '/auditoria/integridad');
check('auditoría íntegra', integ.body.valida === true, `${integ.body.total} entradas`);

console.log(fallos === 0 ? '\nRecorrido completo: TODO OK' : `\n${fallos} verificación(es) fallaron`);
process.exit(fallos ? 1 : 0);
