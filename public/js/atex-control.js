// public/js/atex-control.js — Version complète avec auth, viewer, filtres
(function () {
  const API = '/api';

  // Cache for secteurs to resolve names
  let secteursCache = [];

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
    let atts = eq.attachments || [];
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
      iframe.title = item.name || 'Document';
      iframe.className = 'w-100 h-100';
      iframe.src = src;
      stage.appendChild(iframe);
    } else {
      const img = document.createElement('img');
      img.alt = item.name || 'Image';
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
        showToast('Aucune pièce jointe', 'warning');
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
      showToast('Erreur en ouvrant les pièces', 'danger');
    }
  }

  // Toast helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} alert-dismissible fade show`;
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '2000';
    toast.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // Load Secteurs
  async function loadSecteurs() {
    try {
      showLoader(true);
      const response = await fetch(`${API}/atex-secteurs?account_id=${getAccountId()}`, {
        headers: authHeaders()
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Non autorisé');
        throw new Error(`HTTP ${response.status}`);
      }
      secteursCache = await response.json();
      const select = document.getElementById('filter-secteur');
      const editSelect = document.getElementById('secteur');
      if (select) {
        select.innerHTML = '<option value="">Tous les secteurs</option>' + secteursCache.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      }
      if (editSelect) {
        editSelect.innerHTML = '<option value="">Sélectionner un secteur</option>' + secteursCache.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      }
    } catch (err) {
      console.error('[loadSecteurs] error', err);
      showToast(`Erreur lors du chargement des secteurs: ${err.message}`, 'danger');
      if (err.message === 'Non autorisé') window.location.href = '/login.html';
    } finally {
      showLoader(false);
    }
  }

  // Load Equipments and render
  async function loadEquipments(filters = {}) {
    try {
      showLoader(true);
      const query = new URLSearchParams({ account_id: getAccountId(), ...filters }).toString();
      const response = await fetch(`${API}/atex-equipments?${query}`, {
        headers: authHeaders()
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Non autorisé');
        throw new Error(`HTTP ${response.status}`);
      }
      const equipments = await response.json();
      renderEquipments(equipments);
    } catch (err) {
      console.error('[loadEquipments] error', err);
      showToast(`Erreur lors du chargement des équipements: ${err.message}`, 'danger');
      if (err.message === 'Non autorisé') window.location.href = '/login.html';
    } finally {
      showLoader(false);
    }
  }

  // Render equipments
  function renderEquipments(equipments) {
    const tbody = document.querySelector('#equipmentsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!equipments.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="text-center">Aucun équipement trouvé</td></tr>';
      return;
    }
    equipments.forEach(eq => {
      const secteur = secteursCache.find(s => s.id === eq.secteur_id) || { name: 'Inconnu' };
      const statut = getStatut(eq);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${eq.id}</td>
        <td>${eq.composant || ''}</td>
        <td>${secteur.name}</td>
        <td>${eq.batiment || ''}</td>
        <td>${eq.local || ''}</td>
        <td>${eq.zone_gaz || ''}</td>
        <td>${eq.zone_poussieres || ''}</td>
        <td>${eq.conformite || ''}</td>
        <td><span class="badge bg-${statut.class}">${statut.text}</span></td>
        <td>${eq.risk || ''}</td>
        <td>${eq.last_inspection_date ? new Date(eq.last_inspection_date).toLocaleDateString('fr-FR') : ''}</td>
        <td>${eq.next_inspection_date ? new Date(eq.next_inspection_date).toLocaleDateString('fr-FR') : ''}</td>
        <td>
          <button data-action="edit-equipment" data-id="${eq.id}" class="btn btn-primary btn-sm" title="Éditer">
            <i class="fas fa-edit"></i>
          </button>
          <button data-action="delete-equipment" data-id="${eq.id}" class="btn btn-danger btn-sm" title="Supprimer">
            <i class="fas fa-trash"></i>
          </button>
          <button data-action="open-attachments" data-id="${eq.id}" class="btn btn-info btn-sm" title="Pièces jointes">
            <i class="fas fa-paperclip"></i>
          </button>
          <button data-action="open-ia" data-id="${eq.id}" class="btn btn-warning btn-sm" title="Chat IA">
            <i class="fas fa-robot"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Calculate statut
  function getStatut(eq) {
    if (!eq.next_inspection_date) return { text: 'Inconnu', class: 'secondary' };
    const today = new Date();
    const next = new Date(eq.next_inspection_date);
    const diffDays = (next - today) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return { text: 'En retard', class: 'danger' };
    if (diffDays <= 7) return { text: 'Bientôt', class: 'warning' };
    if (diffDays <= 30) return { text: 'Aujourd’hui', class: 'info' };
    return { text: 'OK', class: 'success' };
  }

  // Save Equipment
  async function saveEquipment(equipment) {
    try {
      showLoader(true);
      const method = equipment.id ? 'PUT' : 'POST';
      const url = equipment.id ? `${API}/atex-equipments/${equipment.id}` : `${API}/atex-equipments`;
      const response = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(equipment)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast('Équipement sauvegardé', 'success');
      return await response.json();
    } catch (err) {
      console.error('[saveEquipment] error', err);
      showToast(`Erreur sauvegarde équipement: ${err.message}`, 'danger');
    } finally {
      showLoader(false);
    }
  }

  // Delete Equipment
  async function deleteEquipment(id) {
    try {
      showLoader(true);
      const response = await fetch(`${API}/atex-equipments/${id}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast('Équipement supprimé', 'success');
    } catch (err) {
      console.error('[deleteEquipment] error', err);
      showToast(`Erreur suppression équipement: ${err.message}`, 'danger');
    } finally {
      showLoader(false);
    }
  }

  // Get IA Help
  async function getIAHelp(id) {
    try {
      showLoader(true);
      const response = await fetch(`${API}/atex-help/${id}`, {
        headers: authHeaders()
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error('[getIAHelp] error', err);
      showToast(`Erreur IA help: ${err.message}`, 'danger');
      return { html: 'Erreur lors du chargement de l’aide IA' };
    } finally {
      showLoader(false);
    }
  }

  // Import File
  async function importFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      showLoader(true);
      const response = await fetch(`${API}/atex-import-excel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` },
        body: formData
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      showToast(`Import réussi: ${result.count} équipements`, 'success');
      return result;
    } catch (err) {
      console.error('[importFile] error', err);
      showToast(`Erreur import: ${err.message}`, 'danger');
    } finally {
      showLoader(false);
    }
  }

  // Show/hide loader
  function showLoader(show) {
    let loader = document.getElementById('loader');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'loader';
      loader.className = 'loader';
      loader.style.display = 'none';
      document.querySelector('.container').prepend(loader);
    }
    loader.style.display = show ? 'block' : 'none';
  }

  // Init and Bind
  window.addEventListener('DOMContentLoaded', () => {
    // Check if logged in
    if (!getToken()) {
      showToast('Veuillez vous connecter', 'danger');
      window.location.href = '/login.html';
      return;
    }

    // Load initial data
    loadSecteurs();
    loadEquipments();

    // Form submission
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
        delete form.dataset.id;
      });
    }

    // Filter form
    const filterForm = document.getElementById('filter-form');
    if (filterForm) {
      filterForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const filters = {
          secteur_id: document.getElementById('filter-secteur').value,
          conformite: document.getElementById('filter-conformite').value,
          statut: document.getElementById('filter-statut').value
        };
        loadEquipments(filters);
      });
      filterForm.addEventListener('reset', () => {
        filterForm.reset();
        loadEquipments();
      });
    }

    // Actions
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const act = btn.dataset.action;
      if (act === 'edit-equipment') {
        const id = btn.dataset.id;
        const response = await fetch(`${API}/atex-equipments/${id}`, { headers: authHeaders() });
        if (!response.ok) {
          showToast('Erreur chargement équipement', 'danger');
          return;
        }
        const eq = await response.json();
        const form = document.getElementById('equipment-form');
        form.dataset.id = id;
        document.getElementById('secteur').value = eq.secteur_id || '';
        document.getElementById('batiment').value = eq.batiment || '';
        document.getElementById('local').value = eq.local || '';
        document.getElementById('zone_gaz').value = eq.zone_gaz || '';
        document.getElementById('zone_poussieres').value = eq.zone_poussieres || '';
        document.getElementById('composant').value = eq.composant || '';
        document.getElementById('fabricant').value = eq.fabricant || '';
        document.getElementById('type').value = eq.type || '';
        document.getElementById('identifiant').value = eq.identifiant || '';
        document.getElementById('marquage_atex').value = eq.marquage_atex || '';
        document.getElementById('comments').value = eq.comments || '';
        document.getElementById('last_inspection_date').value = eq.last_inspection_date ? new Date(eq.last_inspection_date).toISOString().split('T')[0] : '';
        document.getElementById('frequence').value = eq.frequence || 36;
        document.querySelector('.nav-tabs a[href="#add-edit"]').click(); // Switch to tab
      }
      if (act === 'delete-equipment') {
        const id = btn.dataset.id;
        if (confirm('Voulez-vous vraiment supprimer cet équipement ?')) {
          await deleteEquipment(id);
          loadEquipments();
        }
      }
      if (act === 'open-attachments') {
        const id = btn.dataset.id;
        const response = await fetch(`${API}/equip/${id}`, { headers: authHeaders() });
        if (!response.ok) {
          showToast('Erreur chargement pièces jointes', 'danger');
          return;
        }
        const payload = await response.json();
        window.openAttachmentViewer(payload);
      }
      if (act === 'open-ia') {
        const id = btn.dataset.id;
        const { html } = await getIAHelp(id);
        const modal = new bootstrap.Modal(document.getElementById('iaModal'));
        document.getElementById('iaModalContent').innerHTML = html;
        modal.show();
      }
    });

    // Import
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
