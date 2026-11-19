import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { Cita, Consulta, ErrorApi, Expediente, Medicamento } from '../../core/models';

/**
 * Expediente clínico único (RF-02), registro de consultas con CIE-11 (RES-02),
 * recetas con control de alergias (RN-01) e inventario (RF-03).
 * Toda vista está protegida por 2FA en el backend (RNF-01).
 */
@Component({
  selector: 'app-expediente',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    @if (expediente(); as exp) {
      <h2>Expediente: {{ exp.paciente.nombre }}</h2>

      @if (mensaje()) { <p class="ok">{{ mensaje() }}</p> }
      @if (error()) { <p class="error">{{ error() }}</p> }
      @if (alertas().length) {
        <div class="alerta">
          <strong>Receta bloqueada por alergia severa (RN-01)</strong>
          @for (a of alertas(); track $index) { <p>{{ a.medicamento }} · alergia a {{ a.alergia }}</p> }
        </div>
      }

      <section class="card">
        <h3>Datos generales</h3>
        <p><strong>Antecedentes:</strong> {{ exp.antecedentes || 'Sin antecedentes registrados' }}</p>
        <p><strong>Alergias:</strong>
          @for (a of exp.paciente.alergias; track a.sustancia) {
            <span class="tag estado-Cancelada">{{ a.sustancia }} ({{ a.severidad }})</span>
          } @empty { Ninguna registrada }
        </p>
      </section>

      @if (esClinico()) {
        <section class="card">
          <h3>Registrar consulta</h3>
          <form (ngSubmit)="registrarConsulta()">
            <div class="grid">
              <label>Cita
                <select name="cita" [(ngModel)]="form.citaId" required>
                  @for (c of citasActivas(); track c.id) {
                    <option [value]="c.id">{{ c.fechaHora | date: 'dd/MM HH:mm' : '-0600' }} · {{ c.estado }}</option>
                  } @empty { <option value="">Sin citas activas</option> }
                </select>
              </label>
              <label>Diagnóstico CIE-11
                <input name="cie" [(ngModel)]="form.diagnosticoCIE11" placeholder="p. ej. BA00 o CA40.0" required>
              </label>
              <label>Presión sistólica (mmHg)
                <input type="number" name="ps" [(ngModel)]="form.presionSistolica">
              </label>
              <label>Presión diastólica (mmHg)
                <input type="number" name="pd" [(ngModel)]="form.presionDiastolica">
              </label>
              <label>Frecuencia cardiaca (lpm)
                <input type="number" name="fc" [(ngModel)]="form.frecuenciaCardiaca">
              </label>
              <label>Temperatura (°C)
                <input type="number" step="0.1" name="temp" [(ngModel)]="form.temperatura">
              </label>
            </div>
            <label>Notas de evolución
              <textarea name="notas" rows="3" [(ngModel)]="form.notasEvolucion" required></textarea>
            </label>
            <button type="submit" [disabled]="guardando()">Guardar consulta</button>
          </form>
        </section>
      }

      <section class="card">
        <h3>Historial de consultas</h3>
        @if (exp.consultas.length === 0) {
          <p class="muted">Sin consultas registradas.</p>
        }
        @for (c of exp.consultas; track c.id) {
          <article class="consulta">
            <header>
              <strong>{{ c.fecha | date: 'dd/MM/yyyy HH:mm' : '-0600' }}</strong>
              · CIE-11 <code>{{ c.diagnosticoCIE11 }}</code>
              @if (c.recetaId) { · <span class="tag estado-Completada">Con receta</span> }
            </header>
            <p>{{ c.notasEvolucion }}</p>
            <p class="muted">
              @for (entrada of signos(c); track entrada[0]) {
                {{ entrada[0] }}: {{ entrada[1] }} ·
              }
            </p>

            @if (puedeRecetar() && !c.recetaId) {
              <button class="secundario" (click)="abrirReceta(c)">Emitir receta</button>
            }
          </article>
        }
      </section>

      @if (consultaReceta(); as c) {
        <section class="card">
          <h3>Receta · consulta del {{ c.fecha | date: 'dd/MM/yyyy' : '-0600' }}</h3>
          @for (m of medicamentos(); track m.id) {
            <div class="linea-receta">
              <span>{{ m.nombre }} <small class="muted">existencia: {{ m.existencia }}</small></span>
              <input type="number" min="0" [name]="'cant-' + m.id" [(ngModel)]="cantidades[m.id]">
            </div>
          }
          <button (click)="emitirReceta(c)" [disabled]="guardando()">Emitir receta</button>
          <button class="secundario" (click)="consultaReceta.set(null)">Cancelar</button>
        </section>
      }
    } @else {
      <p class="muted">Cargando expediente…</p>
    }
  `,
  styles: `
    .consulta { border-top: 1px solid #e3e8ef; padding: .75rem 0; }
    .consulta header { margin-bottom: .25rem; }
    .alerta { background: #fdecea; border: 1px solid #e53935; padding: .75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
    .linea-receta { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .35rem 0; }
    .linea-receta input { width: 6rem; }
  `,
})
export class ExpedienteComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly ruta = inject(ActivatedRoute);
  readonly auth = inject(AuthService);

  readonly expediente = signal<Expediente | null>(null);
  readonly citas = signal<Cita[]>([]);
  readonly medicamentos = signal<Medicamento[]>([]);
  readonly consultaReceta = signal<Consulta | null>(null);
  readonly mensaje = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly alertas = signal<{ medicamento: string; alergia: string }[]>([]);
  readonly guardando = signal(false);

  readonly esClinico = computed(() => this.auth.tieneRol('medico', 'enfermero'));
  readonly puedeRecetar = computed(() => this.auth.tieneRol('medico'));
  readonly citasActivas = computed(() =>
    this.citas().filter((c) => ['Pendiente', 'Confirmada', 'EnAtencion'].includes(c.estado)),
  );

  private pacienteId = '';
  cantidades: Record<string, number> = {};
  form = {
    citaId: '',
    diagnosticoCIE11: '',
    presionSistolica: undefined as number | undefined,
    presionDiastolica: undefined as number | undefined,
    frecuenciaCardiaca: undefined as number | undefined,
    temperatura: undefined as number | undefined,
    notasEvolucion: '',
  };

  ngOnInit(): void {
    this.pacienteId = this.ruta.snapshot.paramMap.get('pacienteId') ?? '';
    this.cargar();
    this.api.citas().subscribe((c) => {
      this.citas.set(c.filter((x) => x.pacienteId === this.pacienteId));
      this.form.citaId = this.citasActivas()[0]?.id ?? '';
    });
    this.api.medicamentos().subscribe((m) => this.medicamentos.set(m));
  }

  registrarConsulta(): void {
    this.limpiarAvisos();
    const signos: Record<string, number> = {};
    const { presionSistolica, presionDiastolica, frecuenciaCardiaca, temperatura } = this.form;
    if (presionSistolica !== undefined) signos['presionSistolica'] = presionSistolica;
    if (presionDiastolica !== undefined) signos['presionDiastolica'] = presionDiastolica;
    if (frecuenciaCardiaca !== undefined) signos['frecuenciaCardiaca'] = frecuenciaCardiaca;
    if (temperatura !== undefined) signos['temperatura'] = temperatura;

    this.guardando.set(true);
    this.api.registrarConsulta(this.pacienteId, {
      citaId: this.form.citaId,
      signosVitales: signos,
      diagnosticoCIE11: this.form.diagnosticoCIE11,
      notasEvolucion: this.form.notasEvolucion,
    }).subscribe({
      next: () => {
        this.mensaje.set('Consulta registrada.');
        this.form = { ...this.form, diagnosticoCIE11: '', notasEvolucion: '', presionSistolica: undefined, presionDiastolica: undefined, frecuenciaCardiaca: undefined, temperatura: undefined };
        this.guardando.set(false);
        this.cargar();
      },
      error: (e: { error: ErrorApi }) => this.mostrarError(e.error),
    });
  }

  abrirReceta(c: Consulta): void {
    this.limpiarAvisos();
    this.cantidades = {};
    this.consultaReceta.set(c);
  }

  emitirReceta(c: Consulta): void {
    this.limpiarAvisos();
    const items = Object.entries(this.cantidades)
      .filter(([, cant]) => Number(cant) > 0)
      .map(([medicamentoId, cantidad]) => ({ medicamentoId, cantidad: Number(cantidad) }));
    if (items.length === 0) {
      this.error.set('Seleccione al menos un medicamento');
      return;
    }

    this.guardando.set(true);
    this.api.emitirReceta({ consultaId: c.id, items }).subscribe({
      next: (r) => {
        this.mensaje.set(`Receta ${r.folio} emitida.`);
        this.consultaReceta.set(null);
        this.guardando.set(false);
        this.cargar();
        this.api.medicamentos().subscribe((m) => this.medicamentos.set(m));
      },
      error: (e: { error: ErrorApi }) => this.mostrarError(e.error),
    });
  }

  signos(c: Consulta): [string, number][] {
    const etiquetas: Record<string, string> = {
      presionSistolica: 'PAS',
      presionDiastolica: 'PAD',
      frecuenciaCardiaca: 'FC',
      temperatura: 'Temp',
      peso: 'Peso',
    };
    return Object.entries(c.signosVitales).map(([k, v]): [string, number] => [etiquetas[k] ?? k, v]);
  }

  private cargar(): void {
    this.api.expediente(this.pacienteId).subscribe({
      next: (e) => this.expediente.set(e),
      error: (e: { error: ErrorApi }) => this.error.set(e.error?.error ?? 'No se pudo cargar el expediente'),
    });
  }

  private mostrarError(e: ErrorApi): void {
    this.guardando.set(false);
    this.error.set(e?.error ?? 'Ocurrió un error');
    this.alertas.set(e?.alertas ?? []);
    if (e?.faltantes?.length) this.error.set(`Existencia insuficiente: ${e.faltantes.join(', ')}`);
  }

  private limpiarAvisos(): void {
    this.mensaje.set(null);
    this.error.set(null);
    this.alertas.set([]);
  }
}
