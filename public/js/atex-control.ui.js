// js/atex-control.ui.js — viewer pièces (photo + fichiers) avec sélecteur
(() => {
  // ------- Helpers -------
  function toast(msg, type = 'info') {
    if (typeof window.toast === 'function') return window.toast(msg, type);
    console[type === 'danger' ? 'error' : 'log']('[toast]', msg);
  }
  const getAccountId = () => (window.state && state.accountId) || '';

  function isPDF(mime, src) {
    if (mime && mime.toLowerCase().includes('pdf')) return true;
    if (typeof src === 'string' && src.startsWith('data:application/pdf')) return true;
    if (typeof src === 'string' && src.toLowerCase().endsWith('.pdf')) return true;
    return false;
  }

  function dedupeBySrc(items) {
    const seen = new Set();
    const out = [];
    for (const it of items) {
      const key = (it.src || '') + '|' + (it.name || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  }

  function buildAttachmentList(eq) {
    const list = [];
    // 1) Photo "legacy" (on la met en tête pour être visible de suite)
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
      const name = it.name || 'pièce';
      const mime = it.mime || '';
      const src  = it.url || it.data || '';
      if (!src) continue;
      list.push({ name, mime, src });
    }
    return dedupeBySrc(list);
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

  function updateMetaBar(eq, items, index) {
    const metaEl = document.getElementById('attViewerMeta');
    const openBtn = document.getElementById('attOpen');
    if (!metaEl || !items.length) return;

    // Nettoyage
    metaEl.innerHTML = '';

    // Info "x / N"
    const info = document.createElement('span');
    info.className = 'me-2';
    info.textContent = `${index + 1} / ${items.length}`;
    metaEl.appendChild(info);

    // Sélecteur des pièces (petit, discret)
    const sel = document.createElement('select');
    sel.className = 'form-select form-select-sm d-inline-block';
    sel.style.width = 'auto';
    sel.style.maxWidth = '60vw';
    items.forEach((it, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.text = it.name || (isPDF(it.mime, it.src) ? 'document.pdf' : 'image');
      if (i === index) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      const i = Number(sel.value);
      window.__attIndex = i;
      const it = items[i];
      renderAttachmentIntoStage(it);
      if (openBtn) openBtn.href = it.src;
      // maj texte "x / N"
      info.textContent = `${i + 1} / ${items.length}`;
    };
    metaEl.appendChild(sel);
  }

  function bindArrows(items) {
    const prevBtn = document.getElementById('attPrev');
    const nextBtn = document.getElementById('attNext');
    const openBtn = document.getElementById('attOpen');
    const metaEl  = document.getElementById('attViewerMeta');

    const goto = (i) => {
      if (!items || !items.length) return;
      window.__attIndex = (i + items.length) % items.length;
      const it = items[window.__attIndex];
      renderAttachmentIntoStage(it);
      if (openBtn) openBtn.href = it.src;
      // maj select + compteur
      if (metaEl) {
        const sel = metaEl.querySelector('select');
        const info = metaEl.querySelector('span');
        if (sel) sel.value = String(window.__attIndex);
        if (info) info.textContent = `${window.__attIndex + 1} / ${items.length}`;
      }
    };

    if (prevBtn) prevBtn.onclick = () => goto(window.__attIndex - 1);
    if (nextBtn) nextBtn.onclick = () => goto(window.__attIndex + 1);
  }

  async function openAttachmentViewer(equipId) {
    try {
      if (!window.API) throw new Error('API config manquante');
      const url = `${API.equip}/${equipId}?account_id=${getAccountId()}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const eq = await r.json();

      const items = buildAttachmentList(eq);
      if (!items.length) {
        toast('Aucune pièce jointe pour cet équipement', 'secondary');
        return;
      }

      const titleEl = document.getElementById('attViewerTitle');
      const openBtn = document.getElementById('attOpen');
      if (titleEl) titleEl.textContent = `Pièces — ${eq.identifiant || eq.composant || ('#' + eq.id)}`;

      // Stockage global
      window.__attItems = items;
      window.__attIndex = 0;

      // Rendu initial
      renderAttachmentIntoStage(items[0]);
      if (openBtn) openBtn.href = items[0].src;

      // Meta bar (compteur + sélecteur)
      updateMetaBar(eq, items, 0);

      // Liaison des flèches
      bindArrows(items);

      // Affichage modal
      const modalEl = document.getElementById('attViewerModal');
      if (!modalEl) throw new Error('#attViewerModal introuvable');
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();

      // astuce: icons lucide
      if (window.lucide && lucide.createIcons) lucide.createIcons();

    } catch (err) {
      console.error('[openAttachmentViewer] fail', err);
      toast('Erreur en ouvrant les pièces', 'danger');
    }
  }

  // Expose pour usage depuis le tableau (bouton "Pièces")
  window.openAttachmentViewer = openAttachmentViewer;

  // Délégué: tout élément avec data-open-attachments et data-id
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

  document.addEventListener('DOMContentLoaded', () => {
    bindDelegatedButtons();
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  });
})();
