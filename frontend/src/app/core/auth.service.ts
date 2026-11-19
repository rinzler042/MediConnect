import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { ApiService } from './api.service';
import { Rol, Usuario } from './models';

const CLAVE_TOKEN = 'mc_token';
const CLAVE_USUARIO = 'mc_usuario';

/** Estado de sesión. Persiste el token y el usuario en localStorage. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly usuario = signal<Usuario | null>(this.leerUsuario());

  get token(): string | null {
    return localStorage.getItem(CLAVE_TOKEN);
  }

  iniciar(correo: string) {
    return this.api.login(correo);
  }

  verificar(desafioId: string, codigo: string) {
    return this.api.verificar(desafioId, codigo).pipe(
      tap(({ token, usuario }) => {
        localStorage.setItem(CLAVE_TOKEN, token);
        localStorage.setItem(CLAVE_USUARIO, JSON.stringify(usuario));
        this.usuario.set(usuario as Usuario);
      }),
    );
  }

  tieneRol(...roles: Rol[]): boolean {
    const rol = this.usuario()?.rol;
    return !!rol && roles.includes(rol);
  }

  salir(): void {
    this.api.salir().subscribe({ error: () => undefined });
    this.limpiar();
  }

  /** Limpia la sesión local sin llamar a la API (p. ej. al recibir 401). */
  limpiar(): void {
    localStorage.removeItem(CLAVE_TOKEN);
    localStorage.removeItem(CLAVE_USUARIO);
    this.usuario.set(null);
    this.router.navigateByUrl('/login');
  }

  private leerUsuario(): Usuario | null {
    const crudo = localStorage.getItem(CLAVE_USUARIO);
    return crudo ? (JSON.parse(crudo) as Usuario) : null;
  }
}
