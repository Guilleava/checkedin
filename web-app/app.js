// Lógica principal (SIN geolocalización). Supabase + localStorage.
(function () {
  const storage = window.CheckedInStorage;

  // ---------------- Venues ----------------
  async function loadVenues() {
    const sel = document.getElementById('venue');
    sel.innerHTML = '<option value="" disabled selected>Cargando…</option>';

    const { data, error } = await supabase
      .from('venue') // minúsculas
      .select('id,name,max_active_males,max_active_females,active')
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[loadVenues] error:', error);
      sel.innerHTML = '<option value="" disabled selected>Error al cargar</option>';
      return [];
    }

    sel.innerHTML = '<option value="" disabled selected>Selecciona una sede</option>';
    (data || []).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      opt.dataset.maxm = v.max_active_males;
      opt.dataset.maxf = v.max_active_females;
      sel.appendChild(opt);
    });
    return data || [];
  }

  // ------------- Capacidad por género/sede -------------
  async function capacityCheck(venueId, myGender) {
    const field = myGender === 'male' ? 'max_active_males' : 'max_active_females';

    const { data: v, error: ve } = await supabase
      .from('venue')
      .select(field)
      .eq('id', venueId)
      .single();
    if (ve) console.error('[capacityCheck venue]', ve);

    const { count, error: ce } = await supabase
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('active', true)
      .eq('gender', myGender);
    if (ce) console.error('[capacityCheck checkins]', ce);

    const max = v ? v[field] : 100;
    return (count || 0) < max;
  }

  // ------------- Listado de perfiles (interés mutuo) -------------
  async function loadProfiles(me) {
    const list = document.getElementById('profiles-list');
    const empty = document.getElementById('profiles-empty');
    list.innerHTML = '';

    const norm = s => (s || '').toLowerCase().trim();

    // Mi info normalizada
    const myGender = norm(me.gender);                 // 'male' | 'female'
    const myInterest = norm(me.interested_in);        // 'men'  | 'women'

    // A quién debo ver (género objetivo desde mi interés)
    const targetGender = myInterest === 'men' ? 'male' : 'female';
    // Qué espera ver la otra persona para que sea mutuo (interés objetivo desde MI género)
    const partnerMustBeInterestedIn = myGender === 'male' ? 'men' : 'women';


    const { data, error } = await supabase
      .from('checkins')
      .select('nickname,instagram,gender,description,interested_in,active,created_at')
      .eq('venue_id', me.venue_id)
      .eq('active', true)
      .order('created_at', { ascending: false });

    console.log('[loadProfiles] raw:', { error, count: data?.length, data });

    if (error) {
      console.error('[loadProfiles] error:', error);
      empty.hidden = false;
      empty.textContent = 'Error cargando perfiles.';
      return;
    }

    // Normalizar filas y aplicar filtro de interés mutuo
    const items = (data || [])
      .map(p => ({
        ...p,
        gender: norm(p.gender),
        interested_in: norm(p.interested_in),
        nickname: p.nickname
      }))
      // no mostrarme a mí
      .filter(p => p.nickname !== me.nickname)
      // 1) Ellos/ellas son del género que me interesa
      .filter(p => p.gender === targetGender)
      // 2) Ellos/ellas están interesados en mi género
      .filter(p => p.interested_in === partnerMustBeInterestedIn);

    console.log('[loadProfiles] filtered:', {
      myGender, myInterest, targetGender, partnerMustBeInterestedIn,
      itemsCount: items.length, items
    });

    if (!items.length) {
      empty.hidden = false;
      empty.textContent = 'No hay personas que coincidan con tu interés.';
      return;
    }
    empty.hidden = true;

    // Render tarjetas
    const frag = document.createDocumentFragment();
    items.forEach(p => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.display = 'flex';
      card.style.alignItems = 'flex-start';

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = (p.nickname || '?')[0].toUpperCase();

      const body = document.createElement('div');
      body.style.flex = '1';

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = p.nickname;

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = p.gender === 'male' ? 'Hombre' : 'Mujer';

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = p.description || '';

      const links = document.createElement('div');
      links.className = 'links';
      if (p.instagram) {
        const a = document.createElement('a');
        a.href = `https://instagram.com/${p.instagram}`;
        a.target = '_blank';
        a.textContent = `@${p.instagram}`;
        links.appendChild(a);
      }

      // Mensajería simple
      const actions = document.createElement('div');
      actions.className = 'actions';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.textContent = 'Enviar mensaje';
      sendBtn.addEventListener('click', async () => {
        const text = prompt(`Mensaje a ${p.nickname} (máx 150 caracteres)`);
        if (!text) return;
        const { error: meErr } = await supabase.from('messages').insert({
          venue_id: me.venue_id,
          from_nickname: me.nickname,
          to_nickname: p.nickname,
          text: text.trim().slice(0, 150)
        });
        if (meErr) { console.error('[send message]', meErr); alert('Error al enviar.'); return; }
        alert('Enviado.');
      });

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'outline';
      viewBtn.textContent = 'Ver mensajes';
      viewBtn.addEventListener('click', async () => {
        const { data: msgs, error: vmErr } = await supabase.from('messages')
          .select('from_nickname,text,created_at,read')
          .eq('venue_id', me.venue_id)
          .eq('to_nickname', me.nickname)
          .order('created_at', { ascending: false })
          .limit(10);
        if (vmErr) { console.error('[view messages]', vmErr); alert('No fue posible cargar mensajes.'); return; }
        if (!msgs || !msgs.length) return alert('Sin mensajes nuevos.');
        const lines = msgs.map(m => `De ${m.from_nickname}: ${m.text}`).join('\n');
        alert(lines);
        await supabase.from('messages').update({ read: true })
          .eq('venue_id', me.venue_id)
          .eq('to_nickname', me.nickname)
          .eq('read', false);
      });

      actions.appendChild(sendBtn);
      actions.appendChild(viewBtn);

      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(desc);
      body.appendChild(links);
      body.appendChild(actions);

      card.appendChild(avatar);
      card.appendChild(body);
      frag.appendChild(card);
    });
    list.appendChild(frag);
  }

  // ---------------- App init ----------------
  document.addEventListener('DOMContentLoaded', async () => {
    await loadVenues();

    const meLine = document.getElementById('me-line');
    const form = document.getElementById('checkin-form');
    const errEl = document.getElementById('checkin-error');
    const refreshBtn = document.getElementById('refresh-btn');
    const checkoutBtn = document.getElementById('checkout-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.hidden = true; errEl.textContent = '';

      const venueSel = document.getElementById('venue');
      const venueId = Number(venueSel.value);
      if (!venueId) { errEl.textContent = 'Selecciona una sede.'; errEl.hidden = false; return; }

      const nickname = document.getElementById('nickname').value.trim();
      const instagram = document.getElementById('instagram').value.trim();
      const gender = document.getElementById('gender').value;
      const description = document.getElementById('description').value.trim();
      const interested_in = document.getElementById('interested_in').value;

      if (!nickname) { errEl.textContent = 'El apodo es obligatorio.'; errEl.hidden = false; return; }
      if (!gender) { errEl.textContent = 'Selecciona tu género.'; errEl.hidden = false; return; }
      if (!description) { errEl.textContent = 'La descripción es obligatoria.'; errEl.hidden = false; return; }
      if (!interested_in) { errEl.textContent = 'Selecciona a quién deseas conocer.'; errEl.hidden = false; return; }

      // capacidad
      try {
        const ok = await capacityCheck(venueId, gender);
        if (!ok) { errEl.textContent = 'Capacidad alcanzada para tu género en esta sede. Intenta luego.'; errEl.hidden = false; return; }
      } catch (capErr) {
        console.error('[capacityCheck]', capErr);
        errEl.textContent = 'No fue posible validar la capacidad. Intenta más tarde.'; errEl.hidden = false; return;
      }

      // insertar check-in
      try {
        const { error } = await supabase.from('checkins').insert({
          venue_id: venueId,
          nickname,
          instagram: instagram || null,
          gender,
          description,
          interested_in,
          active: true
        });
        if (error) throw error;
      } catch (e2) {
        console.error('[insert checkin]', e2);
        errEl.textContent = e2?.message || 'No fue posible registrar tu check-in.'; errEl.hidden = false; return;
      }

      const me = { venue_id: venueId, nickname, instagram: instagram || null, gender, description, interested_in };
      storage.setUser(me);

      document.getElementById('checkin-section').hidden = true;
      document.getElementById('profiles-section').hidden = false;
      meLine.textContent =
        `Estás como ${nickname} — ${gender === 'male' ? 'Hombre' : 'Mujer'}. ` +
        `Interés: ${interested_in === 'men' ? 'Hombres' : 'Mujeres'}.`;

      await loadProfiles(me);
    });

    // actualizar listado
    refreshBtn.addEventListener('click', async () => {
      const me = storage.getUser();
      if (me) await loadProfiles(me);
    });

    // checkout con tiempo mínimo (RPC) + fallback
    checkoutBtn.addEventListener('click', async () => {
      const me = storage.getUser();
      if (!me) return;

      const { data: as } = await supabase
        .from('app_setting')
        .select('min_stay_minutes')
        .single();
      const mins = as?.min_stay_minutes ?? 0;

      try {
        const { data: res, error } = await supabase
          .rpc('checkout_by_nickname', { p_venue_id: me.venue_id, p_nickname: me.nickname });
        if (error) throw error;
        if (res === 'too_early') {
          alert(`Aún no puedes salir. Tiempo mínimo: ${mins} minutos.`);
          return;
        }
      } catch {
        // DEV fallback: permitir checkout
        await supabase.from('checkins')
          .update({ active: false })
          .eq('venue_id', me.venue_id)
          .eq('nickname', me.nickname)
          .eq('active', true);
      }

      storage.removeUser();
      location.reload();
    });
  });
})();
