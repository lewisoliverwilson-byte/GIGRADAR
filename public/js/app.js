/* =============================================
   GIGRADAR — SPA APP
   ============================================= */

/* ---- IMAGE CACHE ---- */
const imageCache = {};

/* ---- PENDING VERIFICATION ---- */
// { name, email, password, cognitoUser }
let pendingVerification = null;

/* ---- STATE ---- */
const state = {
  user: null,
  following: new Set(),
  notifications: [...NOTIFICATIONS],
  searchQuery: '',
  calendarMonth: null // Date object for current calendar view
};

/* ---- LOCALSTORAGE ---- */
function saveState() {
  localStorage.setItem('gr_following', JSON.stringify([...state.following]));
}

function loadFollowingAndNotifs() {
  const f = localStorage.getItem('gr_following');
  if (f) {
    try { state.following = new Set(JSON.parse(f)); } catch (e) { state.following = new Set(); }
  }
  const notifState = localStorage.getItem('gr_notifs');
  if (notifState) {
    try {
      const saved = JSON.parse(notifState);
      state.notifications = NOTIFICATIONS.map(n => {
        const s = saved.find(s => s.id === n.id);
        return s ? { ...n, read: s.read } : n;
      });
    } catch (e) {}
  }
}

/* ---- COGNITO ---- */
const cognitoUserPool = new AmazonCognitoIdentity.CognitoUserPool({
  UserPoolId: window.GIGRADAR_CONFIG.cognitoUserPoolId,
  ClientId:   window.GIGRADAR_CONFIG.cognitoClientId
});

function makeCognitoUser(email) {
  return new AmazonCognitoIdentity.CognitoUser({
    Username: email,
    Pool: cognitoUserPool
  });
}

function getSessionUser() {
  return new Promise(resolve => {
    const cognitoUser = cognitoUserPool.getCurrentUser();
    if (!cognitoUser) { resolve(null); return; }
    cognitoUser.getSession((err, session) => {
      if (err || !session || !session.isValid()) { resolve(null); return; }
      cognitoUser.getUserAttributes((err, attrs) => {
        if (err) { resolve(null); return; }
        const m = {};
        attrs.forEach(a => { m[a.getName()] = a.getValue(); });
        resolve({ name: m.name || m.email.split('@')[0], email: m.email, verified: true });
      });
    });
  });
}

function cognitoErrorMessage(err) {
  switch (err.code) {
    case 'UsernameExistsException':    return 'An account with this email already exists.';
    case 'InvalidPasswordException':   return 'Password must be at least 8 characters with uppercase and a number.';
    case 'UserNotFoundException':      return 'No account found with this email.';
    case 'NotAuthorizedException':     return 'Incorrect password. Please try again.';
    case 'UserNotConfirmedException':  return 'Please verify your email before signing in.';
    case 'CodeMismatchException':      return 'Incorrect code. Please try again.';
    case 'ExpiredCodeException':       return 'Code expired. Please request a new one.';
    case 'LimitExceededException':     return 'Too many attempts. Please wait a moment and try again.';
    default: return err.message || 'Something went wrong. Please try again.';
  }
}

function saveNotifState() {
  localStorage.setItem('gr_notifs', JSON.stringify(state.notifications.map(n => ({ id: n.id, read: n.read }))));
}

/* ---- UTILITIES ---- */
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(str) {
  if (!str) return '';
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDateBadge(str) {
  if (!str) return { day: '', month: '' };
  const d = new Date(str + 'T12:00:00');
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-GB', { month: 'short' })
  };
}

function getArtist(id) {
  return ARTISTS.find(a => a.id === id) || null;
}

function getVenue(id) {
  return VENUES.find(v => v.id === id) || null;
}

function getArtistGigs(artistId) {
  const today = '2026-03-28';
  return GIGS.filter(g => g.artistId === artistId && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getArtistPastGigs(artistId) {
  const today = '2026-03-28';
  return PAST_GIGS.filter(g => g.artistId === artistId && g.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function getSetlist(gigId) {
  const pg = PAST_GIGS.find(g => g.id === gigId);
  if (!pg || !pg.setlistId) return null;
  return SETLISTS.find(s => s.id === pg.setlistId) || null;
}

function artistAvatar(artist) {
  const colors = {
    '#f59e0b': 'linear-gradient(135deg, #f59e0b, #ef4444)',
    '#3b82f6': 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    '#f97316': 'linear-gradient(135deg, #f97316, #f59e0b)',
    '#ec4899': 'linear-gradient(135deg, #ec4899, #8b5cf6)',
    '#dc2626': 'linear-gradient(135deg, #dc2626, #f97316)',
    '#6366f1': 'linear-gradient(135deg, #6366f1, #ec4899)',
    '#8b5cf6': 'linear-gradient(135deg, #8b5cf6, #f472b6)',
    '#10b981': 'linear-gradient(135deg, #10b981, #3b82f6)',
    '#0ea5e9': 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    '#14b8a6': 'linear-gradient(135deg, #14b8a6, #3b82f6)',
    '#f59e0b': 'linear-gradient(135deg, #f59e0b, #10b981)',
    '#06b6d4': 'linear-gradient(135deg, #06b6d4, #8b5cf6)',
    '#f43f5e': 'linear-gradient(135deg, #f43f5e, #f97316)',
    '#a855f7': 'linear-gradient(135deg, #a855f7, #06b6d4)',
    '#22c55e': 'linear-gradient(135deg, #22c55e, #06b6d4)',
    '#84cc16': 'linear-gradient(135deg, #84cc16, #10b981)',
    '#ef4444': 'linear-gradient(135deg, #ef4444, #f43f5e)',
    '#64748b': 'linear-gradient(135deg, #64748b, #3b82f6)'
  };
  return colors[artist.color] || `linear-gradient(135deg, ${artist.color}, #8b5cf6)`;
}

function formatListeners(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toString();
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- TOAST ---- */
function toast(message, type = 'default') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    el.addEventListener('animationend', () => el.remove());
  }, 3200);
}

/* ---- NAVBAR UPDATE ---- */
function updateNavbar() {
  const authArea = document.getElementById('authArea');
  if (state.user) {
    const initials = state.user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const verifiedBadge = state.user.verified ? '<span class="verified-badge" title="Email verified">✓</span>' : '';
    authArea.innerHTML = `
      <div class="user-chip">
        <div class="user-avatar-sm">${esc(initials)}</div>
        <span>${esc(state.user.name.split(' ')[0])}</span>
        ${verifiedBadge}
      </div>
      <button class="logout-btn" id="logoutBtn">Sign out</button>
    `;
    document.getElementById('logoutBtn').addEventListener('click', () => {
      const cognitoUser = cognitoUserPool.getCurrentUser();
      if (cognitoUser) cognitoUser.signOut();
      state.user = null;
      state.following = new Set();
      saveState();
      updateNavbar();
      toast('Signed out');
      router();
    });
  } else {
    authArea.innerHTML = `<button class="btn btn-primary" id="authBtn">Sign In</button>`;
    document.getElementById('authBtn').addEventListener('click', showAuthModal);
  }
  updateBellBadge();
}

function updateBellBadge() {
  const unread = state.notifications.filter(n => !n.read).length;
  const badge = document.getElementById('bellBadge');
  badge.textContent = unread;
  badge.setAttribute('data-count', unread);
}

/* ---- SCROLL NAV ---- */
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (window.scrollY > 10) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
}, { passive: true });

/* ---- NOTIFICATIONS PANEL ---- */
function renderNotifPanel() {
  const list = document.getElementById('notifList');
  if (!state.notifications.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    return;
  }
  list.innerHTML = state.notifications.map(n => {
    const artist = getArtist(n.artistId);
    const icon = n.type === 'new_gig' ? '🎸' : '🎟️';
    return `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <div class="notif-icon">${icon}</div>
        <div class="notif-text">
          <div class="notif-msg">${esc(n.message)}</div>
          <div class="notif-date">${formatDate(n.date)}</div>
        </div>
        ${!n.read ? '<div class="notif-unread-dot"></div>' : ''}
      </div>
    `;
  }).join('');
}

function openNotifPanel() {
  // Mark all read
  state.notifications.forEach(n => n.read = true);
  saveNotifState();
  updateBellBadge();
  renderNotifPanel();

  document.getElementById('notifPanel').classList.add('open');
  document.getElementById('notifOverlay').classList.add('open');
  document.getElementById('notifPanel').setAttribute('aria-hidden', 'false');
  document.getElementById('bellBtn').setAttribute('aria-expanded', 'true');
}

function closeNotifPanel() {
  document.getElementById('notifPanel').classList.remove('open');
  document.getElementById('notifOverlay').classList.remove('open');
  document.getElementById('notifPanel').setAttribute('aria-hidden', 'true');
  document.getElementById('bellBtn').setAttribute('aria-expanded', 'false');
}

document.getElementById('bellBtn').addEventListener('click', () => {
  const isOpen = document.getElementById('notifPanel').classList.contains('open');
  if (isOpen) closeNotifPanel(); else openNotifPanel();
});
document.getElementById('notifClose').addEventListener('click', closeNotifPanel);
document.getElementById('notifOverlay').addEventListener('click', closeNotifPanel);

/* ---- AUTH MODAL ---- */
function showAuthModal() {
  document.getElementById('authModal').classList.add('open');
  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById('authModal').setAttribute('aria-hidden', 'false');
  document.getElementById('loginEmail').focus();
  showLoginForm();
}

function hideAuthModal() {
  document.getElementById('authModal').classList.remove('open');
  document.getElementById('modalBackdrop').classList.remove('open');
  document.getElementById('authModal').setAttribute('aria-hidden', 'true');
}

function showLoginForm() {
  document.getElementById('loginForm').style.display = '';
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('verifyForm').style.display = 'none';
  document.getElementById('loginError').textContent = '';
}

function showSignupForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = '';
  document.getElementById('verifyForm').style.display = 'none';
  document.getElementById('signupError').textContent = '';
}

function showVerifyForm(name, email) {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('verifyForm').style.display = '';
  document.getElementById('verifySubtitle').textContent = `We've sent a 6-digit code to ${email}`;
  document.getElementById('verifyCodePreview').textContent = 'Check your inbox — the code expires in 24 hours.';
  document.getElementById('verifyCodeInput').value = '';
  document.getElementById('verifyError').textContent = '';
  document.getElementById('verifyCodeInput').focus();
}

document.getElementById('modalClose').addEventListener('click', hideAuthModal);
document.getElementById('modalBackdrop').addEventListener('click', hideAuthModal);
document.getElementById('switchToSignup').addEventListener('click', showSignupForm);
document.getElementById('switchToLogin').addEventListener('click', showLoginForm);

document.getElementById('loginFormEl').addEventListener('submit', e => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  if (!email || !password) { errorEl.textContent = 'Please fill in all fields.'; return; }
  if (!email.includes('@')) { errorEl.textContent = 'Please enter a valid email.'; return; }

  const btn = e.target.querySelector('button[type=submit]');
  btn.textContent = 'Signing in…'; btn.disabled = true;

  const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
  const cognitoUser = makeCognitoUser(email);

  cognitoUser.authenticateUser(authDetails, {
    onSuccess: session => {
      btn.textContent = 'Sign In'; btn.disabled = false;
      cognitoUser.getUserAttributes((err, attrs) => {
        const m = {};
        if (!err && attrs) attrs.forEach(a => { m[a.getName()] = a.getValue(); });
        const name = m.name || email.split('@')[0];
        state.user = { name, email, verified: true };
        saveState();
        updateNavbar();
        hideAuthModal();
        toast(`Welcome back, ${name.split(' ')[0]}!`, 'success');
        router();
      });
    },
    onFailure: err => {
      btn.textContent = 'Sign In'; btn.disabled = false;
      if (err.code === 'UserNotConfirmedException') {
        pendingVerification = { name: email.split('@')[0], email, password, cognitoUser };
        showVerifyForm(email.split('@')[0], email);
        return;
      }
      errorEl.textContent = cognitoErrorMessage(err);
    }
  });
});

document.getElementById('signupFormEl').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!name || !email || !password) {
    document.getElementById('signupError').textContent = 'Please fill in all fields.';
    return;
  }
  if (!email.includes('@')) {
    document.getElementById('signupError').textContent = 'Please enter a valid email.';
    return;
  }
  if (password.length < 8) {
    document.getElementById('signupError').textContent = 'Password must be at least 8 characters.';
    return;
  }

  const btn = e.target.querySelector('button[type=submit]');
  btn.textContent = 'Creating account…'; btn.disabled = true;

  const attrs = [
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'email', Value: email }),
    new AmazonCognitoIdentity.CognitoUserAttribute({ Name: 'name',  Value: name })
  ];

  cognitoUserPool.signUp(email, password, attrs, null, (err, result) => {
    btn.textContent = 'Create Account'; btn.disabled = false;
    if (err) {
      document.getElementById('signupError').textContent = cognitoErrorMessage(err);
      return;
    }
    pendingVerification = { name, email, password, cognitoUser: result.user };
    showVerifyForm(name, email);
  });
});

document.getElementById('verifyFormEl').addEventListener('submit', e => {
  e.preventDefault();
  const code = document.getElementById('verifyCodeInput').value.trim();
  const errorEl = document.getElementById('verifyError');

  if (!code) { errorEl.textContent = 'Please enter the verification code.'; return; }
  if (!pendingVerification) { errorEl.textContent = 'Session expired. Please sign up again.'; return; }

  const btn = e.target.querySelector('button[type=submit]');
  btn.textContent = 'Verifying…'; btn.disabled = true;

  pendingVerification.cognitoUser.confirmRegistration(code, true, (err) => {
    btn.textContent = 'Verify Email'; btn.disabled = false;
    if (err) { errorEl.textContent = cognitoErrorMessage(err); return; }

    // Auto sign-in after verification
    const { name, email, password } = pendingVerification;
    pendingVerification = null;
    const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
    makeCognitoUser(email).authenticateUser(authDetails, {
      onSuccess: () => {
        state.user = { name, email, verified: true };
        saveState();
        updateNavbar();
        hideAuthModal();
        toast(`Welcome to GigRadar, ${name.split(' ')[0]}!`, 'success');
        router();
      },
      onFailure: () => {
        // Verification succeeded but auto-login failed — send them to login
        showLoginForm();
        document.getElementById('loginEmail').value = email;
        toast('Email verified! Please sign in.');
      }
    });
  });
});

document.getElementById('resendCode').addEventListener('click', () => {
  if (!pendingVerification) return;
  pendingVerification.cognitoUser.resendConfirmationCode((err) => {
    if (err) { toast(cognitoErrorMessage(err)); return; }
    toast('Verification code resent');
  });
});

document.getElementById('backToSignup').addEventListener('click', showSignupForm);

/* ---- SEARCH AUTOCOMPLETE ---- */
const searchInput = document.getElementById('searchInput');
const autocompleteDropdown = document.getElementById('autocompleteDropdown');
let autocompleteActive = -1;

function renderAutocomplete(query) {
  if (!query.trim()) {
    autocompleteDropdown.classList.remove('open');
    return;
  }
  const q = query.toLowerCase();
  const results = ARTISTS.filter(a => a.name.toLowerCase().includes(q)).slice(0, 6);

  if (!results.length) {
    autocompleteDropdown.innerHTML = `<div class="autocomplete-all" data-search="${esc(query)}">Search for "${esc(query)}"</div>`;
    autocompleteDropdown.classList.add('open');
    autocompleteDropdown.querySelector('.autocomplete-all').addEventListener('click', () => {
      navigateTo(`#/search?q=${encodeURIComponent(query)}`);
      autocompleteDropdown.classList.remove('open');
      searchInput.value = '';
    });
    return;
  }

  autocompleteDropdown.innerHTML = results.map((a, i) => `
    <div class="autocomplete-item" data-artist="${esc(a.id)}" role="option" tabindex="-1">
      <div class="autocomplete-avatar" style="background: ${artistAvatar(a)}; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; color:rgba(255,255,255,0.9)">
        ${esc(a.name[0])}
      </div>
      <div>
        <div class="autocomplete-name">${esc(a.name)}</div>
        <div class="autocomplete-sub">${a.genres.slice(0,2).map(esc).join(' · ')}</div>
      </div>
    </div>
  `).join('') + `<div class="autocomplete-all">See all results for "${esc(query)}"</div>`;

  autocompleteDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo(`#/artist/${item.dataset.artist}`);
      autocompleteDropdown.classList.remove('open');
      searchInput.value = '';
    });
  });

  const seeAll = autocompleteDropdown.querySelector('.autocomplete-all');
  if (seeAll) {
    seeAll.addEventListener('click', () => {
      navigateTo(`#/search?q=${encodeURIComponent(query)}`);
      autocompleteDropdown.classList.remove('open');
      searchInput.value = '';
    });
  }

  autocompleteDropdown.classList.add('open');
  autocompleteActive = -1;
}

searchInput.addEventListener('input', e => {
  renderAutocomplete(e.target.value);
});

searchInput.addEventListener('keydown', e => {
  const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
  if (e.key === 'ArrowDown') {
    autocompleteActive = Math.min(autocompleteActive + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === autocompleteActive));
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    autocompleteActive = Math.max(autocompleteActive - 1, -1);
    items.forEach((el, i) => el.classList.toggle('active', i === autocompleteActive));
    e.preventDefault();
  } else if (e.key === 'Enter') {
    if (autocompleteActive >= 0 && items[autocompleteActive]) {
      items[autocompleteActive].click();
    } else if (searchInput.value.trim()) {
      navigateTo(`#/search?q=${encodeURIComponent(searchInput.value.trim())}`);
      autocompleteDropdown.classList.remove('open');
      searchInput.value = '';
    }
    e.preventDefault();
  } else if (e.key === 'Escape') {
    autocompleteDropdown.classList.remove('open');
  }
});

document.addEventListener('click', e => {
  if (!document.getElementById('searchWrap').contains(e.target)) {
    autocompleteDropdown.classList.remove('open');
  }
});

/* ---- ROUTER ---- */
function navigateTo(hash) {
  window.location.hash = hash;
}

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, queryStr] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = {};
  if (queryStr) {
    queryStr.split('&').forEach(p => {
      const [k, v] = p.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
  }
  return { parts, params };
}

function router() {
  const { parts, params } = parseHash();
  const main = document.getElementById('mainContent');

  // Update active nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  if (parts[0] === 'genre') document.getElementById('navBrowse').classList.add('active');
  if (parts[0] === 'calendar') document.getElementById('navCalendar').classList.add('active');

  if (!parts.length || (parts.length === 1 && parts[0] === '')) {
    renderHome(main);
  } else if (parts[0] === 'artist' && parts[1]) {
    renderArtist(parts[1], main);
  } else if (parts[0] === 'genre') {
    renderGenre(parts[1] || 'all', main);
  } else if (parts[0] === 'calendar') {
    renderCalendar(main);
  } else if (parts[0] === 'search') {
    renderSearch(params.q || '', main);
  } else {
    renderHome(main);
  }

  window.scrollTo(0, 0);
  loadArtistImages();
}

window.addEventListener('hashchange', router);

/* ---- GIG CARD HTML ---- */
function gigCardHTML(gig, showArtist = true) {
  const artist = getArtist(gig.artistId);
  const venue = getVenue(gig.venueId);
  const bd = formatDateBadge(gig.date);
  const tickets = gig.tickets || [];
  const availableTickets = tickets.filter(t => t.available);

  return `
    <div class="gig-card">
      <div class="date-badge">
        <div class="date-badge-day">${bd.day}</div>
        <div class="date-badge-month">${bd.month}</div>
      </div>
      <div class="gig-info">
        ${showArtist && artist ? `<div class="gig-artist" style="cursor:pointer" onclick="navigateTo('#/artist/${esc(artist.id)}')">${esc(artist.name)}</div>` : ''}
        <div class="gig-venue">${venue ? `<strong>${esc(venue.name)}</strong>, ${esc(venue.city)}` : 'Venue TBC'}</div>
        <div class="gig-date-full">${formatDate(gig.date)}</div>
      </div>
      <div class="gig-tickets">
        ${tickets.length ? tickets.map(t => `
          <a href="${esc(t.url)}" class="ticket-btn ${t.available ? '' : 'sold-out'}" ${t.available ? '' : 'aria-disabled="true"'} target="_blank" rel="noopener">
            ${t.available ? `🎟 ${esc(t.seller)} ${t.price ? `· ${esc(t.price)}` : ''}` : `${esc(t.seller)} · Sold out`}
          </a>
        `).join('') : '<span class="text-muted" style="font-size:13px">Tickets TBC</span>'}
      </div>
    </div>
  `;
}

/* ---- ARTIST CARD HTML ---- */
function artistCardHTML(artist) {
  const upcomingCount = getArtistGigs(artist.id).length;
  return `
    <div class="artist-card" onclick="navigateTo('#/artist/${esc(artist.id)}')" role="button" tabindex="0" aria-label="${esc(artist.name)}">
      <div class="artist-card-avatar" style="background: ${artistAvatar(artist)}"${artist.wikipedia ? ` data-wikipedia="${esc(artist.wikipedia)}"` : ''}>
        <div class="artist-initial">${esc(artist.name[0])}</div>
        ${upcomingCount > 0 ? `<div class="upcoming-badge">${upcomingCount} gig${upcomingCount !== 1 ? 's' : ''}</div>` : ''}
      </div>
      <div class="artist-card-body">
        <div class="artist-card-name">${esc(artist.name)}</div>
        <div class="artist-card-meta">
          <span>${formatListeners(artist.monthlyListeners)} listeners</span>
        </div>
        <div class="artist-card-genres">
          ${artist.genres.slice(0, 2).map(g => `<span class="genre-pill">${esc(g)}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

/* =============================================
   VIEWS
   ============================================= */

/* ---- HOME ---- */
function renderHome(main) {
  if (state.user && state.following.size > 0) {
    renderPersonalisedHome(main);
  } else {
    renderDiscoveryHome(main);
  }
}

function renderDiscoveryHome(main) {
  const nextTenGigs = GIGS
    .filter(g => g.date >= '2026-03-28')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  main.innerHTML = `
    <div class="page">
      <!-- HERO -->
      <section class="hero">
        <div class="hero-bg"></div>
        <div class="hero-eyebrow">🇬🇧 UK Gig Discovery</div>
        <h1>Never miss a gig from<br><span class="gradient-text">your favourite artists</span></h1>
        <p class="hero-sub">Track UK tours, get instant alerts when tickets drop, and explore what's on near you.</p>
        <div class="hero-search" id="heroSearchWrap">
          <input type="text" class="hero-search-input" id="heroSearchInput" placeholder="Search artists, venues…" autocomplete="off" />
          <button class="btn btn-primary" id="heroSearchBtn">Search</button>
        </div>
        <div class="genre-chips" id="heroGenreChips">
          ${GENRES.map(g => `<button class="genre-chip" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}
        </div>
      </section>

      <!-- TRENDING ARTISTS -->
      <section class="container mt-32">
        <div class="section-head">
          <h2 class="section-title">Trending <span class="accent">Artists</span></h2>
          <a href="#/genre/all" class="section-link">View all →</a>
        </div>
        <div class="artist-grid">
          ${ARTISTS.slice(0, 8).map(artistCardHTML).join('')}
        </div>
      </section>

      <!-- UPCOMING GIGS -->
      <section class="container mt-32">
        <div class="section-head">
          <h2 class="section-title">Upcoming <span class="accent">Gigs</span></h2>
          <a href="#/genre/all" class="section-link">Browse all →</a>
        </div>
        <div class="gig-list">
          ${nextTenGigs.map(g => gigCardHTML(g, true)).join('')}
        </div>
      </section>
    </div>
  `;

  // Hero search
  const heroInput = document.getElementById('heroSearchInput');
  document.getElementById('heroSearchBtn').addEventListener('click', () => {
    if (heroInput.value.trim()) {
      navigateTo(`#/search?q=${encodeURIComponent(heroInput.value.trim())}`);
    }
  });
  heroInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && heroInput.value.trim()) {
      navigateTo(`#/search?q=${encodeURIComponent(heroInput.value.trim())}`);
    }
  });

  // Genre chips
  document.querySelectorAll('#heroGenreChips .genre-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      navigateTo(`#/genre/${encodeURIComponent(chip.dataset.genre)}`);
    });
  });

  // Artist card keyboard nav
  bindArtistCardKeys(main);
}

function renderPersonalisedHome(main) {
  const followedArray = [...state.following];
  const followedGigs = GIGS
    .filter(g => followedArray.includes(g.artistId) && g.date >= '2026-03-28')
    .sort((a, b) => a.date.localeCompare(b.date));

  const discoverArtists = ARTISTS.filter(a => !state.following.has(a.id)).slice(0, 8);
  const nextTenGigs = GIGS
    .filter(g => g.date >= '2026-03-28')
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);

  main.innerHTML = `
    <div class="page">
      <div class="container">
        <!-- WELCOME -->
        <div style="padding: 40px 0 8px">
          <h1 style="font-size: 28px; font-weight:800; letter-spacing:-0.5px">
            Hey ${esc(state.user.name.split(' ')[0])} 👋
          </h1>
          <p style="color: var(--muted); margin-top: 4px; font-size: 15px">Here's what's coming up for the artists you follow.</p>
        </div>

        <!-- FOLLOWED GIGS -->
        <div class="feed-section">
          <div class="section-head" style="margin-bottom: 18px">
            <h2 class="section-title">Your <span class="accent">Gigs</span></h2>
            <a href="#/calendar" class="section-link">Calendar view →</a>
          </div>
          ${followedGigs.length ? `
            <div class="gig-list">
              ${followedGigs.slice(0, 8).map(g => gigCardHTML(g, true)).join('')}
            </div>
            ${followedGigs.length > 8 ? `<p style="text-align:center; margin-top:18px"><a href="#/calendar" class="section-link" style="font-size:14px">+ ${followedGigs.length - 8} more gigs in calendar</a></p>` : ''}
          ` : `
            <div class="empty-state">
              <div class="empty-icon">🎸</div>
              <h3>No upcoming gigs</h3>
              <p>The artists you follow don't have any upcoming gigs right now. Check back soon!</p>
            </div>
          `}
        </div>

        <!-- DISCOVER MORE -->
        <div style="margin-top: 0">
          <div class="section-head">
            <h2 class="section-title">Discover <span class="accent">More</span></h2>
            <a href="#/genre/all" class="section-link">Browse all →</a>
          </div>
          <div class="artist-grid">
            ${discoverArtists.map(artistCardHTML).join('')}
          </div>
        </div>

        <!-- MORE UPCOMING -->
        <div class="mt-32">
          <div class="section-head">
            <h2 class="section-title">More <span class="accent">Upcoming</span></h2>
          </div>
          <div class="gig-list">
            ${nextTenGigs.filter(g => !followedArray.includes(g.artistId)).slice(0, 6).map(g => gigCardHTML(g, true)).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  bindArtistCardKeys(main);
}

/* ---- ARTIST PAGE ---- */
function renderArtist(id, main) {
  const artist = getArtist(id);
  if (!artist) {
    main.innerHTML = `
      <div class="container" style="padding-top: 60px; text-align: center">
        <div class="empty-icon">🔍</div>
        <h2>Artist not found</h2>
        <p class="text-muted mt-16">We couldn't find that artist.</p>
        <a href="#/" class="btn btn-secondary mt-24" style="display: inline-flex">Go Home</a>
      </div>
    `;
    return;
  }

  const upcomingGigs = getArtistGigs(id);
  const pastGigs = getArtistPastGigs(id);
  const isFollowing = state.following.has(id);

  main.innerHTML = `
    <div class="page">
      <!-- ARTIST HERO -->
      <div class="artist-hero">
        <div class="artist-hero-bg" style="background: ${artistAvatar(artist)}"${artist.wikipedia ? ` data-wikipedia="${esc(artist.wikipedia)}" data-hero-bg="1"` : ''}></div>
        <div class="artist-hero-overlay"></div>
        <div class="artist-hero-content">
          <div class="artist-avatar-lg" style="background: ${artistAvatar(artist)}"${artist.wikipedia ? ` data-wikipedia="${esc(artist.wikipedia)}"` : ''}><span class="artist-initial">${esc(artist.name[0])}</span></div>
          <div class="artist-hero-info">
            <h1>${esc(artist.name)}</h1>
            <div class="artist-meta-row">
              <div class="genre-chips" style="justify-content:flex-start; margin-bottom: 0">
                ${artist.genres.map(g => `<button class="genre-chip" onclick="navigateTo('#/genre/${encodeURIComponent(esc(g))}')">${esc(g)}</button>`).join('')}
              </div>
              <div class="artist-listeners">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                <strong>${formatListeners(artist.monthlyListeners)}</strong> monthly listeners
              </div>
              <span class="artist-country">🇬🇧 ${esc(artist.country)}</span>
            </div>
          </div>
          <div style="flex-shrink:0; align-self: center; margin-left: auto; margin-top: 16px">
            <button class="btn btn-primary follow-btn ${isFollowing ? 'following' : ''}" id="followBtn">
              ${isFollowing ? '✓ Following' : '+ Follow'}
            </button>
          </div>
        </div>
      </div>

      <!-- TABS -->
      <div class="container">
        <div class="tabs-bar" id="tabsBar">
          <button class="tab-btn active" data-tab="upcoming">Upcoming Gigs <span style="font-size:12px; color:var(--muted); margin-left:4px">(${upcomingGigs.length})</span></button>
          <button class="tab-btn" data-tab="past">Past Gigs & Setlists <span style="font-size:12px; color:var(--muted); margin-left:4px">(${pastGigs.length})</span></button>
          <button class="tab-btn" data-tab="about">About</button>
        </div>

        <!-- UPCOMING TAB -->
        <div id="tab-upcoming" class="tab-content">
          ${upcomingGigs.length ? `
            <div class="gig-list">
              ${upcomingGigs.map(g => gigCardHTML(g, false)).join('')}
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">🎸</div>
              <h3>No upcoming gigs</h3>
              <p>Nothing scheduled yet. Follow ${esc(artist.name)} to get notified when they announce shows.</p>
            </div>
          `}
        </div>

        <!-- PAST TAB -->
        <div id="tab-past" class="tab-content" style="display:none">
          ${pastGigs.length ? `
            <div class="gig-list">
              ${pastGigs.map(pg => {
                const venue = getVenue(pg.venueId);
                const bd = formatDateBadge(pg.date);
                const setlist = getSetlist(pg.id);
                return `
                  <div class="gig-card" style="flex-direction: column; align-items: flex-start; gap: 12px">
                    <div style="display:flex; align-items: center; gap: 16px; width: 100%">
                      <div class="date-badge">
                        <div class="date-badge-day">${bd.day}</div>
                        <div class="date-badge-month">${bd.month}</div>
                      </div>
                      <div class="gig-info">
                        <div class="gig-venue">${venue ? `<strong>${esc(venue.name)}</strong>, ${esc(venue.city)}` : 'Venue TBC'}</div>
                        <div class="gig-date-full">${formatDate(pg.date)}</div>
                      </div>
                      <div style="margin-left: auto; font-size: 12px; color: var(--muted); font-weight:600; background: rgba(255,255,255,0.05); padding: 3px 10px; border-radius: var(--radius-full)">Past</div>
                    </div>
                    ${setlist ? `
                      <div class="setlist-accordion" style="width: 100%; padding-left: 70px">
                        <button class="setlist-toggle" data-setlist="${setlist.id}">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                          View Setlist (${setlist.songs.length} songs)
                        </button>
                        <div class="setlist-body" id="setlist-${setlist.id}">
                          <div class="setlist-songs">
                            ${setlist.songs.map(song => `<div class="setlist-song">${esc(song)}</div>`).join('')}
                          </div>
                        </div>
                      </div>
                    ` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">📜</div>
              <h3>No past gigs found</h3>
              <p>We don't have any past gig data for ${esc(artist.name)} yet.</p>
            </div>
          `}
        </div>

        <!-- ABOUT TAB -->
        <div id="tab-about" class="tab-content" style="display:none">
          <div class="about-section">
            <p class="about-bio">${esc(artist.bio)}</p>
            <div class="about-stats">
              <div class="about-stat">
                <div class="about-stat-val">${formatListeners(artist.monthlyListeners)}</div>
                <div class="about-stat-label">Monthly Listeners</div>
              </div>
              <div class="about-stat">
                <div class="about-stat-val">${upcomingGigs.length}</div>
                <div class="about-stat-label">Upcoming Gigs</div>
              </div>
              <div class="about-stat">
                <div class="about-stat-val">${artist.genres.length}</div>
                <div class="about-stat-label">Genres</div>
              </div>
              <div class="about-stat">
                <div class="about-stat-val">🇬🇧</div>
                <div class="about-stat-label">${esc(artist.country)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Tabs
  const tabs = main.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      main.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      document.getElementById(`tab-${tab.dataset.tab}`).style.display = '';
    });
  });

  // Setlist toggles
  main.querySelectorAll('.setlist-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(`setlist-${btn.dataset.setlist}`);
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open');
      btn.classList.toggle('open');
      btn.innerHTML = btn.classList.contains('open')
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> Hide Setlist`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> View Setlist (${main.querySelector(`#setlist-${btn.dataset.setlist} .setlist-songs`).children.length} songs)`;
    });
  });

  // Follow button
  document.getElementById('followBtn').addEventListener('click', () => {
    if (!state.user) {
      showAuthModal();
      return;
    }
    const btn = document.getElementById('followBtn');
    if (state.following.has(id)) {
      state.following.delete(id);
      btn.textContent = '+ Follow';
      btn.classList.remove('following');
      toast(`Unfollowed ${artist.name}`);
    } else {
      state.following.add(id);
      btn.textContent = '✓ Following';
      btn.classList.add('following');
      toast(`Now following ${artist.name}!`, 'success');
    }
    saveState();
  });
}

/* ---- GENRE PAGE ---- */
function renderGenre(genreName, main) {
  const isAll = !genreName || genreName === 'all';
  const filteredArtists = isAll
    ? ARTISTS
    : ARTISTS.filter(a => a.genres.some(g => g.toLowerCase() === genreName.toLowerCase()));

  const displayName = isAll ? 'All Artists' : genreName;

  main.innerHTML = `
    <div class="page genre-page">
      <div class="genre-page-header">
        <h1 class="genre-page-title"><span class="text-gradient">${esc(displayName)}</span></h1>
        <div class="genre-chips">
          <button class="genre-chip ${isAll ? 'active' : ''}" onclick="navigateTo('#/genre/all')">All</button>
          ${GENRES.map(g => `
            <button class="genre-chip ${g.toLowerCase() === genreName.toLowerCase() ? 'active' : ''}"
              onclick="navigateTo('#/genre/${encodeURIComponent(g)}')">${esc(g)}</button>
          `).join('')}
        </div>
      </div>

      ${filteredArtists.length ? `
        <div class="section-head">
          <span style="font-size:14px; color: var(--muted)">${filteredArtists.length} artist${filteredArtists.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="artist-grid">
          ${filteredArtists.map(artistCardHTML).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No artists found</h3>
          <p>No artists match the genre "${esc(genreName)}".</p>
        </div>
      `}
    </div>
  `;

  bindArtistCardKeys(main);
}

/* ---- CALENDAR ---- */
function renderCalendar(main) {
  if (!state.user) {
    main.innerHTML = `
      <div class="page">
        <div class="login-prompt">
          <div class="empty-icon">📅</div>
          <h2>Your Gig Calendar</h2>
          <p>Sign in and follow artists to see their upcoming gigs in a personalised calendar view.</p>
          <button class="btn btn-primary" onclick="showAuthModal()">Sign In to Continue</button>
        </div>
      </div>
    `;
    return;
  }

  if (!state.calendarMonth) {
    const now = new Date('2026-03-28');
    state.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  renderCalendarView(main);
}

function renderCalendarView(main, selectedDate = null) {
  const monthDate = state.calendarMonth;
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const monthName = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Build gig map for followed artists
  const followedGigMap = {};
  const followedArray = [...state.following];
  GIGS.forEach(g => {
    if (followedArray.includes(g.artistId)) {
      if (!followedGigMap[g.date]) followedGigMap[g.date] = [];
      followedGigMap[g.date].push(g);
    }
  });

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Mon = 0
  const daysInMonth = lastDay.getDate();

  const today = '2026-03-28';

  let daysHTML = '';
  // Leading blanks
  for (let i = 0; i < startDow; i++) {
    daysHTML += '<div class="cal-day other-month"></div>';
  }
  // Days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const gigs = followedGigMap[dateStr] || [];
    const isToday = dateStr === today;
    const isSelected = selectedDate === dateStr;

    const dots = gigs.map(g => {
      const artist = getArtist(g.artistId);
      const color = artist ? artist.color : '#8b5cf6';
      return `<div class="cal-dot" style="background: ${color}" title="${artist ? artist.name : ''}"></div>`;
    }).join('');

    daysHTML += `
      <div class="cal-day ${isToday ? 'today' : ''} ${gigs.length ? 'has-gigs' : ''} ${isSelected ? 'selected' : ''}"
        ${gigs.length ? `onclick="selectCalDate('${dateStr}')" role="button" tabindex="0"` : ''}>
        <div class="cal-day-num">${d}</div>
        ${dots ? `<div class="cal-dots">${dots}</div>` : ''}
      </div>
    `;
  }
  // Trailing blanks
  const totalCells = startDow + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < remaining; i++) {
    daysHTML += '<div class="cal-day other-month"></div>';
  }

  // Selected date gig details
  let gigDetailsHTML = '';
  if (selectedDate && followedGigMap[selectedDate]) {
    const dateGigs = followedGigMap[selectedDate];
    gigDetailsHTML = `
      <div class="cal-gig-details">
        <div class="cal-gig-details-title">Gigs on ${formatDate(selectedDate)}</div>
        <div class="gig-list">
          ${dateGigs.map(g => gigCardHTML(g, true)).join('')}
        </div>
      </div>
    `;
  }

  main.innerHTML = `
    <div class="page">
      <div class="calendar-page container">
        <div class="calendar-header">
          <h1 class="calendar-title"><span class="text-gradient">${esc(monthName)}</span></h1>
          <div class="cal-nav">
            <button class="cal-nav-btn" id="calPrev" aria-label="Previous month">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="cal-nav-btn" id="calNext" aria-label="Next month">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>

        ${state.following.size === 0 ? `
          <div class="empty-state" style="padding: 40px 0">
            <div class="empty-icon">🎸</div>
            <h3>Follow some artists first</h3>
            <p>Your calendar will show gigs from artists you follow.</p>
            <a href="#/genre/all" class="btn btn-primary" style="display: inline-flex; margin-top: 8px">Browse Artists</a>
          </div>
        ` : ''}

        <div class="calendar-grid">
          <div class="cal-weekdays">
            ${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<div class="cal-weekday">${d}</div>`).join('')}
          </div>
          <div class="cal-days">
            ${daysHTML}
          </div>
        </div>

        ${gigDetailsHTML}
      </div>
    </div>
  `;

  document.getElementById('calPrev').addEventListener('click', () => {
    state.calendarMonth = new Date(year, month - 1, 1);
    renderCalendarView(main, null);
  });
  document.getElementById('calNext').addEventListener('click', () => {
    state.calendarMonth = new Date(year, month + 1, 1);
    renderCalendarView(main, null);
  });

  // Make selectCalDate globally accessible for inline handlers
  window.selectCalDate = (dateStr) => {
    renderCalendarView(main, dateStr);
  };
}

/* ---- SEARCH ---- */
function renderSearch(query, main) {
  const q = (query || '').toLowerCase().trim();

  const matchArtists = q ? ARTISTS.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.genres.some(g => g.toLowerCase().includes(q)) ||
    a.bio.toLowerCase().includes(q)
  ) : [];

  const matchGigs = q ? GIGS.filter(g => {
    const artist = getArtist(g.artistId);
    const venue = getVenue(g.venueId);
    return (
      (artist && artist.name.toLowerCase().includes(q)) ||
      (venue && (venue.name.toLowerCase().includes(q) || venue.city.toLowerCase().includes(q)))
    );
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15) : [];

  const hasResults = matchArtists.length > 0 || matchGigs.length > 0;

  main.innerHTML = `
    <div class="page search-page">
      <h1>Search Results</h1>
      ${q ? `<p class="search-query-text">Showing results for <strong>"${esc(query)}"</strong></p>` : ''}

      ${!q ? `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>What are you looking for?</h3>
          <p>Search for an artist, venue, or genre using the bar above.</p>
        </div>
      ` : !hasResults ? `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No results found</h3>
          <p>We couldn't find anything matching "${esc(query)}". Try a different search.</p>
          <button class="btn btn-secondary mt-24" onclick="navigateTo('#/genre/all')">Browse All Artists</button>
        </div>
      ` : `
        ${matchArtists.length ? `
          <div class="section-head">
            <h2 class="section-title">Artists <span style="font-size:14px; font-weight:400; color: var(--muted)">(${matchArtists.length})</span></h2>
          </div>
          <div class="artist-grid mb-16">
            ${matchArtists.map(artistCardHTML).join('')}
          </div>
        ` : ''}

        ${matchGigs.length ? `
          <div class="section-head mt-32">
            <h2 class="section-title">Gigs <span style="font-size:14px; font-weight:400; color: var(--muted)">(${matchGigs.length})</span></h2>
          </div>
          <div class="gig-list">
            ${matchGigs.map(g => gigCardHTML(g, true)).join('')}
          </div>
        ` : ''}
      `}
    </div>
  `;

  bindArtistCardKeys(main);
}

/* ---- ARTIST IMAGE LOADING ---- */
async function loadArtistImages() {
  const els = document.querySelectorAll('[data-wikipedia]:not([data-img-loaded])');
  await Promise.all([...els].map(async el => {
    const title = el.dataset.wikipedia;
    el.dataset.imgLoaded = '1';

    if (!(title in imageCache)) {
      try {
        const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        const data = await res.json();
        imageCache[title] = data.thumbnail?.source || null;
      } catch { imageCache[title] = null; }
    }

    const url = imageCache[title];
    if (!url) return;

    if (el.dataset.heroBg) {
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center top';
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'artist-img';
      img.alt = '';
      img.loading = 'lazy';
      img.onload = () => {
        const initial = el.querySelector('.artist-initial');
        if (initial) initial.style.opacity = '0';
      };
      el.insertBefore(img, el.firstChild);
    }
  }));
}

/* ---- ACCESSIBILITY: Artist card keyboard nav ---- */
function bindArtistCardKeys(main) {
  main.querySelectorAll('.artist-card').forEach(card => {
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });
}

/* ---- INIT ---- */
async function init() {
  loadFollowingAndNotifs();

  // Restore Cognito session if one exists
  state.user = await getSessionUser();

  updateNavbar();
  renderNotifPanel();

  // Calendar month default
  state.calendarMonth = new Date(2026, 2, 1); // March 2026

  // Make showAuthModal global (used in inline handlers)
  window.showAuthModal = showAuthModal;
  window.navigateTo = navigateTo;

  // Run router
  router();
}

init();
