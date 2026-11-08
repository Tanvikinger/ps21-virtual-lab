// Minimal JSON logger. Never pass secrets/credentials to it.
export const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));
