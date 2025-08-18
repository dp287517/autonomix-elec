// /public/js/ui.js
window.UI = (function(){
  function qs(id){ return document.getElementById(id); }

  function showModal(id){
    const back = qs(id);
    if (!back) return;
    back.classList.add('visible');
    const m = back.querySelector('.modal');
    if (m) requestAnimationFrame(()=> m.classList.add('show'));
  }
  function hideModal(id){
    const back = qs(id);
    if (!back) return;
    const m = back.querySelector('.modal');
    if (m) m.classList.remove('show');
    setTimeout(()=> back.classList.remove('visible'), 150);
  }

  function confirm({title='Confirmer', message='Êtes-vous sûr ?', okText='Confirmer', cancelText='Annuler'}){
    return new Promise(resolve=>{
      const id = 'modal-confirm';
      const back = qs(id);
      back.querySelector('.modal-head').textContent = title;
      back.querySelector('.modal-body').textContent = message;
      const btnOk = back.querySelector('[data-ok]');
      const btnNo = back.querySelector('[data-cancel]');
      btnOk.textContent = okText;
      btnNo.textContent = cancelText;

      const onOk = ()=>{ cleanup(); resolve(true); };
      const onNo = ()=>{ cleanup(); resolve(false); };

      function cleanup(){
        btnOk.removeEventListener('click', onOk);
        btnNo.removeEventListener('click', onNo);
        hideModal(id);
      }
      btnOk.addEventListener('click', onOk);
      btnNo.addEventListener('click', onNo);
      showModal(id);
    });
  }

  function prompt({title='Créer', label='Nom', placeholder='Nom...', okText='Créer', cancelText='Annuler'}){
    return new Promise(resolve=>{
      const id = 'modal-prompt';
      const back = qs(id);
      back.querySelector('.modal-head').textContent = title;
      back.querySelector('label').textContent = label;
      const input = back.querySelector('input');
      input.value = '';
      input.placeholder = placeholder;
      const btnOk = back.querySelector('[data-ok]');
      const btnNo = back.querySelector('[data-cancel]');
      btnOk.textContent = okText;
      btnNo.textContent = cancelText;

      const onOk = ()=>{ const v = input.value.trim(); cleanup(); resolve(v || null); };
      const onNo = ()=>{ cleanup(); resolve(null); };

      function cleanup(){
        btnOk.removeEventListener('click', onOk);
        btnNo.removeEventListener('click', onNo);
        hideModal(id);
      }
      btnOk.addEventListener('click', onOk);
      btnNo.addEventListener('click', onNo);

      showModal(id);
      setTimeout(()=> input.focus(), 50);
    });
  }

  function toast(message, ms=1800){
    let el = document.getElementById('toast');
    if (!el){
      el = document.createElement('div');
      el.id = 'toast'; el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    setTimeout(()=> el.classList.remove('show'), ms);
  }

  return { showModal, hideModal, confirm, prompt, toast };
})();
