// ════════════════════════════════════════════════════════════════
// FITFLOW PRO — Push Notification Manager (Pure VAPID, no Firebase)
//
// HOW THIS WORKS:
//   • VAPID public key lives here in client code — this is SAFE.
//     Public keys are meant to be public.
//   • VAPID private key lives ONLY in Apps Script → Project Settings
//     → Script Properties as "VAPID_PRIVATE_KEY". Never in code.
//     Never in git. Never anywhere visible.
//   • Apps Script signs and sends push directly to each browser's
//     push endpoint (Chrome/Firefox/Edge all have their own).
//     No Firebase. No FCM. No service account JSON.
//
// TO SET UP (one time only):
//   1. Go to your Apps Script project
//   2. Project Settings (⚙️) → Script Properties
//   3. Add property: VAPID_PRIVATE_KEY = <the private key>
//   4. Add property: VAPID_SUBJECT = mailto:admin@fitflow.com
//      (replace with your actual admin email)
//   5. Paste the new google-apps-script.js backend code
//   6. Redeploy as New Version
// ════════════════════════════════════════════════════════════════

const PUSH = {

  // ✅ SAFE TO BE PUBLIC — this is a VAPID public key, not a secret.
  // It is mathematically paired with the private key that sits only
  // in Apps Script Script Properties, never in any source file.
  VAPID_PUBLIC_KEY: 'BHpguNhH05jGBBHaj0oU5LNYKvOlyrz0xFUSNhoUm89pDz-eXtVTHNwJW4IAQLyn_Gl2HjN_W9STa9fXsAlBOWk',

  isSupported() {
    return 'serviceWorker' in navigator
        && 'PushManager'   in window
        && 'Notification'  in window;
  },

  getPermission() {
    return Notification.permission;
  },

  _toUint8Array(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  },

  async subscribe() {
    if (!this.isSupported()) return null;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return null;

      const reg = await navigator.serviceWorker.ready;
      let sub   = await reg.pushManager.getSubscription();

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: this._toUint8Array(this.VAPID_PUBLIC_KEY),
        });
      }

      await this._save(sub);
      return sub;
    } catch (e) {
      console.error('Push subscribe failed:', e);
      return null;
    }
  },

  async unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await this._remove(sub);
      }
    } catch {}
  },

  async isSubscribed() {
    if (!this.isSupported()) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      return !!(await reg.pushManager.getSubscription());
    } catch { return false; }
  },

  async _save(sub) {
    const user = APP.currentUser;
    if (!user) return;
    // Extract the keys from the subscription
    const p256dh = sub.getKey('p256dh')
      ? btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh'))))
      : '';
    const auth = sub.getKey('auth')
      ? btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))))
      : '';

    await Sheets.post('savePushSubscription', {
      userId:   user.id,
      name:     user.name,
      email:    user.email,
      endpoint: sub.endpoint,
      p256dh,
      auth,
      savedAt:  new Date().toISOString(),
    });
    Store.set('ff_push_subscribed', true);
  },

  async _remove(sub) {
    const user = APP.currentUser;
    if (!user) return;
    await Sheets.post('removePushSubscription', {
      userId:   user.id,
      endpoint: sub.endpoint,
    });
    Store.set('ff_push_subscribed', false);
  },
};

// ── AUTO-INIT AFTER LOGIN ─────────────────────────────────────────
async function initPushNotifications() {
  if (!PUSH.isSupported()) return;
  if (Notification.permission === 'granted') {
    await PUSH.subscribe(); // silently renew subscription on every login
  } else if (Notification.permission === 'default') {
    setTimeout(showPushPrompt, 5000); // ask after 5 s on dashboard
  }
}

function showPushPrompt(force = false) {
  if (!APP.currentUser) return;
  if (APP.currentUser.role === 'ADMIN') return;
  // Only auto-show on dashboard; but can be forced from profile menu
  if (!force && APP.currentPage !== 'page-dashboard') return;
  if (!force && Store.get('ff_push_dismissed_today') === new Date().toDateString()) return;
  const banner = document.getElementById('push-banner');
  if (banner) {
    banner.classList.remove('hidden');
    banner.style.display = 'block';
  }
}

async function acceptPushNotifications() {
  const b = document.getElementById('push-banner');
  if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
  const sub = await PUSH.subscribe();
  showToast(
    sub ? '🔔 Daily workout reminders enabled!' : 'Could not enable — check browser settings.',
    sub ? 'success' : 'error'
  );
}

function dismissPushNotifications() {
  const b = document.getElementById('push-banner');
  if (b) { b.classList.add('hidden'); b.style.display = 'none'; }
  Store.set('ff_push_dismissed_today', new Date().toDateString());
}
