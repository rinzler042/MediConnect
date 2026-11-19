import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { Cita, ErrorApi, Medico, PacienteResumen } from '../../core/models';

/** RF-06: recepción registra el ingreso de urgencia sin cita previa. */
@Component({
  selector: 'app-urgencias',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <h2>Ingreso de urgencia</h2>
    <p class="muted">Registro administrativo. El acceso clínico al expediente sigue requiriendo 2FA individual del personal médico.</p>

    @if (mensaje()) { <p class="ok">{{ mensaje() }}</p> }
    @if (error()) { <p class="error">{{ error() }}</p> }

    <section class="card">
      <form (ngSubmit)="registrar()">
        <div class="grid">
          <label>Paciente
            <select name="pacienteId" [(ngModel)]="pacienteId" required>
              @for (p of pacientes(); track p.id) { <option [value]="p.id">{{ p.nombre }}</option> }
            </select>
          </label>
          <label>Médico asignado (opcional)
            <select name="medicoId" [(ngModel)]="medicoId">
              <option value="">Sin asignar</option>
              @for (m of medicos(); track m.id) { <option [value]="m.id">{{ m.nombre }} · {{ m.sede }}</option> }
            </select>
          </label>
        </div>
        <label>Motivo de ingreso
          <textarea name="motivo" rows="2" [(ngModel)]="motivo" required></textarea>
        </label>
        <button type="submit" [disabled]="cargando()">Registrar ingreso</button>
      </form>
    </section>

    <section class="card">
      <h3>Urgencias registradas</h3>
      @if (urgencias().length === 0) {
        <p class="muted">Sin registros.</p>
      } @else {
        <table>
          <thead><tr><th>Hora de ingreso</th><th>Paciente</th><th>Motivo</th><th>Estado</th></tr></thead>
          <tbody>
            @for (u of urgencias(); track u.id) {
              <tr>
                <td>{{ u.fechaHora | date: 'dd/MM/yyyy HH:mm' : '-0600' }}</td>
                <td>{{ nombrePaciente(u.pacienteId) }}</td>
                <td>{{ u.motivo }}</td>
                <td><span class="tag estado-{{ u.estado }}">{{ u.estado }}</span></td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `,
})
export class UrgenciasComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly pacientes = signal<PacienteResumen[]>([]);
  readonly medicos = signal<Medico[]>([]);
  readonly urgencias = signal<Cita[]>([]);
  readonly mensaje = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly cargando = signal(false);

  pacienteId = '';
  medicoId = '';
  motivo = '';

  ngOnInit(): void {
    this.api.pacientes().subscribe((p) => { this.pacientes.set(p); this.pacienteId = p[0]?.id ?? ''; });
    this.api.medicos().subscribe((m) => this.medicos.set(m));
    this.recargar();
  }

  registrar(): void {
    this.cargando.set(true);
    this.mensaje.set(null);
    this.error.set(null);
    this.api.registrarUrgencia({ pacienteId: this.pacienteId, medicoId: this.medicoId || undefined, motivo: this.motivo })
      .subscribe({
        next: () => {
          this.mensaje.set('Ingreso de urgencia registrado.');
          this.motivo = '';
          this.cargando.set(false);
          this.recargar();
        },
        error: (e: { error: ErrorApi }) => {
          this.error.set(e.error?.error ?? 'No se pudo registrar el ingreso');
          this.cargando.set(false);
        },
      });
  }

  nombrePaciente(id: string): string {
    return this.pacientes().find((p) => p.id === id)?.nombre ?? id;
  }

  private recargar(): void {
    this.api.citas().subscribe((c) => this.urgencias.set(c.filter((x) => x.urgencia)));
  }
}
