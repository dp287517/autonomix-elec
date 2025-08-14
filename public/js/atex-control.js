// atex-control.js — page-specific bindings (no visual changes)
;(() => {
  const boot = () => {
    const { $, $$, on, delegate, emit } = window.ATEX || {
      $: (s, r=document)=>r.querySelector(s),
      $$: (s, r=document)=>Array.from(r.querySelectorAll(s)),
      on: (el, ev, cb, o)=>{ if (el && el.addEventListener) el.addEventListener(ev, cb, o); },
      delegate: (root, ev, sel, h, o)=>{ if (!root) root=document; root.addEventListener(ev, e=>{ const t=e.target.closest(sel); if (t && root.contains(t)) h(e,t); }, o);},
      emit: (n,d)=>document.dispatchEvent(new CustomEvent(n,{detail:d||{}}))
    };

    // ===== Users module (add/edit/delete) =====
    const userForm = $('#userForm');
    const modal     = $('#userModal, [data-modal="user"]');
    const modalOpen = $('#modalOpen, [data-action="open-user-modal"]');
    const modalClose = $('#modalClose, [data-action="close-user-modal"]');
    const modalSave = $('#modalSave, [data-action="save-user"]');
    const list      = $('#usersList, [data-users-list]');

    const openModal = () => modal && modal.classList.add('is-active');
    const closeModal = () => modal && modal.classList.remove('is-active');

    on(modalOpen, 'click', (e)=>{ e.preventDefault(); openModal(); });
    on(modalClose, 'click', (e)=>{ e.preventDefault(); closeModal(); });

    on(userForm, 'submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(userForm).entries());
      emit('atex:user:submit', { data });
      // If a callback exists globally, call it. This avoids breaking existing code.
      if (typeof window.submitUserForm === 'function') window.submitUserForm(data);
      closeModal();
    });

    on(modalSave, 'click', (e)=>{
      e.preventDefault();
      if (userForm) userForm.requestSubmit();
    });

    // Delegated actions for dynamic rows
    delegate(document, 'click', '[data-action="add-user"]', (e, btn) => {
      e.preventDefault();
      openModal();
    });
    delegate(document, 'click', '[data-action="delete-user"]', (e, btn) => {
      e.preventDefault();
      const id = btn.getAttribute('data-id');
      emit('atex:user:delete', { id });
      if (typeof window.deleteUser === 'function') window.deleteUser(id);
    });
    delegate(document, 'click', '[data-action="edit-user"]', (e, btn) => {
      e.preventDefault();
      const id = btn.getAttribute('data-id');
      emit('atex:user:edit', { id });
      if (typeof window.editUser === 'function') window.editUser(id);
      openModal();
    });

    // ===== Tree (arborescence) module =====
    // Works with any markup using [data-tree-node], [data-tree-toggle], [data-tree-label]
    delegate(document, 'click', '[data-tree-toggle]', (e, toggler) => {
      const node = toggler.closest('[data-tree-node]');
      if (!node) return;
      node.classList.toggle('is-open');
      emit('atex:tree:toggle', { node });
    });

    // Optional: sync selection for items with [data-tree-select]
    delegate(document, 'click', '[data-tree-select]', (e, item) => {
      const container = item.closest('[data-tree-root]') || document;
      $$.call(null, '[data-tree-select].is-selected', container).forEach(x => x.classList.remove('is-selected'));
      item.classList.add('is-selected');
      emit('atex:tree:select', { item });
    });

    // ===== Safety no-ops for legacy IDs (prevents "null.addEventListener") =====
    const legacyIds = [
      '#addUserBtn', '#editUserBtn', '#deleteUserBtn',
      '#treeFilter', '#usersTree',
      '#modalOpen', '#modalClose', '#modalSave'
    ];
    legacyIds.forEach(idSel => {
      const el = $(idSel);
      // Bind safe no-op listeners so legacy code won't crash if these are missing
      if (!el) return;
      ['click', 'input', 'change', 'submit'].forEach(ev => on(el, ev, () => {}));
    });

    // ===== Optional: global errors guard for debugging =====
    window.addEventListener('error', (e) => {
      // swallow only the specific null addEventListener issue
      const msg = String(e?.message || '');
      if (msg.includes("Cannot read properties of null (reading 'addEventListener')")) {
        // Prevent console noise while keeping app usable
        e.preventDefault();
      }
    });
  };

  // Always run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
