// public/js/atex-control.ui.js — v6 (viewer flèches + PDF/data:)
(function(){
  const $ = (s)=>document.querySelector(s);

  function guessMimeFromSrc(src){
    if(/^data:([^;]+)/i.test(src)) return RegExp.$1;
    if(/\.pdf(\?|$)/i.test(src)) return 'application/pdf';
    if(/\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(src)) return 'image/*';
    return '';
  }

  function normalizeAttachments(eq){
    let atts = eq && eq.attachments;
    if (typeof atts === 'string'){ try{ atts = JSON.parse(atts); }catch{ atts = null; } }
    if (!Array.isArray(atts)) atts = [];
    const items = [];

    // from attachments
    atts.forEach((a, i)=>{
      const src = a?.url || a?.href || a?.path || a?.data || '';
      if(!src) return;
      items.push({
        name: a?.name || a?.label || `Pièce ${i+1}`,
        src,
        mime: a?.mime || guessMimeFromSrc(src)
      });
    });

    // fallback from photo
    if ((!items.length) && eq?.photo){
      items.push({ name:'Photo', src:String(eq.photo), mime: guessMimeFromSrc(String(eq.photo)) || 'image/*' });
    }
    return items;
  }

  function renderStage(item, idx, total){
    const stage = $('#attViewerStage');
    const title = $('#attViewerTitle');
    const meta  = $('#attViewerMeta');
    const openA = $('#attOpen');

    if(!stage) return;
    stage.innerHTML = '';

    const mime = (item.mime||'').toLowerCase();
    const src  = item.src;

    if (mime.includes('pdf')){
      const iframe = document.createElement('iframe');
      iframe.setAttribute('title', item.name || 'document');
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

    if (title) title.textContent = item.name || `Pièce ${idx+1}/${total}`;
    if (meta)  meta.textContent  = `Élément ${idx+1} / ${total} — ${mime || 'fichier'}`;
    if (openA){ openA.href = src; openA.download = ''; }
  }

  function updateNavButtons(state){
    const prev = $('#attPrev');
    const next = $('#attNext');
    if (!prev || !next) return;
    prev.disabled = state.idx <= 0;
    next.disabled = state.idx >= state.items.length - 1;
  }

  async function openAttachmentViewer(eq){
    try{
      const modal = new bootstrap.Modal($('#attViewerModal'));
      const items = normalizeAttachments(eq);
      if (!items.length){
        (window.toast || console.log)('Aucune pièce jointe','warning');
        return;
      }
      const state = { items, idx: 0 };
      window.__att_state = state;

      renderStage(state.items[state.idx], state.idx, state.items.length);
      updateNavButtons(state);
      modal.show();

      // Bind once per open, then clean on close
      const prev = $('#attPrev');
      const next = $('#attNext');
      const modalEl = $('#attViewerModal');

      function onPrev(){
        if (state.idx > 0){
          state.idx -= 1;
          renderStage(state.items[state.idx], state.idx, state.items.length);
          updateNavButtons(state);
        }
      }
      function onNext(){
        if (state.idx < state.items.length-1){
          state.idx += 1;
          renderStage(state.items[state.idx], state.idx, state.items.length);
          updateNavButtons(state);
        }
      }
      prev?.addEventListener('click', onPrev);
      next?.addEventListener('click', onNext);

      modalEl?.addEventListener('hidden.bs.modal', ()=>{
        prev?.removeEventListener('click', onPrev);
        next?.removeEventListener('click', onNext);
        delete window.__att_state;
        $('#attViewerStage').innerHTML='';
        $('#attViewerMeta').textContent='';
      }, { once:true });

    }catch(err){
      console.error('[openAttachmentViewer] fail', err);
      (window.toast || console.log)('Erreur en ouvrant les pièces','danger');
    }
  }

  window.openAttachmentViewer = openAttachmentViewer;
})();
