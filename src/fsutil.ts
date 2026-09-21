/**
 * The small filesystem and process helpers the client registrars share.
 *
 * Writes are read–modify–write and atomic-ish (temp file + rename), because the file we
 * are editing is the customer's own MCP config: it very likely already holds servers
 * that have nothing to do with us, and losing one to a half-written file or a clobbered
 * root object would be a far worse outcome than failing to install.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

export const execFileP = promisify(execFile);

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The file's text, or undefined when it is absent. Any other error propagates — an
 *  unreadable config is a real failure and must not be silently treated as empty, which
 *  would make the next write clobber it. */
export async function readTextIfPresent(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Write `text` to `p`, creating parent directories as needed.
 *
 * A file we create is 0600, since it lives in the user's home and nothing else needs to
 * read it. A file that already exists keeps the mode the user gave it — tightening
 * someone's existing config behind their back is not ours to do, and would be a
 * surprising side effect of adding one entry.
 */
export async function writeConfig(p: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const isNew = !(await exists(p));
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, isNew ? { mode: 0o600 } : {});
  await fs.rename(tmp, p);
}

/** Is `bin` on PATH? Used to detect CLI clients that manage their own config. */
export async function whichBin(bin: string): Promise<string | undefined> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileP(probe, [bin]);
    const first = stdout.split('\n')[0]?.trim();
    return first ? first : undefined;
  } catch {
    return undefined;
  }
}
