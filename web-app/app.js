// Lógica principal (NO geolocalización). Usa Supabase + almacenamiento local.
(function () {
  const storage = window.CheckedInStorage;

  async function loadVenues() {
    const sel = document.getElementById('venue');
    sel.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    const { data, error } = await supabase.from('Venue')
      .select('id,name,max_active_males,max_active_females,active')
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (error) { sel.innerHTML = '<option value="" disabled selected>Error al cargar</option>'; return []; }
    sel.innerHTML = '<option value="" disabled selected>Selecciona una sede</option>';
    data.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      opt.dataset.maxm = v.max_active_males;
      opt.dataset.maxf = v.max_active_females;
      sel.appendChild(opt);
    });
    return data;
  }

  async function capacityCheck(venueId, myGender){
    const field = myGender==='male' ? 'max_active_males' : 'max_active_females';
    const { data: v } = await supabase.from('Venue').select(field).eq('id', venueId).single();
    const { count } = await supabase.from('Checkins')
      .select('id', { count:'exact', head:true })
      .eq('venue_id', venueId).eq('active', true).eq('gender', myGender);
    const max = v ? v[field] : 100;
    return (count||0) < max;
  }

  async function loadProfiles(me){
    const list = document.getElementById('profiles-list');
    const empty = document.getElementById('profiles-empty');
    list.innerHTML='';

    const targetGender = me.interested_in==='men' ? 'male':'female';
    const myGender = me.gender;

    const { data, error } = await supabase.from('Checkins')
      .select('nickname,instagram,gender,description,interested_in,active,created_at')
      .eq('venue_id', me.venue_id).eq('active', true).order('created_at',{ascending:false});
    if(error){ empty.hidden=false; return; }
    const items = (data||[])
      .filter(p=>p.nickname!==me.nickname)
      .filter(p=>p.gender===targetGender && p.interested_in===myGender);

    if(!items.length){ empty.hidden=false; return; }
    empty.hidden=true;

    const frag = document.createDocumentFragment();
    items.forEach(p=>{
      const card = document.createElement('div'); card.className='card'; card.style.display='flex'; card.style.alignItems='flex-start';
      const avatar = document.createElement('div'); avatar.className='avatar'; avatar.textContent=(p.nickname||'?')[0].toUpperCase();
      const body = document.createElement('div'); body.style.flex='1';
      const title = document.createElement('div'); title.className='title'; title.textContent=p.nickname;
      const meta = document.createElement('div'); meta.className='meta'; meta.textContent = p.gender==='male'?'Hombre':'Mujer';
      const desc = document.createElement('div'); desc.className='desc'; desc.textContent=p.description||'';
      const links = document.createElement('div'); links.className='links';
      if(p.instagram){ const a=document.createElement('a'); a.href=`https://instagram.com/${p.instagram}`; a.target='_blank'; a.textContent=`@${p.instagram}`; links.appendChild(a); }

      // Mensajería básica
      const actions = document.createElement('div'); actions.className='actions';
      const sendBtn = document.createElement('button'); sendBtn.type='button'; sendBtn.textContent='Enviar mensaje';
      sendBtn.addEventListener('click', async ()=>{
        const text = prompt(`Mensaje a ${p.nickname} (máx 150 caracteres)`);
        if(!text) return;
        await supabase.from('Messages').insert({
          venue_id: me.venue_id,
          from_nickname: me.nickname,
          to_nickname: p.nickname,
          text: text.trim().slice(0,150)
        });
        alert('Enviado.');
      });

      const viewBtn = document.createElement('button'); viewBtn.type='button'; viewBtn.className='outline'; viewBtn.textContent='Ver mensajes';
      viewBtn.addEventListener('click', async ()=>{
        const { data: msgs } = await supabase.from('Messages')
          .select('from_nickname,text,created_at,read')
          .eq('venue_id', me.venue_id)
          .eq('to_nickname', me.nickname)
          .order('created_at', { ascending:false })
          .limit(10);
        if(!msgs || !msgs.length) return alert('Sin mensajes nuevos.');
        const lines = msgs.map(m=>`De ${m.from_nickname}: ${m.text}`).join('\\n');
        alert(lines);
        await supabase.from('Messages').update({ read: true })
          .eq('venue_id', me.venue_id).eq('to_nickname', me.nickname).eq('read', false);
      });

      actions.appendChild(sendBtn); actions.appendChild(viewBtn);

      body.appendChild(title); body.appendChild(meta); body.appendChild(desc); body.appendChild(links); body.appendChild(actions);
      card.appendChild(avatar); card.appendChild(body);
      frag.appendChild(card);
    });
    list.appendChild(frag);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadVenues();

    const meLine = document.getElementById('me-line');
    const form = document.getElementById('checkin-form');
    const errEl = document.getElementById('checkin-error');
    const refreshBtn = document.getElementById('refresh-btn');
    const checkoutBtn = document.getElementById('checkout-btn');

    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      errEl.hidden = true; errEl.textContent='';

      const venueSel = document.getElementById('venue');
      const venueId = Number(venueSel.value);
      if(!venueId){ errEl.textContent='Selecciona una sede.'; errEl.hidden=false; return; }

      const nickname = document.getElementById('nickname').value.trim();
      const instagram = document.getElementById('instagram').value.trim();
      const gender = document.getElementById('gender').value;
      const description = document.getElementById('description').value.trim();
      const interested_in = document.getElementById('interested_in').value;

      if(!nickname) return (errEl.textContent='El apodo es obligatorio.', errEl.hidden=false);
      if(!gender) return (errEl.textContent='Selecciona tu género.', errEl.hidden=false);
      if(!description) return (errEl.textContent='La descripción es obligatoria.', errEl.hidden=false);
      if(!interested_in) return (errEl.textContent='Selecciona a quién deseas conocer.', errEl.hidden=false);

      try {
        const ok = await capacityCheck(venueId, gender);
        if(!ok){ errEl.textContent='Capacidad alcanzada para tu género en esta sede. Intenta luego.'; errEl.hidden=false; return; }
      } catch {
        errEl.textContent='No fue posible validar la capacidad. Intenta más tarde.'; errEl.hidden=false; return;
      }

      try {
        const { error } = await supabase.from('Checkins').insert({
          venue_id: venueId,
          nickname,
          instagram: instagram||null,
          gender,
          description,
          interested_in,
          active: true
        });
        if(error) throw error;
      } catch (e) {
        errEl.textContent = e?.message || 'No fue posible registrar tu check-in.'; errEl.hidden=false; return;
      }

      const me = { venue_id: venueId, nickname, instagram: instagram||null, gender, description, interested_in };
      storage.setUser(me);
      document.getElementById('checkin-section').hidden = true;
      document.getElementById('profiles-section').hidden = false;
      meLine.textContent = `Estás como ${nickname} — ${gender==='male'?'Hombre':'Mujer'}. Interés: ${interested_in==='men'?'Hombres':'Mujeres'}.`;
      await loadProfiles(me);
    });

    refreshBtn.addEventListener('click', async ()=>{
      const me = storage.getUser();
      if(me) await loadProfiles(me);
    });

    checkoutBtn.addEventListener('click', async ()=>{
      const me = storage.getUser();
      if(!me) return;
      const { data: as } = await supabase.from('App_setting').select('min_stay_minutes').single();
      const mins = as?.min_stay_minutes ?? 0;

      try {
        const { data: res, error } = await supabase.rpc('checkout_by_nickname', { p_venue_id: me.venue_id, p_nickname: me.nickname });
        if(error) throw error;
        if(res === 'too_early'){ alert(`Aún no puedes salir. Tiempo mínimo: ${mins} minutos.`); return; }
      } catch {
        await supabase.from('Checkins').update({ active:false })
          .eq('venue_id', me.venue_id).eq('nickname', me.nickname).eq('active', true);
      }

      storage.removeUser();
      location.reload();
    });
  });
})();
