import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Rol } from './models';

/** Exige sesión y, si la ruta declara `data.roles`, que el rol del usuario esté incluido. */
export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const usuario = auth.usuario();

  if (!usuario) return router.createUrlTree(['/login']);

  const roles = route.data['roles'] as Rol[] | undefined;
  if (roles && !roles.includes(usuario.rol)) return router.createUrlTree(['/citas']);

  return true;
};
