// Turns any error (axios, fetch, thrown Error) into a sentence a non-technical
// user can act on. Server messages written for users pass through; anything
// that looks like database/validator/stack output is replaced.

const TECHNICAL_PATTERNS = [
  /SQLSTATE/i,
  /duplicate key/i,
  /violates .* constraint/i,
  /\bpq:|\bgorm\b|\bsql:/i,
  /Key: '.*' Error:/i,
  /Field validation/i,
  /json: cannot/i,
  /strconv\./i,
  /runtime error/i,
  /nil pointer/i,
  /Request failed with status code/i,
  /Network Error/i,
  /timeout of \d+ms/i,
  /ECONN|ETIMEDOUT|ENOTFOUND/i,
  /JSON Parse error|Unexpected token/i,
  /undefined is not|Cannot read propert/i,
  /TypeError|SyntaxError/i,
  /<html|<!DOCTYPE/i,
];

export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const NETWORK_ERROR = "We couldn't reach MySokoApp. Check your internet connection and try again.";

export function isTechnicalMessage(message: string): boolean {
  return TECHNICAL_PATTERNS.some((re) => re.test(message));
}

function friendlyForStatus(status: number): string | null {
  if (status === 401) return 'Your session has expired. Please log in again.';
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find what you were looking for.";
  if (status === 409) return 'This already exists. Please check your details.';
  if (status === 413) return 'That file is too large. Please choose a smaller one.';
  if (status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (status >= 500) return "Something went wrong on our side. Please try again in a moment.";
  return null;
}

export function friendlyError(error: any, fallback: string = GENERIC_ERROR): string {
  if (!error) return fallback;
  if (typeof error === 'string') return isTechnicalMessage(error) ? fallback : error;

  const status: number | undefined = error.response?.status;
  const serverMsg = error.response?.data?.error ?? error.response?.data?.message;

  if (typeof serverMsg === 'string' && serverMsg.trim() && !isTechnicalMessage(serverMsg)) {
    return serverMsg;
  }

  // axios: a request with no response never reached the server.
  if (error.isAxiosError && !error.response) {
    return error.code === 'ECONNABORTED' ? 'The request took too long. Please try again.' : NETWORK_ERROR;
  }
  // fetch: network failures reject with a TypeError.
  if (error instanceof TypeError && /Network request failed/i.test(error.message)) {
    return NETWORK_ERROR;
  }

  if (status) {
    const byStatus = friendlyForStatus(status);
    if (byStatus) return byStatus;
  }

  const msg = typeof error.message === 'string' ? error.message : '';
  if (msg && !isTechnicalMessage(msg) && !error.response) return msg;
  return fallback;
}
