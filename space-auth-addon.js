// space-auth-addon.js
// Adds Firebase Auth + Firestore user profiles/roles + username editing + admin user management
// This file is meant to be loaded AFTER space-script_firebase_admin_updated.js

(function () {
  'use strict';

  const USERS_COLLECTION = 'users_v1';
  const ATTEMPTS_COLLECTION = 'examAttempts_v1';

  // Store chosen username during email sign-up (so we can reuse it after verification/login)
  const PENDING_USERNAME_KEY = 'spacePlatform_pendingUsername_v1';

  const HEARTBEAT_INTERVAL_MS = 30_000;

  // ===== Helpers =====
  function isReady() {
    return !!(window.firebaseAuth && window.authApi && window.firestoreDb && window.firestoreApi);
  }

  function api() {
    return window.firestoreApi;
  }
  function db() {
    return window.firestoreDb;
  }
  function auth() {
    return window.firebaseAuth;
  }

  function showEl(el, show) {
    if (!el) return;
    el.style.display = show ? '' : 'none';
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function nowMs() { return Date.now(); }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function getPendingUsername(email) {
    try {
      const raw = localStorage.getItem(PENDING_USERNAME_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const key = normalizeEmail(email);
      const val = obj?.[key];
      if (!val || typeof val !== 'string') return null;
      return val.trim() || null;
    } catch (e) {
      return null;
    }
  }

  function setPendingUsername(email, username) {
    try {
      const key = normalizeEmail(email);
      if (!key) return;
      const raw = localStorage.getItem(PENDING_USERNAME_KEY);
      const obj = raw ? (JSON.parse(raw) || {}) : {};
      obj[key] = String(username || '').trim();
      localStorage.setItem(PENDING_USERNAME_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  function consumePendingUsername(email) {
    try {
      const key = normalizeEmail(email);
      if (!key) return null;
      const raw = localStorage.getItem(PENDING_USERNAME_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw) || {};
      const val = obj?.[key];
      if (val) {
        delete obj[key];
        localStorage.setItem(PENDING_USERNAME_KEY, JSON.stringify(obj));
      }
      return typeof val === 'string' ? (val.trim() || null) : null;
    } catch (e) {
      return null;
    }
  }

  // ===== UI: Auth Gate =====
  function ensureAuthGate() {
    if (document.getElementById('authGate')) return;

    const gate = document.createElement('div');
    gate.id = 'authGate';
    gate.className = 'auth-gate';
    gate.innerHTML = `
      <div class="auth-card">
        <div class="auth-title">
          <i class="fas fa-lock"></i>
          <div>
            <h3>تسجيل الدخول</h3>
            <p>لازم تسجل دخول عشان نحفظ الاسم والنتايج على Firebase</p>
          </div>
        </div>

        <div class="auth-actions">
          <button type="button" class="auth-btn google" id="btnGoogleSignIn">
            <i class="fab fa-google"></i> دخول بجوجل
          </button>
        </div>

        <div class="auth-divider"><span>أو</span></div>

        <form class="auth-form" id="emailAuthForm">
          <div class="auth-field">
            <label>الإيميل</label>
            <input type="email" id="authEmail" autocomplete="email" required placeholder="name@example.com">
          </div>
          <div class="auth-field">
            <label>كلمة المرور</label>
            <input type="password" id="authPassword" autocomplete="current-password" required placeholder="********">
          </div>

          <div class="auth-field">
            <label>اسم المستخدم <span style="opacity:.8; font-weight:600;">(مطلوب عند إنشاء حساب)</span></label>
            <input type="text" id="authUsername" autocomplete="username" placeholder="مثال: أحمد محمد">
          </div>

          <div class="auth-actions two">
            <button type="submit" class="auth-btn primary" id="btnEmailSignIn">
              <i class="fas fa-right-to-bracket"></i> تسجيل دخول
            </button>
            <button type="button" class="auth-btn secondary" id="btnEmailSignUp">
              <i class="fas fa-user-plus"></i> إنشاء حساب
            </button>
          </div>

          <div class="auth-note" id="authNote" style="display:none;"></div>
          <button type="button" class="auth-btn link" id="btnResendVerify" style="display:none;">
            إعادة إرسال رسالة التفعيل
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(gate);

    // bind
    const btnGoogle = gate.querySelector('#btnGoogleSignIn');
    const emailForm = gate.querySelector('#emailAuthForm');
    const btnSignUp = gate.querySelector('#btnEmailSignUp');
    const btnResend = gate.querySelector('#btnResendVerify');

    btnGoogle.addEventListener('click', signInWithGoogle);
    emailForm.addEventListener('submit', (e) => { e.preventDefault(); signInWithEmail(); });
    btnSignUp.addEventListener('click', signUpWithEmail);
    btnResend.addEventListener('click', resendVerificationEmail);
  }

  function setAuthNote(message, type = 'info', showResend = false) {
    const note = document.getElementById('authNote');
    const resend = document.getElementById('btnResendVerify');
    if (!note) return;
    note.style.display = message ? 'block' : 'none';
    note.className = `auth-note ${type}`;
    note.textContent = message || '';
    if (resend) resend.style.display = showResend ? 'inline-flex' : 'none';
  }

  function lockGateUi(locked) {
    const gate = document.getElementById('authGate');
    if (!gate) return;
    gate.querySelectorAll('button, input').forEach(el => {
      el.disabled = !!locked;
    });
  }

  async function signInWithGoogle() {
    if (!isReady()) return;
    try {
      lockGateUi(true);
      setAuthNote('', 'info', false);

      const provider = new window.authApi.GoogleAuthProvider();
      await window.authApi.signInWithPopup(auth(), provider);
    } catch (e) {
      console.error(e);
      setAuthNote('فشل تسجيل الدخول بجوجل. تأكد من الإعدادات وجرّب تاني.', 'error', false);
    } finally {
      lockGateUi(false);
    }
  }

  async function signUpWithEmail() {
    if (!isReady()) return;
    const email = String(document.getElementById('authEmail')?.value || '').trim();
    const password = String(document.getElementById('authPassword')?.value || '').trim();
    const usernameRaw = String(document.getElementById('authUsername')?.value || '').trim();

    if (!email || !password || password.length < 6) {
      setAuthNote('اكتب إيميل صحيح وباسورد 6 حروف على الأقل.', 'error', false);
      return;
    }

    const usernameClean = filterName(usernameRaw);
    if (!usernameClean) {
      setAuthNote('اكتب اسم مستخدم صحيح (حروف عربي/إنجليزي + مسافات فقط) عشان ننشئ الحساب.', 'error', false);
      return;
    }

    try {
      lockGateUi(true);
      setAuthNote('', 'info', false);

      const cred = await window.authApi.createUserWithEmailAndPassword(auth(), email, password);

      // احفظ الاسم المختار محلياً كـ fallback (لو الـ Rules منعت الكتابة قبل التفعيل)
      setPendingUsername(email, usernameClean);

      // اكتب بروفايل المستخدم فوراً (قبل تسجيل الخروج)
      try {
        await upsertProfile(cred.user.uid, {
          uid: cred.user.uid,
          email,
          username: usernameClean,
          role: 'student',
          createdAtMs: nowMs(),
          createdAt: api().serverTimestamp(),
          lastSeenMs: nowMs(),
          lastSeen: api().serverTimestamp()
        });
        // لو نجحنا في كتابة البروفايل، امسح الـ pending
        consumePendingUsername(email);
      } catch (e) {
        // سيب الـ pending؛ هيتاخد تلقائياً أول مرة يسجل دخول بعد التفعيل
      }

      // إرسال تفعيل
      await window.authApi.sendEmailVerification(cred.user);
      setAuthNote('تم إنشاء الحساب ✅ .. لازم تفتح الإيميل وتعمل تفعيل وبعدين تسجل دخول.', 'success', true);

      // خروج لحين التفعيل
      await window.authApi.signOut(auth());
    } catch (e) {
      console.error(e);
      setAuthNote('فشل إنشاء الحساب. ممكن الإيميل مستخدم قبل كده أو الباسورد ضعيف.', 'error', false);
    } finally {
      lockGateUi(false);
    }
  }

  async function signInWithEmail() {
    if (!isReady()) return;
    const email = String(document.getElementById('authEmail')?.value || '').trim();
    const password = String(document.getElementById('authPassword')?.value || '').trim();

    if (!email || !password) {
      setAuthNote('اكتب الإيميل والباسورد.', 'error', false);
      return;
    }

    try {
      lockGateUi(true);
      setAuthNote('', 'info', false);

      const cred = await window.authApi.signInWithEmailAndPassword(auth(), email, password);

      if (cred.user && !cred.user.emailVerified) {
        setAuthNote('لازم تفعّل الإيميل الأول. افتح الرسالة اللي اتبعتت لك.', 'error', true);
        await window.authApi.signOut(auth());
        return;
      }
    } catch (e) {
      console.error(e);
      setAuthNote('بيانات الدخول غلط أو الحساب مش موجود.', 'error', false);
    } finally {
      lockGateUi(false);
    }
  }

  async function resendVerificationEmail() {
    if (!isReady()) return;
    const email = String(document.getElementById('authEmail')?.value || '').trim();
    const password = String(document.getElementById('authPassword')?.value || '').trim();
    if (!email || !password) {
      setAuthNote('اكتب الإيميل والباسورد الأول عشان أقدر أرسل التفعيل.', 'error', false);
      return;
    }

    try {
      lockGateUi(true);
      setAuthNote('', 'info', false);

      const cred = await window.authApi.signInWithEmailAndPassword(auth(), email, password);
      if (cred.user?.emailVerified) {
        setAuthNote('الإيميل متفعّل بالفعل ✅', 'success', false);
        return;
      }
      await window.authApi.sendEmailVerification(cred.user);
      setAuthNote('تم إرسال رسالة تفعيل جديدة ✅', 'success', true);
      await window.authApi.signOut(auth());
    } catch (e) {
      console.error(e);
      setAuthNote('تعذر إرسال رسالة التفعيل. اتأكد من الإيميل والباسورد.', 'error', false);
    } finally {
      lockGateUi(false);
    }
  }

  // ===== Profile / Role =====
  let currentProfile = null;
  let profileUnsub = null;
  let heartbeatTimer = null;

  async function getProfile(uid) {
    const ref = api().doc(db(), USERS_COLLECTION, uid);
    const snap = await api().getDoc(ref);
    return snap.exists() ? snap.data() : null;
  }

  async function upsertProfile(uid, payload) {
    const ref = api().doc(db(), USERS_COLLECTION, uid);
    await api().setDoc(ref, payload, { merge: true });
  }

  function filterName(name) {
    // reuse existing filterName if present
    if (typeof window.filterName === 'function') {
      return window.filterName(name);
    }
    const s = String(name || '').replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > 40) return null;
    const valid = /^[\u0600-\u06FFa-zA-Z ]+$/;
    if (!valid.test(s)) return null;
    return s;
  }

  async function promptUsername() {
    const modal = document.getElementById('nameModal');
    const input = document.getElementById('firstNameInput');

    // tweak copy to be "اسم المستخدم"
    try {
      const title = modal?.querySelector('h2');
      if (title) title.innerHTML = `<i class="fas fa-user"></i> اسم المستخدم`;
      const p = modal?.querySelector('.modal-body p');
      if (p) p.innerHTML = 'اكتب <b>اسمك</b> اللي هيظهر في المنصة والامتحانات.';
      const label = modal?.querySelector('label[for="firstNameInput"]');
      if (label) label.textContent = 'اسم المستخدم';
      const btn = modal?.querySelector('.save-btn');
      if (btn) btn.innerHTML = `<i class="fas fa-save"></i> حفظ`;
    } catch (e) {}

    // IMPORTANT FIX:
    // اسم المستخدم modal في الـ HTML عنده onclick/onkeydown بتستدعي verifyFirstNameAndContinue().
    // في النسخة السابقة كنا بنعتمد على addEventListener للـ save button فقط.
    // لو المستخدم ضغط Enter (أو حتى لو الـ onclick اشتغل قبل listener في بعض المتصفحات)
    // الـ Promise كانت بتفضل معلّقة، فيبان كأنه "واقف".
    // الحل: نعمل override مؤقت لـ verifyFirstNameAndContinue عشان أي حفظ (زرار/Enter) يحل الـ Promise.

    return await new Promise((resolve) => {
      // fallback
      if (!modal || !input) {
        const raw = prompt('اكتب اسم المستخدم:');
        const clean = filterName(raw);
        resolve(clean);
        return;
      }

      const cancelBtn = modal.querySelector('.settings-action.secondary');
      const closeBtn = modal.querySelector('.close-modal');

      const originalVerify = window.verifyFirstNameAndContinue;

      const restore = () => {
        try { window.verifyFirstNameAndContinue = originalVerify; } catch (e) {}
        try { cancelBtn?.removeEventListener('click', onCancel); } catch (e) {}
        try { closeBtn?.removeEventListener('click', onCancel); } catch (e) {}
      };

      const onCancel = () => {
        restore();
        if (typeof window.closeModal === 'function') window.closeModal('nameModal');
        resolve(null);
      };

      // Override: called by both Save button onclick and input Enter keydown
      window.verifyFirstNameAndContinue = function () {
        const raw = String(input?.value || '').trim();
        if (!raw) {
          if (typeof window.showAlert === 'function') window.showAlert('من فضلك اكتب اسم المستخدم.', 'error');
          input?.focus?.();
          return;
        }
        const clean = filterName(raw);
        if (!clean) {
          if (typeof window.showAlert === 'function') {
            window.showAlert('الاسم غير مناسب. استخدم حروف فقط (عربي/إنجليزي) مع مسافات، بدون أرقام/رموز.', 'error');
          }
          input?.select?.();
          return;
        }

        // حافظ على السلوك القديم (تخزين محلي + تحديث UI) لو موجود
        try { if (typeof window.setSavedFirstName === 'function') window.setSavedFirstName(clean); } catch (e) {}

        restore();
        if (typeof window.closeModal === 'function') window.closeModal('nameModal');
        resolve(clean);
      };

      // show modal
      modal.style.display = 'flex';
      input.value = '';
      setTimeout(() => input.focus(), 80);

      cancelBtn?.addEventListener('click', onCancel);
      closeBtn?.addEventListener('click', onCancel);
    });
  }

  function applyProfileToLocalUser() {
    if (!currentProfile) return;
    if (!window.appData) return;

    // Ensure object exists
    if (typeof window.ensureCurrentUserObject === 'function') window.ensureCurrentUserObject();

    window.appData.currentUser.name = currentProfile.username || window.appData.currentUser.name;
    window.appData.currentUser.email = currentProfile.email || window.appData.currentUser.email;
    window.appData.currentUser.role = currentProfile.role || window.appData.currentUser.role;

    // Keep old localStorage key for compatibility
    try {
      localStorage.setItem('spacePlatform_firstName_v1', currentProfile.username || '');
    } catch (e) {}

    // Persist userData
    try {
      localStorage.setItem('spacePlatform_userData', JSON.stringify(window.appData.currentUser));
    } catch (e) {}

    // Update UI
    updateUserMenuUI();
    refreshAllUiAfterUsernameChange();
  }

  function refreshAllUiAfterUsernameChange() {
    try { if (typeof window.updateLeaderboardDisplay === 'function') window.updateLeaderboardDisplay(); } catch (e) {}
    try { if (typeof window.loadPreviousResults === 'function') window.loadPreviousResults(); } catch (e) {}
    // Many screens read name live from appData.currentUser, so this is enough.
  }

  function startHeartbeat(uid) {
    stopHeartbeat();
    heartbeatTimer = setInterval(async () => {
      try {
        await api().updateDoc(api().doc(db(), USERS_COLLECTION, uid), {
          lastSeenMs: nowMs(),
          lastSeen: api().serverTimestamp()
        });
      } catch (e) {
        // ignore
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  async function ensureProfile(user) {
    const uid = user.uid;
    const email = user.email || '';

    // live subscription so admin table updates quickly
    if (profileUnsub) {
      try { profileUnsub(); } catch (e) {}
      profileUnsub = null;
    }

    const ref = api().doc(db(), USERS_COLLECTION, uid);
    profileUnsub = api().onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() || {};
      currentProfile = normalizeProfile(uid, d, email);
      window.currentProfile = currentProfile;
      applyProfileToLocalUser();
      applyRoleToUi();
    });

    // ensure doc exists
    let existing = null;
    try { existing = await getProfile(uid); } catch (e) { existing = null; }

    // If no profile or missing username -> use pending username from signup, otherwise prompt
    let username = existing?.username;
    if (!username) {
      const pending = consumePendingUsername(email);
      if (pending) username = pending;
    }
    if (!username) {
      username = await promptUsername();
      if (!username) username = 'مستخدم';
    }

    // default role
    const payload = {
      uid,
      email,
      username,
      role: existing?.role || 'student',
      createdAtMs: existing?.createdAtMs || nowMs(),
      createdAt: existing?.createdAt || api().serverTimestamp(),
      lastSeenMs: nowMs(),
      lastSeen: api().serverTimestamp()
    };

    try {
      await upsertProfile(uid, payload);
    } catch (e) {
      console.error('Failed to write users_v1 profile:', e);
      if (typeof window.showAlert === 'function') {
        window.showAlert('مش قادر أسجل بيانات المستخدم في Firestore. راجع Firestore Rules.', 'error');
      }
    }

    startHeartbeat(uid);
  }

  function normalizeProfile(uid, d, fallbackEmail) {
    return {
      uid,
      email: String(d.email || fallbackEmail || '').trim(),
      username: String(d.username || '').trim(),
      role: String(d.role || 'student').trim(),
      examState: d.examState || null,
      currentExam: d.currentExam || null,
      lastSeenMs: typeof d.lastSeenMs === 'number' ? d.lastSeenMs : null
    };
  }

  // ===== User menu =====
  function updateUserMenuUI() {
    const menu = document.getElementById('userMenu');
    const nameEl = document.getElementById('displayUserName');
    if (!menu || !nameEl) return;

    if (!currentProfile) {
      menu.style.display = 'none';
      return;
    }
    menu.style.display = '';
    nameEl.textContent = currentProfile.username || '—';
  }

  function attachUserMenuHandlers() {
    const btn = document.getElementById('userMenuBtn');
    const dd = document.getElementById('userDropdown');
    const editBtn = document.getElementById('editUsernameBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if (btn && dd) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dd.style.display = (dd.style.display === 'none' || !dd.style.display) ? 'block' : 'none';
      });
      document.addEventListener('click', () => { dd.style.display = 'none'; });
    }

    if (editBtn) {
      editBtn.addEventListener('click', async () => {
        if (!currentProfile) return;
        const newName = await promptUsername();
        if (!newName) return;
        await setUsernameForCurrentUser(newName);
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try { await window.authApi.signOut(auth()); } catch (e) {}
      });
    }
  }

  async function setUsernameForCurrentUser(newName) {
    const clean = filterName(newName);
    if (!clean) {
      if (typeof window.showAlert === 'function') window.showAlert('الاسم غير مناسب.', 'error');
      return;
    }
    if (!currentProfile) return;

    try {
      await api().updateDoc(api().doc(db(), USERS_COLLECTION, currentProfile.uid), {
        username: clean,
        usernameUpdatedAtMs: nowMs(),
        usernameUpdatedAt: api().serverTimestamp()
      });
    } catch (e) {
      console.error(e);
      if (typeof window.showAlert === 'function') window.showAlert('فشل تحديث الاسم في Firestore.', 'error');
      return;
    }

    // Update latest attempts docs (best-effort)
    try {
      const q = api().query(
        api().collection(db(), ATTEMPTS_COLLECTION),
        api().where('uid', '==', currentProfile.uid),
        api().orderBy('createdAtMs', 'desc'),
        api().limit(200)
      );
      const snap = await api().getDocs(q);
      const updates = [];
      snap.forEach((docSnap) => {
        updates.push(api().updateDoc(api().doc(db(), ATTEMPTS_COLLECTION, docSnap.id), { name: clean, username: clean }));
      });
      await Promise.allSettled(updates);
    } catch (e) {
      // ignore
    }

    if (typeof window.showAlert === 'function') window.showAlert('تم تحديث الاسم ✅', 'success');
  }

  // override getEffectiveUserName to always use profile
  function overrideNameGetter() {
    window.getEffectiveUserName = function () {
      const u = window.currentProfile?.username;
      if (u) return String(u).trim();
      // fallback to local
      const saved = String(localStorage.getItem('spacePlatform_firstName_v1') || '').trim();
      if (saved) return saved;
      return '';
    };
  }

  // ===== Attempt saving override: add uid/email/username =====
  function overrideAttemptSaving() {
    const original = window.saveAttemptToFirestore;
    window.saveAttemptToFirestore = async function (attempt) {
      try {
        if (!isReady()) return false;

        const user = auth().currentUser;
        if (!user) {
          console.warn('No auth user; attempt not saved');
          return false;
        }
        const payload = {
          ...(attempt || {}),
          uid: user.uid,
          email: user.email || '',
          username: window.currentProfile?.username || (attempt?.name ?? ''),
          // keep old "name" for compatibility
          name: attempt?.name || window.currentProfile?.username || 'مستخدم',
          createdAtMs: nowMs(),
          createdAt: api().serverTimestamp()
        };

        await api().addDoc(api().collection(db(), ATTEMPTS_COLLECTION), payload);
        return true;
      } catch (e) {
        console.error('Firestore save failed:', e);
        return false;
      }
    };

    // keep a reference if needed
    window._saveAttemptToFirestore_original = original;
  }

  // ===== Exam state tracking =====
  async function markExamState(state, meta) {
    if (!currentProfile) return;
    try {
      const update = {
        examState: state,
        lastSeenMs: nowMs(),
        lastSeen: api().serverTimestamp()
      };
      if (state === 'in_progress') {
        update.currentExam = {
          ...meta,
          startedAtMs: nowMs(),
          startedAt: api().serverTimestamp()
        };
      } else {
        update.currentExam = null;
        update.lastExam = {
          ...meta,
          endedAtMs: nowMs(),
          endedAt: api().serverTimestamp()
        };
      }
      await api().updateDoc(api().doc(db(), USERS_COLLECTION, currentProfile.uid), update);
    } catch (e) {
      // ignore
    }
  }

  function wrapExamFunctions() {
    // startChallenge
    if (typeof window.startChallenge === 'function') {
      const orig = window.startChallenge;
      window.startChallenge = function () {
        markExamState('in_progress', { type: 'challenge', subject: (typeof window.getChallengeSubjectName === 'function' ? window.getChallengeSubjectName() : 'challenge') });
        return orig.apply(this, arguments);
      };
    }

    // startQuickExamInternal
    if (typeof window.startQuickExamInternal === 'function') {
      const orig = window.startQuickExamInternal;
      window.startQuickExamInternal = function () {
        markExamState('in_progress', { type: 'quick', subject: window.appData?.activeExam?.subject || 'quick' });
        return orig.apply(this, arguments);
      };
    }

    // startSubjectExam
    if (typeof window.startSubjectExam === 'function') {
      const orig = window.startSubjectExam;
      window.startSubjectExam = function (subject) {
        markExamState('in_progress', { type: 'subject', subject: subject || 'subject' });
        return orig.apply(this, arguments);
      };
    }

    // finishExam
    if (typeof window.finishExam === 'function') {
      const orig = window.finishExam;
      window.finishExam = function () {
        try {
          const meta = {
            type: window.appData?.activeExam?.type || 'exam',
            subject: window.appData?.activeExam?.subject || ''
          };
          markExamState('idle', meta);
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    }

    // submitChallenge
    if (typeof window.submitChallenge === 'function') {
      const orig = window.submitChallenge;
      window.submitChallenge = function () {
        markExamState('idle', { type: 'challenge', subject: (typeof window.getChallengeSubjectName === 'function' ? window.getChallengeSubjectName() : 'challenge') });
        return orig.apply(this, arguments);
      };
    }
  }

  // ===== Admin: role-based UI + users table =====
  function isAdmin() {
    return (currentProfile?.role || '').toLowerCase() === 'admin';
  }

  function applyRoleToUi() {
    // Hide settings button for students
    const settingsButtons = Array.from(document.querySelectorAll('.nav-btn'))
      .filter(b => (b.textContent || '').includes('الإعدادات'));
    settingsButtons.forEach(btn => {
      btn.style.display = isAdmin() ? '' : 'none';
    });
    // Also hide any hero/settings buttons
    document.querySelectorAll('.action-btn.settings-btn').forEach(btn => btn.style.display = isAdmin() ? '' : 'none');

    // settings section lock screen
    const lockedScreen = document.getElementById('settingsLockedScreen');
    const content = document.getElementById('settingsContent');
    if (lockedScreen && content) {
      if (isAdmin()) {
        lockedScreen.style.display = 'none';
        content.style.display = 'block';
      } else {
        lockedScreen.style.display = 'block';
        content.style.display = 'none';
        // update copy
        const h3 = lockedScreen.querySelector('h3');
        const p = lockedScreen.querySelector('p');
        if (h3) h3.textContent = 'الإعدادات للأدمن فقط';
        if (p) p.textContent = 'لو انت طالب، زر الإعدادات مش هيظهر لك. لو محتاج صلاحية كلم الأدمن.';
        const btn = lockedScreen.querySelector('button');
        if (btn) btn.style.display = 'none';
      }
    }

    // enable/disable admin edit controls
    document.querySelectorAll('[data-admin-edit="challenge"]').forEach(el => {
      if (isAdmin()) {
        el.removeAttribute('disabled');
        el.classList.remove('disabled-by-role');
      } else {
        el.setAttribute('disabled', 'disabled');
        el.classList.add('disabled-by-role');
      }
    });

    // Remove old admin code gate visuals
    const gateBar = document.getElementById('adminGateBar');
    if (gateBar) gateBar.style.display = isAdmin() ? 'none' : 'none';
    const adminModal = document.getElementById('adminAccessModal');
    if (adminModal) adminModal.style.display = 'none';
  }

  function overrideAdminRequirement() {
    // Replace requireAdminForChallengeEdit to use role
    window.requireAdminForChallengeEdit = function () {
      if (isAdmin()) return true;
      if (typeof window.showAlert === 'function') {
        window.showAlert('الوظيفة دي للأدمن فقط.', 'error');
      }
      return false;
    };
  }

  function hideOldAttemptsCard() {
    // hide the "سجل الامتحانات" card (we replace it with users management)
    const container = document.getElementById('adminAttemptsContainer');
    if (!container) return;
    let card = container;
    while (card && card !== document.body) {
      if (card.classList && card.classList.contains('settings-card')) break;
      card = card.parentElement;
    }
    if (card) card.style.display = 'none';
  }

  function ensureAdminUsersCard() {
    const settingsContent = document.getElementById('settingsContent');
    if (!settingsContent) return;

    if (document.getElementById('adminUsersCard')) return;

    const card = document.createElement('div');
    card.className = 'settings-card';
    card.id = 'adminUsersCard';
    card.innerHTML = `
      <div class="settings-card-header">
        <h3><i class="fas fa-users-gear"></i> إدارة المستخدمين (للأدمن)</h3>
        <div class="questions-count" id="adminUsersCount">--</div>
      </div>
      <p class="settings-note">
        هنا هتلاقي كل المستخدمين اللي سجلوا في الموقع (الاسم، الإيميل، الدور، وحالة الامتحان).
        <br><b>مهم:</b> كلمة المرور مش ممكن تظهر من Firebase (أمانياً غير متاحة).
      </p>

      <div class="settings-actions">
        <button class="settings-action secondary" id="adminUsersRefreshBtn" type="button">
          <i class="fas fa-rotate"></i> تحديث
        </button>
      </div>

      <div class="admin-users-container" id="adminUsersContainer">
        <div class="settings-note" id="adminUsersStatus">—</div>

        <div class="admin-attempts-table-wrap">
          <table class="leaderboard-table admin-users-table">
            <thead>
              <tr>
                <th>#</th>
                <th>الاسم</th>
                <th>الإيميل</th>
                <th>الدور</th>
                <th>حالة الامتحان</th>
                <th>آخر ظهور</th>
                <th>إجراء</th>
              </tr>
            </thead>
            <tbody id="adminUsersTableBody"></tbody>
          </table>
        </div>
      </div>
    `;

    settingsContent.appendChild(card);

    const btn = document.getElementById('adminUsersRefreshBtn');
    if (btn) btn.addEventListener('click', () => loadUsersTable(true));
  }

  function formatLastSeen(ms) {
    if (!ms) return '—';
    const diff = Math.max(0, nowMs() - ms);
    const sec = Math.floor(diff / 1000);
    if (sec < 15) return 'الآن';
    if (sec < 60) return `منذ ${sec} ثانية`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `منذ ${min} دقيقة`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `منذ ${hr} ساعة`;
    const d = Math.floor(hr / 24);
    return `منذ ${d} يوم`;
  }

  function formatExamState(userDoc) {
    const state = String(userDoc?.examState || 'idle');
    if (state === 'in_progress') {
      const ex = userDoc?.currentExam;
      const type = ex?.type ? `(${ex.type})` : '';
      const subj = ex?.subject ? `- ${ex.subject}` : '';
      return `بيمتحن الآن ${type} ${subj}`.trim();
    }
    return 'مش بيمتحن';
  }

  async function loadUsersTable(showMessages) {
    if (!isAdmin()) return;

    const status = document.getElementById('adminUsersStatus');
    const tbody = document.getElementById('adminUsersTableBody');
    const countEl = document.getElementById('adminUsersCount');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (status) status.textContent = 'جاري التحميل...';

    try {
      // Simple read (no orderBy to avoid index needs)
      const snap = await api().getDocs(api().collection(db(), USERS_COLLECTION));
      const rows = [];
      snap.forEach(docSnap => rows.push({ id: docSnap.id, ...docSnap.data() }));

      // Sort by createdAtMs desc if exists
      rows.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

      if (countEl) countEl.textContent = `عدد المستخدمين: ${rows.length}`;

      rows.forEach((u, idx) => {
        const role = String(u.role || 'student');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td>${escapeHtml(u.username || '—')}</td>
          <td>${escapeHtml(u.email || '—')}</td>
          <td><span class="role-pill ${role === 'admin' ? 'admin' : 'student'}">${escapeHtml(role)}</span></td>
          <td>${escapeHtml(formatExamState(u))}</td>
          <td>${escapeHtml(formatLastSeen(u.lastSeenMs))}</td>
          <td>
            <button type="button" class="role-toggle-btn" data-uid="${escapeHtml(u.uid || docSnapSafeId(u))}" data-role="${escapeHtml(role)}">
              ${role === 'admin' ? 'خليه Student' : 'خليه Admin'}
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind toggle buttons
      tbody.querySelectorAll('.role-toggle-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.getAttribute('data-uid');
          const current = btn.getAttribute('data-role');
          const next = (String(current).toLowerCase() === 'admin') ? 'student' : 'admin';
          await setUserRole(uid, next);
          await loadUsersTable(false);
        });
      });

      if (status) status.textContent = rows.length ? 'جاهز ✅' : 'مفيش مستخدمين لسه.';
    } catch (e) {
      console.error(e);
      if (status) status.textContent = 'تعذر تحميل المستخدمين. راجع Firestore Rules.';
      if (showMessages && typeof window.showAlert === 'function') {
        window.showAlert('مش قادر أقرأ users_v1 من Firestore. راجع الـ Rules.', 'error');
      }
    }
  }

  function docSnapSafeId(u) {
    return String(u.id || '').trim();
  }

  async function setUserRole(uid, role) {
    if (!uid) return;
    if (!isAdmin()) return;

    try {
      await api().updateDoc(api().doc(db(), USERS_COLLECTION, uid), {
        role: role,
        roleUpdatedAtMs: nowMs(),
        roleUpdatedAt: api().serverTimestamp(),
        roleUpdatedBy: currentProfile?.uid || null
      });
      if (typeof window.showAlert === 'function') window.showAlert('تم تحديث الدور ✅', 'success');
    } catch (e) {
      console.error(e);
      if (typeof window.showAlert === 'function') window.showAlert('فشل تحديث الدور. راجع Rules.', 'error');
    }
  }

  // ===== Auth state listener =====
  function bindAuthState() {
    if (!isReady()) return;

    window.authApi.onAuthStateChanged(auth(), async (user) => {
      ensureAuthGate();

      const mainPlatform = document.getElementById('mainPlatform');
      if (!user) {
        // signed out
        currentProfile = null;
        window.currentProfile = null;

        // hide platform
        if (mainPlatform) mainPlatform.style.display = 'none';
        document.getElementById('authGate').style.display = 'flex';
        updateUserMenuUI();
        applyRoleToUi();

        stopHeartbeat();
        if (profileUnsub) { try { profileUnsub(); } catch (e) {} profileUnsub = null; }
        return;
      }

      // if email/password and not verified -> block
      if (user.providerData?.some(p => p.providerId === 'password') && !user.emailVerified) {
        if (mainPlatform) mainPlatform.style.display = 'none';
        document.getElementById('authGate').style.display = 'flex';
        setAuthNote('لازم تفعّل الإيميل الأول.', 'error', true);
        return;
      }

      // signed in
      document.getElementById('authGate').style.display = 'none';
      if (mainPlatform) mainPlatform.style.display = 'block';

      await ensureProfile(user);

      // initial admin card / table
      hideOldAttemptsCard();
      ensureAdminUsersCard();
      applyRoleToUi();
      if (isAdmin()) loadUsersTable(false);
    });
  }

  // ===== Init =====
  function init() {
    ensureAuthGate();
    attachUserMenuHandlers();
    overrideNameGetter();
    overrideAttemptSaving();
    wrapExamFunctions();
    overrideAdminRequirement();

    // Hide platform until auth state resolves
    const mainPlatform = document.getElementById('mainPlatform');
    if (mainPlatform) mainPlatform.style.display = 'none';

    // Close dropdown if exists
    const dd = document.getElementById('userDropdown');
    if (dd) dd.style.display = 'none';

    bindAuthState();
  }

  // Wait for APIs to exist
  function waitForFirebaseAndInit() {
    const started = Date.now();
    const timer = setInterval(() => {
      if (isReady()) {
        clearInterval(timer);
        init();
      } else if (Date.now() - started > 8000) {
        clearInterval(timer);
        console.error('Firebase APIs not ready. Check index.html module imports.');
      }
    }, 50);
  }

  // Kick
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForFirebaseAndInit);
  } else {
    waitForFirebaseAndInit();
  }
})();
