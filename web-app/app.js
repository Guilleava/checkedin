(function () {
  const storage = window.CheckedInStorage;

  // ---- Config ----
  const MESSAGE_LIMIT = 3;

  // Realtime channels
  let msgSub = null;           // messages channel
  let checkinsSub = null;      // checkins realtime channel
  let autoRefreshTimer = null; // polling fallback

  // ---------- helpers to manage auto refresh ----------
  function stopAutoRefresh() {
    if (checkinsSub) { try { supabase.removeChannel(checkinsSub); } catch {} checkinsSub = null; }
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  }

  function startAutoRefresh(me) {
    // clean previous
    stopAutoRefresh();

    // Realtime: react to inserts/updates/deletes in checkins for this venue
    checkinsSub = supabase
      .channel(`checkins_${me.venue_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkins', filter: `venue_id=eq.${me.venue_id}` },
        () => {
          // any change -> refresh list
          loadProfiles(me);
        }
      )
      .subscribe();

    // Polling safety net every 20s in case realtime drops
    autoRefreshTimer = setInterval(() => loadProfiles(me), 20000);
  }

  // ---------- Venues ----------
  async function loadVenues() {
    const sel = document.getElementById('venue');
    sel.innerHTML = '<option value="" disabled selected>Cargando…</option>';
    const { data, error } = await supabase
      .from('venue')
      .select('id,name,active')
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (error) { console.error(error); sel.innerHTML = '<option>Error</option>'; return; }
    sel.innerHTML = '<option value="" disabled selected>Selecciona una sede</option>';
    (data || []).forEach(v => {
      const o = document.createElement('option');
      o.value = v.id; o.textContent = v.name; sel.appendChild(o);
    });
  }

  // ---------- Realtime: messages ----------
  function subscribeToIncomingMessages(me) {
    if (msgSub) { try { supabase.removeChannel(msgSub); } catch {} msgSub = null; }
    msgSub = supabase
      .channel(`msgs_${me.nickname}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_nickname=eq.${me.nickname}` },
        (payload) => alert(`Nuevo mensaje de ${payload.new.from_nickname}: ${payload.new.text}`)
      )
      .subscribe();
  }

  // ---------- Message limit helpers ----------
  async function getSentCount(me, toNickname) {
    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', me.venue_id)
      .eq('from_nickname', me.nickname)
      .eq('to_nickname', toNickname);
    if (error) { console.error('[getSentCount]', error); return 0; }
    return count || 0;
  }

  async function getQuota(me, toNickname) {
    const used = await getSentCount(me, toNickname);
    const left = Math.max(0, MESSAGE_LIMIT - used);
    return { used, left };
  }

  // ---------- Profiles (mutual interest) ----------
  async function loadProfiles(me) {
    const list = document.getElementById('profiles-list');
    const empty = document.getElementById('profiles-empty');
    list.innerHTML = '';

    const norm = s => (s || '').toLowerCase().trim();
    const myGender = norm(me.gender);
    const myInterest = norm(me.interested_in);
    const targetGender = myInterest === 'men' ? 'male' : 'female';
    const partnerMustBeInterestedIn = myGender === 'male' ? 'men' : 'women';

    const { data, error } = await supabase.from('checkins')
      .select('nickname,instagram,gender,description,interested_in,active')
      .eq('venue_id', me.venue_id).eq('active', true)
      .order('created_at', { ascending: false });

    if (error) { console.error(error); empty.hidden = false; return; }

    const items = (data || [])
      .map(p => ({ ...p, gender: norm(p.gender), interested_in: norm(p.interested_in) }))
      .filter(p => p.nickname !== me.nickname)
      .filter(p => p.gender === targetGender)
      .filter(p => p.interested_in === partnerMustBeInterestedIn);

    if (!items.length) { empty.hidden = false; return; }
    empty.hidden = true;

    const frag = document.createDocumentFragment();

    // Build cards with per-conversation quota
    await Promise.all(items.map(async (p) => {
      const card = document.createElement('div'); card.className = 'card'; card.style.display = 'flex';
      const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = p.nickname[0].toUpperCase();
      const body = document.createElement('div'); body.style.flex = '1';
      const title = document.createElement('div'); title.className = 'title'; title.textContent = p.nickname;
      const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = p.gender === 'male' ? 'Hombre' : 'Mujer';
      const desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = p.description || '';
      const links = document.createElement('div');
      if (p.instagram) {
        const a = document.createElement('a');
        a.href = `https://instagram.com/${p.instagram}`;
        a.target = '_blank';
        a.textContent = `@${p.instagram}`;
        links.appendChild(a);
      }

      const actions = document.createElement('div'); actions.className = 'actions';

      // Quota display
      const quota = document.createElement('span');
      quota.className = 'muted';
      quota.style.marginRight = '8px';

      // Buttons
      const sendBtn = document.createElement('button');
      sendBtn.textContent = 'Enviar mensaje';

      const viewBtn = document.createElement('button');
      viewBtn.className = 'outline';
      viewBtn.textContent = 'Ver mensajes';

      // Evaluate current quota for this conversation
      let { used, left } = await getQuota(me, p.nickname);

      function renderQuota() {
        quota.textContent =
          left > 0
            ? `Te quedan ${left} mensajes con ${p.nickname}`
            : 'Te has quedado sin mensajes. Es momento de verificar con quién hablas: asegúrate de que es la persona correcta, haz contacto visual y/o saluda.';
        sendBtn.disabled = left <= 0;
        if (left <= 0) {
          sendBtn.title = 'Has alcanzado el límite de mensajes para esta persona';
        } else {
          sendBtn.removeAttribute('title');
        }
      }
      renderQuota();

      // Send flow with server-side recheck
      sendBtn.onclick = async () => {
        // Recheck to avoid race conditions
        ({ left } = await getQuota(me, p.nickname));
        if (left <= 0) {
          renderQuota();
          alert('Te has quedado sin mensajes. Es momento de verificar con quién hablas: asegúrate de que es la persona correcta, haz contacto visual y/o saluda.');
          return;
        }

        const text = prompt(`Mensaje a ${p.nickname} (máx 150 caracteres)`);
        if (!text) return;

        const { error: meErr } = await supabase.from('messages').insert({
          venue_id: me.venue_id,
          from_nickname: me.nickname,
          to_nickname: p.nickname,
          text: text.trim().slice(0, 150)
        });
        if (meErr) { alert('Error al enviar'); return; }

        used += 1;
        left = Math.max(0, MESSAGE_LIMIT - used);
        renderQuota();

        if (left <= 0) {
          alert('Te has quedado sin mensajes. Es momento de verificar con quién hablas: asegúrate de que es la persona correcta, haz contacto visual y/o saluda.');
        } else {
          alert('Enviado.');
        }
      };

      // View messages (this conversation only)
      viewBtn.onclick = async () => {
        const { data: msgs, error: vmErr } = await supabase.from('messages')
          .select('from_nickname,text,created_at')
          .eq('venue_id', me.venue_id)
          .eq('to_nickname', me.nickname)
          .eq('from_nickname', p.nickname)
          .order('created_at', { ascending: false })
          .limit(12);
        if (vmErr) { alert('No fue posible cargar'); return; }
        if (!msgs || !msgs.length) { alert('Sin mensajes'); return; }
        alert(msgs.map(m => `De ${m.from_nickname}: ${m.text}`).join('\n'));
      };

      actions.appendChild(quota);
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
    }));

    list.appendChild(frag);
  }

  // ---------- Restore session ----------
  async function tryRestoreSession() {
    const me = storage.getUser?.(); if (!me) return false;
    const { data } = await supabase.from('checkins')
      .select('id')
      .eq('venue_id', me.venue_id)
      .eq('nickname', me.nickname)
      .eq('active', true)
      .limit(1);
    if (!data || !data.length) { storage.removeUser?.(); return false; }

    document.getElementById('checkin-section').hidden = true;
    document.getElementById('profiles-section').hidden = false;
    document.getElementById('me-line').textContent =
      `Estás como ${me.nickname} — ${me.gender === 'male' ? 'Hombre' : 'Mujer'}. ` +
      `Interés: ${me.interested_in === 'men' ? 'Hombres' : 'Mujeres'}.`;

    await loadProfiles(me);
    subscribeToIncomingMessages(me);
    startAutoRefresh(me); // keep list live
    return true;
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    await loadVenues();

    // restore session if possible
    const restored = await tryRestoreSession();
    if (restored) return;

    const form = document.getElementById('checkin-form');
    const errEl = document.getElementById('checkin-error');
    const meLine = document.getElementById('me-line');
    const refreshBtn = document.getElementById('refresh-btn');
    const checkoutBtn = document.getElementById('checkout-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); errEl.hidden = true; errEl.textContent = '';

      const venueId = Number(document.getElementById('venue').value);
      const nickname = document.getElementById('nickname').value.trim();
      const instagram = document.getElementById('instagram').value.trim();
      const gender = document.getElementById('gender').value;
      const description = document.getElementById('description').value.trim();
      const interested_in = document.getElementById('interested_in').value;

      if (!venueId || !nickname || !gender || !description || !interested_in) {
        errEl.textContent = 'Completa todos los campos obligatorios.'; errEl.hidden = false; return;
      }

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
        if (error) {
          if (error.code === '23505' || (error.message && error.message.includes('uq_checkins_active_nickname'))) {
            errEl.textContent = 'El apodo ya está en uso, prueba otro que combine letras y números.';
            errEl.hidden = false; return;
          }
          throw error;
        }
      } catch (e2) {
        console.error(e2);
        errEl.textContent = 'No fue posible registrar tu check-in.'; errEl.hidden = false; return;
      }

      const me = { venue_id: venueId, nickname, instagram: instagram || null, gender, description, interested_in };
      storage.setUser(me);

      document.getElementById('checkin-section').hidden = true;
      document.getElementById('profiles-section').hidden = false;
      meLine.textContent =
        `Estás como ${nickname} — ${gender === 'male' ? 'Hombre' : 'Mujer'}. ` +
        `Interés: ${interested_in === 'men' ? 'Hombres' : 'Mujeres'}.`;

      await loadProfiles(me);
      subscribeToIncomingMessages(me);
      startAutoRefresh(me); // start live updates after check-in
    });

    // Manual refresh (kept)
    refreshBtn.onclick = async () => {
      const me = storage.getUser(); if (me) await loadProfiles(me);
    };

    // Checkout
    checkoutBtn.onclick = async () => {
      const me = storage.getUser(); if (!me) return;
      await supabase.from('checkins')
        .update({ active: false })
        .eq('venue_id', me.venue_id)
        .eq('nickname', me.nickname)
        .eq('active', true);

      // cleanup
      if (msgSub) { try { supabase.removeChannel(msgSub); } catch {} msgSub = null; }
      stopAutoRefresh();
      storage.removeUser();
      location.reload();
    };
  });
})();
