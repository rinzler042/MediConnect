'use strict';

/** Error controlado con código HTTP. Los servicios lo lanzan; app.js lo traduce a respuesta JSON. */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

module.exports = { HttpError };
