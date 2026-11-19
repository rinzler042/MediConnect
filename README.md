# MediConnect Plus

Sistema inteligente de gestión hospitalaria y telemedicina, implementado a partir del documento de
análisis de requisitos del taller *"Análisis de requisitos, del proyecto al modelo"* (Ingeniería de Requisitos, Unidad II).

- **Backend:** Node.js + Express 5 (`backend/`)
- **Frontend:** Angular 19, componentes standalone (`frontend/`)

## Ejecución

Se requiere Node.js 20 o superior.

```bash
# 1. API (puerto 3000)
cd backend
npm install
npm test          # pruebas de reglas de negocio y API
npm start

# 2. Interfaz (puerto 4200)
cd frontend
npm install
npm start         # abrir http://localhost:4200
```

### Usuarios de prueba

El inicio de sesión usa correo y un código de dos factores. En desarrollo el código se muestra en pantalla
(`DEV_EXPOSE_OTP=false` lo oculta).

| Correo | Rol | Puede |
|---|---|---|
| `carlos.mendoza@mediconnect.mx` | Recepción | Agendar citas, registrar urgencias, gestionar lista de espera |
| `lucia.herrera@mediconnect.mx` | Médico | Expediente, consultas, recetas, teleconsultas |
| `sofia.ruiz@mediconnect.mx` | Enfermero | Expediente y registro de consultas |
| `ana.gomez@correo.mx` | Paciente | Sus citas, teleconsultas y su expediente |
| `direccion@mediconnect.mx` | Dirección médica | Auditoría e integridad |

## Trazabilidad de requisitos

| Requisito | Implementación |
|---|---|
| **RF-01** Agendar, reprogramar y cancelar citas | `services/citas.js` (`agendar`, `reprogramar`, `cancelar`); disponibilidad en bloques de 30 min, 08:00–16:00 |
| **RF-02** Expediente clínico único | `services/clinico.js` (`obtenerExpediente`, `registrarConsulta`); una consulta vinculada a una cita |
| **RF-03** Recetas vinculadas al inventario | `services/clinico.js` (`emitirReceta`): valida existencias y descuenta al emitir |
| **RF-04** Enlace seguro de teleconsulta | `generarEnlace`: token aleatorio, válido de 15 min antes a 60 min después de la cita |
| **RF-05** Recordatorio y liberación de cupo | `procesarVentanas`: recordatorio a las 24 h; sin confirmación se cancela y el cupo pasa a la lista de espera |
| **RF-06** Ingreso de urgencia sin cita | `registrarUrgencia`: solo recepción; no otorga acceso clínico |
| **RNF-01** Autenticación de dos factores y cifrado | Login en dos pasos (`auth.js`); rutas clínicas exigen 2FA. El cifrado TLS/AES no está implementado (ver limitaciones) |
| **RNF-02** Respuesta ≤ 1.2 s con 500 usuarios | No medido todavía (ver limitaciones) |
| **RNF-03** Registro inmutable de accesos | `audit.js`: entradas congeladas con cadena de hashes SHA-256; endpoint `/api/auditoria/integridad` |
| **RES-01** Protección de datos médicos | Acceso por rol y auditoría de cada lectura y modificación del expediente |
| **RES-02** Codificación CIE-11 | Validación de formato en `clinico.js` (`PATRON_CIE11`) |
| **RN-01** Alergia severa bloquea la receta | `emitirReceta` rechaza con HTTP 409 y devuelve la alerta; no descuenta inventario |
| **RN-02** Ventana de confirmación de 6 h | Recordatorio a 24 h + 6 h = cupo liberado 18 h antes de la cita (`ANTICIPACION_MINIMA_MS`) |

### Decisiones tomadas del taller de negociación

- **Conflicto 1 (RF-01 / RF-05):** recordatorio 24 h antes, 6 h para confirmar, luego liberación y lista de espera.
  Se implementa como una sola ventana temporal, sin reglas contradictorias.
- **Conflicto 2 (RNF-01 / RF-06):** el ingreso de urgencia lo registra recepción, pero el acceso clínico al expediente
  siempre requiere 2FA individual y queda auditado.

## Arquitectura

```
backend/src
├── app.js            Rutas Express y manejo de errores
├── server.js         Arranque y proceso periódico de RF-05/RN-02 (cada 60 s)
├── auth.js           Desafíos OTP, sesiones y middlewares (autenticación, rol, 2FA)
├── audit.js          Bitácora WORM con cadena de hashes
├── db.js             Almacén en memoria con datos de prueba
├── errors.js         HttpError
└── services/
    ├── citas.js      Reglas de agenda, confirmación, lista de espera, urgencias y teleconsulta
    └── clinico.js    Expediente, consultas, recetas y alergias

frontend/src/app
├── core/             Servicio de API, sesión, interceptor de token, guardias, modelos
├── pages/login       Inicio de sesión con código de verificación
├── pages/citas       Agenda, confirmar, cancelar, teleconsulta
├── pages/urgencias   Ingreso de urgencias (recepción)
├── pages/expediente  Expediente, consultas y recetas (personal clínico)
└── pages/auditoria   Bitácora e integridad (dirección)
```

Estilo: cliente-servidor en capas, con la lógica de negocio separada de las rutas HTTP.
Las integraciones externas (correo/SMS, farmacia, telemedicina) están representadas dentro del backend.

### Endpoints principales

| Método | Ruta | Rol |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/verificar` | Público |
| GET | `/api/citas`, `/api/citas/disponibilidad` | Autenticado |
| POST | `/api/citas`, `/api/citas/:id/confirmar`, `/api/citas/:id/cancelar`, `/api/citas/:id/enlace` | Según permiso sobre la cita |
| PATCH | `/api/citas/:id/reprogramar` | Paciente dueño, recepción, médico de la cita |
| POST | `/api/urgencias` | Recepción |
| GET/POST | `/api/lista-espera` | Recepción / paciente |
| GET | `/api/expedientes/:pacienteId` | Médico, enfermero (2FA), paciente (propio) |
| POST | `/api/expedientes/:pacienteId/consultas` | Médico, enfermero (2FA) |
| POST | `/api/recetas` | Médico (2FA) |
| GET | `/api/auditoria`, `/api/auditoria/integridad` | Dirección |

## Limitaciones conocidas

- **Persistencia en memoria.** Los datos se pierden al reiniciar. Para producción se requiere una base de datos clínica
  y un almacén WORM real (por ejemplo, un bucket con retención bloqueada).
- **2FA simulado.** El código se devuelve en la respuesta de desarrollo en lugar de enviarse por correo o SMS.
- **Sin cifrado TLS 1.3 ni AES-256** en este entorno; se deben configurar en el despliegue (RNF-01).
- **Sin contraseñas.** La autenticación se basa en correo y OTP, como demostración.
- **RNF-02 no verificado.** Requiere una prueba de carga con 500 usuarios concurrentes (por ejemplo, con `autocannon`).
- **Notificaciones simuladas.** Se registran en `db.notificaciones`; no se envían correos ni SMS.
- **Estado de tiempo.** Las reglas usan la hora de Ciudad de México (UTC-06:00, sin horario de verano).
