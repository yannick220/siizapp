(() => {
  const SUPABASE_URL = "https://xctoczjnlvxbnlocwkpt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f1jYc1xgVVKoUnp4Lu4T8g_PqvRKzUS";

  if (!window.supabase?.createClient) {
    console.warn("Supabase client unavailable.");
    return;
  }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  window.siizSupabase = client;

  let currentUser = null;
  let currentProfile = null;
  let liveMessageChannel = null;
  let liveBooted = false;
  let bootSessionPromise = null;
  let lastAuthMode = "signin";

  const originalSendMessage = sendMessage;
  const originalSendVoiceMessage = sendVoiceMessage;
  const originalShowNewChat = showNewChat;
  const originalShowProfile = showProfile;
  const originalAvailableSiizContacts = availableSiizContacts;
  const originalInviteContactItems = inviteContactItems;
  const originalUnavailableSiizContacts = unavailableSiizContacts;

  function injectLiveStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .siiz-auth-gate {
        position: fixed;
        inset: 0;
        z-index: 80;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(255,255,255,.86);
        backdrop-filter: blur(22px);
      }
      .siiz-auth-card {
        width: min(390px, 100%);
        border-radius: 28px;
        background: rgba(255,255,255,.94);
        box-shadow: 0 22px 60px rgba(17,17,19,.16);
        padding: 24px;
        display: grid;
        gap: 14px;
      }
      .siiz-auth-card h2 {
        margin: 0;
        font-size: 1.8rem;
        letter-spacing: 0;
      }
      .siiz-auth-card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.45;
        font-size: .9rem;
      }
      #siizAuthMessage {
        margin: -2px 0 0;
        padding: 10px 12px;
        border-radius: 16px;
        background: rgba(17,17,19,.05);
        color: rgba(17,17,19,.68);
        font-size: .78rem;
        font-weight: 700;
        line-height: 1.35;
      }
      #siizAuthMessage:empty {
        display: none;
      }
      #siizAuthMessage.is-error {
        background: rgba(210,44,44,.10);
        color: #9f1d1d;
      }
      #siizAuthMessage.is-success {
        background: rgba(255,212,0,.18);
        color: var(--ink);
      }
      .siiz-auth-card input {
        width: 100%;
        border: 0;
        border-radius: 18px;
        padding: 15px 16px;
        background: rgba(17,17,19,.06);
        font: inherit;
        outline: none;
      }
      .siiz-auth-card input:focus {
        box-shadow: inset 0 0 0 2px rgba(255,212,0,.8);
        background: #fff;
      }
      .siiz-password-field {
        position: relative;
      }
      .siiz-password-field input {
        padding-right: 58px;
      }
      .siiz-password-field button {
        position: absolute;
        top: 50%;
        right: 6px;
        transform: translateY(-50%);
        height: 38px;
        width: 44px;
        border: 0;
        border-radius: 14px;
        padding: 0;
        background: rgba(17,17,19,.07);
        color: rgba(17,17,19,.72);
        display: grid;
        place-items: center;
        cursor: pointer;
      }
      .siiz-password-field button svg {
        width: 19px;
        height: 19px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .siiz-password-field button:active {
        transform: translateY(-50%) scale(.97);
      }
      .siiz-auth-primary,
      .siiz-live-form button {
        border: 0;
        border-radius: 18px;
        min-height: 48px;
        padding: 0 16px;
        background: var(--yellow);
        color: var(--ink);
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
      .siiz-auth-switch {
        min-height: 38px;
        border: 0;
        background: transparent;
        color: rgba(17,17,19,.64);
        font: inherit;
        font-size: .84rem;
        font-weight: 700;
        cursor: pointer;
      }
      .siiz-auth-card button:disabled {
        opacity: .55;
        cursor: default;
      }
      .siiz-live-form {
        display: grid;
        gap: 12px;
        padding: 2px 0 8px;
      }
      .siiz-live-form input {
        width: 100%;
        border: 0;
        border-radius: 18px;
        padding: 15px 16px;
        background: rgba(17,17,19,.06);
        font: inherit;
        outline: none;
      }
      .siiz-live-code {
        border-radius: 18px;
        background: var(--yellow-soft);
        padding: 14px 16px;
        font-weight: 800;
        text-align: center;
        letter-spacing: .08em;
      }
    `;
    document.head.append(style);
  }

  function setAuthMessage(element, text = "", type = "info") {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function friendlyAuthError(error) {
    const rawMessage = String(error?.message || error || "");
    const normalized = rawMessage.toLowerCase();
    if (normalized.includes("invalid login credentials")) {
      return "Email ou mot de passe incorrect.";
    }
    if (normalized.includes("email not confirmed")) {
      return "Confirme ton email avant de te connecter.";
    }
    if (normalized.includes("email rate limit")) {
      return "Trop d’essais d’email d’un coup. Réessaie dans quelques minutes.";
    }
    if (normalized.includes("password") && normalized.includes("6")) {
      return "Le mot de passe doit contenir au moins 6 caractères.";
    }
    return rawMessage || "Connexion impossible. Vérifie tes informations puis réessaie.";
  }

  function ensureLivePill() {
    document.querySelector("#siizLivePill")?.remove();
    return null;
  }

  function setLivePill(text, online = false) {
    ensureLivePill();
    window.siizLiveStatus = { text, online };
  }

  function liveDisplayName() {
    return currentProfile?.display_name
      || currentUser?.user_metadata?.display_name
      || currentUser?.email?.split("@")[0]
      || "SIIZ";
  }

  function renderLiveProfileButton() {
    if (!currentUser) return;
    const avatar = currentProfile?.avatar_url || localStorage.getItem("siiz-profile-photo") || "";
    profileButtonVisual.replaceChildren();
    if (avatar) {
      const image = document.createElement("img");
      image.src = avatar;
      image.alt = "";
      profileButtonVisual.append(image);
      return;
    }
    profileButtonVisual.textContent = initialsFor(liveDisplayName());
  }

  function showAuthGate(message = "") {
    let gate = document.querySelector("#siizAuthGate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "siizAuthGate";
      gate.className = "siiz-auth-gate";
      gate.innerHTML = `
        <form class="siiz-auth-card" id="siizAuthForm" data-auth-form-mode="signin">
          <h2 data-auth-title>Se connecter</h2>
          <p data-auth-copy>Retrouve tes conversations, tes groupes et ta proximité.</p>
          <input name="displayName" autocomplete="name" placeholder="Prénom" hidden />
          <input name="email" type="email" autocomplete="email" placeholder="Email" required />
          <div class="siiz-password-field">
            <input name="password" type="password" autocomplete="current-password" placeholder="Mot de passe" minlength="6" required />
            <button type="button" data-password-toggle aria-label="Afficher le mot de passe" aria-pressed="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <button class="siiz-auth-primary" type="submit" data-auth-primary>Se connecter</button>
          <button class="siiz-auth-switch" type="button" data-auth-switch>Pas encore inscrit ? Créer un compte</button>
          <button class="siiz-auth-switch" type="button" data-forgot-password>Mot de passe oublié ?</button>
          <p id="siizAuthMessage">${escapeHtml(message)}</p>
        </form>`;
      document.body.append(gate);
      gate.addEventListener("submit", handleAuthSubmit);
      gate.addEventListener("click", event => {
        const switcher = event.target.closest("[data-auth-switch]");
        if (switcher) {
          const form = gate.querySelector("#siizAuthForm");
          setAuthMode(form, form?.dataset.authFormMode === "signup" ? "signin" : "signup");
          return;
        }
        if (event.target.closest("[data-forgot-password]")) {
          requestPasswordReset(gate);
          return;
        }
        const toggle = event.target.closest("[data-password-toggle]");
        if (toggle) {
          const input = gate.querySelector("input[name='password']");
          if (!input) return;
          const isVisible = input.type === "text";
          input.type = isVisible ? "password" : "text";
          toggle.setAttribute("aria-label", isVisible ? "Afficher le mot de passe" : "Masquer le mot de passe");
          toggle.setAttribute("aria-pressed", String(!isVisible));
          input.focus();
          return;
        }
      });
    }
    gate.hidden = false;
    const messageElement = gate.querySelector("#siizAuthMessage");
    setAuthMessage(messageElement, message);
  }

  function setAuthMode(form, mode) {
    if (!form) return;
    const nextMode = mode === "signup" ? "signup" : "signin";
    lastAuthMode = nextMode;
    form.dataset.authFormMode = nextMode;
    const displayName = form.querySelector("input[name='displayName']");
    const title = form.querySelector("[data-auth-title]");
    const copy = form.querySelector("[data-auth-copy]");
    const primary = form.querySelector("[data-auth-primary]");
    const switcher = form.querySelector("[data-auth-switch]");
    const message = form.querySelector("#siizAuthMessage");
    const password = form.querySelector("input[name='password']");

    if (displayName) {
      displayName.hidden = nextMode !== "signup";
      displayName.toggleAttribute("required", nextMode === "signup");
    }
    if (password) password.autocomplete = nextMode === "signup" ? "new-password" : "current-password";
    if (title) title.textContent = nextMode === "signup" ? "Créer mon compte" : "Se connecter";
    if (copy) copy.textContent = nextMode === "signup"
      ? "Un mail suffit pour créer ton compte SIIZ."
      : "Retrouve tes conversations, tes groupes et ta proximité.";
    if (primary) primary.textContent = nextMode === "signup" ? "Créer mon compte" : "Se connecter";
    if (switcher) switcher.textContent = nextMode === "signup"
      ? "Déjà inscrit ? Se connecter"
      : "Pas encore inscrit ? Créer un compte";
    const forgot = form.querySelector("[data-forgot-password]");
    if (forgot) forgot.hidden = nextMode !== "signin";
    setAuthMessage(message);
  }

  async function requestPasswordReset(gate) {
    const form = gate.querySelector("#siizAuthForm");
    const email = form?.querySelector("input[name='email']")?.value.trim();
    const message = form?.querySelector("#siizAuthMessage");
    if (!email || !form.querySelector("input[name='email']").checkValidity()) {
      setAuthMessage(message, "Indique d'abord ton adresse e-mail.", "error");
      return;
    }
    setAuthMessage(message, "Envoi du lien de récupération...");
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw error;
      setAuthMessage(message, "Si ce compte existe, un lien de récupération vient d'être envoyé. Consulte ta boîte mail.", "success");
    } catch (error) {
      setAuthMessage(message, friendlyAuthError(error), "error");
    }
  }

  function showNewPasswordForm() {
    if (document.getElementById("siizRecoveryGate")) return;
    const overlay = document.createElement("div");
    overlay.id = "siizRecoveryGate";
    overlay.className = "siiz-auth-gate";
    overlay.innerHTML = `
      <form class="siiz-auth-card" id="siizRecoveryForm">
        <h2>Choisir un nouveau mot de passe</h2>
        <p>Ce formulaire est accessible après avoir suivi le lien reçu par e-mail.</p>
        <input name="newPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Nouveau mot de passe (8 caractères minimum)" required />
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Confirmer le mot de passe" required />
        <button class="siiz-auth-primary" type="submit">Enregistrer le nouveau mot de passe</button>
        <p id="siizRecoveryMessage" role="status"></p>
      </form>`;
    document.body.append(overlay);
    overlay.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = form.querySelector("#siizRecoveryMessage");
      const password = form.elements.newPassword.value;
      if (password !== form.elements.confirmPassword.value) {
        message.textContent = "Les deux mots de passe ne correspondent pas.";
        return;
      }
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        const { error } = await client.auth.updateUser({password});
        if (error) throw error;
        overlay.remove();
        const gate = document.getElementById("siizAuthGate");
        if (gate) gate.hidden = true;
      } catch (error) {
        message.textContent = friendlyAuthError(error);
      } finally {
        button.disabled = false;
      }
    });
  }

  function hideAuthGate() {
    const gate = document.querySelector("#siizAuthGate");
    if (!gate) return;
    const form = gate.querySelector("#siizAuthForm");
    form?.reset();
    setAuthMode(form, "signin");
    gate.hidden = true;
  }

  availableSiizContacts = function availableLiveAwareContacts() {
    if (!currentUser) return originalAvailableSiizContacts();
    return conversations
      .filter(item => item.live && !item.isGroup && !item.offScale)
      .map(item => ({
        ...item,
        key: `conversation:${item.id}`,
        conversationId: item.id,
        source: "conversation"
      }));
  };

  inviteContactItems = function inviteLiveAwareContacts() {
    return currentUser ? [] : originalInviteContactItems();
  };

  unavailableSiizContacts = function unavailableLiveAwareContacts() {
    return currentUser ? [] : originalUnavailableSiizContacts();
  };

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.target.closest("form");
    if (!form) return;
    const mode = form.dataset.authFormMode || lastAuthMode || "signin";
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const displayName = String(data.get("displayName") || "").trim();
    const message = form.querySelector("#siizAuthMessage");
    if (!message) return;
    const buttons = [...form.querySelectorAll("button")];
    if (!email || !password || (mode === "signup" && !displayName)) {
      setAuthMessage(
        message,
        mode === "signup"
          ? "Renseigne ton prénom, ton email et ton mot de passe."
          : "Renseigne ton email et ton mot de passe.",
        "error"
      );
      return;
    }
    setAuthMessage(message, mode === "signup" ? "Création du compte..." : "Connexion...");
    buttons.forEach(button => { button.disabled = true; });

    const request = mode === "signup"
      ? client.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || email.split("@")[0] } }
        })
      : client.auth.signInWithPassword({ email, password });

    try {
      const { data: authData, error } = await request;
      if (error) {
        setAuthMessage(message, friendlyAuthError(error), "error");
        return;
      }
      if (mode === "signup" && !authData.session) {
        setAuthMode(form, "signin");
        const nextMessage = form.querySelector("#siizAuthMessage");
        setAuthMessage(nextMessage, "Compte créé. Confirme ton email, puis reviens te connecter.", "success");
        return;
      }
      if (authData.session) {
        setAuthMessage(message, "Connecté. Chargement de SIIZ...", "success");
        const isReady = await bootSession(authData.session);
        if (!isReady) {
          setAuthMessage(
            message,
            "Connexion acceptée, mais SIIZ n’arrive pas à charger ton profil. Recharge la page ; si ça revient, relance le SQL de réparation dans Supabase.",
            "error"
          );
        }
      }
    } catch (error) {
      console.warn(error);
      setAuthMessage(message, friendlyAuthError(error), "error");
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function initialsFor(name) {
    return String(name || "SIIZ")
      .trim()
      .split(/\s+/)
      .map(word => word[0])
      .slice(0, 2)
      .join("")
      .toLocaleUpperCase("fr");
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return now();
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay) return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Hier";
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(date);
  }

  function distanceKmBetween(a, b) {
    if (!a || !b) return null;
    const lat1 = Number(a.approximate_lat);
    const lng1 = Number(a.approximate_lng);
    const lat2 = Number(b.approximate_lat);
    const lng2 = Number(b.approximate_lng);
    if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
    const toRad = angle => angle * Math.PI / 180;
    const radius = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  async function ensureProfile() {
    const fallbackName = currentUser.user_metadata?.display_name
      || currentUser.email?.split("@")[0]
      || "Yannick";
    await client
      .from("profiles")
      .upsert({ id: currentUser.id, display_name: fallbackName }, { onConflict: "id" });

    const { data, error } = await client
      .from("profiles")
      .select("id, display_name, avatar_url, share_code, proximity_enabled, approximate_lat, approximate_lng")
      .eq("id", currentUser.id)
      .single();

    if (error) throw error;
    currentProfile = data;
    if (currentProfile.proximity_enabled === false || localStorage.getItem("siiz-proximity") === "off") {
      setProximityEnabled(false);
      if (currentProfile.proximity_enabled !== false) {
        await updateLiveProximity(false, { quiet: true });
      }
      return;
    }
    setProximityEnabled(true);
    requestApproximateLocation();
  }

  function requestApproximateLocation() {
    if (localStorage.getItem("siiz-proximity") === "off") return;
    if (!navigator.geolocation) {
      disableLiveProximity("Géolocalisation indisponible : proximité désactivée");
      return;
    }
    navigator.geolocation.getCurrentPosition(async position => {
      const rounded = {
        approximate_lat: Number(position.coords.latitude.toFixed(3)),
        approximate_lng: Number(position.coords.longitude.toFixed(3)),
        proximity_enabled: true,
        proximity_updated_at: new Date().toISOString()
      };
      const { error } = await client.from("profiles").update(rounded).eq("id", currentUser.id);
      if (!error) {
        currentProfile = { ...currentProfile, ...rounded };
        loadLiveConversations();
      }
    }, () => {
      disableLiveProximity("Position refusée : proximité désactivée");
    }, { enableHighAccuracy: false, timeout: 6500, maximumAge: 1000 * 60 * 15 });
  }

  function disableLiveProximity(message) {
    if (!currentUser || currentProfile?.proximity_enabled === false) return;
    updateLiveProximity(false, { quiet: true }).then(() => {
      showToast(message);
    });
  }

  function profileDistance(profile, members = []) {
    if (!currentProfile || currentProfile.proximity_enabled === false || !profile || profile.id === currentProfile.id) return 0;
    if (profile.proximity_enabled === false) return null;
    const value = distanceKmBetween(currentProfile, profile);
    if (Number.isFinite(value)) return Math.max(.001, value);
    const memberIndex = Math.max(1, members.findIndex(member => member.profile_id === profile.id) + 1);
    return memberIndex * 8;
  }

  function liveProfileFrom(member) {
    const hasVisibleProfile = Boolean(member.profiles);
    const profile = member.profiles || {};
    return {
      id: profile.id || member.profile_id,
      name: hasVisibleProfile ? (profile.display_name || "Contact SIIZ") : "Contact SIIZ",
      initials: initialsFor(profile.display_name),
      avatar: profile.avatar_url || "",
      proximity_enabled: hasVisibleProfile ? profile.proximity_enabled : false,
      approximate_lat: profile.approximate_lat,
      approximate_lng: profile.approximate_lng,
      hidden: !hasVisibleProfile
    };
  }

  function buildLiveConversations(rows, members, messages) {
    return rows.map(row => {
      const conversation = row.conversations || row;
      const conversationMembers = members.filter(member => member.conversation_id === row.conversation_id);
      const allProfiles = conversationMembers.map(liveProfileFrom);
      const profiles = allProfiles.filter(profile => profile.id === currentUser.id || (!profile.hidden && profile.proximity_enabled !== false));
      const otherProfiles = profiles.filter(profile => profile.id !== currentUser.id);
      const primaryProfile = otherProfiles[0] || profiles[0] || {};
      if (!otherProfiles.length) return null;
      const visibleProfileIds = new Set(profiles.map(profile => profile.id));
      const conversationMessages = messages
        .filter(message => message.conversation_id === row.conversation_id)
        .filter(message => message.sender_id === currentUser.id || visibleProfileIds.has(message.sender_id));
      const lastMessage = conversationMessages.at(-1);
      const isGroup = Boolean(conversation.is_group);
      const title = isGroup
        ? (conversation.title || otherProfiles.map(profile => profile.name).join(", ") || "Groupe")
        : (primaryProfile.name || "Conversation");
      const resolvedDistance = isGroup
        ? Math.exp(Math.max(.001, otherProfiles.reduce((sum, profile) => {
            const d = profileDistance(profile, conversationMembers) || 8;
            return sum + Math.log(Math.max(.001, d));
          }, 0)) / Math.max(1, otherProfiles.length))
        : (profileDistance(primaryProfile, conversationMembers) || 8);

      return {
        id: `live-${row.conversation_id}`,
        supabaseId: row.conversation_id,
        live: true,
        name: title,
        initials: initialsFor(title),
        avatar: !isGroup ? primaryProfile.avatar : "",
        proximity: isGroup
          ? `${profiles.length} participants · plusieurs distances`
          : (primaryProfile.proximity_enabled === false ? "hors GPS" : "proximité relative"),
        distanceKm: resolvedDistance,
        band: bandForDistance(resolvedDistance),
        isGroup,
        otherProfileId: !isGroup ? primaryProfile.id : "",
        liveMemberIds: otherProfiles.map(profile => profile.id).filter(Boolean),
        members: profiles.map(profile => profile.name),
        preview: lastMessage?.body || "Conversation SIIZ",
        time: formatTime(lastMessage?.created_at || conversation.created_at),
        activitySort: new Date(lastMessage?.created_at || conversation.created_at).getTime(),
        unread: 0,
        messages: conversationMessages.map(message => {
          const sender = profiles.find(profile => profile.id === message.sender_id) || {};
          const senderDistance = sender.id === currentUser.id ? 0 : (profileDistance(sender, conversationMembers) || resolvedDistance);
          return {
            id: message.id,
            side: message.sender_id === currentUser.id ? "out" : "in",
            sender: sender.name,
            distanceKm: senderDistance,
            text: message.body || "Message",
            time: formatTime(message.created_at),
            type: message.audio_url ? "audio" : undefined,
            transcript: message.body || "Message vocal"
          };
        })
      };
    }).filter(Boolean).sort((a, b) => (b.activitySort || 0) - (a.activitySort || 0));
  }

  async function loadLiveConversations(options = {}) {
    if (!currentUser) return;
    if (currentProfile?.proximity_enabled === false || !proximityEnabled) {
      conversations.splice(0, conversations.length);
      activeId = "";
      renderConversations();
      renderProximityDisabledState();
      setLivePill(`Connecté · ${currentProfile?.share_code || "SIIZ"}`, true);
      return;
    }

    const { data: memberships, error } = await client
      .from("conversation_members")
      .select("conversation_id, conversations(id, is_group, title, created_at)")
      .eq("profile_id", currentUser.id);

    if (error) {
      showToast("Lecture Supabase impossible");
      console.warn(error);
      return;
    }

    if (!memberships?.length) {
      conversations.splice(0, conversations.length);
      activeId = "";
      renderConversations();
      renderProximityDisabledState("Ajoutez un contact SIIZ par code pour démarrer une discussion.");
      setLivePill(`Connecté · ${currentProfile?.share_code || "code bientôt prêt"}`, true);
      if (options.sayEmpty) showToast("Connecté. Aucune conversation pour l’instant.");
      return;
    }

    const ids = memberships.map(item => item.conversation_id);
    const [{ data: members, error: membersError }, { data: liveMessages, error: messagesError }] = await Promise.all([
      client
        .from("conversation_members")
        .select("conversation_id, profile_id, profiles(id, display_name, avatar_url, proximity_enabled, approximate_lat, approximate_lng)")
        .in("conversation_id", ids),
      client
        .from("messages")
        .select("id, conversation_id, sender_id, body, audio_url, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: true })
    ]);

    if (membersError || messagesError) {
      showToast("Synchronisation incomplète");
      console.warn(membersError || messagesError);
      return;
    }

    const previousActiveId = activeId;
    const liveRows = buildLiveConversations(memberships, members || [], liveMessages || []);
    conversations.splice(0, conversations.length, ...liveRows);
    activeId = conversations.some(item => item.id === previousActiveId) ? previousActiveId : conversations[0]?.id || "";
    renderConversations();
    if (activeId) renderActiveConversation();
    else renderProximityDisabledState("Aucune conversation pour l’instant.");
    setLivePill(`Connecté · ${currentProfile?.share_code || "SIIZ"}`, true);
  }

  function renderProximityDisabledState(text = "Réactive la proximité pour voir les profils SIIZ autour de toi.") {
    chatName.textContent = "SIIZ";
    chatStatus.textContent = proximityEnabled ? "aucune conversation" : "proximité désactivée";
    setAvatarElement(chatAvatar, { initials: "SI" });
    messagesEl.innerHTML = `<div class="siiz-proximity-disabled"><strong>${escapeHtml(proximityEnabled ? "Aucune conversation" : "Proximité désactivée")}</strong><span>${escapeHtml(text)}</span></div>`;
  }

  function subscribeToMessages() {
    if (liveMessageChannel) client.removeChannel(liveMessageChannel);
    liveMessageChannel = client
      .channel(`siiz-live-${currentUser.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        loadLiveConversations();
      })
      .subscribe();
  }

  async function startLiveConversation(code) {
    const lookup = String(code || "").trim();
    if (!lookup) return;
    const { data: matches, error: findError } = await client.rpc("find_profile_by_code", { lookup_code: lookup });
    if (findError) {
      showToast("La fonction Supabase manque. Lance le SQL 02.");
      console.warn(findError);
      return;
    }
    const match = Array.isArray(matches) ? matches[0] : matches;
    if (!match) {
      showToast("Aucun contact trouvé avec ce code");
      return;
    }
    const { data: conversationId, error } = await client.rpc("start_direct_conversation", { other_profile_id: match.id });
    if (error) {
      showToast("Conversation non créée");
      console.warn(error);
      return;
    }
    await loadLiveConversations();
    closeDialog();
    openConversation(`live-${conversationId}`);
  }

  function showLiveStartDialog() {
    openDialog(`${dialogHeader("Ajouter un contact", "new-chat")}
      <form class="siiz-live-form" id="liveStartForm">
        <p class="settings-explainer">Colle le code SIIZ d’un contact pour ouvrir une vraie conversation Supabase.</p>
        <input name="shareCode" autocomplete="off" placeholder="Code SIIZ" required />
        <button type="submit">Ouvrir la conversation</button>
      </form>`);
  }

  function showLiveAccount() {
    const code = currentProfile?.share_code || "non disponible";
    openDialog(`${dialogHeader("Compte SIIZ")}
      <div class="dialog-contact-list">
        <p class="settings-explainer">Ton code sert à permettre à un autre utilisateur de t’ajouter sans connaître ta position.</p>
        <div class="siiz-live-code">${escapeHtml(code)}</div>
        <button class="dialog-contact" data-live-copy-code type="button">
          <span class="avatar">#</span>
          <span><strong>Copier mon code</strong><small>À envoyer à un contact SIIZ</small></span>
        </button>
        <button class="dialog-contact" data-live-reload type="button">
          <span class="avatar">↻</span>
          <span><strong>Synchroniser</strong><small>Recharger messages et groupes</small></span>
        </button>
        <button class="dialog-contact" data-live-signout type="button">
          <span class="avatar">×</span>
          <span><strong>Se déconnecter</strong><small>Revenir à l’écran de connexion</small></span>
        </button>
      </div>`);
  }

  showProfile = function showProfileWithLive(direction = "forward") {
    originalShowProfile(direction);
    if (!currentUser) return;
    requestAnimationFrame(() => {
      const profileCard = dialog.querySelector(".profile-card");
      const profileName = profileCard?.querySelector("h3");
      const profileAvatar = profileCard?.querySelector(".avatar");
      if (profileName) profileName.textContent = liveDisplayName();
      if (profileAvatar) setAvatarElement(profileAvatar, {
        initials: initialsFor(liveDisplayName()),
        avatar: currentProfile?.avatar_url || localStorage.getItem("siiz-profile-photo") || ""
      });
      const list = dialog.querySelector(".settings-list");
      if (!list || list.querySelector("[data-dialog-action='live-account']")) return;
      list.insertAdjacentHTML("afterbegin", settingsRow(
        "live-account",
        "Compte SIIZ",
        currentProfile?.share_code ? `Code ${currentProfile.share_code}` : "Code de contact"
      ));
    });
  };

  async function updateLiveProximity(enabled, options = {}) {
    if (!currentUser) return;
    setProximityEnabled(enabled);
    const patch = enabled
      ? { proximity_enabled: true, proximity_updated_at: new Date().toISOString() }
      : {
          proximity_enabled: false,
          approximate_lat: null,
          approximate_lng: null,
          proximity_updated_at: new Date().toISOString()
        };
    const { data, error } = await client
      .from("profiles")
      .update(patch)
      .eq("id", currentUser.id)
      .select("id, display_name, avatar_url, share_code, proximity_enabled, approximate_lat, approximate_lng")
      .single();
    if (error) {
      showToast("Réglage non synchronisé");
      console.warn(error);
      setProximityEnabled(!enabled);
      return;
    }
    currentProfile = { ...currentProfile, ...data };
    if (enabled) {
      requestApproximateLocation();
      await loadLiveConversations();
    } else {
      await loadLiveConversations();
    }
    if (!options.quiet) showToast(enabled ? "Proximité réactivée" : "Proximité désactivée");
  }

  showNewChat = function showNewChatWithLive() {
    originalShowNewChat();
    if (!currentUser) return;
    requestAnimationFrame(() => {
      const list = dialog.querySelector(".dialog-contact-list");
      if (!list || list.querySelector("[data-live-start]")) return;
      list.insertAdjacentHTML("afterbegin", `
        <button class="dialog-contact" data-live-start type="button">
          <span class="avatar">#</span>
          <span><strong>Ajouter par code SIIZ</strong><small>Démarrer une vraie conversation Supabase</small></span>
        </button>
      `);
    });
  };

  sendMessage = async function sendLiveMessage(text) {
    const value = text.trim();
    if (!value) return;
    const active = conversations.find(item => item.id === activeId);
    if (!currentUser) {
      originalSendMessage(text);
      return;
    }
    if (!active?.live || !active.supabaseId) {
      showToast("Ajoutez ou ouvrez une conversation SIIZ");
      return;
    }

    messageInput.value = "";
    resizeInput();
    const { error } = await client.from("messages").insert({
      conversation_id: active.supabaseId,
      sender_id: currentUser.id,
      body: value
    });
    if (error) {
      messageInput.value = value;
      resizeInput();
      showToast("Message non envoyé");
      console.warn(error);
      return;
    }
    await loadLiveConversations();
    openConversation(active.id);
  };

  sendVoiceMessage = function sendLiveVoiceMessage() {
    if (!currentUser) {
      originalSendVoiceMessage();
      return;
    }
    const active = conversations.find(item => item.id === activeId);
    if (!active?.live) {
      showToast("Ajoutez ou ouvrez une conversation SIIZ");
      return;
    }
    showToast("Messages vocaux non disponibles dans cette version");
  };

  async function createLiveGroupFromForm(event) {
    if (!currentUser || event.target.id !== "groupForm") return;

    const data = new FormData(event.target);
    const name = String(data.get("groupName") || "").trim();
    const selectedKeys = data.getAll("members");
    const selectedItems = selectedKeys.map(resolveGroupCandidate).filter(Boolean);
    const liveIds = selectedItems.flatMap(item => item.liveMemberIds || (item.otherProfileId ? [item.otherProfileId] : []));
    const memberIds = [...new Set(liveIds)].filter(id => id && id !== currentUser.id);

    if (!selectedItems.some(item => item.live)) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!name || memberIds.length < 2) {
      showToast("Choisissez un nom et au moins deux contacts SIIZ");
      return;
    }

    const { data: conversationId, error } = await client.rpc("create_group_conversation", {
      group_title: name,
      member_ids: memberIds
    });

    if (error) {
      showToast("Groupe non créé");
      console.warn(error);
      return;
    }

    await client.from("messages").insert({
      conversation_id: conversationId,
      sender_id: currentUser.id,
      body: `Groupe créé : ${name}`
    });

    await loadLiveConversations();
    closeDialog();
    openConversation(`live-${conversationId}`);
  }

  dialogBackdrop.addEventListener("click", event => {
    if (event.target.closest("[data-dialog-action='live-account']")) showLiveAccount();
    if (event.target.closest("[data-live-start]")) showLiveStartDialog();
    if (event.target.closest("[data-live-copy-code]")) {
      navigator.clipboard?.writeText(currentProfile?.share_code || "");
      showToast("Code copié");
    }
    if (event.target.closest("[data-live-reload]")) {
      loadLiveConversations({ sayEmpty: true });
      closeDialog();
    }
    if (event.target.closest("[data-live-signout]")) {
      client.auth.signOut();
      closeDialog();
    }
  });

  dialogBackdrop.addEventListener("submit", event => {
    if (event.target.id === "liveStartForm") {
      event.preventDefault();
      const data = new FormData(event.target);
      startLiveConversation(data.get("shareCode"));
      return;
    }
    createLiveGroupFromForm(event);
  }, true);

  dialogBackdrop.addEventListener("change", event => {
    if (event.target.id !== "proximityToggle" || !currentUser) return;
    event.stopImmediatePropagation();
    updateLiveProximity(event.target.checked);
  }, true);

  async function bootSession(session) {
    if (!session?.user) return false;
    if (bootSessionPromise && currentUser?.id === session.user.id) return bootSessionPromise;
    currentUser = session.user;
    bootSessionPromise = (async () => {
      try {
        conversations.splice(0, conversations.length);
        activeId = "";
        renderConversations();
        renderProximityDisabledState("Connexion à Supabase en cours...");
        await ensureProfile();
        renderLiveProfileButton();
        hideAuthGate();
        setLivePill(`Connecté · ${currentProfile?.share_code || "SIIZ"}`, true);
        await loadLiveConversations({ sayEmpty: !liveBooted });
        subscribeToMessages();
        liveBooted = true;
        return true;
      } catch (error) {
        console.warn(error);
        window.siizLiveLastError = error;
        conversations.splice(0, conversations.length);
        activeId = "";
        renderConversations();
        renderProximityDisabledState("La base Supabase n’est pas encore prête. Lance le SQL de réparation, puis recharge l’application.");
        setLivePill("Supabase à terminer", false);
        showToast("Lance le SQL de réparation dans Supabase");
        return false;
      } finally {
        bootSessionPromise = null;
      }
    })();
    return bootSessionPromise;
  }

  async function initLiveMode() {
    injectLiveStyles();
    ensureLivePill();
    const { data } = await client.auth.getSession();
    if (data.session) {
      const isReady = await bootSession(data.session);
      if (!isReady) showAuthGate("Connexion trouvée, mais SIIZ n’arrive pas à charger ton profil.");
    } else {
      setLivePill("SIIZ déconnecté");
      showAuthGate();
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showNewPasswordForm();
        return;
      }
      if (session) {
        bootSession(session);
      } else {
        currentUser = null;
        currentProfile = null;
        conversations.splice(0, conversations.length);
        activeId = "";
        renderConversations();
        renderProximityDisabledState("Connectez-vous pour retrouver vos conversations SIIZ.");
        if (liveMessageChannel) client.removeChannel(liveMessageChannel);
        liveMessageChannel = null;
        liveBooted = false;
        setLivePill("SIIZ déconnecté");
        showAuthGate("Connecte-toi pour retrouver tes conversations.");
      }
    });
  }

  initLiveMode();
})();
