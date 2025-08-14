// /public/js/signup.js
const API = (window.API_BASE_URL || '') + '/api';
document.getElementById('btnSignup').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirm = document.getElementById('confirm').value;
  const msg = document.getElementById('msg');
  msg.className='small'; msg.textContent='';

  if(!email || !password || !confirm){
    msg.classList.add('text-danger');
    msg.textContent='Champs requis.';
    return;
  }
  if(password !== confirm){
    msg.classList.add('text-danger');
    msg.textContent='Mots de passe différents.';
    return;
  }

  try{
    const r = await fetch(`${API}/register`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, password })
    });

    let data = {};
    try { data = await r.json(); } catch {}

    if(!r.ok){
      if (r.status === 409 || data.error === 'email_exists') {
        msg.classList.add('text-danger');
        msg.innerHTML = `Cet email est déjà utilisé. <a href="login.html">Se connecter</a>`;
        return;
      }
      const tech = (data && data.error) ? String(data.error) : 'server_error';
      msg.classList.add('text-danger');
      msg.textContent = `Inscription impossible (${tech}). Réessaie dans un instant.`;
      return;
    }

    msg.classList.remove('text-danger');
    msg.classList.add('text-success');
    msg.textContent='Compte créé ! Redirection…';
    setTimeout(()=> location.href='login.html', 800);

  }catch(e){
    msg.classList.add('text-danger');
    msg.textContent='Inscription impossible (réseau). Vérifie ta connexion et réessaie.';
  }
});