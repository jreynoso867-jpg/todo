// A stand-in for what the iPhone app puts on the page before it loads: window.Capacitor with its plugins, shaped
// like the real iOS bridge (each method returns a Promise; addListener hands back { remove } right away, not a Promise;
// a notification tap that opened the app waits until a listener is added). Every call is recorded in window.__cap.
// Usage: page.addInitScript(fakeCapacitor, { notify: 'prompt' | 'granted' | 'denied', files: {...}, tap: {...} })
'use strict';

function fakeCapacitor(opts = {}) {
  const cap = window.__cap = {
    calls: [], pending: new Map(), files: new Map(Object.entries(opts.files || {})), notify: opts.notify || 'prompt',
    shareCancels: !!opts.shareCancels, listeners: {}, held: {},
  };
  if (opts.tap) cap.held['LocalNotifications/localNotificationActionPerformed'] = [{ actionId: 'tap', notification: { id: 1, title: 'x', body: 'y', extra: opts.tap } }];
  const later = v => new Promise(ok => setTimeout(() => ok(v), 5));
  const fail = msg => new Promise((ok, no) => setTimeout(() => no(new Error(msg)), 5));
  const rec = (plugin, method, args) => cap.calls.push({ plugin, method, args });
  const uri = (dir, path) => `file:///var/mobile/Containers/Data/Application/APP/${dir === 'DOCUMENTS' ? 'Documents' : 'Library/Caches'}/${path}`;
  function plugin(name, methods) {
    const p = {};
    for (const [m, fn] of Object.entries(methods)) p[m] = o => { rec(name, m, o); return fn(o); };
    p.addListener = (event, cb) => {
      rec(name, 'addListener', { event });
      const key = `${name}/${event}`;
      (cap.listeners[key] = cap.listeners[key] || []).push(cb);
      for (const ev of cap.held[key] || []) setTimeout(() => cb(ev), 0);
      delete cap.held[key];
      return { remove: async () => { cap.listeners[key] = (cap.listeners[key] || []).filter(f => f !== cb); } };
    };
    p.removeAllListeners = () => later(undefined);
    return p;
  }
  const Plugins = {
    LocalNotifications: plugin('LocalNotifications', {
      checkPermissions: () => later({ display: cap.notify }),
      requestPermissions: () => { if (cap.notify === 'prompt') cap.notify = opts.answer || 'granted'; return later({ display: cap.notify }); },
      getPending: () => later({ notifications: [...cap.pending.values()].map(n => ({ id: n.id, title: n.title, body: n.body, schedule: { at: n.at }, extra: n.extra })) }),
      cancel: o => { for (const n of o.notifications) cap.pending.delete(Number(n.id)); return later(undefined); },
      schedule: o => {
        for (const n of o.notifications) {
          if (!Number.isInteger(n.id)) return fail('Notification is missing an identifier.');
          if (!(n.schedule && n.schedule.at instanceof Date)) return fail('schedule.at must be a Date');
          cap.pending.set(n.id, { ...n, at: n.schedule.at.getTime() });
        }
        return later({ notifications: o.notifications.map(n => ({ id: n.id })) });
      },
    }),
    Haptics: plugin('Haptics', { impact: () => later(), notification: () => later(), selectionStart: () => later(), selectionChanged: () => later(), selectionEnd: () => later(), vibrate: () => later() }),
    SystemBars: plugin('SystemBars', { setStyle: () => later(), setAnimation: () => later(), show: () => later(), hide: () => later() }),
    Share: plugin('Share', {
      canShare: () => later({ value: true }),
      share: () => (cap.shareCancels ? fail('Share canceled') : later({ activityType: 'com.apple.DocumentManagerUICore.SaveToFiles' })),
    }),
    Filesystem: plugin('Filesystem', {
      writeFile: o => { if (typeof o.data !== 'string') return fail('data must be a string'); cap.files.set(`${o.directory}/${o.path}`, { data: o.data, encoding: o.encoding || null }); return later({ uri: uri(o.directory, o.path) }); },
      readdir: o => {
        const pre = `${o.directory}/${o.path}/`;
        return later({ files: [...cap.files.keys()].filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => ({ name: k.slice(pre.length), type: 'file' })) });
      },
      deleteFile: o => { cap.files.delete(`${o.directory}/${o.path}`); return later(undefined); },
      getUri: o => later({ uri: uri(o.directory, o.path) }),
    }),
    App: plugin('App', { getInfo: () => later({ version: '2.0.0', build: '1' }), getState: () => later({ isActive: true }) }),
  };
  window.Capacitor = {
    DEBUG: false, isLoggingEnabled: false, Plugins,
    isNativePlatform: () => true, getPlatform: () => 'ios',
    isPluginAvailable: name => Object.prototype.hasOwnProperty.call(Plugins, name),
  };
  // Tests call this to act like iOS: a tap on a notification while the app is open.
  cap.fire = (plugin, event, data) => (cap.listeners[`${plugin}/${event}`] || []).forEach(cb => cb(data));
}

module.exports = { fakeCapacitor };
