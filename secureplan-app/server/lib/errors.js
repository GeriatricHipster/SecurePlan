export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message, details) {
  return new ApiError(400, 'VALIDATION_ERROR', message, details);
}

export function unauthorized(message = 'Authentication is required.') {
  return new ApiError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'You do not have permission to perform this action.') {
  return new ApiError(403, 'FORBIDDEN', message);
}

export function notFound(resource = 'Resource') {
  return new ApiError(404, 'NOT_FOUND', `${resource} was not found.`);
}

export function conflict(message, details) {
  return new ApiError(409, 'CONFLICT', message, details);
}
