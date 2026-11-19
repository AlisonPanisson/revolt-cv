export interface KeyboardSnapshot {
  steer: number;
  throttle: number;
  brake: number;
  fireTriggered: boolean;
  resetTriggered: boolean;
  anyActive: boolean;
}

export class KeyboardController {
  private keys = new Set<string>();
  private fireQueued = false;
  private resetQueued = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const code = e.code;
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      if (!this.keys.has(code)) {
        if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyE') {
          this.fireQueued = true;
        }
        if (code === 'KeyR') {
          this.resetQueued = true;
        }
      }
      this.keys.add(code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  public update(): KeyboardSnapshot {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const up = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const down = this.keys.has('KeyS') || this.keys.has('ArrowDown');

    const steer = (right ? 1 : 0) - (left ? 1 : 0);
    const throttle = up ? 1 : 0;
    const brake = down ? 1 : 0;

    const fireTriggered = this.fireQueued;
    const resetTriggered = this.resetQueued;
    this.fireQueued = false;
    this.resetQueued = false;

    const anyActive = left || right || up || down || fireTriggered || resetTriggered;
    return {
      steer,
      throttle,
      brake,
      fireTriggered,
      resetTriggered,
      anyActive,
    };
  }
}
