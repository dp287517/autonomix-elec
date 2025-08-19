// public/js/epd-guard.js
(async function(){
  try{
    const token = localStorage.getItem('autonomix_token');
    if(!token){ window.location.href = 'login.html'; return; }
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer '+token }});
    if(!r.ok){
      localStorage.removeItem('autonomix_token');
      localStorage.removeItem('autonomix_user');
      window.location.href = 'login.html';
    }
  }catch{
    window.location.href = 'login.html';
  }
})();
