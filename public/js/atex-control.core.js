// public/js/atex-control.core.js — Version complète avec auth
(function () {
  const API = '/api';

  // Get account ID
  function getAccountId() {
    return localStorage.getItem('app_account_id') || '10';
  }

  // Get JWT token
  function getToken() {
    return localStorage.getItem('autonomix_token') || '';
  }

  // Headers with auth
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    };
  }

  // Helpers
  function guessMimeFromSrc(src) {
    if (/^data:([^;]+)/i.test(src)) return RegExp.$1;
    if (/\.pdf(\?|$)/i.test(src)) return 'application/pdf';
    if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(src)) return 'image/' + RegExp.$1.toLowerCase();
    return '';
  }

  function normalizeAttachments(eq) {
    let atts = eq.attachments;
    if (typeof atts === 'string') { try { atts = JSON.parse(atts); } catch { atts = []; } }
    if (!Array.isArray(atts)) atts = [];
    const items = atts.map((a, i) => {
      const src = a.url || a.href || a.path || a.data || '';
      if (!src) return null;
      return {
        name: a.name || `Pièce ${i+1}`,
        src,
        mime: a.mime || guessMimeFromSrc(src)
      };
    }).filter(Boolean);
    if (eq.photo) items.unshift({ name: 'Photo', src: eq.photo, mime: 'image/*' });
    return items;
  }

  function renderStage(item, idx, total) {
    const stage = document.getElementById('attViewerStage');
    const title = document.getElementById('attViewerTitle');
    const meta = document.getElementById('attViewerMeta');
    const openA = document.getElementById('attOpen');

    if (!stage) return;
    stage.innerHTML = '';

    const mime = (item.mime || '').toLowerCase();
    const src = item.src;

    if (mime.includes('pdf')) {
      const iframe = document.createElement('iframe');
      iframe.title = item.name || 'document';
      iframe.className = 'w-100 h-100';
      iframe.src = src;
      stage.appendChild(iframe);
    } else {
      const img = document.createElement('img');
      img.alt = item.name || 'image';
      img.src = src;
      img.className = 'img-fluid';
      stage.appendChild(img);
    }

    if (title) title.textContent = item.name || 'Pièce jointe';
    if (meta) meta.textContent = `${idx + 1}/${total}`;
    if (openA) openA.href = src;
  }

  function updateNavButtons(state) {
    const prev = document.getElementById('attPrev');
    const next = document.getElementById('attNext');
    if (!prev || !next) return;
    prev.disabled = state.idx <= 0;
    next.disabled = state.idx >= state.items.length - 1;
  }

  async function openAttachmentViewer(eq) {
    try {
      const modal = new bootstrap.Modal(document.getElementById('attViewerModal'));
      const items = normalizeAttachments(eq);
      if (!items.length) {
        console.log('Aucune pièce jointe', 'warning');
        return;
      }
      const state = { items, idx: 0 };
      window.__att_state = state;

      renderStage(state.items[state.idx], state.idx, state.items.length);
      updateNavButtons(state);
      modal.show();

      const prev = document.getElementById('attPrev');
      const next = document.getElementById('attNext');
      const modalEl = document.getElementById('attViewerModal');

      function onPrev() {
        if (state.idx > 0) {
          state.idx -= 1;
          renderStage(state.items[state.idx], state.idx, state.items.length);
          updateNavButtons(state);
        }
      }
      function onNext() {
        if (state.idx < state.items.length - 1) {
          state.idx += 1;
          renderStage(state.items[state.idx], state.idx, state.items.length);
          updateNavButtons(state);
        }
      }
      prev.addEventListener('click', onPrev);
      next.addEventListener('click', onNext);

      modalEl.addEventListener('hidden.bs.modal', () => {
        prev.removeEventListener('click', onPrev);
        next.removeEventListener('click', onNext);
        delete window.__att_state;
        document.getElementById('attViewerStage').innerHTML = '';
        document.getElementById('attViewerMeta').textContent = '';
      }, { once: true });
    } catch (err) {
      console.error('[openAttachmentViewer] fail', err);
      console.log('Erreur en ouvrant les pièces', 'danger');
    }
  }

  window.openAttachmentViewer = openAttachmentViewer;

  // Load Secteurs
  async function loadSecteurs() {
    try {
      const response = await fetch(`${API}/atex-secteurs?account_id=${getAccountId()}`, {
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const secteurs = await response.json();
      const select = document.getElementById('filter-secteur');
      const editSelect = document.getElementById('secteur');
      if (select) {
        select.innerHTML = '<option>Secteur</option>' + secteurs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      }
      if (editSelect) {
        editSelect.innerHTML = '<option>Secteur</option>' + secteurs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      }
    } catch (err) {
      console.error('[loadSecteurs] error', err);
      alert('Erreur lors du chargement des secteurs');
    }
  }

  // Load Equipments
  async function loadEquipments() {
    try {
      const response = await fetch(`${API}/atex-equipments?account_id=${getAccountId()}`, {
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const equipments = await response.json();
      if (!Array.isArray(equipments)) throw new Error('Response is not an array');
      const table = document.getElementById('equipments-table').querySelector('tbody');
      if (table) {
        table.innerHTML = equipments.map(eq => `
          <tr>
            <td>${eq.id}</td>
            <td>${eq.composant}</td>
            <td>${eq.secteur_id}</td>
            <td>${eq.batiment || ''}</td>
            <td>${eq.local || ''}</td>
            <td>${eq.zone_gaz || ''}</td>
            <td>${eq.zone_poussieres || ''}</td>
            <td>${eq.conformite || ''}</td>
            <td>${eq.statut || ''}</td>
            <td>${eq.risk || ''}</td>
            <td>${eq.last_inspection_date || ''}</td>
            <td>${eq.next_inspection_date || ''}</td>
            <td>
              <button data-action="edit-equipment" data-id="${eq.id}">Edit</button>
              <button data-action="delete-equipment" data-id="${eq.id}">Delete</button>
              <button data-action="open-attachments" data-id="${eq.id}">Attachments</button>
              <button data-action="open-ia" data-id="${eq.id}">IA</button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      console.error('[loadEquipments] error', err);
      alert('Erreur lors du chargement des équipements');
    }
  }

  // Save Equipment
  async function saveEquipment(equipment) {
    const method = equipment.id ? 'PUT' : 'POST';
    const url = equipment.id ? `${API}/atex-equipments/${equipment.id}` : `${API}/atex-equipments`;
    try {
      const response = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(equipment)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.error('[saveEquipment] error', err);
      alert('Erreur lors de la sauvegarde de l\'équipement');
    }
  }

  // Delete Equipment
  async function deleteEquipment(id) {
    try {
      const response = await fetch(`${API}/atex-equipments/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.error('[deleteEquipment] error', err);
      alert('Erreur lors de la suppression');
    }
  }

  // Inspect
  async function inspectEquipment(id, inspection) {
    try {
      const response = await fetch(`${API}/atex-inspections`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ equipment_id: id, ...inspection })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.error('[inspectEquipment] error', err);
      alert('Erreur lors de l\'inspection');
    }
  }

  // IA Help
  async function getIAHelp(id) {
    try {
      const response = await fetch(`${API}/atex-help/${id}`, { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { html } = await response.json();
      return html;
    } catch (err) {
      console.error('[getIAHelp] error', err);
      alert('Erreur IA');
    }
  }

  // Chat IA
  async function sendChat(question, equipment_id, history) {
    try {
      const response = await fetch(`${API}/atex-chat`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ question, equipment_id, history })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { response: reply } = await response.json();
      return reply;
    } catch (err) {
      console.error('[sendChat] error', err);
      alert('Erreur chat IA');
    }
  }

  async function getChatThread(equipment_id) {
    try {
      const response = await fetch(`${API}/atex-chat/${equipment_id}`, { headers: authHeaders() });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error('[getChatThread] error', err);
      alert('Erreur récupération chat');
    }
  }

  async function deleteChatThread(equipment_id) {
    try {
      const response = await fetch(`${API}/atex-chat/${equipment_id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.error('[deleteChatThread] error', err);
      alert('Erreur suppression chat');
    }
  }

  // Import File
  async function importFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const response = await fetch(`${API}/atex-import-excel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }, // No Content-Type for FormData
        body: formData
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error('[importFile] error', err);
      alert('Erreur import');
    }
  }

  // Init and Bind
  window.addEventListener('DOMContentLoaded', () => {
    // Check if logged in
    if (!getToken()) {
      window.location.href = '/login.html';
      return;
    }
    loadSecteurs();
    loadEquipments();

    const form = document.getElementById('equipment-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const equipment = {
          id: form.dataset.id || null,
          secteur_id: document.getElementById('secteur').value,
          batiment: document.getElementById('batiment').value,
          local: document.getElementById('local').value,
          zone_gaz: document.getElementById('zone_gaz').value,
          zone_poussieres: document.getElementById('zone_poussieres').value,
          composant: document.getElementById('composant').value,
          fabricant: document.getElementById('fabricant').value,
          type: document.getElementById('type').value,
          identifiant: document.getElementById('identifiant').value,
          marquage_atex: document.getElementById('marquage_atex').value,
          comments: document.getElementById('comments').value,
          last_inspection_date: document.getElementById('last_inspection_date').value,
          frequence: document.getElementById('frequence').value
        };
        await saveEquipment(equipment);
        loadEquipments();
        form.reset();
      });
    }

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const act = btn.dataset.action;
      if (act === 'edit-equipment') {
        const id = btn.dataset.id;
        const response = await fetch(`${API}/atex-equipments/${id}`, { headers: authHeaders() });
        const eq = await response.json();
        const form = document.getElementById('equipment-form');
        form.dataset.id = id;
        document.getElementById('secteur').value = eq.secteur_id;
        document.getElementById('batiment').value = eq.batiment;
        document.getElementById('local').value = eq.local;
        document.getElementById('zone_gaz').value = eq.zone_gaz;
        document.getElementById('zone_poussieres').value = eq.zone_poussieres;
        document.getElementById('composant').value = eq.composant;
        document.getElementById('fabricant').value = eq.fabricant;
        document.getElementById('type').value = eq.type;
        document.getElementById('identifiant').value = eq.identifiant;
        document.getElementById('marquage_atex').value = eq.marquage_atex;
        document.getElementById('comments').value = eq.comments;
        document.getElementById('last_inspection_date').value = eq.last_inspection_date;
        document.getElementById('frequence').value = eq.frequence;
      }
      if (act === 'delete-equipment') {
        const id = btn.dataset.id;
        document.getElementById('deleteMsg').textContent = 'Voulez-vous vraiment supprimer cet équipement ATEX ?';
        document.getElementById('deleteMeta').textContent = `ID ${id}`;
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('deleteModal'));
        modal.show();
        document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
          try {
            await deleteEquipment(id);
            loadEquipments();
            modal.hide();
          } catch (err) {
            alert('Erreur suppression');
          }
        }, { once: true });
      }
      if (act === 'open-attachments') {
        const id = btn.dataset.id;
        const response = await fetch(`${API}/equip/${id}`, { headers: authHeaders() });
        const payload = await response.json();
        window.openAttachmentViewer(payload);
      }
      if (act === 'open-ia') {
        const id = btn.dataset.id;
        const html = await getIAHelp(id);
        // Display in modal
      }
    });

    const importBtn = document.getElementById('import-btn');
    const importFileInput = document.getElementById('import-file');
    if (importBtn && importFileInput) {
      importBtn.addEventListener('click', async () => {
        const file = importFileInput.files[0];
        if (file) {
          await importFile(file);
          loadEquipments();
        }
      });
    }
  });
})();
