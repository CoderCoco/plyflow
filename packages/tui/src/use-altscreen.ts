import { useEffect, useState } from 'react';

interface OutLike {
  write(s: string): void;
  rows?: number;
  columns?: number;
  on?(ev: 'resize', cb: () => void): void;
  off?(ev: 'resize', cb: () => void): void;
}

interface ProcLike {
  pid: number;
  once(ev: 'SIGINT' | 'exit', cb: () => void): void;
  removeListener(ev: 'SIGINT' | 'exit', cb: () => void): void;
  kill(pid: number, signal: string): void;
}

// ESC byte (0x1b) prefixes each sequence — required for actual terminal control.
const ENTER = '\x1b[?1049h\x1b[2J\x1b[H';  // enter altscreen + clear + home
const RESTORE = '\x1b[?1049l';              // leave altscreen (restore)

export function useAltscreen(
  out: OutLike = process.stdout,
  proc: ProcLike = process as unknown as ProcLike,
): { rows: number; columns: number } {
  const [size, setSize] = useState({ rows: out.rows ?? 24, columns: out.columns ?? 80 });

  useEffect(() => {
    out.write(ENTER);
    const onResize = () => setSize({ rows: out.rows ?? 24, columns: out.columns ?? 80 });
    out.on?.('resize', onResize);

    // Restore on hard exits too, so a crash never strands the user in altscreen.
    const restore = () => out.write(RESTORE);
    const onSigint = () => { restore(); proc.kill(proc.pid, 'SIGINT'); };
    proc.once('SIGINT', onSigint);
    proc.once('exit', restore);

    return () => {
      out.off?.('resize', onResize);
      proc.removeListener('SIGINT', onSigint);
      proc.removeListener('exit', restore);
      out.write(RESTORE);
    };
  }, [out, proc]);

  return size;
}
