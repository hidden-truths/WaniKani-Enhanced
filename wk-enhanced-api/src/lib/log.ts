// Minimal structured-JSON logger. One line per event. journald-friendly.
// Avoids a pino/winston dep — this is the entire logging surface we need.

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
    const line = { ts: new Date().toISOString(), level, event, ...(fields || {}) };
    // stdout for info/debug, stderr for warn/error — keeps `docker logs` and
    // journalctl filtering trivial.
    const sink = level === 'warn' || level === 'error' ? console.error : console.log;
    sink(JSON.stringify(line));
}

export const log = {
    debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
    info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
    warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
};
