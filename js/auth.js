import { db } from './supabase.js';
import { el, state, setSelectedDetails } from './state.js';
import { clearMsg, safe, showMsg } from './utils.js';

export function createAuthModule({ loadAllData }) {
  function isStaff() {
    return state.roles.some(role => ['admin', 'operator'].includes(safe(role).toLowerCase()));
  }

  async function loadProfileAndRoles(userId) {
    const [profileRes, rolesRes] = await Promise.all([
      db.from('profiles').select('*').eq('id', userId).maybeSingle(),
      db.from('user_roles').select('role').eq('user_id', userId)
    ]);

    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;

    state.profile = profileRes.data || null;
    state.roles = (rolesRes.data || []).map(item => item.role);
  }

  function renderAppShell(loggedIn) {
    if (!el.authView || !el.appView) return;

    if (loggedIn) {
      el.authView.classList.add('hidden');
      el.appView.classList.remove('hidden');
      return;
    }

    el.appView.classList.add('hidden');
    el.authView.classList.remove('hidden');
  }

  function setAuthButtonsDisabled(disabled) {
    if (el.signInBtn) el.signInBtn.disabled = disabled;
    if (el.signUpBtn) el.signUpBtn.disabled = disabled;
  }

  async function applySession(session) {
    state.session = session || null;

    if (!session) {
      state.profile = null;
      state.roles = [];
      setSelectedDetails();
      renderAppShell(false);
      return;
    }

    await loadProfileAndRoles(session.user.id);

    if (!isStaff()) {
      await db.auth.signOut({ scope: 'local' });
      state.session = null;
      state.profile = null;
      state.roles = [];
      renderAppShell(false);
      showMsg(el.msg, 'This account does not have admin/operator access.');
      return;
    }

    renderAppShell(true);

    if (el.userEmail) {
      el.userEmail.textContent = state.profile?.email || session.user?.email || '';
    }

    await loadAllData();
  }

  async function signUp() {
    clearMsg(el.msg);

    const email = safe(el.email?.value);
    const password = safe(el.password?.value);

    if (!email || !password) {
      showMsg(el.msg, 'Enter email and password.');
      return;
    }

    setAuthButtonsDisabled(true);

    try {
      const { data, error } = await db.auth.signUp({ email, password });

      if (error) {
        showMsg(el.msg, error.message);
        return;
      }

      if (data?.session) {
        showMsg(el.msg, 'Account created successfully.', 'success');
        await loadSessionAndData();
      } else {
        showMsg(el.msg, 'Account created. Confirm email if required, then sign in.', 'success');
      }
    } catch (error) {
      showMsg(el.msg, error.message || 'Sign up failed.');
    } finally {
      setAuthButtonsDisabled(false);
    }
  }

  async function signIn() {
    clearMsg(el.msg);

    const email = safe(el.email?.value);
    const password = safe(el.password?.value);

    if (!email || !password) {
      showMsg(el.msg, 'Enter email and password.');
      return;
    }

    setAuthButtonsDisabled(true);

    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });

      if (error) {
        showMsg(el.msg, error.message);
        return;
      }

      clearMsg(el.msg);
      await applySession(data?.session || null);
    } catch (error) {
      showMsg(el.msg, error.message || 'Sign in failed.');
    } finally {
      setAuthButtonsDisabled(false);
    }
  }

  async function signOut() {
    try {
      await db.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error('signOut error:', error);
    }

    state.session = null;
    state.profile = null;
    state.roles = [];
    setSelectedDetails();

    renderAppShell(false);
    clearMsg(el.appMsg);
    clearMsg(el.msg);
  }

  async function loadSessionAndData() {
    clearMsg(el.appMsg);

    try {
      const { data, error } = await db.auth.getSession();

      if (error) {
        showMsg(el.msg, error.message || 'Session load failed.');
        return;
      }

      await applySession(data?.session || null);
    } catch (error) {
      console.error(error);
      showMsg(el.appMsg || el.msg, error.message || 'Session load failed.');
    }
  }

  return {
    applySession,
    isStaff,
    loadSessionAndData,
    renderAppShell,
    signIn,
    signOut,
    signUp
  };
}
