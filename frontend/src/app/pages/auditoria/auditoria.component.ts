import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { EntradaAuditoria } from '../../core/models';

/** RNF-03: bitácora de auditoría inmutable y verificación de su cadena de hashes. */
@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [DatePipe],
  template: `
    <h2>Auditoría</h2>
    <p class="muted">Registro inmutable de accesos y cambios. Cada entrada encadena el hash de la anterior.</p>

    <section class="card">
      <button (click)="verificar()">Verificar integridad</button>
      @if (integridad(); as i) {
        @if (i.valida) {
          <p class="ok">Cadena íntegra · {{ i.total }} entradas verificadas.</p>
        } @else {
          <p class="error">Alteración detectada en la entrada #{{ i.indiceAlterado }}.</p>
        }
      }
    </section>

    <section class="card">
      <table>
        <thead><tr><th>Fecha (UTC)</th><th>Usuario</th><th>Acción</th><th>Recurso</th><th>Hash</th></tr></thead>
        <tbody>
          @for (e of entradas(); track e.hash) {
            <tr>
              <td>{{ e.ts | date: 'dd/MM/yyyy HH:mm:ss' : 'UTC' }}</td>
              <td>{{ e.usuarioId }}</td>
              <td>{{ e.accion }}</td>
              <td>{{ e.recurso }}</td>
              <td><code>{{ e.hash.slice(0, 12) }}…</code></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="muted">Sin registros.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class AuditoriaComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly entradas = signal<EntradaAuditoria[]>([]);
  readonly integridad = signal<{ valida: boolean; total: number; indiceAlterado?: number } | null>(null);

  ngOnInit(): void {
    this.api.auditoria().subscribe((e) => this.entradas.set([...e].reverse()));
  }

  verificar(): void {
    this.api.integridad().subscribe((r) => this.integridad.set(r));
  }
}
