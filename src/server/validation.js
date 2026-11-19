export function parseResourceFields(input, fields, requiredFields = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Request body must be an object." };
  }

  const values = {};
  for (const field of fields) {
    if (Object.hasOwn(input, field)) {
      values[field] = input[field];
    }
  }

  for (const field of requiredFields) {
    if (values[field] === undefined || values[field] === null || values[field] === "") {
      return { error: `${field} is required.` };
    }
  }
  if (Object.keys(values).length === 0) {
    return { error: "Provide at least one supported field." };
  }
  return { values };
}

export function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
