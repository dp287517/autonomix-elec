// public/js/atex-control.ui.js — v6 (Attachment Viewer branché sur #attViewerModal)
(function(){
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function isImage(u){ return /^data:image\//i.test(u) || /\.(png|jpe?g|webp|gif)$/i.test(u||''); }
  function isPdf(u){ return /^data:application\/pdf/i.test(u) || /\.pdf(\?|#|$)/i.test(u||''); }

  const state = { slides: [], idx: 0, eqId: null };

  function render(){
    const stage = $('#attViewerStage'); if(!stage) return;
    if(!state.slides.length){
      stage.innerHTML = '<div class="text-white-50 p-4">Aucune pièce jointe.</div>';
      const openBtn = $('#attOpen'); if (openBtn) openBtn.setAttribute('href','#');
      const meta = $('#attViewerMeta'); if (meta) meta.textContent = '';
      const title = $('#attViewerTitle'); if (title) title.textContent = 'Aperçu';
      return;
    }
    if(state.idx < 0) state.idx = state.slides.length-1;
    if(state.idx >= state.slides.length) state.idx = 0;

    const slide = state.slides[state.idx];
    const src   = slide.src;
    const name  = slide.name || `Pièce ${state.idx+1}`;

    const title = $('#attViewerTitle'); if (title) title.textContent = name;
    const meta  = $('#attViewerMeta');
    if (meta) meta.textContent = `Équipement #${state.eqId} • ${state.idx+1}/${state.slides.length}${slide.mime? ' • '+slide.mime : ''}`;

    const openBtn = $('#attOpen'); if (openBtn) openBtn.setAttribute('href', src);

    if (isImage(src)){
      stage.innerHTML = `<img src="${src}" class="img-fluid">`;
    } else if (isPdf(src)){
      stage.innerHTML = `<iframe src="${src}" class="w-100" style="height: calc(100vh - 180px);" frameborder="0"></iframe>`;
    } else {
      stage.innerHTML = `<div class="text-center p-4">
        <div class="text-white-50 mb-2">Type non prévisualisable.</div>
        <a class="btn btn-primary" href="${src}" target="_blank" rel="noopener">Ouvrir</a>
      </div>`;
    }
  }

  function next(){ state.idx++; render(); }
  function prev(){ state.idx--; render(); }

  // Exposé global — on attend l'objet équipement complet (pour éviter un fetch)
  window.openAttachmentViewer = function(eq){
    try{
      const slides = [];

      // 1) Photo principale (si image ou pdf en data/url)
      if (eq && eq.photo && (isImage(eq.photo) || isPdf(eq.photo))){
        slides.push({ name: 'Photo', mime: '', src: eq.photo });
      }

      // 2) Attachments (array de {name,mime,url|data|href|path} ou string JSON)
      let atts = eq && eq.attachments;
      if (typeof atts === 'string'){
        try{ atts = JSON.parse(atts); }catch{ atts = null; }
      }
      if (Array.isArray(atts)){
        atts.forEach((a)=>{
          const name = (a && (a.name||a.label)) || `Pièce ${slides.length+1}`;
          const mime = a && a.mime || '';
          const src  = a && (a.url || a.href || a.data || a.path) || '';
          if (!src) return;
          slides.push({ name, mime, src });
        });
      }

      state.slides = slides;
      state.idx = 0;
      state.eqId = eq?.id || null;

      const el = $('#attViewerModal');
      if (!el) {
        console.warn('[openAttachmentViewer] #attViewerModal introuvable dans le DOM');
        if (window.toast) window.toast('Viewer introuvable dans la page','warning');
        return;
      }

      render();
      bootstrap.Modal.getOrCreateInstance(el).show();
    }catch(err){
      console.error('[openAttachmentViewer] fail', err);
      if (window.toast) window.toast('Erreur en ouvrant les pièces','danger');
    }
  };

  document.addEventListener('DOMContentLoaded', ()=>{
    $('#attPrev')?.addEventListener('click', prev);
    $('#attNext')?.addEventListener('click', next);
  });
})();
