// /public/js/login.js
const API = (window.API_BASE_URL || '') + '/api';
document.getElementById('btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('err'); err.style.display='none'; err.textContent='';
  try{
    const r = await fetch(`${API}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    const data = await r.json();
    if(!r.ok){ throw new Error(data.error || 'Connexion impossible'); }
    localStorage.setItem('autonomix_token', data.token);
    localStorage.setItem('autonomix_user', JSON.stringify(data.user || { email }));
    location.href = 'dashboard.html';
  }catch(e){ err.textContent = e.message; err.style.display='block'; }
});