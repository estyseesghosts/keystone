// Central logger (repair X8.1): levels, sinks, redaction, storage
// forwarding, and global-handler wiring.

import {
  addSink,
  debug,
  error,
  info,
  installGlobalErrorHandlers,
  logger,
  redactUrl,
  reportGlobalError,
  stripTokens,
  warn,
  type GlobalErrorHandler,
  type LogRecord,
} from './logger';
import {emitStorageWriteFailed} from '#/storage/storageEvents';

function collect() {
  const seen: LogRecord[] = [];
  const dispose = addSink(r => seen.push(r));
  return {seen, dispose};
}

describe('logger levels and sinks', () => {
  it('delivers every level to sinks with a timestamp', () => {
    const {seen, dispose} = collect();
    try {
      debug('d');
      info('i');
      warn('w');
      error('e');
      expect(seen.map(r => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
      expect(seen.map(r => r.message)).toEqual(['d', 'i', 'w', 'e']);
      for (const r of seen) expect(typeof r.at).toBe('number');
    } finally {
      dispose();
    }
  });

  it('exposes the same fns on the logger singleton', () => {
    expect(logger.debug).toBe(debug);
    expect(logger.info).toBe(info);
    expect(logger.warn).toBe(warn);
    expect(logger.error).toBe(error);
    expect(logger.addSink).toBe(addSink);
  });

  it('unsubscribes and survives throwing sinks', () => {
    const good: LogRecord[] = [];
    const offBad = addSink(() => {
      throw new Error('sink boom');
    });
    const offGood = addSink(r => good.push(r));
    try {
      expect(() => warn('hello')).not.toThrow();
      expect(good).toHaveLength(1);
      offGood();
      warn('again');
      expect(good).toHaveLength(1);
    } finally {
      offBad();
    }
  });

  it('renders Error details and truncates runaway strings', () => {
    const {seen, dispose} = collect();
    try {
      error('failed', new Error('nope'));
      expect(seen[0].detail).toContain('Error: nope');
      warn('big', `x${'y'.repeat(5000)}`);
      expect(seen[1].detail).not.toBeNull();
      expect(seen[1].detail!.length).toBeLessThan(3000);
      expect(seen[1].detail).toContain('[truncated]');
    } finally {
      dispose();
    }
  });

  it('survives circular details', () => {
    const {seen, dispose} = collect();
    try {
      const circular: {self?: unknown} = {};
      circular.self = circular;
      expect(() => warn('circular', circular)).not.toThrow();
      expect(seen).toHaveLength(1);
    } finally {
      dispose();
    }
  });
});

describe('redactUrl', () => {
  it('keeps origin + path, masks the query (the `?i=` token dies here)', () => {
    expect(redactUrl('https://m.example/api/notes?i=secret123')).toBe(
      'https://m.example/api/notes?[redacted]',
    );
    expect(redactUrl('https://m.example/api/notes')).toBe('https://m.example/api/notes');
    expect(redactUrl('https://m.example/')).toBe('https://m.example');
  });

  it('drops credentials and fragments', () => {
    expect(redactUrl('https://user:pass@m.example/x#frag')).toBe('https://m.example/x');
  });

  it('answers fixed markers for bad input, never the input', () => {
    const evil = 'not a url Bearer abc123';
    expect(redactUrl(evil)).toBe('[unparseable-url]');
    expect(redactUrl(null)).toBe('[no-url]');
    expect(redactUrl(undefined)).toBe('[no-url]');
    expect(redactUrl('')).toBe('[no-url]');
  });
});

describe('stripTokens (privacy 13: no body or token in any log)', () => {
  it('masks bearer tokens', () => {
    const out = stripTokens('call failed Authorization: Bearer abc123def');
    expect(out).toContain('Bearer [redacted]');
    expect(out).not.toContain('abc123def');
  });

  it('masks the Misskey `i` credential in JSON and query forms', () => {
    expect(stripTokens('{"i": "tok123"}')).not.toContain('tok123');
    expect(stripTokens('POST /api/notes?i=tok123')).not.toContain('tok123');
    expect(stripTokens('stream wss://m.example/streaming?i=tok123 down')).not.toContain('tok123');
  });

  it('masks OAuth secrets but leaves public ids readable', () => {
    const out = stripTokens('client_secret=shh client_id=pub1');
    expect(out).not.toContain('shh');
    expect(out).toContain('pub1');
  });

  it('redacts every record (message and detail) at emit time', () => {
    const {seen, dispose} = collect();
    try {
      warn('vote failed with Bearer deadbeef', new Error('server said {"i": "tok999"}'));
      expect(seen).toHaveLength(1);
      expect(seen[0].message).not.toContain('deadbeef');
      expect(seen[0].detail).not.toContain('tok999');
    } finally {
      dispose();
    }
  });
});

describe('storageWriteFailed forwarding (X1.3 S12 consumer)', () => {
  it('logs the scope only — never the key, values, or tokens', () => {
    const {seen, dispose} = collect();
    try {
      emitStorageWriteFailed('keystone.drafts.sess-1');
      expect(seen).toHaveLength(1);
      expect(seen[0].level).toBe('warn');
      expect(seen[0].detail).toContain('drafts');
      expect(seen[0].message).not.toContain('keystone.drafts.sess-1');
      expect(seen[0].detail).not.toContain('keystone.drafts.sess-1');
    } finally {
      dispose();
    }
  });
});

describe('global handlers', () => {
  it('reportGlobalError logs without throwing', () => {
    const {seen, dispose} = collect();
    try {
      expect(() => reportGlobalError(new Error('global boom'))).not.toThrow();
      expect(() => reportGlobalError('a string throw', true)).not.toThrow();
      expect(seen).toHaveLength(2);
      expect(seen[0].level).toBe('error');
      expect(seen[0].detail).toContain('global boom');
      expect(seen[1].message).toContain('fatal');
    } finally {
      dispose();
    }
  });

  it('installs ErrorUtils + unhandledrejection from injected fakes', () => {
    const {seen, dispose} = collect();
    let installed: GlobalErrorHandler | undefined;
    let prevCalled: unknown[] = [];
    const prev: GlobalErrorHandler = (...args) => {
      prevCalled = args;
    };
    const fakeWindow = {
      listeners: new Map<string, (event: unknown) => void>(),
      addEventListener(type: string, listener: (event: unknown) => void) {
        this.listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        this.listeners.delete(type);
      },
    };
    const fakeUtils = {
      getGlobalHandler: () => prev,
      setGlobalHandler: (h: GlobalErrorHandler) => {
        installed = h;
      },
    };
    const undo = installGlobalErrorHandlers({errorUtils: fakeUtils, window: fakeWindow});
    try {
      expect(installed).toBeDefined();
      installed?.(new Error('fatal boom'), true);
      expect(seen).toHaveLength(1);
      expect(seen[0].message).toContain('fatal');
      expect(seen[0].detail).toContain('fatal boom');
      // The previous handler is called through (RN behaviour preserved).
      expect(prevCalled[0]).toBeInstanceOf(Error);
      // Web rejections forward their reason.
      fakeWindow.listeners.get('unhandledrejection')?.({reason: new Error('rejected')});
      expect(seen).toHaveLength(2);
      expect(seen[1].detail).toContain('rejected');
    } finally {
      undo();
      dispose();
    }
    expect(fakeWindow.listeners.has('unhandledrejection')).toBe(false);
  });

  it('restores the previous ErrorUtils handler on dispose', () => {
    const installed: GlobalErrorHandler[] = [];
    const prev: GlobalErrorHandler = () => undefined;
    const fakeUtils = {
      getGlobalHandler: () => prev,
      setGlobalHandler: (h: GlobalErrorHandler) => {
        installed.push(h);
      },
    };
    const undo = installGlobalErrorHandlers({errorUtils: fakeUtils, window: null});
    undo();
    expect(installed).toHaveLength(2);
    expect(installed[1]).toBe(prev);
  });

  it('reads the real globals without throwing (whatever this env has)', () => {
    const {dispose} = collect();
    try {
      let undo: () => void = () => undefined;
      expect(() => {
        undo = installGlobalErrorHandlers();
      }).not.toThrow();
      expect(typeof undo).toBe('function');
      expect(() => undo()).not.toThrow();
    } finally {
      dispose();
    }
  });
});
