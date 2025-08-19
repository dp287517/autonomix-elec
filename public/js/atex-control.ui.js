// js/atex-control.ui.js — viewer pièces (images/PDF) + hooks doux
(() => {
  // --- Utilitaires légers ---
  function toast(msg, type = 'info') {
    // Si tu as déjà une fonction toast globale, on l’utilise
    if (typeof window.toast === 'function') return window.toast(msg, type);
    // Fallback minimal
    console[type === 'danger' ? 'error' : 'log']('[toast]', msg);
  }

  function isPDF(mime, src) {
    if (mime && mime.toLowerCase().includes('pdf')) return true;
    if (typeof src === 'string' && src.startsWith('data:application/pdf')) return true;
    if (typeof src === 'string' && src.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  function buildAttachmentList(eq) {
    const list = [];
    // 1) Photo "legacy" (dataURL)
    if (eq.photo && typeof eq.photo === 'string' && eq.photo.startsWith('data:')) {
      list.push({
        name: eq.identifiant ? `photo_${eq.identifiant}.jpg` : 'photo.jpg',
        mime: (eq.photo.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg',
        src: eq.photo
      });
    }
    // 2) Attachments JSONB: [{name, mime, url|data}, ...]
    const arr = Array.isArray(eq.attachments) ? eq.attachments : [];
    for (const it of arr) {
      if (!it) continue;
      const name = it.name || 'piece';
      const mime = it.mime || '';
      const src  = it.url || it.data || '';
      if (!src) continue;
      list.push({ name, mime, src });
    }
    return list;
  }

  function renderAttachmentIntoStage(item) {
    const stage = document.getElementById('attViewerStage');
    if (!stage) return;
    stage.innerHTML = '';
    if (isPDF(item.mime, item.src)) {
      const iframe = document.createElement('iframe');
      iframe.className = 'w-100 h-100';
      iframe.src = item.src;
      iframe.setAttribute('loading', 'lazy');
      stage.appendChild(iframe);
    } else {
      const img = document.createElement('img');
      img.className = 'img-fluid';
      img.style.maxHeight = '90vh';
      img.alt = item.name || 'Aperçu';
      img.src = item.src;
      stage.appendChild(img);
    }
  }

  async function openAttachmentViewer(equipId) {
    try {
      if (!window.API) throw new Error('API config manquante');
      const url = `${API.equip}/${equipId}?account_id=${(window.state && state.accountId) || ''}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const eq = await r.json();

      const items = buildAttachmentList(eq);
      if (!items.length) {
        toast('Aucune pièce jointe pour cet équipement', 'secondary');
        return;
      }

      // Méta du modal
      const titleEl = document.getElementById('attViewerTitle');
      const metaEl  = document.getElementById('attViewerMeta');
      const openBtn = document.getElementById('attOpen');
      if (titleEl) titleEl.textContent = `Pièces — ${eq.identifiant || eq.composant || ('#' + eq.id)}`;
      if (metaEl)  metaEl.textContent  = `${items.length} fichier(s)`;

      // Stockage en mémoire globale
      window.__attItems = items;
      window.__attIndex = 0;
      if (openBtn) openBtn.href = items[0].src;

      renderAttachmentIntoStage(items[0]);

      // Afficher le modal
      const modalEl = document.getElementById('attViewerModal');
      if (!modalEl) throw new Error('#attViewerModal introuvable');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
    } catch (err) {
      console.error('[openAttachmentViewer] fail', err);
      toast('Erreur en ouvrant les pièces', 'danger');
    }
  }

  // Expose une API publique pour que core.js (ou la table) puisse l’appeler
  window.openAttachmentViewer = openAttachmentViewer;

  // --- Navigation (préc / suiv) dans le modal ---
  function bindModalNav() {
    const prevBtn = document.getElementById('attPrev');
    const nextBtn = document.getElementById('attNext');
    const openBtn = document.getElementById('attOpen');

    if (prevBtn) prevBtn.onclick = () => {
      if (!window.__attItems || !window.__attItems.length) return;
      window.__attIndex = (window.__attIndex - 1 + window.__attItems.length) % window.__attItems.length;
      const it = window.__attItems[window.__attIndex];
      renderAttachmentIntoStage(it);
      if (openBtn) openBtn.href = it.src;
    };
    if (nextBtn) nextBtn.onclick = () => {
      if (!window.__attItems || !window.__attItems.length) return;
      window.__attIndex = (window.__attIndex + 1) % window.__attItems.length;
      const it = window.__attItems[window.__attIndex];
      renderAttachmentIntoStage(it);
      if (openBtn) openBtn.href = it.src;
    };
  }

  // --- Délégué de clic : tout élément avec data-open-attachments et data-id ---
  function bindDelegatedButtons() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-open-attachments]');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      ev.preventDefault();
      openAttachmentViewer(id);
    });
  }

  // Init après chargement DOM
  document.addEventListener('DOMContentLoaded', () => {
    bindModalNav();
    bindDelegatedButtons();
    // Active les icônes Lucide si présent
    if (window.lucide && lucide.createIcons) {
      lucide.createIcons();
    }
  });
})();
