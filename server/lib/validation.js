import { badRequest } from './errors.js';

export function stringValue(value, field, options = {}) {
  const { required = true, min = 1, max = 255, trim = true } = options;
  if (value === undefined || value === null) {
    if (!required) return undefined;
    throw badRequest(`${field} is required.`, { field });
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`, { field });
  const normalized = trim ? value.trim() : value;
  if (normalized.length < min || normalized.length > max) {
    throw badRequest(`${field} must be between ${min} and ${max} characters.`, { field });
  }
  return normalized;
}

export function optionalNullableString(value, field, max = 255) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return stringValue(value, field, { max });
}

export function emailValue(value) {
  const email = stringValue(value, 'email', { max: 320 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('Enter a valid email address.', { field: 'email' });
  }
  return email;
}

export function passwordValue(value) {
  const password = stringValue(value, 'password', { min: 10, max: 200, trim: false });
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw badRequest('Password must contain at least one letter and one number.', { field: 'password' });
  }
  return password;
}

export function idValue(value, field = 'id') {
  return stringValue(value, field, { min: 8, max: 80 });
}

export function numberValue(value, field, options = {}) {
  const { required = true, min = -Infinity, max = Infinity, integer = false } = options;
  if (value === undefined || value === null || value === '') {
    if (!required) return undefined;
    throw badRequest(`${field} is required.`, { field });
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min || number > max) {
    throw badRequest(`${field} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`, {
      field,
    });
  }
  return number;
}

export function enumValue(value, field, allowed, options = {}) {
  if ((value === undefined || value === null || value === '') && options.required === false) return undefined;
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`, { field, allowed });
  }
  return value;
}

export function booleanValue(value, field, options = {}) {
  if (value === undefined && options.required === false) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  throw badRequest(`${field} must be true or false.`, { field });
}

export function jsonObject(value, field, options = {}) {
  if (value === undefined && options.required === false) return undefined;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw badRequest(`${field} must contain valid JSON.`, { field });
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest(`${field} must be an object.`, { field });
  }
  return parsed;
}

export function jsonArray(value, field, options = {}) {
  if (value === undefined && options.required === false) return undefined;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw badRequest(`${field} must contain valid JSON.`, { field });
    }
  }
  if (!Array.isArray(parsed)) throw badRequest(`${field} must be an array.`, { field });
  return parsed;
}

export function colorValue(value, required = true) {
  if (value === undefined && !required) return undefined;
  const color = stringValue(value, 'color', { max: 40 });
  if (!/^#[\da-f]{3,8}$/i.test(color) && !/^rgba?\([\d\s,.%]+\)$/i.test(color)) {
    throw badRequest('color must be a hexadecimal or rgb/rgba color.', { field: 'color' });
  }
  return color;
}

export function safeFilename(value, fallback = 'file') {
  const name = String(value || fallback)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\";]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (name || fallback).slice(0, 180);
}
