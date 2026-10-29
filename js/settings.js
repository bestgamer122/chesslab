const DEFAULT_SETTINGS = {
  boardTheme: 'green',
  showCoords: true,
  animations: true,
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem('chesslab_settings');
      if (saved) this.data = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch (_) {}
  }

  save(newData) {
    this.data = { ...this.data, ...newData };
    try { localStorage.setItem('chesslab_settings', JSON.stringify(this.data)); } catch (_) {}
  }

  get(key) { return this.data[key]; }
}
