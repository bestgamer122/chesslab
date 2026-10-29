import {
  Chessboard, FEN, COLOR, BORDER_TYPE,
} from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.12.3/src/Chessboard.js';
import { Markers, MARKER_TYPE } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.12.3/src/extensions/markers/Markers.js';
import { Arrows, ARROW_TYPE } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.12.3/src/extensions/arrows/Arrows.js';

const ASSETS = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8.12.3/assets/';

export class BoardView {
  constructor(element) {
    this.token = 0;
    this.board = new Chessboard(element, {
      position: FEN.start,
      orientation: COLOR.white,
      responsive: true,
      assetsUrl: ASSETS,
      style: {
        cssClass: 'green',
        showCoordinates: true,
        borderType: BORDER_TYPE.thin,
      },
      animationDuration: 0, // Отключаем анимацию, чтобы не было багов SVG
      extensions: [{ class: Markers }, { class: Arrows }],
    });
  }

  async setFen(fen, { from = null, to = null, best = null, animate = true } = {}) {
    const token = ++this.token;
    try {
      // Принудительно отключаем анимацию, чтобы не было ошибки 'without parentNode'
      await this.board.setPosition(fen, false);
    } catch (_) {
      return;
    }
    if (token !== this.token) return;

    try {
      this.board.removeMarkers();
      this.board.removeArrows();
    } catch (_) {}

    if (from && to) {
      try {
        this.board.addMarker(MARKER_TYPE.square, from);
        this.board.addMarker(MARKER_TYPE.square, to);
      } catch (_) {}
    }

    if (best && best.length >= 4) {
      const fromSquare = best.slice(0, 2);
      const toSquare = best.slice(2, 4);
      if (fromSquare !== toSquare) {
        try {
          this.board.addArrow(ARROW_TYPE.default, fromSquare, toSquare);
        } catch (_) {}
      }
    }
  }

  async setOrientation(color, animated = true) {
    try {
      await this.board.setOrientation(color === 'b' ? COLOR.black : COLOR.white, false);
    } catch (_) { /* ignore */ }
  }

  flip() {
    const current = this.board.getOrientation();
    this.board.setOrientation(current === COLOR.white ? COLOR.black : COLOR.white, false);
  }

  destroy() {
    try { this.board.destroy(); } catch (_) { /* ignore */ }
  }
}
