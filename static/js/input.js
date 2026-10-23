const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.once = new Set();
    this.steer = 0;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.gpPrev = [];
    addEventListener('keydown', (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.once.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  pressed(code) { const p = this.once.has(code); this.once.delete(code); return p; }

  update(dt) {
    const k = this.keys, s = this.state;
    const left = k.has('KeyA') || k.has('ArrowLeft'), right = k.has('KeyD') || k.has('ArrowRight');
    let target = (right ? 1 : 0) - (left ? 1 : 0);
    s.throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    s.brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    s.handbrake = k.has('Space');
    s.nitro = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');
    let analog = null;
    const gp = [...(navigator.getGamepads?.() || [])].find((g) => g && g.connected);
    if (gp) {
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) analog = Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4;
      const b = (i) => gp.buttons[i] || { value: 0, pressed: false };
      s.throttle = Math.max(s.throttle, b(7).value);
      s.brake = Math.max(s.brake, b(6).value);
      s.handbrake ||= b(1).pressed || b(2).pressed;
      s.nitro ||= b(0).pressed || b(5).pressed;
      const map = { 3: 'KeyR', 4: 'KeyC', 9: 'Escape' };
      for (const i in map) { const p = b(i).pressed; if (p && !this.gpPrev[i]) this.once.add(map[i]); this.gpPrev[i] = p; }
      this.gpLook = b(8).pressed;
    }
    if (analog !== null) this.steer = analog;
    else {
      const rate = target === 0 ? 10 : Math.sign(target) !== Math.sign(this.steer) && this.steer !== 0 ? 14 : 5.5;
      const d = target - this.steer;
      this.steer += Math.max(-rate * dt, Math.min(rate * dt, d));
    }
    s.steer = this.steer;
    return s;
  }

  lookBack() { return this.keys.has('KeyB') || !!this.gpLook; }
}
