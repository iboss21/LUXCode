/* ============================================================
   LXR Cursor Settings — Smart, beautiful, actually working
   Cursor + v0.app aesthetic on top of LXR NUI system (lxr-medic style)
   Fully self-contained. Live sync. Profiles. Import/Export.
   ============================================================ */

(function () {
  'use strict';

  const resourceName = (typeof GetParentResourceName === 'function' && GetParentResourceName()) || 'lxr-medic';

  // === Declarative "everything" schema ===
  // Add / modify categories here. Other resources can call LXRSettings.registerCategory(...) at runtime.
  const DEFAULT_SCHEMA = [
    {
      id: 'general',
      label: 'General',
      icon: '⚙',
      desc: 'Core medic behavior and permissions.',
      fields: [
        { key: 'enabled', type: 'toggle', label: 'Medic System Enabled', desc: 'Master switch for the entire resource.', default: true },
        { key: 'requireJob', type: 'toggle', label: 'Require EMS Job', desc: 'Only players with the medic job can use most features.', default: true },
        { key: 'callKey', type: 'text', label: 'Call Medic Key', desc: 'Key to call for help when downed (G recommended).', default: 'G' },
        { key: 'adminCommand', type: 'text', label: 'Admin Command', desc: 'Chat command to open admin panel.', default: 'medadmin' },
      ]
    },
    {
      id: 'medical',
      label: 'Medical',
      icon: '💉',
      desc: 'Bleed rates, timers, revive, last stand, NPC doctor.',
      fields: [
        { key: 'lastStandDuration', type: 'number', label: 'Last Stand Duration (s)', min: 30, max: 600, step: 5, default: 120, unit: 'sec' },
        { key: 'bleedRate', type: 'number', label: 'Bleed Rate', desc: 'Higher = faster blood loss. 1.0 is baseline.', min: 0.2, max: 4, step: 0.1, default: 1.0 },
        { key: 'reviveTime', type: 'number', label: 'Revive Time (s)', min: 3, max: 30, step: 1, default: 8, unit: 'sec' },
        { key: 'npcDoctorEnabled', type: 'toggle', label: 'NPC Doctor Rescue', desc: 'Allow calling an NPC doctor when no medics are online.', default: true },
        { key: 'npcWaitBase', type: 'number', label: 'NPC Doctor Base Wait (s)', min: 20, max: 300, step: 5, default: 90 },
      ]
    },
    {
      id: 'billing',
      label: 'Billing & Economy',
      icon: '💰',
      desc: 'Cash billing, prices, auto-charge behavior.',
      fields: [
        { key: 'billingEnabled', type: 'toggle', label: 'Billing Enabled', default: true },
        { key: 'basePrice', type: 'number', label: 'Base Treatment Price', default: 250, unit: '$' },
        { key: 'chargeOnSave', type: 'toggle', label: 'Auto-charge on Save Record', desc: 'Deduct cash from patient when medic saves the record.', default: true },
        { key: 'maxBill', type: 'number', label: 'Maximum Bill Amount', default: 2500, unit: '$' },
      ]
    },
    {
      id: 'profiles',
      label: 'Performance Profiles',
      icon: '⚡',
      desc: 'One-click tuning for busy vs immersive servers. Changes multiple medical values at once.',
      fields: [
        { key: '_profile', type: 'profiles', label: 'Quick Profile', desc: 'Applies a balanced set of values instantly.' }
      ]
    },
    {
      id: 'hud',
      label: 'HUD & Feedback',
      icon: '🖥',
      desc: 'Downed HUD, progress bars, notifications.',
      fields: [
        { key: 'downedHudStyle', type: 'select', label: 'Downed HUD Style', options: [{v:'center',l:'Center (dramatic)'},{v:'right',l:'Right (compact)'}], default: 'center' },
        { key: 'showProgressBar', type: 'toggle', label: 'Show Bleed Progress Bar', default: true },
        { key: 'notifyStyle', type: 'select', label: 'Notify Style', options: [{v:'ox',l:'ox_lib'},{v:'native',l:'Native GTA'}], default: 'ox' },
      ]
    },
    {
      id: 'keys',
      label: 'Keybinds',
      icon: '⌨',
      desc: 'All primary controls (player + medic).',
      fields: [
        { key: 'keyCallMedic', type: 'text', label: 'Call for Medic', default: 'G' },
        { key: 'keyQuickDiagnose', type: 'text', label: 'Quick Diagnose (on target)', default: 'E' },
        { key: 'keyOpenBoss', type: 'text', label: 'Open Boss Menu', default: 'F6' },
      ]
    },
    {
      id: 'advanced',
      label: 'Advanced',
      icon: '🔧',
      desc: 'Dangerous / performance options. Use with care.',
      fields: [
        { key: 'allowSelfRevive', type: 'toggle', label: 'Allow Self-Revive (debug only)', default: false, danger: true },
        { key: 'debugLogs', type: 'toggle', label: 'Verbose Debug Logs', default: false },
        { key: 'staggerNui', type: 'number', label: 'NUI Stagger (ms)', desc: 'Delay between heavy SendNUIMessage chunks for CEF stability.', default: 70, min: 0, max: 200 },
      ]
    },
    {
      id: 'about',
      label: 'About',
      icon: '🐺',
      desc: 'LXRCore • The Land of Wolves',
      fields: [
        { key: '_about', type: 'about' }
      ]
    }
  ];

  const state = {
    open: false,
    config: {},
    schema: JSON.parse(JSON.stringify(DEFAULT_SCHEMA)),
    dirty: false,
    search: '',
    activeCategory: 'general',
    locale: {},
  };

  let container = null;

  function postNUI(event, payload) {
    const body = Object.assign({}, payload || {});
    return fetch('https://' + resourceName + '/' + event, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json()).catch(() => ({}));
  }

  function nuiT(key, fb) {
    return state.locale[key] || fb || key;
  }

  // === Public API (extensible) ===
  window.LXRSettings = {
    registerCategory(cat) {
      if (!cat || !cat.id) return;
      const idx = state.schema.findIndex(c => c.id === cat.id);
      if (idx >= 0) state.schema[idx] = { ...state.schema[idx], ...cat };
      else state.schema.push(cat);
      if (state.open) renderAll();
    },
    open(initialConfig, localeBundle) {
      if (localeBundle) state.locale = { ...state.locale, ...localeBundle };
      state.config = { ...initialConfig };
      state.dirty = false;
      state.search = '';
      ensureDOM();
      container.classList.remove('hidden');
      state.open = true;
      renderAll();
      const s = container.querySelector('.lxr-settings-search');
      if (s) setTimeout(() => s.focus(), 30);
    },
    close() {
      if (!state.open) return;
      state.open = false;
      if (container) container.classList.add('hidden');
      postNUI('settings:close', { config: state.config });
    },
    getConfig() { return { ...state.config }; },
  };

  function ensureDOM() {
    if (container && document.body.contains(container)) return;

    container = document.createElement('section');
    container.id = 'tab-settings';
    container.className = 'lxr-medic-layout-wrap lxr-settings-shell hidden';

    container.innerHTML = `
      <div class="lxr-medic-layout">
        <div class="lxr-settings-top" style="grid-column: 1 / -1; padding: 0 0 8px 0; display:flex; align-items:center; gap:12px;">
          <div style="font-weight:800; letter-spacing:.03em; color:#f7edd9; font-size:13px;">SETTINGS</div>
          <input class="lxr-settings-search" placeholder="Search settings... ( / to focus )" />
          <div style="flex:1"></div>
          <button class="cfg-btn cfg-btn--ghost" id="lxrSettingsClose">Close</button>
        </div>

        <aside class="lxr-medic-side lxr-settings-nav" style="width:210px; padding-top:4px;">
          <div id="lxrSettingsNav" class="cfg-nav"></div>
        </aside>

        <section class="lxr-medic-content lxr-scroll-minimal" style="padding-top:4px;">
          <div id="lxrSettingsContent"></div>

          <div class="lxr-settings-footer">
            <span class="lxr-settings-dirty" id="lxrSettingsDirty" style="display:none;">Unsaved changes</span>
            <div class="lxr-settings-actions">
              <button class="cfg-btn cfg-btn--ghost" id="lxrSettingsExport">Export JSON</button>
              <button class="cfg-btn cfg-btn--ghost" id="lxrSettingsImport">Import JSON</button>
              <button class="cfg-btn cfg-btn--ghost" id="lxrSettingsReset">Reset All</button>
              <button class="cfg-btn" id="lxrSettingsApply">Apply &amp; Save</button>
            </div>
          </div>
        </section>
      </div>
    `;

    const main = document.querySelector('.adm-main') || document.getElementById('app');
    if (main) main.appendChild(container);

    container.querySelector('#lxrSettingsClose').onclick = () => window.LXRSettings.close();

    const search = container.querySelector('.lxr-settings-search');
    search.oninput = (e) => {
      state.search = (e.target.value || '').toLowerCase().trim();
      renderContent();
    };

    // Cursor muscle memory: / focuses search
    document.addEventListener('keydown', (e) => {
      if (!state.open) return;
      if (e.key === '/' && document.activeElement.tagName === 'BODY') {
        e.preventDefault();
        search.focus();
        search.select();
      }
    });

    container.querySelector('#lxrSettingsApply').onclick = applyAndSave;
    container.querySelector('#lxrSettingsReset').onclick = resetAll;
    container.querySelector('#lxrSettingsExport').onclick = exportJSON;
    container.querySelector('#lxrSettingsImport').onclick = importJSON;
  }

  function renderNav() {
    const nav = container.querySelector('#lxrSettingsNav');
    nav.innerHTML = '';

    state.schema.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'cfg-nav__btn' + (cat.id === state.activeCategory ? ' cfg-nav__btn--active' : '');
      btn.innerHTML = `${cat.icon || ''} <span style="margin-left:6px;">${cat.label}</span>`;
      btn.onclick = () => {
        state.activeCategory = cat.id;
        renderNav();
        renderContent();
      };
      nav.appendChild(btn);
    });
  }

  function renderContent() {
    const root = container.querySelector('#lxrSettingsContent');
    root.innerHTML = '';

    const q = state.search;

    state.schema.forEach(cat => {
      const visibleFields = cat.fields.filter(f => {
        if (!q) return true;
        const hay = (f.label + ' ' + (f.desc || '') + ' ' + f.key).toLowerCase();
        return hay.includes(q);
      });

      if (q && visibleFields.length === 0) return;
      if (!q && cat.id !== state.activeCategory) return;

      const wrap = document.createElement('div');
      wrap.className = 'lxr-settings-category';
      wrap.dataset.cat = cat.id;

      wrap.innerHTML = `
        <div class="lxr-settings-category-head">
          <h3>${cat.icon || ''} ${cat.label}</h3>
          <span class="lxr-settings-count">${visibleFields.length} setting${visibleFields.length===1?'':'s'}</span>
        </div>
        ${cat.desc ? `<div class="cfg-lead" style="margin-bottom:10px;">${cat.desc}</div>` : ''}
        <div class="lxr-settings-fields"></div>
      `;

      const fieldsHost = wrap.querySelector('.lxr-settings-fields');

      visibleFields.forEach(field => {
        const row = document.createElement('div');
        row.className = 'lxr-setting-row';
        row.dataset.key = field.key;

        const currentVal = (state.config[field.key] !== undefined) ? state.config[field.key] : field.default;
        let controlHTML = '';

        if (field.type === 'toggle') {
          const checked = currentVal ? 'checked' : '';
          controlHTML = `
            <label class="lxr-switch">
              <input type="checkbox" ${checked} data-key="${field.key}" />
              <span class="track"><span class="thumb"></span></span>
            </label>
          `;
        } else if (field.type === 'number') {
          controlHTML = `
            <div class="lxr-num">
              <input type="number" class="cfg-input" data-key="${field.key}" value="${currentVal}" min="${field.min||''}" max="${field.max||''}" step="${field.step||1}" />
              ${field.unit ? `<span class="unit">${field.unit}</span>` : ''}
            </div>
          `;
        } else if (field.type === 'select' && field.options) {
          const opts = field.options.map(o => `<option value="${o.v}" ${String(o.v)===String(currentVal)?'selected':''}>${o.l}</option>`).join('');
          controlHTML = `<select class="cfg-input" data-key="${field.key}">${opts}</select>`;
        } else if (field.type === 'text') {
          controlHTML = `<input type="text" class="cfg-input" data-key="${field.key}" value="${currentVal || ''}" />`;
        } else if (field.type === 'profiles') {
          controlHTML = `
            <div class="lxr-profiles">
              <button class="lxr-profile-btn" data-profile="lite">Lite (fast server)</button>
              <button class="lxr-profile-btn" data-profile="balanced">Balanced</button>
              <button class="lxr-profile-btn" data-profile="max">Max (immersive)</button>
            </div>
          `;
        } else if (field.type === 'about') {
          controlHTML = `
            <div style="max-width:420px; font-size:12px; color:var(--muted);">
              LXRCore • The Land of Wolves<br>
              <span style="color:#c9a96e;">lxrcore.com</span><br>
              Cursor-grade settings for RedM. Changes apply live.
            </div>
          `;
        }

        const title = field.label || field.key;
        const danger = field.danger ? ` <span style="color:#a83a3a; font-size:10px;">(dangerous)</span>` : '';

        row.innerHTML = `
          <div class="lxr-setting-label">
            <div class="lxr-setting-title">${title}${danger}</div>
            ${field.desc ? `<div class="lxr-setting-desc">${field.desc}</div>` : ''}
          </div>
          <div class="lxr-setting-control">${controlHTML}</div>
        `;

        // Live binding
        const input = row.querySelector('input,select');
        if (input) {
          const update = () => {
            let val = input.type === 'checkbox' ? input.checked : input.value;
            if (input.type === 'number') val = parseFloat(val) || 0;
            state.config[field.key] = val;
            state.dirty = true;
            updateDirty();
            postNUI('settings:update', { key: field.key, value: val });
          };
          input.addEventListener('change', update);
          if (input.type === 'text' || input.tagName === 'SELECT') {
            input.addEventListener('input', () => {
              let val = input.value;
              if (input.type === 'number') val = parseFloat(val) || 0;
              state.config[field.key] = val;
              state.dirty = true;
              updateDirty();
            });
          }
        }

        // Smart profiles
        row.querySelectorAll('.lxr-profile-btn').forEach(b => {
          b.addEventListener('click', () => {
            applyProfile(b.dataset.profile);
            row.querySelectorAll('.lxr-profile-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            setTimeout(() => b.classList.remove('active'), 650);
          });
        });

        fieldsHost.appendChild(row);
      });

      root.appendChild(wrap);
    });
  }

  function updateDirty() {
    const el = container && container.querySelector('#lxrSettingsDirty');
    if (el) el.style.display = state.dirty ? 'inline' : 'none';
  }

  function applyProfile(name) {
    const p = {
      lite:     { lastStandDuration: 60,  bleedRate: 1.6, reviveTime: 5,  npcWaitBase: 45 },
      balanced: { lastStandDuration: 120, bleedRate: 1.0, reviveTime: 8,  npcWaitBase: 90 },
      max:      { lastStandDuration: 240, bleedRate: 0.6, reviveTime: 14, npcWaitBase: 160 },
    }[name] || {};

    Object.keys(p).forEach(k => {
      state.config[k] = p[k];
      postNUI('settings:update', { key: k, value: p[k] });
    });
    state.dirty = true;
    updateDirty();
    renderContent();
  }

  function renderAll() {
    renderNav();
    renderContent();
    updateDirty();
  }

  function applyAndSave() {
    state.dirty = false;
    updateDirty();
    postNUI('settings:save', { config: state.config });
    const b = container.querySelector('#lxrSettingsApply');
    const orig = b.textContent;
    b.textContent = 'Saved ✓';
    setTimeout(() => { if (b) b.textContent = orig; }, 1400);
  }

  function resetAll() {
    if (!confirm('Reset ALL settings to defaults? This cannot be undone.')) return;

    state.schema.forEach(cat => cat.fields.forEach(f => {
      if (f.default !== undefined && f.type !== 'profiles' && f.type !== 'about') {
        state.config[f.key] = f.default;
        postNUI('settings:update', { key: f.key, value: f.default });
      }
    }));
    state.dirty = true;
    renderContent();
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state.config, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lxr-medic-settings.json';
    a.click();
  }

  function importJSON() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          Object.keys(data).forEach(k => {
            state.config[k] = data[k];
            postNUI('settings:update', { key: k, value: data[k] });
          });
          state.dirty = true;
          renderContent();
        } catch(e){ alert('Bad JSON file'); }
      };
      r.readAsText(f);
    };
    inp.click();
  }

  // === Message bridge (matches your existing lxr-medic pattern) ===
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.action === 'openSettings' || d.action === 'settings:open') {
      window.LXRSettings.open(d.config || d.settings || {}, d.locale || {});
    }
    if (d.action === 'settings:apply' && d.config) {
      state.config = { ...state.config, ...d.config };
      if (state.open) renderContent();
    }
  });

  console.log('%c[LXR] Cursor-grade Settings loaded (v0 + Cursor quality, fully working)', 'color:#c9a96e');
})();
