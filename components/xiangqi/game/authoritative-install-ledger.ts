/**
 * Resolves an online command as soon as its authoritative state is installed,
 * while the command gate remains busy until the presentation pipeline settles.
 */
export class AuthoritativeInstallLedger {
  readonly #waiters = new Map<string, () => void>();
  #generation = 0;

  waitFor(token: string): Promise<void> {
    const generation = this.#generation;
    return new Promise((resolve) => {
      this.#waiters.set(token, () => {
        if (generation === this.#generation) resolve();
      });
    });
  }

  markInstalled(token: string): void {
    const resolve = this.#waiters.get(token);
    if (!resolve) return;
    this.#waiters.delete(token);
    resolve();
  }

  cancel(token: string): void {
    this.#waiters.delete(token);
  }

  invalidate(): void {
    this.#generation += 1;
    this.#waiters.clear();
  }
}
