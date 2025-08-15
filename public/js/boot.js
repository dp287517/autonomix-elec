
// public/js/boot.js — minimal bootstrap to keep logout functional even if other scripts fail to parse
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('logoutBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        try {
          localStorage.removeItem('autonomix_token');
          localStorage.removeItem('autonomix_user');
        } catch(e){}
        location.href = 'login.html';
      });
    }
  });
})();
