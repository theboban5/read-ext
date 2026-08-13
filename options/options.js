document.addEventListener('DOMContentLoaded', function () {
  const el = (id) => document.getElementById(id);

  const baseUrlInput = el('base-url');
  const tokenInput = el('token');
  const testBtn = el('test-btn');
  const saveBtn = el('save-btn');
  const previewBtn = el('preview-btn');
  const migrateBtn = el('migrate-btn');
  const syncBtn = el('sync-btn');
  const resetBtn = el('reset-btn');

  const testResult = el('test-result');
  const migrateResult = el('migrate-result');
  const resetResult = el('reset-result');

  let connectionOk = false;

  refreshStatus();

  // ---------- helpers ----------

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response) return reject(new Error('No response from the extension background.'));
        if (response.success === false) return reject(new Error(response.message || 'Failed.'));
        resolve(response);
      });
    });
  }

  function show(node, html, cls) {
    node.className = 'result' + (cls ? ' ' + cls : '');
    node.innerHTML = html;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  function when(ts) {
    if (!ts) return 'never';
    const d = new Date(ts);
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    return d.toLocaleString();
  }

  function busy(btn, label, fn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        btn.disabled = false;
        btn.textContent = original;
      });
  }

  // ---------- connection ----------

  testBtn.addEventListener('click', () =>
    busy(testBtn, 'Testing...', async () => {
      const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, '');
      const token = tokenInput.value.trim();

      if (!baseUrl || !token) {
        show(testResult, 'Enter both the worker URL and the token.', 'error');
        return;
      }

      // Chrome will not let the background fetch an arbitrary host without
      // permission for it, and asking requires this click as the user gesture.
      try {
        const origin = new URL(baseUrl).origin + '/*';
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) {
          show(testResult, 'Permission for that host was declined, so sync cannot reach it.', 'error');
          return;
        }
      } catch (err) {
        show(testResult, 'That does not look like a valid URL.', 'error');
        return;
      }

      try {
        const { health } = await send({ action: 'testConnection', baseUrl, token });
        connectionOk = true;
        saveBtn.disabled = false;
        previewBtn.disabled = false;
        show(
          testResult,
          `Connected. Server has <strong>${health.counts.entries}</strong> articles, ` +
            `<strong>${health.counts.reads}</strong> read events, ` +
            `<strong>${health.counts.toread}</strong> queued.`,
          'ok'
        );
        await refreshStatus();
      } catch (err) {
        connectionOk = false;
        saveBtn.disabled = true;
        show(testResult, esc(err.message), 'error');
      }
    })
  );

  saveBtn.addEventListener('click', () =>
    busy(saveBtn, 'Saving...', async () => {
      try {
        await send({
          action: 'setSyncConfig',
          baseUrl: baseUrlInput.value.trim(),
          token: tokenInput.value.trim(),
        });
        show(testResult, 'Saved.', 'ok');
        await refreshStatus();
      } catch (err) {
        show(testResult, esc(err.message), 'error');
      }
    })
  );

  // ---------- migration ----------

  previewBtn.addEventListener('click', () =>
    busy(previewBtn, 'Checking...', async () => {
      try {
        const p = await send({ action: 'previewMigration' });
        migrateBtn.disabled = false;

        let html =
          `<strong>${p.before.blogs}</strong> read entries and <strong>${p.before.toRead}</strong> queued ` +
          `become <strong>${p.articles}</strong> articles with <strong>${p.reads}</strong> read events.`;

        // Collisions are the one thing worth eyeballing before uploading: they are
        // the only part of this that is expensive to change afterwards.
        if (p.collisions.length) {
          html +=
            `<br><br><strong>${p.collisions.length}</strong> URL${p.collisions.length === 1 ? '' : 's'} ` +
            `normalize together and will merge into one article. All read events are kept.<ul>` +
            p.collisions
              .slice(0, 25)
              .map((c) => `<li>${c.urls.map((u) => `<code>${esc(u)}</code>`).join(' + ')}</li>`)
              .join('') +
            (p.collisions.length > 25 ? `<li>…and ${p.collisions.length - 25} more</li>` : '') +
            `</ul>`;
          if (p.collisions.length > 25) {
            html +=
              `<br>That is a lot of merging. If these do not look like genuine duplicates, ` +
              `stop and loosen the rules in <code>background/urlkey.js</code> before migrating.`;
          }
        } else {
          html += `<br><br>No URL collisions.`;
        }

        if (p.dropped.length) {
          html +=
            `<br><br><strong>${p.dropped.length}</strong> entr${p.dropped.length === 1 ? 'y has' : 'ies have'} ` +
            `no usable URL and will be skipped.`;
        }

        show(migrateResult, html, null);
      } catch (err) {
        show(migrateResult, esc(err.message), 'error');
      }
    })
  );

  migrateBtn.addEventListener('click', () => {
    if (!confirm('Upload everything in this browser to the sync server?\n\nA backup will download first.')) return;

    return busy(migrateBtn, 'Migrating...', async () => {
      show(migrateResult, 'Backing up, then uploading...', null);
      try {
        const r = await send({ action: 'runMigration' });

        if (r.alreadyMigrated) {
          show(migrateResult, 'Already migrated.', 'ok');
          return;
        }

        if (r.ok === false) {
          show(
            migrateResult,
            `<strong>Stopped before finishing.</strong> Nothing local was deleted.<ul>` +
              r.problems.map((p) => `<li>${esc(p)}</li>`).join('') +
              `</ul>Your data is untouched and a backup is in Downloads.`,
            'error'
          );
          return;
        }

        show(
          migrateResult,
          `Migrated. <strong>${r.after.articles}</strong> articles, ` +
            `<strong>${r.after.reads}</strong> read events, ` +
            `<strong>${r.after.toread}</strong> queued.` +
            (r.collisions.pairs.length ? `<br>${r.collisions.pairs.length} URL groups merged.` : '') +
            (r.dropped.length ? `<br>${r.dropped.length} entries skipped (no usable URL).` : ''),
          'ok'
        );
        await refreshStatus();
      } catch (err) {
        show(migrateResult, esc(err.message) + '<br>Nothing local was deleted.', 'error');
      }
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'migrationProgress' && msg.progress) {
      const p = msg.progress;
      if (p.step === 'uploading' && p.total) {
        show(migrateResult, `Uploading ${p.done || 0} of ${p.total}...`, null);
      } else if (p.message) {
        show(migrateResult, esc(p.message), null);
      }
    }
  });

  // ---------- status ----------

  syncBtn.addEventListener('click', () =>
    busy(syncBtn, 'Syncing...', async () => {
      try {
        await send({ action: 'syncNow' });
      } catch (err) {
        /* refreshStatus surfaces it from lastError */
      }
      await refreshStatus();
    })
  );

  resetBtn.addEventListener('click', () => {
    if (!confirm('Discard the local copy and download everything again from the server?')) return;
    return busy(resetBtn, 'Resetting...', async () => {
      try {
        const r = await send({ action: 'resetLocalCache' });
        show(resetResult, `Re-pulled ${r.entries} articles and ${r.reads} read events.`, 'ok');
        await refreshStatus();
      } catch (err) {
        show(resetResult, esc(err.message), 'error');
      }
    });
  });

  async function refreshStatus() {
    let s;
    try {
      s = await send({ action: 'getSyncStatus' });
    } catch (err) {
      return;
    }

    if (s.baseUrl && !baseUrlInput.value) baseUrlInput.value = s.baseUrl;

    el('s-configured').textContent = s.configured ? 'yes' : 'no';
    el('s-migrated').textContent = s.migrated ? 'yes' : 'not yet';
    el('s-articles').textContent = s.counts.articles;
    el('s-reads').textContent = s.counts.reads;
    el('s-toread').textContent = s.counts.toread;
    el('s-pull').textContent = when(s.lastPullAt);
    el('s-push').textContent = when(s.lastPushAt);
    el('s-pending').textContent = s.pendingOps;
    el('s-since').textContent = s.since;

    const errBox = el('s-error');
    if (s.lastError) {
      errBox.style.display = 'block';
      errBox.textContent =
        s.lastError.message +
        (s.lastError.code === 'auth' ? ' Sync is paused until this is fixed.' : '');
    } else {
      errBox.style.display = 'none';
    }

    // Migration is a one-time thing; hide it once it has happened.
    el('migrate-card').style.display = s.migrated ? 'none' : '';
    if (s.configured && !s.migrated) previewBtn.disabled = false;
  }
});
