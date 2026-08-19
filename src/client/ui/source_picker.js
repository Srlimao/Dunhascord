/**
 * Electron Visual Window & Screen Picker Component
 */

export class SourcePicker {
  constructor({ modalEl, gridEl, onSelect, onCancel }) {
    this.modalEl = modalEl;
    this.gridEl = gridEl;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  async open() {
    if (!window.electronAPI?.getDesktopSources) return;
    try {
      const sources = await window.electronAPI.getDesktopSources({ types: ['window', 'screen'] });
      this.gridEl.innerHTML = '';

      sources.forEach((src) => {
        const card = document.createElement('div');
        card.className = 'source-card';
        card.innerHTML = `
          <div class="source-thumb-wrap"><img src="${src.thumbnail}" alt="${src.name}"></div>
          <div class="source-card-title">
            ${src.appIcon ? `<img src="${src.appIcon}" class="source-app-icon">` : ''}
            <span>${src.name}</span>
            <span class="source-pid-pill">🎵 App Audio</span>
          </div>
        `;
        card.addEventListener('click', () => {
          this.close();
          if (this.onSelect) this.onSelect(src.id, src.name);
        });
        this.gridEl.appendChild(card);
      });

      this.modalEl.classList.remove('hidden');
    } catch (err) {
      console.warn('[SourcePicker] Error fetching sources:', err);
    }
  }

  close() {
    this.modalEl.classList.add('hidden');
  }
}
