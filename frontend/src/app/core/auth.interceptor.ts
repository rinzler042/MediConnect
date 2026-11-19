import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Agrega el token Bearer a cada llamada y cierra sesión ante un 401. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token;
  const conToken = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(conToken).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.includes('/auth/')) auth.limpiar();
      return throwError(() => err);
    }),
  );
};
